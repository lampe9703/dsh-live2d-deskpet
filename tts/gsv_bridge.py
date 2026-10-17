#!/usr/bin/env python3
"""
GSV-TTS 本地合成桥（为 dsh-live2d-deskpet 桌宠发声用）。

运行方式（由插件宿主拉起，也可手动验证）：
    python gsv_bridge.py \
        --models "<gsv_models_dir>" \
        --gpt     "<Nanami_Chiaki-e15.ckpt>" \
        --sovits  "<Nanami_Chiaki_e20_s940.pth>" \
        --spk-audio  "<examples/laffey.mp3>" \
        --prompt-audio "<examples/AnAn.ogg>" \
        --prompt-text "ちが……ちがう。レイア、貴様は間違っている。" \
        --lang ja \
        --port 9876

对外暴露一个最小的 HTTP JSON 接口（带 CORS），桌宠 renderer 用它把气泡文字
合成为语音并播放：

    POST /tts   {"text": "…", "lang": "ja|zh|auto"}  -> audio/wav 二进制
    GET  /ping  -> 桥存活自检（插件宿主用）

设计要点：
- 只依赖 Python 标准库 http.server，不额外引入 web 框架，避免污染 gsv-venv。
- 模型初始化较慢，放到 _with_tts 惰性加载，随第一请求预热；用线程锁串行推理
  （gsv 本身串行 + 锁保证线程安全）。
- lang=ja 时：
    * 若配置了 --translate-url（OpenAI 兼容 /chat/completions + 模型名），先调用
      它把中文文案翻成日文，再交给 GSV 以日文音素合成——即“气泡中文、发声日文”。
    * 未配置翻译端点时退化为强制日文音读（text_language="ja"，中文按日文 g2p 读）。
- lang=zh 直接以中文合成。

就绪上报（供桌宠在“模型载入显存后”主动问候）：
- 进程起来即监听端口，`/ping` 立刻可用，但 `ready` 仍为 false；
- 后台线程随后载入模型（`--warmup` 有值时再合成一句预热），完成后 `ready` 才置 true；
- `GET /health` 返回 `{ready, warmup, error}`，`error` 保留首次加载失败的原文。
  桌宠据此区分“桥没起来”（连不上）和“模型还没载入/载入失败”。

注意：本脚本假定运行所用 python 环境已安装 gsv_tts（工作区为 gsv-venv）。
"""

import argparse
import json
import os
import re
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_CN_DIGITS = str.maketrans("0123456789", "零一二三四五六七八九")


def request_log(line: str) -> None:
    """把每次 /tts 请求记一行，方便把"没声音"定位到具体一环：

      - 日志里没有新行  → 桌宠窗口压根没来请求（客户端侧问题）
      - 日志里有 FAIL 行 → 桥合成失败（文本/模型/翻译问题）
      - 日志里是 OK 行却没声音 → 播放器侧问题

    路径优先取 TEMP/TMP，取不到就放在脚本旁边——`tempfile.gettempdir()` 在某些
    宿主环境里会退化成当前工作目录，不可靠。
    """
    try:
        target = None
        for key in ("TEMP", "TMP", "TMPDIR"):
            base = os.environ.get(key)
            if base and os.path.isdir(base):
                target = os.path.join(base, "gsv-bridge-requests.log")
                break
        if target is None:
            target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge-requests.log")
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


def sanitize_for_tts(text: str) -> str:
    """把"第+阿拉伯数字"这种序号写成中文数字。

    gsv 的文本前端对这类输入会抛
    `ValueError: Text processing produced no valid segments`——实测 `第1句`/`第2句`
    必炸，而 `第0句`、`现在是2026年10月。` 都正常，所以只改这一种已知坏输入。
    """
    return re.sub(r"第(\d+)", lambda m: "第" + m.group(1).translate(_CN_DIGITS), text)


def sanitize_digits(text: str) -> str:
    """兜底清洗：把所有阿拉伯数字换成中文数字（仅在原样合成失败后才用）。"""
    return text.translate(_CN_DIGITS)

