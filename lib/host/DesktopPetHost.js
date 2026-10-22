import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { ModelRegistry } from '../core/ModelRegistry.js';
import { activePersona, sectionToConfig } from '../shared/pet-section.js';
import { isTaskEventKind, taskStateFor } from '../shared/task-voice.js';
import { AgentSpeechService } from '../electron/services/AgentSpeechService.js';
import { MemoryStore } from '../electron/services/MemoryStore.js';
import { ensureSoullinkProfile } from '../electron/soullink/profile-store.js';
/**
 * How long after pushing a window size the host treats an incoming resize
 * report as Chromium's own frame-delta echo rather than a user drag.
 *
 * Measured on a real frameless window: the host's push reaches the Electron
 * main process, `setSize` runs, and the window's own `resize` event fires after
 * its 400ms settle debounce — the drift lands around 1.4s after the push. The
 * window therefore has to outlast that full round trip with margin, while
 * staying short enough that a deliberate drag right after a settings change is
 * still honoured. A drag needs the pointer on the grip and a settle, so 3s is
 * comfortably longer than the echo and comfortably shorter than a human gesture.
 */
const SIZE_ECHO_WINDOW_MS = 3_000;
// ── GSV-TTS 桥：默认路径全部从一个「工作区根」派生 ───────────────────────────
//
// 仓库里不出现任何绝对路径，也不出现用户名：根目录按
//   voice.workspaceDir > 环境变量 GSV_WORKSPACE > <用户主目录>/Documents/deepseek-harness/default-workspace
// 的顺序解析，其余路径都是它下面的相对位置。这样同一份代码在别人机器上也能跑，
// 只要他把 GSV-TTS-Lite 放在同样的工作区结构里，或者直接填设置页里的字段。
const GSV_DEFAULT_GPT = 'Nanami_Chiaki-e15.ckpt';
const GSV_DEFAULT_SOVITS = 'Nanami_Chiaki_e20_s940.pth';
const GSV_DEFAULT_PROMPT_TEXT = 'ちが……ちがう。レイア、貴様は間違っている。';
/** 参考音频所在的相对位置（GSV-TTS-Lite 自带的 examples 目录）。 */
const GSV_EXAMPLES = ['gsv-tts-lite', 'GSV-TTS-Lite-main', 'examples'];
/** 没有配置时的兜底工作区根目录；用 homedir() 现算，不写死用户名。 */
function defaultWorkspaceDir() {
    const fromEnv = process.env.GSV_WORKSPACE;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '')
        return fromEnv.trim();
    return join(homedir(), 'Documents', 'deepseek-harness', 'default-workspace');
}
/**
 * 把 voice 配置解析成一组确定路径。
 *
 * 每个字段都是「显式配置 > 工作区相对位置」；解析集中在一处，避免 `ensureBridge`
 * 与 `runtimeView` 各自拼一遍路径而慢慢漂开（日志路径就曾因为两处各拼一次而不一致）。
 */
export function resolveVoicePaths(voice = {}) {
    const workspace = typeof voice.workspaceDir === 'string' && voice.workspaceDir.trim() !== ''
        ? voice.workspaceDir.trim()
        : defaultWorkspaceDir();
    const models = voice.modelsDir || join(workspace, 'gsv_models');
    return {
        workspace,
        python: voice.pythonPath || (process.platform === 'win32'
            ? join(workspace, 'gsv-venv', 'Scripts', 'python.exe')
            : join(workspace, 'gsv-venv', 'bin', 'python')),
        models,
        gpt: join(models, voice.gptModel || GSV_DEFAULT_GPT),
        sovits: join(models, voice.sovitsModel || GSV_DEFAULT_SOVITS),
        spkAudio: voice.spkAudio || join(workspace, ...GSV_EXAMPLES, 'laffey.mp3'),
        promptAudio: voice.promptAudio || join(workspace, ...GSV_EXAMPLES, 'AnAn.ogg'),
        promptText: voice.promptText || GSV_DEFAULT_PROMPT_TEXT,
        // 桥的临时目录必须显式给：让桥自己探测会卡死在标准 temp 目录上（见下）。
        tempDir: voice.tempDir || join(workspace, 'tmp'),
    };
}
/**
 * 健康检查的节奏与容错阈值。
 *
 * 桥是 Python 进程，冷启动要先 import torch/gsv 再绑端口（实测 5–10s），而一次
 * 合成期间 Python 侧也可能让 /health 慢一拍。原来"一次失败即报错 + 2s 超时"把
 * 这两种正常情况都写成了"语音桥无响应（fetch failed）"，而且轮询在桥重启后被
 * 永久停掉，错误就永远留在设置页上——语音其实一直是好的。
 */
const BRIDGE_POLL_INTERVAL_MS = 5_000;
const BRIDGE_HEALTH_TIMEOUT_MS = 4_000;
/** 连续失败到这一次数才算"真的连不上"。 */
const BRIDGE_FAILURE_THRESHOLD = 3;
/** 桥进程还活着时的宽限：载入模型要十几秒，这期间只报"载入中"。 */
const BRIDGE_ALIVE_GRACE = 6;
// ── 任务节点播报的节流 ────────────────────────────────────────────────────
// 页面侧的观察器是启发式的，同一个节点可能连报两三次（React 重渲染、弹窗动画）。
// 节流放在宿主而不是客户端：客户端只负责"我看到了"，判重与冷却统一在这里，
// 换任何信号源都不会漏。
const TASK_DONE_COOLDOWN_MS = 20_000;
const TASK_CONFIRM_COOLDOWN_MS = 12_000;
const TASK_START_COOLDOWN_MS = 45_000;
/** 刚提醒过确认/开始之后，这个窗口内的"完成"不再补一句——同一回合别连响两次。 */
const TASK_QUIET_AFTER_ACTIVITY_MS = 6_000;
/**
 * 确认之后压住 `done` 的时长（0.2.7）。
 *
 * 等待审批时 agent 会变闲，`settle` 会把这段空闲当成"回合结束"。5 分钟足够覆盖
 * 一次正常的人工审批；期间 agent 真的重新忙起来会立刻清掉这个记号（见
 * `setAgentState`），所以不会误伤"确认完继续跑、跑完再说完成"的正常流程。
 */
