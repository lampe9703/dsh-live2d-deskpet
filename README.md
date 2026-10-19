# DSH Live2D Deskpet

一个跑在 [DeepSeek Harness](https://github.com/deepseek-ai)（下称 DSH）里的 Live2D 桌面宠物插件。

它把 DSH 的 Agent 生命周期映射成 Live2D 动作；在截图驱动模式下按间隔截屏、用一个独立于 DSH 的 OpenAI 兼容 LLM 主动搭话；气泡是中文，声音由本地 GSV-TTS 合成（默认日语）。

> **关于本仓库**>   
> 这是 `dsh-live2d-deskpet` 的增强分支，在原插件（模型 / 模式 / 陪伴 LLM / 人设 / 窗口五组能力）之上补齐了三件事：
>
> 1. **本地语音**：GSV-TTS 桥 + 音画同步气泡（气泡以音频为时钟，而不是按字数估算阅读时间）；
> 2. **截屏上下文注入**：截屏时固定注入「当前时间 + 前台应用/窗口标题 + 引导语」，让回复真正贴着屏幕内容；
> 3. **可观测性**：语音桥健康状态、陪伴截屏各阶段都能在设置页和日志里看到，不再"静默失败"。
>
> 本仓库只包含**构建产物**（`lib/` 为已打包的 ESM 与浏览器 bundle），不含 TypeScript 源码与构建脚本。



---

## 特性

- **Agent 状态驱动**：`agent/status`、`session/event`、`session/updated` 归一化为 `idle / think / working / celebrate / error`，渲染器按状态选动作组，缺动作组时退化为参数过渡。
- **任务节点语音**：Agent驱动模式下，「需要你确认」「任务完成」「开始处理」三个节点会让桌宠用**中文气泡 + 日语语音**提醒一句——人不在对话页也能听见。信号来自页面内的观察器（见下）。
- **透明置顶窗口**：无边框、鼠标穿透（只在模型本体上接收点击）、拖动移动、锁定尺寸、记住位置、下边缘渐隐。
- **截图驱动模式**：定时截屏 → 8×8 感知哈希去重 → 带图请求独立 LLM → SSE 流按句推气泡并逐句发声。
- **本地语音（GSV-TTS）**：独立 Python 桥，`POST /tts` 返回 wav；中文气泡 + 日语配音（可选走中译日端点，否则中文按日语音读）。
- **音画同步**：气泡在这一句音频**开始播放**时出现，播完自动换下一句；合成偏慢时先显示正文、再补一个「（正在合成语音…）」后缀。
- **人设**：SillyTavern v2 角色卡导入/导出，可与 `dsh-cosplay` 的角色库互通；人设只影响 system message，**不影响**截屏注入的固定提示词。
- **可观测**：设置页显示语音桥端口/就绪状态/最近一次截屏阶段；桥的日志与陪伴链路日志都落盘。

---

## 依赖前提

| 依赖                       | 说明                                            |
| ------------------------ | --------------------------------------------- |
| DSH                      | 插件以 loader 补丁形式插入某个 profile，需 DSH 0.2.x       |
| **Cubism 4 运行核**         | `live2dcubismcore.min.js`，**不随本插件分发**，需自备（见下） |
| Live2D 模型                | 自备，本插件不附带任何第三方模型                              |
| Python 3.10+ + `gsv_tts` | 仅语音功能需要；可用独立的 venv                            |
| GSV-TTS 模型               | GPT `.ckpt` + SoVITS `.pth` + 两段参考音频          |

### Cubism 运行核

放到下面任一位置，或在设置页「模型 → Cubism 运行核路径」里填（文件或目录均可）：

```text
~/.dsh/live2d-deskpet/live2dcubismcore.min.js
<模型目录>/live2dcubismcore.min.js
```

**版本要求**：运行核必须保留 `csmGetDrawableRenderOrders`。Cubism SDK 5-r.5 自带的 Core 6.0.1 已移除该 C API，而 `pixi-live2d-display` 0.4 仍会调用它，渲染第一帧就报 `Cannot read properties of undefined (reading '0')`。官方 CDN 的 Core 5.1.0 可用：

```text
https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js
```



---

## 安装

```powershell
# 1. 打包（本仓库的 lib/ 已是构建产物，直接 pack 即可）
npm pack

# 2. 装进某个 DSH profile
dsh plugin --profile desktop add .\dsh-live2d-deskpet-0.1.3.tgz
```

装完**重启 DSH**。之后所有配置都在设置页里热生效，不需要再重启。

> 若该 profile 的 `node_modules` 由与 DSH 内置 pnpm 不同大版本的 pnpm 安装，`dsh plugin` 会因 store 版本不同而拒绝执行（`ERR_PNPM_UNEXPECTED_STORE`）。此时用安装该 profile 的那个 pnpm 执行 `add`，并手动把 `dsh-live2d-deskpet` 追加到 `$DSH_HOME/profiles/<name>/package.json` 的 `dsh.profile.bundles`。

### 设置页在哪

DSH Web GUI → **设置 → Live2D 桌宠**，六组：**模型 / 模式 / 陪伴 LLM / 语音（GSV-TTS）/ 人设 / 窗口**。  
也可以右键桌宠 → **打开设置**。

---

## 语音（GSV-TTS）配置

语音由 `tts/gsv_bridge.py` 提供：一个只依赖标准库 `http.server` 的本地服务，由宿主进程在启用语音时拉起。

### 工作区结构

所有默认路径都从**一个根目录**派生，设置页里通常只需要填「GSV 工作区根目录」这一项：

```text
<workspace>/
├─ gsv-venv/                       # 装了 gsv_tts 的 Python 环境
│  └─ Scripts/python.exe           # Windows；POSIX 为 bin/python
├─ gsv_models/                     # GPT .ckpt + SoVITS .pth
├─ gsv-tts-lite/
│  └─ GSV-TTS-Lite-main/
│     └─ examples/
│        ├─ laffey.mp3             # 说话人参考音频
│        └─ AnAn.ogg               # 提示音频
└─ tmp/                            # 桥的临时目录 + gsv-bridge.log
```

根目录的解析顺序：

```text
设置页「GSV 工作区根目录」 > 环境变量 GSV_WORKSPACE > ~/Documents/deepseek-harness/default-workspace
```

其余字段（Python 路径、模型目录、参考音频、临时目录）留空即按上表推导；也可以逐个显式填写覆盖。

> **为什么临时目录必须显式指定**：在某些 Windows 环境下，Python 在标准 temp 目录（`%TEMP%`、`C:\WINDOWS\Temp`）里创建文件会**永久挂起**（`mkstemp` 卡死），而 Node/PowerShell 写同一目录却正常；`~/.dsh` 对 Python 子进程也可能是拒绝访问。因此桥默认把临时目录放在工作区下，并在启动时显式设给 `tempfile`。

### 发声语种

| 设置       | 行为                           |
| -------- | ---------------------------- |
| `ja`（默认） | 配了中译日端点就先翻成日文再合成；没配则把中文按日语音读 |
| `zh`     | 直接用中文音素合成                    |
| `auto`   | 交给 GSV 的文本前端判断               |

中译日端点可选，指向任意 OpenAI 兼容 `/chat/completions`：

```yaml
live2d-deskpet:
  voice:
    translateUrl: http://127.0.0.1:1234/v1
    translateModel: your-model-id
    translateApiKey: ""   # 留空则依次尝试环境变量 SILICONFLOW_API_KEY、~/.dsh/.credentials.yaml 里的同名项
```

### 桥的状态显示

设置页会显示三种状态之一：

- **语音桥就绪**（绿色）：模型已进显存，可以发声；
- **仍在载入模型**（灰色）：冷启动要 import torch/gsv 再绑端口，通常 5–20s；
- **无响应**（红色）：连续 15–30s 连不上才报，并给出可读原因（端口没监听 / 连接被重置 / 健康检查超时）与日志路径。

---

## 任务节点语音（Agent驱动模式）

桌宠窗口是独立的 Electron 进程，**看不到 DSH 页面的 DOM**；而插件的客户端 bundle 就跑在页面里。于是这条链路分成两段：

```text
DSH 页面（lib/client/index.js 的 MutationObserver）
   │  发现节点 → POST http://127.0.0.1:9879/task-event  {kind, detail}
   ▼
宿主（DesktopPetHost 的任务事件通道）
   │  判重 + 冷却 + 模式门控
   ▼
Electron 桌宠窗口 → 中文气泡 + GSV 日语语音 + 对应动作
```

| 节点 | 锚点 | 默认 |
| --- | --- | --- |
| `confirm` 需要确认 | `dialog` / `[role=dialog]` 内含「同意/确认/允许…」按钮（排除设置面板） | 开 |
| `done` 任务完成 | 新增 `[data-turn-tail]` 回合结束页脚 | 开 |
| `start` 开始处理 | `[data-streaming]` 出现（助手正文开始流式输出） | **关**（每回合都触发，较吵） |

`[data-turn-tail]` 与 `[data-streaming]` 是 DSH 的语义属性（见 `@linxin666/dsh-client-ui-skin-center` 的 `semantic-attrs-v1` 契约：`turn-tail` / `message-body`）。确认弹窗**没有**专属锚点，只能按按钮文案认，所以带了三层防误报：

1. 延迟 400ms 再确认按钮还在页面上（React 重渲染的残留会被滤掉）；
2. 按钮 `disabled` 时视为已处理（自动批准的场景不打扰）；
3. 设置面板也长成 `role=dialog`，按 `[data-slot^="settings"]` 排除。

回合结束另有两道：0.6s 后若一次冒出 ≥3 个新页脚，判定为切会话/翻历史的重建，全部静音；同一回合按 `data-turn-tail` 的 id 只播一次。

节流在**宿主**侧（同一节点 12–45s 冷却、完成 20s 冷却、刚提醒过确认后 6s 内不再补"完成"），客户端只负责"我看到了"——以后信号源换成 DSH 的正式事件，宿主那层不用动。

> **前提**：这套观察器依赖 DSH 页面开着。只用桌面端窗口、不看 Web GUI 时收不到任务节点。
> 通道端口默认 `9879`，可在设置页「模式」里看到是否在监听；端口被占时会显示失败原因。

## 截屏与隐私

这一节请务必读完再打开截图驱动模式。

**什么时候截屏**：仅当「模式 = 截图驱动（或自动判断解析为截图驱动）」且「截图驱动模式允许截屏」打开时，按**截图间隔**（秒级，最小 10 秒；默认 600 秒 = 10 分钟，范围 10–10800）截一张**主显示器**。Agent驱动模式下不截屏；主 agent 正在输出时也会推迟。

**截了什么会发出去**：与上次画面 8×8 感知哈希差异过小的图会被丢弃；通过去重的 PNG 会随请求发送到**你自己配置的 LLM 端点**（`llm.baseUrl`）。本地端点（如 LM Studio）不会离开本机。

**同时注入的提示词**：每次截屏都会附带一段**写死在代码里**的固定提示词（`lib/shared/screen-context.js`），包含：

- 当前时间；
- 当前前台应用名与窗口标题；
- 一段引导语（要求贴着屏幕内容说话、看不清楚不要编、不要复述敏感信息）。

> ⚠️ **窗口标题会一起发出去**。标题里可能含有文件名、聊天对象名、网页标题等。如果你的场景对此敏感，请把截图间隔调大、或关掉「截图驱动模式允许截屏」。

这段提示词与人设无关：换人设不会改变它，它也不会被写进人设。

**密钥**：`llm.apiKey` / `voice.translateApiKey` 以 secret 角色保存在 `~/.dsh/settings.yaml`；设置页只显示**脱敏**形式（前 4 + `••••` + 后 4），读取接口不回显明文；排障日志写入前也会把这两个字段替换成 `***`。

**本插件不读取、不复用 DSH 自己的 LLM 配置与 Key**，也不会把陪伴请求发到 DSH 的模型提供方。

**页面观察器读到什么**：任务节点语音需要在页面里看 DOM。它只做三件事——找 `[data-turn-tail]`、找 `[data-streaming]`、找带"同意/确认"按钮的 `dialog`。命中后只把**节点类型**和一段**用于去重的短特征**（确认弹窗的标题或按钮文案，最多 60 字；回合页脚的指标文字，最多 60 字）POST 到本机 `127.0.0.1:9879`，不读聊天内容、不上传任何页面文本，也不写磁盘。

---

## 配置项

### 陪伴 LLM

| 字段            | 说明                             |
| ------------- | ------------------------------ |
| `baseUrl`     | OpenAI 兼容端点，`/v1` 可有可无         |
| `apiKey`      | 需要鉴权才填；留空表示"不改动已保存的值"          |
| `model`       | 文本模型                           |
| `visionModel` | 视觉模型；截图陪伴必须支持图片输入，留空退回 `model` |
| `temperature` | 0–2                            |

设置页的「测试连接」会真发一次极小请求，回显可用模型列表或错误原因；卡片顶部还会显示**已保存**的端点 / 掩码密钥 / 模型，保存后给出「已保存」回执。

### 陪伴记忆（0.1.7，默认关）

解决「每一轮 LLM 只看到 system + 当前一张截图、没有历史」导致的重复套话：

- 开启后，每轮结束把「时间 / 前台应用 / 桌宠原话」追加进 `~/.dsh/live2d-deskpet/memory/turns.jsonl`（临时文件 + rename 原子写）；下一轮读回最近 N 轮（默认 8，可配 1–30，另有 1200 字符的注入预算）作为**对话历史**注入请求——历史轮只有文本，截图只附在当前轮。system 提示词里同时列出「最近说过的话」并要求不要复述。
- 防重复的另一半是**重采样闸门**：每轮第一段话先和最近几轮比相似度，高度相似就在开口前丢弃并重采样一次。
- **隐私**：屏幕只存一句概括（前台应用 + 窗口标题），不存屏幕原文；写入前替换疑似密码、证件号、密钥并截断长度。文件损坏或被删时按「无记忆」降级，陪伴照常说话；记忆读写失败永远静默，不影响主链路。
- 设置页可一键清空、查看当前条目数；关闭开关不删数据。

### nsfw 提示段（0.1.8 引入，默认关）

给陪伴 LLM 的 system 提示词注入一段成人向「锚定块」。与 dsh-tavern 的破限段不同，**锚定块是插件内置的**——打开开关即注入，不需要编写任何提示词。0.1.9 起设置页卡片名为「🔞 nsfw提示段」，卡片底部的长说明已删除，效果与隐私说明以本节为准：

- 开关打开 + 自定义正文为空：注入内置锚定块（`lib/shared/companion-nsfw.js` 的常量，不从配置/网络/角色卡读取）。
- 开关打开 + 自定义正文非空：注入自定义正文，**整体替换**内置锚定块（保存前 trim + 截 8000 字；「恢复内置」写回空串）。
- 注入位置固定：人设 → 记忆块（如开启）→ NSFW 段 → 说话方式；说话方式永远最后，气泡长度限制仍在代码层兜底。
- 只作用于陪伴 LLM 的独立端点；开关热更，无需重启。
- **效果不保证**：官方对齐强的模型可能不理睬，云端服务端审核可能直接拦截返回，本地模型通常更可靠——插件只负责把锚定块送到位。
- **隐私**：`nsfw` 不进人设对象、不随 v2 角色卡导出；自定义正文只存 `~/.dsh/settings.yaml`；日志只记来源与字数，绝不打印正文（排障日志里与密钥同级脱敏）。

### 人设

一份人设 = `{ id, name, emoji, systemPrompt, greeting, description, tags }`。启用的人设的 `systemPrompt` 作为陪伴 LLM 的 system message，空白时退回内置提示词；`greeting` 在该人设被激活时于气泡里说一次（同时作为语音桥的 warmup 文本）。

导入/导出用 SillyTavern v2 角色卡（`spec: chara_card_v2`），本插件自己的字段放在 `extensions['dsh-live2d-deskpet']`，导出再导入不丢标识。

### 窗口

- 宽 180–800 / 高 240–1000，默认 260×360；出界会被夹到边界（设置页、宿主、Electron 三处共用同一套夹取逻辑）。
- **锁定尺寸**只禁拖拽改尺寸，仍可拖动移动。
- **鼠标穿透**默认开启：只在模型本体上接收点击，其余位置落到下一层窗口。
- 气泡每句 20–40 字、每条回复最多 60 字，停够阅读时间再换下一句。

---

## 目录结构

```text
lib/
├─ index.js              插件入口：apply()、Config、Typert Remote 清单
├─ config.js             设置 schema（volatile，热更）
├─ core/                 AgentStateResolver、ModelRegistry
├─ host/                 DesktopPetHost：loopback HTTP+WS、模型服务、语音桥生命周期与健康轮询
├─ electron/
│  ├─ main.js            主进程：窗口、截屏、IPC
│  ├─ preload.cjs        contextIsolation 下的最小桥接
│  ├─ renderer.html/js   渲染页与打包后的渲染 bundle（Pixi + Live2D）
│  └─ services/          CompanionService、OpenAiCompatibleClient、ForegroundApp、PerceptualHash、DshModeProbe
├─ shared/               宿主 / Electron / 浏览器三方共用的纯函数（不依赖 node 内置模块）
│  ├─ screen-context.js  截屏时注入的固定提示词
│  ├─ task-voice.js      任务节点文案与类型（固定，不随人设变化）
│  ├─ audio-bubble-sync.js  以音频为时钟的气泡调度
│  └─ pet-section.js     设置段 → 运行时配置的投影
└─ client/               设置页 bundle（DSH 客户端插件）+ 页面内任务节点观察器
tts/gsv_bridge.py        GSV-TTS 本地合成桥
docs/                    细分文档
cordis.patch.yml         插入 profile 的 loader 补丁
```

---

## 故障排查

| 现象                                                  | 原因 / 处理                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 窗口在，只显示一段文字提示                                       | 缺 Cubism 运行核，或模型目录里没有 `.model3.json`                                                          |
| `Cannot read properties of undefined (reading '0')` | 运行核过新（Core 6 缺 `csmGetDrawableRenderOrders`）                                                  |
| `Network error.` 且日志有 404                           | 模型文件名编码损坏，或 `model3.json` 里的相对路径与实际文件不符                                                       |
| 窗口看不见但进程在                                           | 它是透明置顶窗口，部分截图工具抓不到；用 `DESKPET_CAPTURE=<path>` 让窗口自己导出像素                                       |
| 气泡一直是「（正在合成语音…）」                                    | 0.1.1 的已知缺陷（正文要等音频播完才回填），0.1.2 起已修复                                                           |
| 设置页提示「语音桥无响应」但语音正常                                  | 0.1.1 的误报（轮询被桥重启打断 + 2s 超时），0.1.2 起已修复；升级后仍出现请贴 `gsv-bridge.log` 尾部                           |
| 截图驱动模式一直不截屏                                           | 看设置页「模式」卡片里的**最近一次截屏**：`skip · 当前模式 task` / `skip · 主 agent 正在输出` / `skip · 画面与上次几乎相同` 都会写明原因 |
| 语音桥起不来                                              | 看 `gsv-bridge.log`；最常见是 Python 路径错、venv 里没装 `gsv_tts`、模型文件名与设置不符                              |
| 改了设置没反应                                             | 看设置页顶部红字（写入失败会说明原因）；或 `~/.dsh/settings.yaml.lock` 被上次异常退出的进程留下                                |
| 任务节点不播报 | ① 设置页「模式」里的**事件通道**是否显示 `127.0.0.1:9879`（端口被占会写明原因）；② 当前是否在 Agent驱动模式；③ DSH 页面是否开着（观察器跑在页面里）；④ 对应开关是否打开 |

### 调试开关

| 环境变量                       | 作用                                                             |
| -------------------------- | -------------------------------------------------------------- |
| `DESKPET_DEBUG=1`          | 打开宿主侧排障日志 `~/.dsh/live2d-deskpet/bootstrap.log`（默认关闭；写入前会脱敏密钥） |
| `DESKPET_CAPTURE=<png 路径>` | 让桌宠窗口自己导出像素，用于验证渲染                                             |
| `DESKPET_CAPTURE_DELAY_MS` | 上面那次的延迟，默认 12000ms                                             |
| `GSV_WORKSPACE`            | 覆盖 GSV 工作区根目录                                                  |

---

## 开发说明

- **`lib/` 是构建产物**：`lib/client/index.js` 与 `lib/electron/renderer.js` 都是 esbuild 打好的自包含 bundle（以 `window.__ModuleLoader__.load({...})` 形式注册）。仓库里没有 TypeScript 源码与构建脚本，所以**直接改 bundle 就是改行为**；`lib/client/section/*.js` 是早期的源码快照，运行时不加载，可能滞后于 bundle。
- **三方沙箱**：`shared/` 下的模块会被同时打进宿主（Node）、Electron 主进程和浏览器，因此不允许 import node 内置模块。需要 `fs`/`path` 的逻辑只能留在 `host/`、`electron/`。
- **资源清理**：插件在 `apply()` 里用 `ctx.effect(() => () => {...})` 注册拆除逻辑，统一停掉事件订阅、桌宠宿主与语音桥进程。
- **热更边界**：改 `lib/host`、`lib/electron`、`lib/client` 需要重启 DSH；只改配置值则热生效。

---

## 许可

MIT，见 [LICENSE](LICENSE)。

第三方组件各自遵循其许可：Live2D Cubism Core 与模型、GSV-TTS 及其模型、pixi.js / pixi-live2d-display 均**不随本仓库分发**，请自行获取并遵守其条款。

> AI生成