# ---------------------------------------------------------------------------
# 合成串行锁
# ---------------------------------------------------------------------------
# gsv_tts 的文本前端（LangSegment）用**类级静态变量**缓存分段结果，官方文档即注明
# "因 LangSegment 使用静态变量，需要加锁保证线程安全"；CUDA graph 的 precompile
# 产物注册同样不是并发安全的。
#
# 而本桥用的是 ThreadingHTTPServer（每请求一线程）：桌宠一次回复会拆成两三块气泡，
# 块块都发一次合成请求，两个请求一重叠就会交叉污染那段静态状态，表现为
# `Text processing produced no valid segments` 或
# `Artifact of type=precompile already registered in mega-cache artifact factory`
# ——一旦发生，进程内后续每个请求都可能继续失败，桌宠只能退回系统音。
# 所以合成必须串行：预检/健康检查不受影响。
_SYNTH_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# 命令行参数
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(description="GSV-TTS local synthesis bridge")
    p.add_argument("--models", required=True, help="gsv_models 目录（含 s1v3/s2Gv2ProPlus 与自训练模型）")
    p.add_argument("--gpt", default=None, help="GPT .ckpt 路径（默认 models/s1v3.ckpt）")
    p.add_argument("--sovits", default=None, help="SoVITS .pth 路径（默认 models/s2Gv2ProPlus.pth）")
    p.add_argument("--spk-audio", required=True, help="目标说话人参考音频（laffey.mp3）")
    p.add_argument("--prompt-audio", required=True, help="提示音频（AnAn.ogg）")
    p.add_argument("--prompt-text", required=True, help="提示音频对应文本")
    p.add_argument("--lang", default="ja", choices=["ja", "zh", "auto"])
    p.add_argument("--port", type=int, default=9876)
    p.add_argument("--translate-url", default=None, help="OpenAI 兼容中译日端点（可选）")
    p.add_argument("--translate-api-key", default=None)
    p.add_argument("--translate-model", default=None)
    p.add_argument("--warmup", default=None,
                   help="就绪前预合成的一句文本（宿主传人设问候语），让首句问候不用等冷启动")
    p.add_argument("--work-dir", default=None,
                   help="临时文件目录。本机标准 temp 目录下创建文件会**永久挂起**"
                        "（Python 的 mkstemp 卡死，PowerShell 却能写），必须指向工作区。")
    p.add_argument("--log-file", default=None,
                   help="把 stdout/stderr 重定向到这个文件；宿主据此把桥的报错留档（原来 stdio 被丢弃）")
    return p.parse_args()


ARGS = parse_args()

# ---------------------------------------------------------------------------
# 临时目录：必须在导入 gsv_tts / 载入模型**之前**定下来
# ---------------------------------------------------------------------------
# 本机的标准 temp 目录（%TEMP%、C:\WINDOWS\Temp 等）下创建文件会**永久挂起**：
# Python 的 mkstemp 卡死不出（PowerShell 写同一个目录却正常），而 gsv_tts 在载入
# 模型与合成时都要建临时文件。表现为 tempfile.gettempdir() 逐个探测候选目录全部
# 卡住，最后抛 "No usable temporary directory found"（模型载入失败），重试时又因
# 为缓存已被前一次失败的加载污染而报 "Artifact of type=precompile already
# registered in mega-cache artifact factory"。
#
# 直接给 tempfile 定一个确定可写的工作区目录，就绕开了那串会挂起的探测。
def _setup_temp_dir(preferred: str) -> str:
    """把 tempfile 指向一个确定可用的目录，避免自动探测卡死。

    只用 tempfile.tempdir 显式赋值：tempfile 在 tempdir 非 None 时**不再**探测
    环境变量与候选目录，所以定时点必须在任何建临时文件的代码之前。
    """
    candidates = []
    if preferred:
        candidates.append(preferred)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(os.path.dirname(script_dir), "tmp"))
    candidates.append(os.getcwd())
    for path in candidates:
        try:
            os.makedirs(path, exist_ok=True)
        except Exception:
            continue
        tempfile.tempdir = path
        print(f"[bridge] temp dir -> {path}", flush=True)
        return path
    print("[bridge] WARNING: no writable temp dir found; synthesis will likely stall",
          flush=True)
    return ""


_setup_temp_dir(ARGS.work_dir)