const TASK_APPROVAL_HOLD_MS = 300_000;
/** 任务事件通道的默认端口（页面侧按固定地址 POST，必须可预测）。 */
const TASK_CHANNEL_DEFAULT_PORT = 9879;

/** 把 Node 的 `fetch failed` 翻成能定位的说法（真实原因在 `error.cause`）。 */function describeBridgeFailure(error) {
    const cause = error?.cause;
    const code = typeof cause?.code === 'string' ? cause.code : '';
    if (code === 'ECONNREFUSED')
        return '端口没有监听（桥进程未启动或已退出）';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE')
        return '连接被重置（桥正在重启）';
    if (error?.name === 'TimeoutError' || code === 'UND_ERR_ABORTED' || code === 'UND_ERR_CONNECT_TIMEOUT')
        return '健康检查超时（桥正忙，可能正在合成）';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        return '地址无法解析';
    return String(error?.message ?? error);
}
/**
 * 脱敏一个密钥，只留前后各 4 位。
 *
 * 设置页要"看得见已保存的是什么"，但密钥不能原样过线——宿主在 `runtimeView()`
 * 里只发这个掩码，明文永远不出宿主进程。
 */
export function maskSecret(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '')
        return '';
    if (text.length <= 8)
        return '••••';
    return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

const MIME_BY_EXTENSION = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.moc3': 'application/octet-stream',
};
/**
 * Owns the desktop pet's transport: one loopback HTTP origin that serves the renderer bundle and
 * the model files, plus a WebSocket carrying Harness state to the Electron window.
 *
 * Model assets are served over HTTP rather than `file://` because the Cubism loader reads them
 * with `fetch`/XHR, which Chromium refuses for the file scheme.
 *
 * The host holds no persistent copy of the configuration: committed settings sections arrive
 * through {@link applySettings} and every user-driven window change is reported through the
 * hooks for the caller to write back into the settings document.
 */