# ---------------------------------------------------------------------------
# 日志：宿主原来用 stdio='ignore' 拉起本进程，桥的任何报错都无处可看——"语音是
# 系统音色"因此无法定位。--log-file 让桥把自己的输出留档。
# ---------------------------------------------------------------------------
def _setup_log_file(path: str) -> None:
    """把 stdout/stderr 都指向 path（同时保留原 stderr 一份，便于手动前台运行）。"""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        handle = open(path, "a", encoding="utf-8", buffering=1)
    except Exception as exc:  # noqa: BLE001 日志失败绝不能拖垮发声
        print(f"[bridge] cannot open log file {path}: {exc}", file=sys.stderr)
        return
    original = sys.stderr
    sys.stdout = handle
    sys.stderr = handle

    def _excepthook(exc_type, exc_value, exc_tb):
        traceback.print_exception(exc_type, exc_value, exc_tb, file=original)
        traceback.print_exception(exc_type, exc_value, exc_tb, file=handle)

    sys.excepthook = _excepthook
    if hasattr(threading, "excepthook"):
        threading.excepthook = lambda info: _excepthook(
            info.exc_type, info.exc_value, info.exc_traceback
        )


if ARGS.log_file:
    _setup_log_file(ARGS.log_file)

# ---------------------------------------------------------------------------
# 就绪状态（供 /health 上报）
# ---------------------------------------------------------------------------
_HEALTH = {"ready": False, "warmup": bool(ARGS.warmup), "error": None}
_HEALTH_LOCK = threading.Lock()


def _mark_ready(error: str = None) -> None:
    with _HEALTH_LOCK:
        _HEALTH["ready"] = error is None
        if error is not None:
            _HEALTH["error"] = error[:600]


def warmup() -> None:
    """就绪前把模型载入显存（有 --warmup 时再合成一句）。

    先载入再合成，是为了让"模型载入完成"这件事本身可观测——桌宠正是等到这个
    时点才用人设问候语发声。合成失败不清空载入成果：推理一次不成功不代表模型
    不可用，`ready` 仍置真，由 /tts 自己逐级降级。
    """
    try:
        _with_tts()
    except Exception as exc:  # noqa: BLE001 加载失败要留在 /health 里给用户看
        print(f"[bridge] model load failed: {exc}", flush=True)
        traceback.print_exc()
        _mark_ready(_load_error or f"模型载入失败：{exc}")
        return
    if ARGS.warmup:
        try:
            started = time.time()
            audio = synthesize(ARGS.warmup, ARGS.lang)
            print(f"[bridge] warmup ok: {len(audio)} bytes in {time.time() - started:.1f}s",
                  flush=True)
        except Exception as exc:  # noqa: BLE001 预热失败不算致命
            print(f"[bridge] warmup synthesis failed: {exc}", flush=True)
            traceback.print_exc()
    _mark_ready()
    print("[bridge] ready: models loaded", flush=True)


# ---------------------------------------------------------------------------
# GSV 模型惰性加载
# ---------------------------------------------------------------------------
_tts = None
_tts_lock = threading.Lock()
_load_error = None
_load_failure_detail = None
# 就绪后不再重复尝试：这些错误（模型文件缺失/不匹配）重试多少次都一样，而每次
# 重试都会再往 artifact 工厂里塞一遍权重。
_SETUP_FAILURES = ("Artifact", "No such file", "not found", "Error(s) in loading")


def _load_tts() -> None:
    """载入模型；失败时把 `_tts` 复原为 None。

    原来的写法直接把 `tts` 赋给 `_tts` **再**载入权重，载入中途失败会留下一个
    半初始化的对象，而且异常被吞掉：冷启动那次以 tempfile 失败告终，重试时
    `_tts is not None` 让它以为已经就绪，随后报
    `Artifact of type=precompile already registered in mega-cache artifact factory`。
    现在只在整条链路成功后发布 `_tts`，失败就彻底丢弃这次尝试。
    """
    global _tts, _load_error, _load_failure_detail
    import gsv_tts
    from gsv_tts import TTS

    # 和部署说明一致：显式指定可写模型目录，规避 ~/.cache/gsv 写权限问题。
    tts = TTS(
        use_bert=True,
        models_dir=ARGS.models,
        gpt_cache=[(1, 512), (1, 1024)],
        sovits_cache=[50],
    )
    tts.load_gpt_model(ARGS.gpt or (ARGS.models + "/s1v3.ckpt"))
    tts.load_sovits_model(ARGS.sovits or (ARGS.models + "/s2Gv2ProPlus.pth"))
    _tts = tts
    _load_error = None
    _load_failure_detail = None


def _with_tts():
    """返回已载入的 TTS 实例；载入失败则抛出。

    失败后允许重试（用户可能刚修好路径），但如果错误类型注定重试无用，就不再
    反复载入——直接抛回上次的原因。
    """
    global _tts, _load_error, _load_failure_detail
    if _tts is not None:
        return _tts
    with _tts_lock:
        if _tts is not None:
            return _tts
        if _load_error and any(token in _load_failure_detail for token in _SETUP_FAILURES):
            raise RuntimeError(f"TTS 模型不可用（{_load_error}）；请检查模型路径后重启语音桥。")
        try:
            _load_tts()
        except Exception as exc:  # noqa: BLE001 失败要能被 /health 与调用方看到
            _tts = None
            _load_error = f"{type(exc).__name__}: {exc}"
            _load_failure_detail = str(exc)
            raise
    return _tts


def _infer_with(tts, body: str, language: str):
    """用给定实例合成一句，返回 wav 字节。"""
    clip = tts.infer(
        spk_audio_path=ARGS.spk_audio,
        prompt_audio_path=ARGS.prompt_audio,
        prompt_audio_text=ARGS.prompt_text,
        text=body,
        text_language=language,
        prompt_language="ja",
    )
    # AudioClip.save() 只收字符串路径；写临时文件再读回。
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    try:
        clip.save(tmp_path)
        with open(tmp_path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.close(fd)
        except Exception:
            pass
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 翻译（中译日，可选端点）
# ---------------------------------------------------------------------------
def translate_to_ja(text: str) -> str:
    """调用 OpenAI 兼容 /chat/completions 把中文翻成日文；未配置则原样返回。"""
    if not ARGS.translate_url or not ARGS.translate_model:
        return text
    # key 三级来源：命令行参数 > 环境变量 SILICONFLOW_API_KEY（DSH credentials refs
    # 会以 env 形式给 llm 插件，桥进程继承宿主环境）> 无（裸奔，服务端会 401）。
    api_key = ARGS.translate_api_key or os.environ.get("SILICONFLOW_API_KEY") or ""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body = {
        "model": ARGS.translate_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是精确的中译日翻译。把用户输入的中文翻译成地道、口语化的日文，"
                    "只输出译文本身，不要任何解释、引号或多余文字。适用于桌宠短句配音。"
                ),
            },
            {"role": "user", "content": text},
        ],
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        ARGS.translate_url.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return text


def synthesize(text: str, lang: str):
    """合成一句话，返回 wav 字节。lang: ja|zh|auto。"""
    effective = lang or ARGS.lang
    ja_wanted = effective == "ja"
    # 明确要日文发音：优先用翻译端点把中文翻成日文再合成；否则退化日语音读。
    has_translate = bool(ARGS.translate_url and ARGS.translate_model)
    target_text = text
    if ja_wanted and has_translate:
        # 翻译端点不可用（额度用尽 402、网络故障、模型名失效等）不能拖垮整次合成：
        # 退回"中文按日文音读"这条路，声线不变、照样出声。
        try:
            translated = translate_to_ja(text)
            target_text = translated or text
        except Exception:
            target_text = text
    if ja_wanted:
        target_lang = "ja"
    elif effective == "zh":
        target_lang = "zh"
    else:
        target_lang = "auto"

    tts = _with_tts()

    # 逐级重试：原样 → 序号数字中文化 → 全部数字中文化 →（非中文时）退回中文合成。
    # 任何一级成功就出声，避免整句 500 让桌宠退回系统音。
    attempts = [(target_text, target_lang)]
    targeted = sanitize_for_tts(target_text)
    if targeted != target_text:
        attempts.append((targeted, target_lang))
    broad = sanitize_digits(target_text)
    if broad not in (target_text, targeted):
        attempts.append((broad, target_lang))
    if target_lang != "zh":
        attempts.append((text, "zh"))
        broad_zh = sanitize_digits(text)
        if broad_zh != text:
            attempts.append((broad_zh, "zh"))

    wav = None
    last_error = None
    for body, language in attempts:
        try:
            wav = _infer_with(tts, body, language)
            break
        except Exception as exc:  # noqa: BLE001 逐级降级，最后一级失败才向上抛
            last_error = exc
            wav = None
    if wav is None:
        raise last_error if last_error is not None else RuntimeError("synthesis failed")
    return wav