export class DesktopPetHost {
    log;
    hooks;
    #http;
    #wss;
    #desktop;
    #socket;
    #models = [];
    #config;
    #dataDir;
    #petDir;
    #port = 0;
    #cubismCore;
    #effectiveMode = 'task';
    #windowPosition = null;
    /**
     * 最近一次 agent 生命周期状态（0.1.6 问题2）。
     *
     * `send()` 在 socket 未 OPEN 时会静默丢弃消息，而 Electron 窗口冷启动要
     * 数秒后才连上 WS——这段窗口里发生的状态变化曾经无处补发。现在先记在
 * 这里，连接建立时的快照会带上它；设置页也可通过 runtimeView 读到。
     */
    #agentState = 'idle';
    /**
     * 页面自报的焦点（0.2.3）：true / false / null（还没收到过）。
     *
     * 由页面里的客户端 POST 到 `/page-focus`。它是自动模式的第二判据：
     * agent 闲着的时候，只有页面说"我失去焦点了"才允许截屏。
     */
    #pageFocused = null;
    /** 本地 GSV-TTS 合成桥进程；voice.enabled 时随桌宠拉起。 */
    #bridge = null;
    #bridgeArgsHash = '';
    /** 桥的就绪状态，由 /health 轮询维护；设置页用它区分"没起来"和"载入中"。 */
    #bridgeReady = false;
    #bridgeError = null;
    #bridgePoll = null;
    /** 连续失败次数：单次失败不足以断言桥没起来（冷启动/合成中都会失败一次）。 */
    #bridgeFailures = 0;
    /** 陪伴模式最近一次截屏的状态，由 Electron 侧上报，供设置页确认"截屏真的跑了"。 */
    #companionStatus = null;
    /** 任务事件通道（页面侧 POST 进来）：监听器、实际端口、失败原因。 */
    #taskServer = null;
    #taskPort = 0;
    #taskChannelError = null;
    /** 各节点的上次播报时刻，用于节流。 */
    #taskLastDoneAt = 0;
    #taskLastConfirmAt = 0;
    #taskLastStartAt = 0;
    #taskLastConfirmKey = '';
    /**
     * 最近一次"需要确认"的时刻（0.2.7）。
     *
     * 等审批期间 agent 会短暂变闲（没有 harness 事件），`settle` 那条会把这次
     * 空闲误判成"回合结束"，于是弹着确认框她先说一句"任务完成啦"。有这条时间戳
     * 就在确认之后压住 done，直到 agent 真的重新忙起来（`setAgentState` 里清掉）。
     */
    #awaitingApprovalAt = 0;
    /**
     * 用户这一回合让他做什么（0.2.8，已压平 + 截断到 60 字）。
     *
     * 由 `session/event` 里的 `user/message` 提供，`lib/index.js` 解析后调
     * `noteUserPrompt()` 写进来。节点播报把它一起给模型——这是"她说的话跟任务
     * 无关"的正解：不是把提示词写得更凶，而是把任务本身告诉她。
     */
    #userPrompt = '';
    /** 0.2.1：Agent 模式发言（节点 → 陪伴 LLM 说一句）。不建定时器，只按事件触发。 */
    #agentSpeech;
    /** Timestamp until which incoming resize reports are ignored as host echoes. */
    #sizeEchoDeadline = 0;
    registry;
    constructor(config, log, hooks = {}) {
        this.log = log;
        this.hooks = hooks;
        this.#config = config;
        this.#dataDir = join(homedir(), '.dsh', 'live2d-deskpet');
        this.registry = new ModelRegistry(join(this.#dataDir, 'models'));
        this.#petDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'electron');
        // 0.2.1：Agent 模式的发言服务。say 走 `agent-speech` 消息——主进程把它转成
        // 渲染进程的 `say` 事件，于是气泡 / TTS / 情绪动作与截图驱动是同一套下游。
        this.#agentSpeech = new AgentSpeechService({
            say: (text, emotion) => this.send({
                type: 'agent-speech',
                text,
                ...(emotion ? { emotion: emotion.emotion, intensity: emotion.intensity, confidence: emotion.confidence } : {}),
            }),
            log: message => this.log.info(message),
        });
        this.#agentSpeech.configure(config, () => this.#effectiveMode);
    }
    /** Runtime data directory (`~/.dsh/live2d-deskpet`), surfaced for the settings page. */
    get dataDir() { return this.#dataDir; }
    async start() {
        await mkdir(this.#dataDir, { recursive: true });
        this.#models = await this.registry.scan();
        this.#config = { ...this.#config, modelId: this.resolveModelId(this.#config.modelId) };
        this.#cubismCore = await this.readCubismCore();
        this.#http = createServer((request, response) => void this.handleRequest(request, response));
        this.#wss = new WebSocketServer({ server: this.#http });
        this.#wss.on('connection', socket => this.onConnection(socket));
        await new Promise((resolve, reject) => {
            this.#http.once('error', reject);
            this.#http.listen(0, '127.0.0.1', () => resolve());
        });
        const address = this.#http.address();
        if (!address || typeof address === 'string')
            throw new Error('无法为桌宠建立本地通信端口。');
        this.#port = address.port;
        this.launchElectron();
        this.ensureBridge();
        this.#startBridgePoll();
        this.ensureTaskChannel();
    }
    async stop() {
        this.#stopBridgePoll();
        this.stopBridge();
        this.stopTaskChannel();
        this.#socket?.close();
        this.#desktop?.kill();
        await new Promise(resolve => this.#wss?.close(() => resolve()) ?? resolve());
        await new Promise(resolve => this.#http?.close(() => resolve()) ?? resolve());
    }
    /**
     * 最近一次 agent 生命周期状态；重连补发与设置页观测都读它（0.1.6 问题2）。
     */
    get agentState() { return this.#agentState; }
    /**
     * 0.1.6 问题2：宿主缓存最新 agent 状态再下发。
     *
     * 旧实现直接 `send()`——socket 未就绪时被静默丢弃且无处补发，桌宠会停在
     * 旧状态直到下一次翻转。现在先记入 `#agentState`，Electron 连接/重连时
     * `sendSnapshot()` 把它一并带下去，冷启动窗口里的状态变化不再丢失。
     */
    setAgentState(state) {
        this.#agentState = state;
        // 0.2.7：agent 真的重新忙起来 → 审批已经过去了，解除对 done 的压制。
        if (state === 'working' || state === 'think')
            this.#awaitingApprovalAt = 0;
        this.send({ type: 'agent-state', state });
    }
    /**
     * 页面自报焦点（0.2.3）。
     *
     * 只在真的变化时下发：页面会每 30 秒补一次心跳（宿主重启后不必等下一次
     * focus/blur 才能恢复判断），心跳不该把 WebSocket 灌满。
     */
    setPageFocused(focused) {
        const next = focused === true;
        if (this.#pageFocused === next)
            return;
        this.#pageFocused = next;
        this.send({ type: 'page-focus', focused: next });
    }
    /**
     * 记下用户这一回合的请求（0.2.8）。
     *
     * 只在非空时覆盖：DSH 偶尔会先来一条空的/纯图片的 user 消息，不能把上一轮
     * 的任务描述冲掉——那会让"她说的话跟任务无关"重新出现。
     */
    noteUserPrompt(text) {
        const next = typeof text === 'string' ? text.trim() : '';
        if (next === '')
            return;
        if (next === this.#userPrompt)
            return;
        this.#userPrompt = next;
        this.log.info(`live2d-deskpet 任务上下文：${next}`);
    }
    /**
     * Apply a committed settings section. Mode, selected model, window size, and
     * companion LLM fields reach the Electron window without a restart; a size
     * change additionally drives the window itself.
     */
    async applySettings(section) {
        const before = this.#config;
        const coreBefore = this.#cubismCore !== undefined;
        const next = sectionToConfig(before, section, id => this.#models.some(model => model.id === id));
        const moved = next.windowWidth !== before.windowWidth || next.windowHeight !== before.windowHeight;
        const lockedMoved = next.windowLocked !== before.windowLocked;
        const clickMoved = next.clickThrough !== before.clickThrough;
        const corePathMoved = next.cubismCorePath !== before.cubismCorePath;
        const personaMoved = next.persona.activeId !== before.persona.activeId;
        const changed = moved || lockedMoved || clickMoved || corePathMoved || personaMoved
            || JSON.stringify(next) !== JSON.stringify(before);
        this.#config = next;
        // 0.2.1：发言服务跟着配置走（LLM 端点、人设、nsfw、情绪开关都在里面）。
        this.#agentSpeech.configure(next, () => this.#effectiveMode);
        if (!changed)
            return;
        if (corePathMoved)
            this.#cubismCore = await this.readCubismCore();
        if (moved || lockedMoved || clickMoved)
            this.syncWindowSize();
        // Switching memory on captures where the window actually is, so the very
        // first enable stores a real position instead of a placeholder corner.
        if (next.rememberWindowPosition && !before.rememberWindowPosition) {
            this.send({ type: 'request-window-position' });
        }
        this.sendSnapshot();
        // The renderer loads the Cubism core through a <script> tag before the app
        // bundle evaluates, so a core that appears only now needs a page reload.
        if (corePathMoved && !coreBefore && this.#cubismCore !== undefined)
            this.send({ type: 'reload' });
        // 语音配置（启用、语种、模型路径、翻译端点）变了就重建合成桥；桥内部按
        // 参数哈希判断是否需要真正重启。
        this.ensureBridge();
        // 任务语音的开关/端口同样热更。
        this.ensureTaskChannel();
    }
    /** Rescan the model folder and republish the snapshot (after import/remove). */
    async refresh() {
        this.#models = await this.registry.scan();
        this.#config = { ...this.#config, modelId: this.resolveModelId(this.#config.modelId) };
        this.sendSnapshot();
    }
    /** Copy a model folder into the registry; the caller decides whether to select it. */
    async importModel(folder) {
        const model = await this.registry.importFolder(folder);
        await this.refresh();
        return model;
    }
    /** Delete one model folder; the caller decides whether to switch the selection. */
    async removeModel(id) {
        await this.registry.remove(id);
        await this.refresh();
    }
    /** Model list the web settings section and the state endpoint publish. */
    models() { return this.#models; }
    /** Current configuration, as the state endpoint reports it. */
    currentConfig() { return this.#config; }
    /** The Cubism runtime is present, so the window can actually render a model. */
    hasCubismCore() { return this.#cubismCore !== undefined; }
    /**
     * 陪伴记忆当前条目数（0.1.7，设置页显示用）。
     *
     * Electron 侧逐轮追加、宿主侧只读；两侧用的是同一份 turns.jsonl
     * （`~/.dsh/live2d-deskpet/memory/`，即 dataDir/memory）。
     */
    async companionMemoryCount() {
        return await new MemoryStore(join(this.#dataDir, 'memory')).count();
    }
    /** 陪伴记忆目录（设置页展示路径用）。 */
    get companionMemoryDir() { return join(this.#dataDir, 'memory'); }
    /**
     * 语音桥是否已把模型载入显存（`/health` 的 `ready`）。
     *
     * 截图驱动模式用它做"截屏前的第一道闸"：模型还没进显存时先截一张再合成，
     * 只会白白花掉一次截屏和一次视觉推理，最后大概率还听不到声音。
     */
    voiceReady() { return this.#bridgeReady; }
    /** Live runtime facts for the settings page; only the host can observe them. */
    runtimeView() {
        return {
            effectiveMode: this.#effectiveMode,
            // 0.1.6 问题2：桌宠当前同步到的 agent 状态，设置页可直接观测同步链路。
            agentState: this.#agentState,
            cubismCore: this.hasCubismCore(),
            modelsRoot: this.registry.root,
            dataDir: this.#dataDir,
            apiKeySet: Boolean(this.#config.llm.apiKey),
            // 设置页要显示"已保存的 LLM 端点"，密钥只发脱敏后的样子。
            llmBaseUrl: this.#config.llm?.baseUrl ?? '',
            llmModel: this.#config.llm?.model ?? '',
            llmApiKeyMasked: maskSecret(this.#config.llm?.apiKey),
            translateApiKeyMasked: maskSecret(this.#config.voice?.translateApiKey),
            windowPosition: this.#windowPosition,
            voiceEnabled: this.#config.voice?.enabled === true,
            voiceReady: this.#bridgeReady,
            voiceError: this.#bridgeError,
            voicePort: Number(this.#config.voice?.bridgePort) || 9876,
            voiceBridgeAlive: Boolean(this.#bridge && this.#bridge.exitCode === null),
            voiceLog: join(resolveVoicePaths(this.#config.voice ?? {}).tempDir, 'gsv-bridge.log'),
            // 任务事件通道：页面侧按这个端口 POST，设置页据此显示"通道是否在听"。
            taskChannelPort: this.#taskPort,
            taskChannelError: this.#taskChannelError,
            companion: this.#companionStatus,
            // 陪伴记忆（0.1.7）：目录给设置页展示；条目数由 Remote 的 getState
            // 异步补上（runtimeView 本身是同步视图）。
            memoryDir: this.companionMemoryDir,
        };
    }
    /**
     * 轮询桥的 /health，维护"模型是否已进显存"。
     *
     * 桌宠窗口只认设置值，看不到桥进程的死活；把这一步放在宿主侧，设置页就能把
     * "桥没起来""模型载入中""载入失败"三种情况分辨开——原来这三种都只表现为
     * "听到的是系统音色"，无法定位。
     */
    #startBridgePoll() {
        if (this.#bridgePoll)
            return;
        const tick = async () => {
            const voice = this.#config.voice ?? {};
            if (voice.enabled !== true) {
                this.#bridgeFailures = 0;
                this.#bridgeReady = false;
                this.#bridgeError = null;
                return;
            }
            const port = Number(voice.bridgePort) || 9876;
            try {
                const response = await fetch(`http://127.0.0.1:${port}/health`, {
                    cache: 'no-store',
                    signal: AbortSignal.timeout(BRIDGE_HEALTH_TIMEOUT_MS),
                });
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const body = await response.json();
                this.#bridgeFailures = 0;
                this.#bridgeReady = body?.ready === true;
                this.#bridgeError = typeof body?.error === 'string' && body.error !== '' ? body.error : null;
            }
            catch (error) {
                // 一次失败不等于"桥没起来"：冷启动要先 import torch/gsv 再绑端口，
                // 合成期间 Python 侧也可能让 /health 慢一拍。连续失败到阈值才报，
                // 否则维持"载入中"，把误报从设置页上彻底去掉。
                this.#bridgeFailures += 1;
                this.#bridgeReady = false;
                const alive = Boolean(this.#bridge && this.#bridge.exitCode === null);
                const settled = this.#bridgeFailures >= BRIDGE_FAILURE_THRESHOLD;
                const withinGrace = alive && this.#bridgeFailures < BRIDGE_ALIVE_GRACE;
                if (!settled || withinGrace) {
                    this.#bridgeError = null;
                    return;
                }
                // 连不上：桥进程没起来（Python 路径错、依赖缺失、端口被占），或者
                // 起来了但一直不应答。原因写在括号里，日志路径给出取证入口。
                this.#bridgeError = `语音桥无响应（${describeBridgeFailure(error)}）。请查看日志：${join(resolveVoicePaths(this.#config.voice ?? {}).tempDir, 'gsv-bridge.log')}`;
            }
        };
        // 轮询是常驻的：桥重启（改配置、宿主重启）时它必须继续跑，否则状态会冻结
        // 在重启窗口里那一次失败上——这正是"提示 fetch failed、语音却正常"的成因。
        this.#bridgePoll = setInterval(() => void tick(), BRIDGE_POLL_INTERVAL_MS);
        void tick();
    }
    #stopBridgePoll() {
        if (this.#bridgePoll) {
            clearInterval(this.#bridgePoll);
            this.#bridgePoll = null;
        }
    }
    /** Push the configured window geometry to the Electron window (it owns the actual resize). */
    syncWindowSize() {
        // Chromium reports a frameless window's size back with a small frame delta
        // (`setSize(444, 555)` settles at 445x557), so an echo arriving right after
        // this push is the browser's own rounding, not a user drag. Remembering the
        // echo would overwrite what the user typed with what Chromium chose, and the
        // next `syncWindowSize` would then grow the window again on every pass.
        this.#sizeEchoDeadline = Date.now() + SIZE_ECHO_WINDOW_MS;
        this.send({
            type: 'window-size',
            width: this.#config.windowWidth,
            height: this.#config.windowHeight,
            locked: this.#config.windowLocked,
            clickThrough: this.#config.clickThrough,
        });
    }
    /** A remembered selection survives a restart only while that model is still on disk. */
    resolveModelId(preferred) {
        const match = this.#models.find(model => model.id === preferred);
        return match?.id ?? this.#models[0]?.id ?? '';
    }
    async handleRequest(request, response) {
        try {
            const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
            if (pathname === '/pet/' || pathname === '/pet/index.html')
                return await this.sendFile(response, join(this.#petDir, 'renderer.html'));
            if (pathname === '/pet/renderer.js')
                return await this.sendFile(response, join(this.#petDir, 'renderer.js'));
            if (pathname === '/pet/core.js')
                return await this.sendCubismCore(response);
            // soullink 情绪动作引擎（0.2.0）：注入脚本必须在 renderer.js 之前加载，
            // 参数快照按模型缓存，取不到就 404 —— 渲染进程据此保持 0.1.9 行为。
            if (pathname === '/pet/soullink-inject.js')
                return await this.sendFile(response, join(this.#petDir, 'soullink', 'inject.js'));
            if (pathname === '/pet/soullink.profile.json')
                return await this.sendSoullinkProfile(response);
            if (pathname.startsWith('/models/')) {
                const target = this.resolveModelPath(pathname.slice('/models/'.length));
                if (!target)
                    return void response.writeHead(403).end('forbidden model path');
                return await this.sendFile(response, target);
            }
            response.writeHead(404).end('not found');
        }
        catch (error) {
            response.writeHead(404).end(error.message);
        }
    }
    /** Rejects traversal and absolute segments so a model request can only reach the model folder. */
    resolveModelPath(encodedPath) {
        let decoded;
        try {
            decoded = decodeURIComponent(encodedPath);
        }
        catch {
            return undefined;
        }
        if (!decoded || decoded.includes('\\') || decoded.split('/').includes('..'))
            return undefined;
        const target = join(this.registry.root, decoded);
        return relative(this.registry.root, target).startsWith('..') ? undefined : target;
    }
    async sendFile(response, path) {
        const body = await readFile(path);
        response.writeHead(200, {
            'content-type': MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream',
            'content-length': body.byteLength,
            'cache-control': 'no-store',
        });
        response.end(body);
    }
    /**
     * 下发当前模型的 soullink profile。
     *
     * 任何一环失败（模型不存在 / profile-generator 没装 / 生成报错）都回 404：
     * 渲染进程拿到 404 就完全不写参数，宠物行为与 0.1.9 逐字节等价。
     */
    async sendSoullinkProfile(response) {
        try {
            const modelId = this.resolveModelId(this.#config.modelId);
            const model = this.#models.find(entry => entry.id === modelId);
            if (!model)
                return void response.writeHead(404).end('soullink: no active model');
            const result = await ensureSoullinkProfile({
                modelsRoot: this.registry.root,
                modelDirName: relative(this.registry.root, model.root).split(sep).join('/'),
                model3Path: model.modelPath,
                cdi3Path: '',
                cachePath: join(this.#dataDir, 'profiles', `${model.id}.json`),
                log: message => this.log.info(message),
            });
            if (!result)
                return void response.writeHead(404).end('soullink: profile unavailable');
            response.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'content-length': Buffer.byteLength(result.body),
                'cache-control': 'no-store',
            });
            response.end(result.body);
        }
        catch (error) {
            this.log.warn(`soullink profile 不可用：${error?.message ?? error}`);
            response.writeHead(404).end('soullink: profile unavailable');
        }
    }
    async sendCubismCore(response) {
        const core = this.#cubismCore;
        const script = core ?? '/* 未配置 Cubism Core：渲染器会显示缺失提示。 */';
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        response.end(script);
    }
    async readCubismCore() {
        const candidates = [
            this.#config.cubismCorePath,
            join(this.#dataDir, 'live2dcubismcore.min.js'),
            join(this.registry.root, 'live2dcubismcore.min.js'),
        ].filter(Boolean);
        for (const candidate of candidates) {
            for (const path of [candidate, join(candidate, 'live2dcubismcore.min.js')]) {
                try {
                    return await readFile(path);
                }
                catch { /* try the next candidate path */ }
            }
        }
        this.log.warn('live2d-deskpet: 未找到 live2dcubismcore.min.js，桌宠只能显示缺失提示。');
        return undefined;
    }
    onConnection(socket) {
        this.#socket = socket;
        socket.on('message', async (payload) => {
            try {
                await this.onMessage(JSON.parse(String(payload)));
            }
            catch (error) {
                this.log.warn(`desktop pet message error: ${error.message}`);
            }
        });
        socket.on('close', () => { if (this.#socket === socket)
            this.#socket = undefined; });
        this.sendSnapshot();
    }
    async onMessage(message) {
        if (message.type === 'renderer-ready') {
            this.sendSnapshot();
            return;
        }
        if (message.type === 'select-model' && typeof message.modelId === 'string') {
            // Menu picks route through the settings document so every surface agrees.
            if (!this.#models.some(model => model.id === message.modelId))
                throw new Error('未知模型。');
            this.hooks.onModelSelect?.(message.modelId);
        }
        if (message.type === 'update-config' && message.patch && typeof message.patch === 'object') {
            const patch = message.patch;
            if (patch.mode === 'auto' || patch.mode === 'task' || patch.mode === 'companion')
                this.hooks.onModeSelect?.(patch.mode);
        }
        if (message.type === 'effective-mode' && (message.mode === 'task' || message.mode === 'companion')) {
            if (message.mode !== this.#effectiveMode) {
                this.#effectiveMode = message.mode;
                this.hooks.onEffectiveMode?.(message.mode);
            }
        }
        if (message.type === 'window-position'
            && typeof message.x === 'number' && typeof message.y === 'number') {
            this.#windowPosition = { x: Math.round(message.x), y: Math.round(message.y) };
            this.hooks.onWindowMove?.(this.#windowPosition);
        }
        if (message.type === 'resize-window'
            && typeof message.width === 'number' && typeof message.height === 'number') {
            // A locked window keeps its configured size: drags and stale reports are ignored.
            if (this.#config.windowLocked)
                return;
            // Swallow the browser's own frame-delta echo of the size the host just pushed;
            // see `syncWindowSize`. A real drag reports after this window has closed.
            if (Date.now() < this.#sizeEchoDeadline)
                return;
            const width = Math.round(message.width);
            const height = Math.round(message.height);
            if (width === this.#config.windowWidth && height === this.#config.windowHeight)
                return;
            this.#config = { ...this.#config, windowWidth: width, windowHeight: height };
            this.hooks.onWindowResize?.({ width, height });
        }
        if (message.type === 'renderer-error')
            this.log.warn(`Live2D renderer: ${String(message.error)}`);
        if (message.type === 'companion-log')
            this.log.info(`live2d-deskpet 陪伴：${String(message.message ?? '')}`);
        if (message.type === 'companion-status') {
            // 陪伴截屏的每一步都回传到这里：设置页据此显示"最近一次截屏"，
            // 日志里也留一行——"截屏到底有没有被调用"从此可查，不用猜。
            this.#companionStatus = {
                stage: String(message.stage ?? ''),
                detail: typeof message.detail === 'string' ? message.detail : '',
                mode: typeof message.mode === 'string' ? message.mode : '',
                captured: message.captured === true,
                at: Date.now(),
            };
            const detail = this.#companionStatus.detail ? ` ${this.#companionStatus.detail}` : '';
            this.log.info(`live2d-deskpet 陪伴：${this.#companionStatus.stage}${detail}`);
        }
    }
    /** Model URLs carry the loopback origin because the renderer cannot build them itself. */
    modelUrl(model) {
        const path = relative(this.registry.root, model.modelPath).split(sep).map(encodeURIComponent).join('/');
        return `http://127.0.0.1:${this.#port}/models/${path}`;
    }
    sendSnapshot() {
        this.send({
            type: 'snapshot',
            config: this.#config,
            models: this.#models.map(model => ({ ...model, modelPath: this.modelUrl(model) })),
            cubismCore: Boolean(this.#cubismCore),
            // 0.1.6 问题2：快照带上最近 agent 状态，Electron 冷启动/重连即恢复
            // 正确表现，不再等下一次状态事件。
            agentState: this.#agentState,
            // 0.2.3：页面焦点同理——重连后不必等下一次 focus/blur 才恢复自动判断。
            pageFocused: this.#pageFocused,
        });
    }
    send(message) {
        const socket = this.#socket;
        if (socket && socket.readyState === socket.OPEN)
            socket.send(JSON.stringify(message));
    }
    /**
     * 拉起本地 GSV-TTS 合成桥（voice.enabled 且路径可用时）。
     *
     * 桥是一个独立的 Python 进程，暴露 `POST /tts`（返回 wav）与 `GET /ping`。
     * 桌宠 renderer 通过 snapshot.config.voice.bridgePort 直连它发声。参数字段
     * 留空时一律回退到工作区默认的一份，保证「装上即能发声」。
     */
    ensureBridge() {
        const voice = this.#config.voice ?? {};
        if (voice.enabled !== true) {
            this.stopBridge();
            return;
        }
        const paths = resolveVoicePaths(voice);
        const args = [
            '--models', paths.models,
            '--gpt', paths.gpt,
            '--sovits', paths.sovits,
            '--spk-audio', paths.spkAudio,
            '--prompt-audio', paths.promptAudio,
            '--prompt-text', paths.promptText,
            '--lang', voice.lang || 'ja',
            '--port', String(voice.bridgePort || 9876),
        ];
        // 桥的临时目录必须显式给：让桥自己探测会卡死在标准 temp 目录上
        // （见 resolveVoicePaths 的注释）。日志也放同一处——~/.dsh 对 Python 子进程
        // 同样是拒绝访问，放那里等于没有日志。
        const tmpDir = paths.tempDir;
        args.push('--work-dir', tmpDir);
        const logPath = join(tmpDir, 'gsv-bridge.log');
        args.push('--log-file', logPath);
        // 用当前人设的问候语预热：模型一进显存就顺手把这句合成一遍，桌宠收到
        // ready 后发起的问候因此是热请求（实测冷启动约 15s，热请求约 1.7s）。
        const greeting = activePersona(this.#config.persona)?.greeting?.trim();
        if (greeting)
            args.push('--warmup', greeting);
        const translate = voice.translateUrl || voice.translateModel;
        if (translate) {
            if (voice.translateUrl) args.push('--translate-url', voice.translateUrl);
            // key 三级来源：设置里的 secret > DSH 环境（credentials refs 会注入 llm
            // 插件同款的 env 名）> credentials.yaml 的 refs 表。后者是硅流 key 的
            // 存放处——llm 插件正用着它，桌宠翻译复用同一把即可，无需重复配置。
            const credentialKey = this.readCredentialRef('SILICONFLOW_API_KEY');
            const key = voice.translateApiKey || process.env.SILICONFLOW_API_KEY || credentialKey || '';
            if (key) args.push('--translate-api-key', key);
            if (voice.translateModel) args.push('--translate-model', voice.translateModel);
        }
        const argHash = args.join('\u0001');
        // 同一个配置的桥已在跑：不重复拉起。
        if (this.#bridge && this.#bridgeArgsHash === argHash) return;
        this.stopBridge();
        const requireLocal = createRequire(import.meta.url);
        // DesktopPetHost 位于 lib/host/，桥脚本在包根的 tts/：需要回退两级。
        const bridgeScript = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tts', 'gsv_bridge.py');
        // 宿主自己（Node）能写这里，先建好目录，免得桥启动时才失败。
        void mkdir(tmpDir, { recursive: true }).catch(() => { });
        // 环境变量也一并指过去：桥里任何走 %TEMP% 的子进程/第三方库都跟着走。
        const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir };
        this.#bridgeArgsHash = argHash;
        // 日志由桥自己写（--log-file），所以这里丢弃的 stdio 不再丢失证据。
        this.#bridge = spawn(paths.python, [bridgeScript, ...args], { detached: false, stdio: 'ignore', env, cwd: tmpDir });
        this.#bridge.once('error', error => {
            this.log.warn(`GSV-TTS 桥启动失败：${error.message}`);
            this.#bridgeReady = false;
            this.#bridgeError = `无法启动语音桥进程（${error.message}）。Python 路径：${paths.python}`;
        });
        this.#bridge.once('exit', code => {
            this.log.info(`GSV-TTS 桥已退出（code=${String(code)}）`);
            if (this.#bridge) this.#bridge = null;
            this.#bridgeReady = false;
            if (code !== 0 && this.#bridgeError === null)
                this.#bridgeError = `语音桥进程退出（code=${String(code)}）。请查看日志：${logPath}`;
        });
        this.#bridgeReady = false;
        this.#bridgeError = null;
        this.#bridgeFailures = 0;
        // 桥刚拉起：立刻补一次健康检查，别让用户等满一个轮询周期。
        setTimeout(() => {
            if (this.#bridge && this.#bridge.exitCode === null)
                void this.#probeBridgeOnce();
        }, 1_500).unref?.();
        this.log.info(`GSV-TTS 桥已拉起（port=${String(voice.bridgePort || 9876)}，日志=${logPath}）`);
    }
    // ── 任务节点语音 ────────────────────────────────────────────────────────
    /**
     * 拉起"任务事件"通道。
     *
     * 页面里的客户端观察器只能"看见"DOM，没法直接跟 Electron 窗口说话，所以它
     * POST 到这个固定端口，宿主再转给桌宠窗口。**必须是固定端口**：桌宠自己的
     * HTTP 服务是 `listen(0)` 随机端口，页面侧无从得知。
     *
     * 绑不上（端口被占）就把原因记进 `#taskChannelError`，设置页会显示——任务语音
     * 是可选能力，失败不能拖垮桌宠本体。
     */
    ensureTaskChannel() {
        // 0.2.3：这个通道不再只服务"任务节点语音"。页面焦点（自动模式的第二判据）
        // 也走它，所以即使把三个任务节点开关全关掉，通道也要在——否则关掉语音就
        // 等于关掉了"我在 DSH 前面"这个信号，她会开始边看代码边搭话。
        // 关掉语音时 /task-event 仍会被 handleTaskEvent 里的开关判断丢掉。
        const port = Number(this.#config.taskVoice?.port) || TASK_CHANNEL_DEFAULT_PORT;
        if (this.#taskServer !== null && this.#taskPort === port)
            return;
        this.stopTaskChannel();
        const server = createServer((request, response) => void this.handleTaskRequest(request, response));
        server.on('error', error => {
            this.#taskChannelError = `任务事件通道无法监听 127.0.0.1:${port}（${error.message}）`;
            this.#taskServer = null;
            this.#taskPort = 0;
            this.log.warn(`live2d-deskpet: ${this.#taskChannelError}`);
        });
        server.listen(port, '127.0.0.1', () => {
            this.#taskServer = server;
            this.#taskPort = port;
            this.#taskChannelError = null;
            this.log.info(`live2d-deskpet 任务事件通道已监听 127.0.0.1:${port}`);
        });
    }
    stopTaskChannel() {
        const server = this.#taskServer;
        this.#taskServer = null;
        this.#taskPort = 0;
        if (server)
            try {
                server.close();
            }
            catch { /* 已经关了 */ }
    }
    /**
     * 处理页面侧的一条任务事件。
     *
     * 请求体用 `text/plain` 发过来（CORS 简单请求，不触发预检），这里再解析 JSON。
     * 只接受三个枚举值，别的直接 204 —— 这个端点暴露在 loopback 上，不值得为
     * 未知输入做任何事。
     */
    async handleTaskRequest(request, response) {
        const headers = {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
            'cache-control': 'no-store',
        };
        if (request.method === 'OPTIONS') {
            response.writeHead(204, headers).end();
            return;
        }
        // 0.2.3：页面焦点上报。和任务节点共用一个通道（同一次 CORS 配置、同一个
        // 端口），但语义完全不同：它不改任何播报状态，只回答"用户此刻在不在 DSH
        // 前面"。没有它，自动模式只能去问 Windows"哪个窗口被钉在顶层"——那既不是
        // 前台窗口，在原生模块没编译的机器上还永远是 false。
        if (request.method === 'POST' && (request.url ?? '').split('?')[0] === '/page-focus') {
            let focusBody = '';
            request.on('data', chunk => {
                focusBody += chunk;
                if (focusBody.length > 512)
                    request.destroy();
            });
            request.on('end', () => {
                try {
                    const parsed = JSON.parse(focusBody || '{}');
                    if (typeof parsed?.focused === 'boolean')
                        this.setPageFocused(parsed.focused);
                }
                catch { /* 坏 JSON 当成没收到 */ }
                response.writeHead(204, headers).end();
            });
            return;
        }
        if (request.method !== 'POST' || (request.url ?? '').split('?')[0] !== '/task-event') {
            response.writeHead(404, headers).end();
            return;
        }
        let body = '';
        request.on('data', chunk => {
            body += chunk;
            if (body.length > 4096)
                request.destroy();
        });
        request.on('end', () => {
            let kind = '';
            let detail = '';
            try {
                const parsed = JSON.parse(body || '{}');
                kind = String(parsed?.kind ?? '');
                detail = String(parsed?.detail ?? '').slice(0, 120);
            }
            catch { /* 坏 JSON 当成无效事件 */ }
            const accepted = this.handleTaskEvent(kind, detail);
            response.writeHead(accepted ? 200 : 204, { ...headers, 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ ok: accepted }));
        });
    }
    /**
     * 判重 + 冷却后把节点播报推给桌宠窗口。
     * @returns 是否真的播了（供 HTTP 响应与日志区分"收到"和"被节流"）
     */
    handleTaskEvent(kind, detail = '') {
        if (!isTaskEventKind(kind))
            return false;
        const taskVoice = this.#config.taskVoice ?? {};
        if (taskVoice.enabled === false)
            return false;
        // 模式门控按**用户选的模式**判断，而不是只看探测出来的有效模式。
        //
        // `auto` 的有效模式来自 DshModeProbe（Windows 原生窗口探测）；探测在非
        // Windows、缺可选原生模块、或 DSH 窗口没置顶时会一直是 false，于是 auto
        // 永远解析成截图驱动，任务节点播报被整批丢掉——"Agent 模式下不出声"的
        // 一个来源。现在：显式选了 Agent 驱动就一定播；auto 才看有效模式；显式
        // 选了截图驱动则让位（那边桌宠自己在说话，插进来会打架）。
        const configuredMode = this.#config.mode ?? 'auto';
        if (configuredMode === 'companion')
            return false;
        if (configuredMode === 'auto' && this.#effectiveMode !== 'task')
            return false;
        if (kind === 'start' && taskVoice.onStart !== true)
            return false;
        if (kind === 'confirm' && taskVoice.onConfirm === false)
            return false;
        if (kind === 'done' && taskVoice.onDone === false)
            return false;
        const now = Date.now();
        if (kind === 'confirm') {
            const key = detail || 'confirm';
            if (key === this.#taskLastConfirmKey && now - this.#taskLastConfirmAt < TASK_CONFIRM_COOLDOWN_MS)
                return false;
            this.#taskLastConfirmAt = now;
            this.#taskLastConfirmKey = key;
            // 0.2.7：记下"在等审批"，压住紧随其后的误判 done。
            this.#awaitingApprovalAt = now;
        }
        else if (kind === 'done') {
            if (now - this.#taskLastDoneAt < TASK_DONE_COOLDOWN_MS)
                return false;
            // 等审批期间的空闲不是"回合结束"。
            if (this.#awaitingApprovalAt !== 0 && now - this.#awaitingApprovalAt < TASK_APPROVAL_HOLD_MS) {
                this.log.info('live2d-deskpet 任务节点：done 被"等待确认"压住（不是真的完成）');
                return false;
            }
            if (now - this.#taskLastConfirmAt < TASK_QUIET_AFTER_ACTIVITY_MS)
                return false;
            if (now - this.#taskLastStartAt < TASK_QUIET_AFTER_ACTIVITY_MS)
                return false;
            this.#taskLastDoneAt = now;
        }
        else {
            if (now - this.#taskLastStartAt < TASK_START_COOLDOWN_MS)
                return false;
            this.#taskLastStartAt = now;
        }
        // 0.2.1：先请陪伴 LLM 就这个节点说一句（带情绪），失败或未配置时它自己
        // 退回 pickTaskLine 的固定文案。**这里绝不能 await**——本方法是同步返回
        // 布尔给页面侧 HTTP 响应用的，等一次 LLM 请求会把 POST 挂住六秒。
        // 判重与冷却已经在上面跑完，所以「立刻返回 true，异步去说」是安全的：
        // 这一句被丢弃与否由发言服务自己的并发闸决定，不影响"收到"的语义。
        const state = this.#agentState === 'error' ? 'error' : taskStateFor(kind);
        void this.#agentSpeech.speakForNode({ state, kind, detail, task: this.#userPrompt });
        this.log.info(`live2d-deskpet 任务节点：${kind}${detail ? `（${detail}）` : ''} → 请求 Agent 发言（state=${state}）`);
        return true;
    }
    /** 单次健康检查（供桥刚启动时提前探一次，不改变轮询节奏）。 */
    async #probeBridgeOnce() {
        const port = Number(this.#config.voice?.bridgePort) || 9876;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(BRIDGE_HEALTH_TIMEOUT_MS),
            });
            if (!response.ok)
                return;
            const body = await response.json();
            this.#bridgeFailures = 0;
            this.#bridgeReady = body?.ready === true;
            this.#bridgeError = null;
        }
        catch {
            // 还在冷启动：交给常驻轮询，这里不写任何错误状态。
        }
    }
    /** 停止本地 GSV-TTS 合成桥。 */
    stopBridge() {
        // 注意：这里**不**停健康检查轮询。桥重启是常态（改配置、换人设预热），
        // 一旦把轮询一起停掉，设置页就会永远停在重启窗口里那次失败的状态上。
        // 轮询的生命周期跟宿主走，只由 stop() 结束。
        if (this.#bridge) {
            const proc = this.#bridge;
            this.#bridge = null;
            this.#bridgeArgsHash = '';
            this.#bridgeReady = false;
            try { proc.kill(); } catch { /* already gone */ }
        }
    }
    /**
     * 从 DSH 的 credentials 存储里读一个具名凭据（`refs:` 段的 `NAME: value`）。
     *
     * 桌宠的中译日要一把 key；llm 插件的 provider 已经用 `apiKeyEnv:
     * SILICONFLOW_API_KEY` 引用了同一把。这里读同一来源，避免让用户为
     * 翻译再配一遍。文件缺失或解析失败时返回空串——调用方自会降级。
     */
    readCredentialRef(name) {
        try {
            const path = join(homedir(), '.dsh', '.credentials.yaml');
            const text = readFileSync(path, 'utf8');
            const match = text.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'm'));
            return match?.[1] ?? '';
        }
        catch {
            return '';
        }
    }
    launchElectron() {
        const entry = join(this.#petDir, 'main.js');
        // `ELECTRON_RUN_AS_NODE` may be inherited from DSH's tooling; do not pass it on.
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const require = createRequire(import.meta.url);
        const electronBinary = require('electron');
        const args = [
            entry,
            `--bridge=ws://127.0.0.1:${this.#port}`,
            `--pet-url=http://127.0.0.1:${this.#port}/pet/`,
            `--window-size=${this.#config.windowWidth}x${this.#config.windowHeight}`,
            `--window-locked=${this.#config.windowLocked ? 1 : 0}`,
            `--click-through=${this.#config.clickThrough ? 1 : 0}`,
        ];
        if (this.#config.windowPosition)
            args.push(`--window-position=${this.#config.windowPosition.x},${this.#config.windowPosition.y}`);
        this.#desktop = spawn(electronBinary, args, { detached: false, stdio: 'ignore', env });
        this.#desktop.once('error', error => this.log.error(`无法启动 Electron 桌宠：${error.message}`));
    }
}