# ---------------------------------------------------------------------------
# HTTP 接口
# ---------------------------------------------------------------------------
class BridgeHandler(BaseHTTPRequestHandler):
    """最小 JSON 接口；带通用 CORS 头，桌宠 renderer 跨端口可直连。"""

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            # 健康检查必须实时：任何中间层缓存都会让宿主把"桥已经好了"读成旧值。
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # 调用方（宿主 / 设置页）的健康检查有超时，桥正忙合成时可能提前放弃
            # 读响应。这既不是桥的故障，也不影响下一次请求，但 socketserver 会把
            # 它打成一大段 traceback，把真正的错误挤出日志窗口——所以就地吞掉。
            pass

    def do_GET(self):
        # 注意：send_header 必须在 send_response 之后调用，否则状态行会被排到
        # 响应头部中间（_send_json 自己会补 CORS 头，这里不要再提前调 _cors）。
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/ping":
            self._send_json(200, {"ok": True, "lang": ARGS.lang})
            return
        if parsed.path == "/health":
            # 桌宠用它区分三种状态：连不上（桥没起来）、ready=false（模型还在
            # 载入或载入失败）、ready=true（可以问候了）。
            with _HEALTH_LOCK:
                payload = {"ok": True, "lang": ARGS.lang, **_HEALTH}
            self._send_json(200, payload)
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            # 交接端点：新桥启动时会请旧桥从这里退出（单实例保证，见 _shutdown_existing）。
            if urllib.parse.urlparse(self.path).path == "/shutdown":
                self._send_json(200, {"ok": True, "bye": True})
                threading.Timer(0.2, lambda: os._exit(0)).start()
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
            text = str(payload.get("text") or "").strip()
            if not text:
                self._send_json(400, {"error": "empty text"})
                return
            lang = str(payload.get("lang") or ARGS.lang)
            if lang not in ("ja", "zh", "auto"):
                lang = ARGS.lang
            # 合成串行化：gsv 的文本前端/CUDA graph 注册都不能并发（见 _SYNTH_LOCK）。
            try:
                with _SYNTH_LOCK:
                    wav = synthesize(text, lang)
            except Exception as synth_error:
                request_log(
                    f"[{datetime.now().isoformat(timespec='seconds')}] FAIL lang={lang} "
                    f"text={text[:40]!r} error={str(synth_error)[:120]!r}"
                )
                raise
            request_log(
                f"[{datetime.now().isoformat(timespec='seconds')}] OK lang={lang} "
                f"bytes={len(wav)} text={text[:40]!r}"
            )
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.send_header("X-GSV-Lang", lang)
            self._cors()
            self.end_headers()
            self.wfile.write(wav)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "bad json"})
        except Exception as exc:  # noqa: BLE001 合成失败要原样报给桌宠
            self._send_json(500, {"error": str(exc)})

    def log_message(self, fmt, *args):  # 安静：错误由响应体返回，不刷控制台
        pass


def _shutdown_existing(port: int) -> None:
    """端口上若已有旧桥，请它退出后再接管——保证全局只有一个桥。

    桌面版每次重启，上一个宿主拉起的桥不会随之退出（Windows 子进程不继承生命周期），
    而 SO_REUSEADDR 又允许新桥绑同一端口：两个桥会同时加载同一份模型缓存（触发
    `Artifact ... already registered in mega-cache`）并争抢请求，落到坏的那个就
    表现为桌宠只能退回系统音。这里让"新桥赶走旧桥"。

    没有应答（端口空闲或是别的服务）时直接返回，不做任何事。
    """
    import socket as _socket
    import time as _time

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/ping", timeout=2) as resp:
            if resp.status != 200:
                return
    except Exception:
        return
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=3).read()
    except Exception:
        pass
    for _ in range(24):
        _time.sleep(0.25)
        try:
            _socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
        except Exception:
            return  # 端口已让出
    return


def main():
    host, port = "127.0.0.1", ARGS.port
    _shutdown_existing(port)
    server = ThreadingHTTPServer((host, port), BridgeHandler)
    print(f"GSV-TTS bridge listening on http://{host}:{port}", flush=True)
    # 先监听端口再后台载入模型：`/ping` 立刻可用（宿主据此判断桥是否拉起），
    # `/health` 的 ready 则要等模型真正进显存才翻转。
    threading.Thread(target=warmup, name="gsv-warmup", daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
