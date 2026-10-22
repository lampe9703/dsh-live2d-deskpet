# 设置栏：Live2D 桌宠

本插件的能力全部在 **DSH Web GUI → 设置 → Live2D 桌宠** 里配置。改动**立即生效**：不需要重启 DSH，也不需要重启桌宠窗口。

## 它是怎么连起来的

```text
设置栏（浏览器 / Web GUI）
   │  settingsScope.bind({ namespace: 'live2d-deskpet' })   读 + 写
   │  remote.live2dDeskpet.*                                动作型调用
   ▼
DSH 设置命名空间 live2d-deskpet  ──watch()──▶  DesktopPetHost.applySettings()
   │                                                  │ WebSocket: window-size / snapshot
   │                                                  ▼
   │                                           Electron 桌宠窗口
   └─ 落在 ~/.dsh/settings.yaml
```

- **持久值走设置命名空间**：`live2d-deskpet`，是分层解析的（schema 默认 → 组合层 → 用户层 `~/.dsh/settings.yaml`）。
- **动作走 Typert Remote**：命名空间 `live2dDeskpet`，五个方法 `importModel` / `removeModel` / `testLlm` / `openModelsFolder` / `clearCompanionMemory`。这些是「做一件事」，不是「存一个值」，所以不走 settings。
- **状态回流**：宿主把自己观测到的事实（生效模式、Cubism 运行核是否就位、目录路径、API Key 是否已设置）通过 `runtimeView()` 回传，设置栏据此显示提示。

### 分层与兜底

| 层 | 来源 | 作用 |
| --- | --- | --- |
| schema 默认 | `src/config.ts` 的 `Config` | 第一次运行时的初始值 |
| 组合层 `base` | profile 的 `cordis.patch.yml` | 部署方可写死的默认 |
| 用户层 | `~/.dsh/settings.yaml` 的 `live2d-deskpet:` | 设置栏写在这里 |
| 旧文件兜底 | `~/.dsh/live2d-deskpet/settings.json` | 没有 settings provider 时（例如没有 Web GUI、直接起窗口时）使用；首次升级会被一次性迁移进用户层 |

## 八个分组

### 模型

- 模型列表来自递归扫描 `~/.dsh/live2d-deskpet/models`；点「使用」即切换，无需重启。
- **导入模型** 打开 DSH 原生的目录选择器，把选中的文件夹**复制**进用户模型目录（复制而非引用，原目录移动后仍可用），然后自动重扫。一个文件夹只能含一个 `.model3.json`，含多个会被拒绝并给出原因。
- **删除模型** 只删用户模型目录里的副本，不会碰你原来的文件夹。删除的如果是当前正在用的模型，会自动回退到第一个可用模型。
- **Cubism 运行核路径** 可以填文件也可以填目录，留空则按默认位置查找（见 [模型导入](model-import.zh-CN.md)）。
- 当前模型已被移出磁盘时，设置栏会提示并回退；此时 `modelId` 不会写入一个不存在的值。

### 模式

- `Agent驱动` / `截图驱动` / `自动判断` 三选一。
  - **Agent驱动**：只跟着 DSH 的 Agent 状态做动作（不说话时也有状态基调：想事情时疑惑、干活时平静、完成时开心、出错时担心），并在任务节点（需要确认 / 完成 / 开始）**让陪伴 LLM 说一句**。不截屏。
  - **截图驱动**：按间隔截屏，用独立 LLM 主动搭话。
- **自动判断**（0.2.2 起，0.2.3 修正）按下面的顺序判：
  1. agent 状态是 `working` / `think`，或**距最后一次活跃不到 90 秒**（尾巴，吃掉工具调用之间、模型出字之间的空档）→ **Agent驱动**：不截屏、不抢显卡、只跟状态做动作。
  2. **DSH 页面有键盘焦点** → **Agent驱动**。页面自己上报 `document.hasFocus()`，也就是"你此刻就在页面前面"，不该被截图打扰。
  3. **页面明确失去焦点** → **截图驱动**，开始按间隔看屏幕。
  4. 从没收到过页面上报（页面没开 / 客户端较旧）→ 退回窗口探测：DSH 窗口在前台或置顶判 Agent驱动，否则截图驱动。
  - **显式选「Agent驱动」/「截图驱动」时不参与自动判断**，选什么就是什么。
  - 0.2.3 修的问题：旧版只认"DSH 窗口被钉在顶层"（`isAlwaysOnTop`），普通前台窗口永远不满足；而且 `node-window-manager` 的原生模块在部分机器上根本没编译，探测永远返回 false——于是 agent 一闲下来就判成截图驱动，人坐在 DSH 里看代码却被搭话。现在主判据换成页面自报焦点，零依赖。
- 下方显示**当前实际生效**的模式：选 `自动判断` 时会同时显示它此刻解析成了 Agent驱动 还是 截图驱动。这是宿主与 Electron 观测到的事实，不是设置栏推算的——**她为什么不说话，这一行就是答案**。
- **置顶** 控制窗口是否始终位于最前。
- **情绪动作引擎**（0.2.0，默认开）：说话瞬间按当前情绪生成表情与身体动作，而不是按状态查固定角度。关掉后注入脚本一个参数都不写，姿态完全退回 0.1.9 的查表行为——这是出问题时的唯一退路。
  - 开：同一句「太好了」和「有点担心」会得到不同的头部角度、嘴角、眉毛、腮红与眼笑。
  - 关：行为与 0.1.9 逐字节等价（含陪伴 LLM 的提示词——关闭时不追加情绪标记约束）。
  - 依赖项：`~/.dsh/live2d-deskpet/profiles/<modelId>.json`。首次说话前由主进程用 `@soullink-emotion/profile-generator` 扫模型目录生成并缓存；生成失败则该模型自动退回 0.1.9 行为，不报错、不白屏。
- **截图间隔（秒）** 是截图驱动模式两次截图之间的最小间隔，范围 **10–10800 秒**（最小 10 秒，默认 600 秒 = 10 分钟）。旧版用分钟（1–180）：升级到本版本后，已保存的旧分钟值会在第一次启动时一次性换算成秒并写回（例如 4 分钟 → 240 秒），之后不再重复换算。
  - 0.2.2 起这个数字**只管"间隔"**，不再兼任"检查频率"：内部每 30 秒看一眼要不要截图，没到间隔就直接退出，到了一次就截。所以"上一轮被跳过"不会再让你白等一整个间隔——agent 一闲下来，最多 30 秒就能补上。
  - 间隔从**上一次真的截屏**算起（不是从"上一次说话"算）。截屏是这条链路上最贵的动作，哈希判重、语音没热、推理失败之后都不会免费重来。
- **任务节点语音** 三个开关（需要确认 / 任务完成 / 任务开始），文案固定、气泡中文、发声语种跟随语音设置。最后一行是**事件通道**状态：显示 `127.0.0.1:9879` 说明页面侧可以上报，端口被占会直接写出原因。
  - 0.2.3 起这个通道**不再随语音开关关闭**：页面焦点（自动模式的第二判据）也走它。三个开关关掉只是不播报，通道照常在听——否则关掉语音等于关掉"我在 DSH 前面"这个信号。
  - 0.2.1 起，Agent 模式下桌宠会**就着任务节点说一句**：语气与情绪由陪伴 LLM 决定（人设、说话方式、NSFW 锚定块与截图驱动完全同一套），不同节点会给出不同情绪（开始＝平静、需要确认＝担心、完成＝开心）。没配 LLM、LLM 挂掉或 6 秒没回话时，退回上面那批固定文案，气泡照出，不会静默。
  - 0.2.4 起，Agent 模式的 system 做了两处调整，否则**人设会把场景段压掉**（实测：人设里「屏幕」出现 7 次、「搭话」3 次，还写着「不能替他做任何事」「不要提醒他」「不要讲道理」，于是"需要确认"那条被回成了"可以更放肆一点哦"）：场景段前置一句**作用域覆盖**声明，明确这一轮不看屏幕、提醒他去点确认不算替他做事；同时**不再追加【说话方式】段**——那段的字数预算（30–N 字）与场景段的 40 字上限打架，模型会挑前者，回复就变成陪伴腔的闲聊。
  - 0.2.5 起，场景规则从人设卡里搬到代码（`shared/scene-anchor.js`），人设只留身份与语气；陪伴 / Agent 两种模式各注一份场景锚定块。
  - 0.2.6 起加了**信息闸**：只有 `需要确认` 那条的 detail（弹窗标题）是真信息，`开始处理` 恒为空、`任务完成` 常常是页脚时间（"刚刚"）或实现词（`agent-settled`）。把这些噪声当摘要喂给模型，它只能用人设腔凑一句泛泛的话——听感就是"与任务毫无关系"。现在没有可用摘要就**不请求模型**，直接用固定文案（"好，我开始处理了。""任务完成啦。"），省一次请求，也保证每句都贴着阶段。
  - 0.2.8 起把**「用户这一回合让他做什么」同步给陪伴 LLM**：从 DSH 的 `session/event`（`user/message`，`source.kind === "user"`）取用户原话，压平、截到 60 字，作为 `这次要做的事：…` 写进节点播报的 user 消息。这是"她说的话跟任务无关"的正解——阶段有了、内容没有，模型只能靠人设凑。
    - 只认用户自己打的字：`runtime-context`、`agent-instructions` 这类系统注入会跳过；图片块不带文字，也跳过。
    - 任务描述只发给**你自己配置的那个陪伴端点**（和截图、人设走同一个端点），不会发到别处。
    - 有了任务描述之后，`开始处理` / `任务完成` 也会走模型（不再一律用固定文案），因为模型手里终于有东西可说了；两者都没有时才退回固定文案。
  - 0.2.7 起**三个节点的锚点全部对照 DSH 的实际 DOM 重新对齐**（从 `app.asar` 里核实的结构）：
    - `需要确认`：原来找 `dialog` / `role="dialog"`，但 DSH 的审批面板是 `div[data-approval-key]`（`ApprovalPanel`），**根本不是 dialog**——所以这条从来没触发过，弹选择框时只能被别的事件顶上。现在按 `[data-approval-key]` 认，`aria-busy="true"` 表示已答过（不播），detail 取面板标题（含工具名）。
    - `开始处理`：原来盯 `[data-streaming]`，而那个属性挂在**推理行的摘要**上（`running || void 0`），一个回合里会反复出现——于是"开始"被重复播报，正好赶在审批弹窗弹出的瞬间。现在改由宿主按 **agent 状态翻转（闲 → 忙）** 派发，一个回合只发生一次。
    - `任务完成`：`[data-turn-tail]` 是对的，保持不变；另外在**确认之后压住 `done`**——等审批时 agent 会短暂变闲，`settle` 会把这段空闲误判成"回合结束"，于是弹着确认框她先说"任务完成啦"。现在确认后 5 分钟内（或直到 agent 重新忙起来）不再播完成。
  - 关掉「情绪动作引擎」后，话照说（LLM 照调），只是不再要求模型输出情绪标记，姿态回到按状态查表的固定角度。
  - 这三个开关关掉的节点**既不说话也不请求 LLM**——关掉「任务开始」就不会有那一次请求。
- **对系统截图可见**（`visibleToCapture`，0.2.1，**默认关 = 不可见**）：关掉时桌宠不会出现在任何截图或录屏里，包括她自己的屏幕理解截图。这是系统级标志（Windows `WDA_EXCLUDEFROMCAPTURE`），不分采集方——**你自己 Win+Shift+S 或录屏也拍不到她**，需要录屏展示她时再把这个开关打开。
  - 为什么默认关：截图驱动模式截的是整个屏幕，桌宠又是置顶透明窗口，于是每一张截图里都有她自己，模型会把画面里的角色当成"别人"来说（"屏幕上那个女孩……"）。默认关掉即解决，不需要用户先找开关。
  - 它和「情绪动作引擎」是两个开关：一个管"拍不拍得到自己"，一个管"动作由谁驱动"，不要混用。
  - 需要 Windows 10 2004+（build 19041+）。更老的系统上该 API 可能不生效，此时行为与旧版一致（截图里仍有她），主进程不会因此报错。

> 任务节点的信号来自 DSH 页面里的观察器（`lib/client/index.js`），所以**页面开着才有效**；纯桌面端窗口看不到页面。判重与冷却在宿主侧，客户端只负责"我看到了"。

### 陪伴 LLM

用途：截图驱动模式的主动发言走这个端点，**与 DSH 自己的模型配置完全隔离**。插件不读取也不改写在 DSH 里配置的 Key。

- **测试连接** 向 `baseUrl` 发一次极小的 `/models` 请求，把可用模型列表或具体错误显示出来；不发送任何截图或对话。
- **API Key** 以 `role('secret')` 保存。它**不会回显**：输入框留空 = 保持原值不变，`unset` 才是清除。所以「保存后输入框变空」是正常的，不是没保存成功。
- **截图感知** 关掉后，截图驱动模式不再产生任何截图，视觉模型也不会被调用——即使填了 `visionModel`。

### 陪伴记忆

用途：解决「每一轮 LLM 都只收到 system + 当前一张截图，没有任何历史」导致的重复套话（反复「腿麻」「腰酸」「坐久了」）。开启后，每一轮结束把「时间 / 前台应用 / 桌宠原话」记下来，下一轮作为**对话历史**注入请求，并在 system 提示词里列出「最近说过的话」要求不要重复。

- **记住最近几轮对话**（`memory.enabled`）：总开关。**默认关**：不开启时请求形状与旧版完全一致。
- **保留轮数**（`memory.shortTermTurns`）：注入最近几轮（1–30，默认 8）；另有字符预算 `memory.maxPromptChars`（默认 1200）控制历史总长，超出时从最旧的开始丢弃，最新一轮永远保留。
- **清空记忆**：一键清空轮次文件（宿主侧原子写入，临时文件 + rename）；桌宠未运行时也能清。
- **当前条目数**：宿主每次读文件后的实际条数，5 秒内自动刷新。

数据与隐私：

- 轮次存放在 `~/.dsh/live2d-deskpet/memory/turns.jsonl`，**不在 settings 里**——配置是配置，运行时数据是运行时数据。关闭开关不删文件，只有「清空记忆」会清空它。
- 每行只有 `{ ts, foreground, reply, screenNote, hash }`。`screenNote` 只存一句概括（前台应用与窗口标题），**不存屏幕原文**；写入前对疑似密码、证件号、密钥做替换，超长文本截断。
- 文件损坏 / 被删：读侧把「坏记忆」当「无记忆」处理，陪伴照常说话；写入失败静默降级，绝不影响陪伴主链路。
- 重启 DSH 后历史仍在（从文件读回）；需要“忘掉”时点「清空记忆」。

防重复的另一半是**重采样闸门**：开启记忆后，桌宠每轮的第一段话会先和最近几轮原话比一次相似度，高度相似则丢弃这一次采样（此时一个字都没说出去）并重采样一次，重采样会在提示词里追加「换个角度或话题」的指令。每轮最多重采样一次，避免在小模型上无限重试。

### nsfw 提示段

用途：给陪伴 LLM 的 system 提示词注入一段成人向「锚定块」（0.1.8 引入；0.1.9 卡片更名「nsfw提示段」，并删去卡片底部的两段长说明——效果免责与隐私说明以本节为准）。与 dsh-tavern 的破限段不同，**锚定块是插件内置的**——打开开关即注入，用户不需要编写任何提示词；文本框只在想覆盖内置正文时才用。

- **开启nsfw陪伴锚定块**（`nsfw.enabled`）：总开关。**默认关**：关闭（或不配置）时请求形状与 0.1.7 完全一致，system 提示词逐字相同。
- **自定义覆盖正文**（`nsfw.prompt`）：可选项。留空 = 注入内置锚定块；填写则**整体替换**内置正文（不是追加）。保存前会 trim 并截断到 8000 字；「恢复内置」按钮写回空串。
- 注入位置固定：**人设 → 记忆块（如开启）→ NSFW 段 → 说话方式**。说话方式保持最后——它是气泡格式的产品约束；气泡长度限制（每句 20–40 字、每条最多 60 字）仍在代码层兑底。
- 只作用于「陪伴 LLM」卡片里配置的**独立端点**，与 DSH 主 agent 无关。

效果与隐私：

- 破限效果**因模型和平台而异**：官方对齐强的模型可能不理睬锚定块，云端服务端审核可能直接拦截返回；本地模型通常更可靠。插件只负责把锚定块送到位，**不保证效果**。
- 锚定块是插件内常量，不从配置文件、网络或角色卡读取；自定义正文只存 `~/.dsh/settings.yaml` 的 live2d-deskpet 段。
- `nsfw` **不进入人设对象，也不随 v2 角色卡导出**（导出再导入不携带该设置）。
- 日志只记录来源（builtin/custom/off）与注入字数，**绝不打印正文**；排障日志（DESKPET_DEBUG）里 nsfw 正文与密钥一样被脱敏成 `***`。
- 开关热更：打开后下一轮截屏请求即生效，无需重启。

### 语音（GSV-TTS）

气泡里的文字始终是陪伴 LLM 写的中文；这一组只决定**用什么声音念**。

- **启用本地语音合成**（`voice.enabled`）：关掉则退回浏览器自带的 `speechSynthesis`。
- **发声语种**（`voice.lang`）：`ja` / `zh` / `auto`。`ja` 且配了中译日端点时先翻译再合成，否则把中文按日语音读。
- **桥端口**（`voice.bridgePort`）：默认 9876，桌宠渲染器直连 `127.0.0.1:<port>`。
- **GSV 工作区根目录**（`voice.workspaceDir`）：其余路径的基准。解析顺序是「这个字段 > 环境变量 `GSV_WORKSPACE` > `~/Documents/deepseek-harness/default-workspace`」。
- **Python 路径 / 模型目录 / 临时目录 / GPT·SoVITS 文件名 / 两段参考音频**：留空即按工作区推导（`gsv-venv`、`gsv_models`、`gsv-tts-lite/.../examples`、`tmp`），也可以逐个覆盖。
- **中译日端点**（`translateUrl` / `translateModel` / `translateApiKey`）：可选，任意 OpenAI 兼容 `/chat/completions`。Key 与 `llm.apiKey` 一样是 `role('secret')`，不回显。

状态行读的是**宿主轮询桥 `/health` 得到的事实**，不是设置值：

| 显示 | 含义 |
| --- | --- |
| 语音桥就绪（绿） | 模型已进显存，可以发声 |
| 仍在载入模型（灰） | 冷启动 import torch/gsv + 绑端口，通常 5–20s |
| 无响应（红） | 连续失败 15–30s 才报；括号里是原因（端口没监听 / 连接被重置 / 健康检查超时），后面跟日志路径 |

> 单次健康检查失败**不会**被当成故障：桥冷启动期间必然失败几次，宿主会连续计数并在桥进程仍存活时给更长的宽限。轮询的生命周期跟宿主走，不随桥重启而中断——0.1.1 就是因为重启时把轮询一起停掉，才出现"语音正常却一直提示无响应"。

### 人设

见下面的[数据结构](#人设的数据结构)。

### 窗口

- 宽度 **180–800**，高度 **240–1000**。出界会被夹到边界，不会报错。
- 默认 **260×360**。
- **锁定窗口**（`windowLocked`）：锁定后不可拖拽改尺寸，右下角把手隐藏；**仍然可以拖动移动**。
- **记住位置**（`rememberWindowPosition`）：独立的开关。开启的瞬间会把窗口**当前**所在位置记下来（宿主向 Electron 发 `request-window-position` 索取），之后每次移动都同步，重启回到那里。关闭只是停止同步，已存的位置会留着，下次开启继续用。

> `rememberWindowPosition` 与 `windowPosition` 是两件事，不能合并。用一个值表达「是否记住」的话，刚开启时没有任何位置可存，唯一能写的就是 `{ x: 0, y: 0 }`——而窗口会真的被放到屏幕左上角。所以开关和值分开：`windowPosition` 只在开关打开时驱动窗口（见 `sectionToConfig`）。

- **模型适配**：模型按窗口等比缩放，整个角色始终完整可见。缩放系数由**载入时测量一次**的模型原始尺寸算出（`shared/model-fit.ts` 的 `fitScale`），不依赖当前已应用的缩放，所以反复调整窗口尺寸不会漂移，也不会突然放大成只露一个局部。

窗口尺寸的夹取在三处共用同一套纯函数（`clampWindowWidth` / `clampWindowHeight`）：设置栏写值前、宿主投影配置时、Electron 建窗与收 `window-size` 时。所以「设置栏显示的数」和「窗口实际的尺寸」不会分叉。

## 人设的数据结构

```yaml
live2d-deskpet:
  persona:
    activeId: p1            # 空串 = 内置默认人设
    personas:
      - id: p1              # 稳定标识，导出再导入不变
        name: 小助手         # 必填，界面上的名字
        emoji: "🐾"          # 可空
        systemPrompt: 你是桌面上的小助手。   # 主字段：作为 system message
        greeting: 我来啦。    # 激活时在气泡说一次，可空
        description: 给人看的简介，不会发给 LLM
        tags: [companion]   # 可空
```

解析规则：

- `activeId` 指向不存在的人设，或人设的 `systemPrompt` 为空白 → 退回内置默认提示词。
- 缺 `id` 或 `name` 的条目在读取时被丢弃（`normalizePersonaConfig`），所以手工编辑出错不会让设置栏整体崩掉。
- 只有 **`systemPrompt`** 会进 LLM 的 system message；`description` 纯粹给人看。
- `greeting` 只在**人设发生切换**时说一次，不会每次进入截图驱动模式都重复。

### 导入 / 导出：SillyTavern v2 角色卡

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "小助手",
    "description": "...",
    "personality": "...",
    "scenario": "...",
    "first_mes": "我来啦。",
    "system_prompt": "你是桌面上的小助手。",
    "tags": ["companion"],
    "extensions": { "dsh-live2d-deskpet": { "id": "p1", "emoji": "🐾" } }
  }
}
```

映射关系：

| v2 字段 | 人设字段 | 说明 |
| --- | --- | --- |
| `name` | `name` | 必填，缺失或空白会被拒绝 |
| `system_prompt` | `systemPrompt` | **排在最前**，但不排他（见下） |
| `description`/`personality`/`style`/`rules`/`behavior`/`scenario`/`mes_example` | `systemPrompt` | 依次追加到 `system_prompt` 之后 |
| `first_mes` | `greeting` | |
| `creator_notes`（无则 `description`） | `description` | |
| `tags` | `tags` | 只保留字符串 |
| `extensions['dsh-live2d-deskpet'].id` | `id` | 没有则生成一个随机 id |
| `extensions['dsh-live2d-deskpet'].emoji` | `emoji` | |

也接受**只有 `name` 的 v1 裸卡**（不带 `data` 外层）。

#### 为什么 `system_prompt` 不排他

真实角色卡通常同时带一个简短的 `system_prompt` 和一大段 `rules`/`personality`。早先的实现「有 `system_prompt` 就只用它」，会把后面那些整块丢掉——实测某张卡因此丢掉 6600+ 字，其中包括 3240 字的 `rules`。现在改为：`system_prompt` 排在最前，其余字段按上表顺序追加，**已被包含的字段自动跳过**（避免 `system_prompt` 复述 `description` 时重复）。

#### 本插件的导出是「可精确还原」的

`toV2Card` 会把整份人设写进 `extensions['dsh-live2d-deskpet']`。因此导出后再导入是**逐字段还原**，不会像改由 v2 文本字段重新推导那样、每轮都把 `description` 追加进 prompt 而越滚越长。同一次导出也会写 `extensions.dshCosplay`（只含 `id`/`emoji`），让 dsh-cosplay 能直接读走。

### 与 dsh-cosplay 联动

装上 dsh-cosplay 后，人设卡片下方会多出「来自 dsh-cosplay」一栏，把该插件**角色库里已有的角色**逐个列出，点「导入」即复制成桌宠人设。

- 走的是 dsh-cosplay 自己的设置命名空间 `cosplay`，**只读不写**——角色库仍归它所有，两个库各自独立。
- 映射用同一套纯函数（`personaFromCosplayRole`），`id` 原样带过来；同名 id 已存在时会新生成一个，所以重复导入是「再来一份」而不是静默覆盖。
- 没装 dsh-cosplay 时这一栏不渲染，其它功能不受影响。

## 陪伴发言：思考过程与断句

气泡浮在角色上面，所以它显示什么、显示多长，直接决定模型会不会被挡。这里有两层，职责分得很清楚。

### 思考过程为什么不进气泡

模型暴露思考有两种形态，**都由代码层拦住**，而且都不需要关掉思考：

1. **独立的 `reasoning_content` / `reasoning` 字段**（DeepSeek、LM Studio 等）——流式解析时直接分流，从不进入发言文本；
2. **内联在 `content` 里**，用标签包起来（Qwen3 及很多社区微调版会输出 ` thinking…<｜end▁of▁thinking｜>`）——由 `src/shared/reasoning.ts` 的 `ReasoningFilter` **边流边过滤**。

第 2 种必须边流边滤：标签会**跨 chunk** 到达（先来 `"<thi"` 再来 `"nk>"`）。等整段收完再 `replace()` 也能去掉标签，但那时气泡已经把思考念出来了。为此过滤器：

- 只扣留「可能正在成形的标签片段」，普通文本不延迟（不是固定 lookahead）；
- 用实例状态记住「当前正在思考块内」，否则下一块会重新只找开标签、把扣留的文本当普通发言漏出去；
- **未闭合的思考块整段算思考**——模型在思考中途被截断时什么都没说，念半句思考比不念更糟。

思考内容不会丢弃，而是走 `onReasoning` 记进 DSH 日志（截断 500 字），方便你想看的时候能看到。

> **刻意没有**在提示词里写「不要思考」「不要输出推理过程」。思考是模型自己的事，显示层已经负责不把它念出来；要求模型压制思考反而可能损害推理质量，而你的诉求本来就是「别显示」，不是「别思考」。

### 断句：代码层保证，提示词层润色

这是你问的「该从代码还是人设提示词入手」——**两层都要，但职责不同**：

| 层 | 做什么 | 为什么不能只靠它 |
| --- | --- | --- |
| 代码（`src/shared/bubble-speech.ts`） | 每泡 20–40 字、每条回复最多 60 字，到句子/逗号边界就切，没有边界就按预算硬切 | 它只能**切**已有文本，管不了模型怎么写，也没法把字加回去 |
| 提示词（`COMPANION_SPEECH_STYLE`） | 要求每条回应用中文说 30–60 字、拆成两三句、每句 20–40 字 | 提示词**不保证**：模型仍可能一口气写 400 字 |

只靠提示词，模型偶尔话多就会糊满屏；只靠代码，切出来的片段可能断在半句中间。所以：提示词让模型**写得**对，代码保证**写得再长也不会溢出**。

提示词里的数字**直接插入自这些常量**，所以改代码里的界限，提示词跟着变，两边不可能报出不同的数字（`tests/persona.test.ts` 钉了这一点）。

提示词这条以「追加」方式接在人设后面（`companionSystemPrompt`），不改动人设卡本身——人设卡是你写的，插件只补一条说话节奏。

### 两条上下限分别由谁保证

| 界限 | 值 | 谁保证 | 说明 |
| --- | --- | --- | --- |
| 单泡下限 | 20 字 | 代码选边界 + `SpeechQueue` 合并 | 下限以下的边界**故意跳过**，让两句短句合成一泡；结尾的短尾巴并进前一泡（两片相加不超过上限时） |
| 单泡上限 | 40 字 | 代码 | 到上限还没有可用边界就按预算硬切（英文会往回退到空格，不切断单词） |
| 单条回复下限 | 30 字 | **只靠提示词** | 代码能把文本切短，不能把字加回去。模型自己说太少时，气泡就是短的——这是唯一一处无法用代码兜底的界限 |
| 单条回复上限 | 60 字 | 代码 | 说满 60 字即停止；超出的部分被丢弃，并**回退到界限内的最后一个标点**，不让回复停在半句中间 |

下限为什么不能写死在切分函数里：切分是**流式**的，逐块决定「这一段说完了」。若在 8 字处就切，播放器只能**先**显示这 8 字、之后无法把它并进下一句。所以下限以下的边界在切分时就跳过，而不能等看到下一块再回补。唯一的例外是**结尾**——收流时如果整条回复都不足一泡，它仍然会被说出来（模型只说了一句短的，这总比什么都不说好）。

超过上限时也不同：若勉强塞进去的那一小截短于 20 字、而整条回复已经够 30 字，就**干脆停在这里**，而不是吐一个半句。反过来，若停在这里会让整条回复低于 30 字，那就保留这一小截——宁可短一点，也不要静默。

### 气泡的节奏：每条停多久

上下限解决了「气泡多长」，但没解决「停留多久」。原本 `say()` 是**立即替换**气泡内容的，而发言片是以**流式速度**到达的——所以整个回复会在几百毫秒内闪完，只有最后一条能被看清。

真机实测（`minicpm-v-4.6`，两条气泡）：

```
旧行为：第 1 条 2.13s 出现，第 2 条 2.26s 出现  ← 只隔 133ms
```

现在由 `src/shared/speech-playback.ts` 的 `SpeechPlayback` 接管：片先入队，**每条停够自己的阅读时长**再放下一条，队列空了自动收起气泡。

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `BUBBLE_HOLD_MS` | 4000 | 每条气泡的**最短**停留时间 |
| `BUBBLE_CHAR_MS` | 40 | 每个字符追加的阅读时间 |

所以一条 20 字的气泡停 4.8 秒，一条 40 字的停 5.6 秒。如果你想要**严格 4 秒**，把 `BUBBLE_CHAR_MS` 设为 0 即可。

同一回复的实测时间轴：

```
0.00s  [25 字] held 5.00s  现在三点正合适，可以考虑用观察的方式聊聊桌面情况。
5.00s  [33 字] held 5.32s  先静想想是否想主动搭话吧。……
10.32s 气泡收起
```

两点实现细节：

- **语音合成也跟着走**：朗读原本是在片到达时就发起的，语音会跑到气泡前面；现在改为在**显示那一刻**朗读，口型与文字同步。
- **新回复不等旧计时器**：队列播空后状态复位，下一条回复立刻显示，不会被上一轮的残留定时器卡住（`tests/speech-playback.test.ts` 钉住这一条）。

播放器的时间源是**注入**的（`Deferrer`），所以节奏可以用假时钟测试，不必真的等 5 秒。

### 还有一个曾经的 bug
### 还有一个曾经的 bug

`CompanionService` 原本先逐句 `say(sentence)`，最后又 `say(整段 answer)`。后者把逐句显示**整个覆盖**掉，气泡最终总是装着完整回复——这才是「内容过多遮挡模型」的直接原因。现在只逐片发言，不再重复整段。

气泡本身也收紧了：`max-height` 从 60% 降到 34%，并限制 4 行（`-webkit-line-clamp`；因为要这个 clamp，`say()` 用 `display:-webkit-box` 而不是 `block`）。

## 交互反馈

设置栏用内联样式渲染，而内联样式表达不了 `:hover`/`:active`/`:disabled`。因此注册时会向 `<head>` 注入一张**作用域限定在 `.deskpet-section`** 的样式表（`SECTION_CSS`），一次覆盖所有控件：

- 按钮：悬停提亮、按下 `scale(.955) translateY(1px)`——点击立刻有回应，不必等写入返回。
- 输入框：聚焦时描边高亮 + 光环。
- 开关：滑钮 `left` 走 `cubic-bezier(.4,0,.2,1)` 曲线滑动，按下时滑钮横向拉伸。
- `prefers-reduced-motion: reduce` 时全部关闭动画。

> 滑钮的滑动**依赖 `checked` 真的变化**。如果写入被拒绝、`section` 不更新，滑钮就会停在原地——这正是「点了没反应」的样子。所以写入失败必须在界面上说出来（见「排障」里的红字说明）。

## 无设置栏时的行为

宿主进程也可能在没有 Web GUI 的情况下启动（例如没有 Web GUI、或者 profile 没装客户端插件）。这时：

- 配置值来自组合层 `base` 与旧文件兜底，设置栏缺省。
- 右键菜单仍然可用：切模型、切模式、打开设置、退出。右键菜单的选择通过 host 的 `onModelSelect` / `onModeSelect` 钩子回写，所以和设置栏写的是同一份文档，不会出现两边打架。

## 排障

| 现象 | 原因 |
| --- | --- |
| 设置栏整块不显示 | 客户端 bundle 没加载成功。检查 `lib/client/index.js` 是 classic script（不能有 `import`/`export`），并且 profile 里装了 `@deepseek-ai/dsh-client-ui-settings` |
| `client-modules: require("<包名>") missed the module table` | 客户端产物里出现了浏览器模块表答不了的 `require`。只允许 `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` 与 `@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives` 这几个 seed；`schemastery` 等宿主包一旦被拖进客户端就会触发。构建期会直接拒绝，见下方「客户端 bundle 的两条硬约束」 |
| 改了设置栏，窗口没变 | 确认「启用桌宠」是开的。被禁用时宿主进程不会启动，设置栏照常可编辑但改动落不到窗口上 |
| **点了开关/按钮像是没反应** | 设置栏**顶部会出现红字**说明写入被拒的原因。最常见的是陈旧写锁，见下一节 |
| `cannot get property "remote.settings" without inject` | 客户端入口的 `inject` 少了 `remote.settings`。命名空间 Remote 必须**单独声明**，只写 `remote` 不够——读未声明的服务会直接抛错，导致设置栏所有控件点击即失败。见 `tests/client-inject.test.ts` |
| `client api: settings/mutate expected 3 argument(s), got 2` | 调用 `remote.settings.mutate` 时少了第 3 个参数。harness 为该端点声明了 `(ns, ops, expectedRevision)` 三个参数，**客户端代理在任何网络调用之前就按个数校验**，少传直接抛错。想无条件写入要显式传 `undefined`（见下） |
| `args fields do not match the descriptor: missing "apiKey"` | 本插件的 Remote manifest 把可选参数声明成了必填。网关只对 `acceptsUndefined` 的参数允许字段缺失（见下） |
| 保存后重启又变回旧值 | 升级后启动会自动修复被扁平化的旧键；若仍复现，看顶部红字 |
| API Key 保存后又变空 | 正常。secret 字段不回显；留空提交 = 保持原值 |
| 截图驱动模式不发言 | 看「测试连接」的结果；再看截图感知是否关闭、间隔是否还没到 |
| 窗口比设置的值大/小 | 值被夹到了 180–800 / 240–1000 的范围边界 |

### 写入被拒：陈旧写锁

DSH 每次写 `settings.yaml` 都会拿一个 `<settings.yaml>.lock` 写锁，并在 `finally` 里删除。它**不会回收孤儿锁**（上游实现明确写着 orphan recovery 属于人工操作），所以只要有一个 DSH 进程在持锁期间被强杀（`taskkill /F`、崩溃、或删除被安全软件/沙箱拦截），锁文件就会永久留下，之后**所有设置写入都在 2 秒等待后失败**：

```
settings/rejected: atomic-write: timed out waiting for the writer lock at ...settings.yaml.lock
```

表现就是「点了没反应、保存了又丢」。判断依据：正常持锁只有毫秒级，超过 5 秒即可视为孤儿。确认没有 DSH 进程在跑之后，删掉这个文件再启动即可：

```powershell
Remove-Item "$env:USERPROFILE\.dsh\settings.yaml.lock"
```

### 为什么必须传满三个参数

`settings/mutate` 的客户端签名是三个参数，代理的校验是「个数必须相等」：

```ts
const expected = descriptor.parameters.length
if (values.length !== expected) throw new Error(`client api: ${endpoint} expected ${contract}, got ...`)
```

即使 `expectedRevision` 语义上可以不传，也**必须显式传 `undefined`**。三个证据链：

1. 生成器对 JSON 参数固定用 `topLevelAbsence: 'undefined'`（`packages/typert/generator/src/analyzer.ts:1056`），所以参数 `optional` 标志为 false 也不影响 codec 接受 `undefined`；
2. 生成的客户端 codec 就是 `z.union([z.undefined(), z.number()])`（`packages/api/settings-controller/lib/typert.remote-client.js`），`parse(undefined)` 通过、`parse(null)` 被拒；
3. 代理装配 args 时 `if (value !== undefined) args[wire] = value`——`undefined` 会被**省略**，于是线上请求与「不带 revision」完全等价，即无条件写入。

**为什么坚持无条件写入**：桌面宠物宿主会在每次窗口缩放/移动时回写窗口几何，命名空间 revision 持续变化；带 revision 栅栏的点击会被判为冲突并静默丢弃。路径化的 `mutate` 只改指定字段，不带栅栏也不会覆盖并发写入的其它字段。

回归测试：`tests/controller-write.test.ts` 里的假传输**按 harness 规则校验参数个数**，两参数调用会以同样的错误失败。

### Remote 参数：可选字段必须声明 `acceptsUndefined`

网关对传入的 `args` 做**精确**校验（`packages/api/gateway/src/index.ts` 的 `assertExactArguments`）：

```ts
const expected = new Set(descriptor.parameters.map(parameter => parameter.wire))
const acceptsMissing = new Set(descriptor.parameters
  .filter(parameter => parameter.source === 'json'
    && (parameter.acceptsUndefined === true || parameter.codec.mode === 'src-json'))
  .map(parameter => parameter.wire))
const missing = [...expected].filter(key => !Object.hasOwn(args, key) && !acceptsMissing.has(key))
```

也就是说：**字段可以缺省，当且仅当该参数声明了 `acceptsUndefined: true`**。缺省时会解析为 `undefined`（`resolveParameter` 里 `if (!Object.hasOwn(args, parameter.wire)) return undefined`），正好对应宿主方法的 `T | undefined`。

这条规则踩过一次：`testLlm(baseUrl, apiKey?, model?)` 的后两个参数在 manifest 里被写成必填，而设置栏在 API 密钥留空时**正当地省略它们**（留空 = 用已保存的密钥），于是「测试连接」永远报 `missing "apiKey"`，而桌宠其实回复得好好的——徽章也显示「已配置」，因为密钥确实存着。

现在参数表只声明一次（`src/shared/deskpet-invocations.ts`），宿主 manifest 与客户端挂载都从它派生，两侧无法再漂移。

### 为什么写入失败现在会显示出来

上游 `SettingsScope.mutate` 在宿主拒绝时是**静默吞掉**的：

```ts
if (!response.ok) { await this.recover(generation); return }   // 不抛错、不返回
```

因此本插件不再用它的写路径，而是直接调用同一套宿主传输（`remote.settings.mutate`），把错误码显示出来，成功后再把返回的视图折进共享 mirror 让界面刷新。同时**不再携带 revision 栅栏**——桌面宠物宿主会在每次窗口缩放/移动时回写窗口几何，使命名空间 revision 不断变化，带栅栏的点击会被判为冲突并静默丢弃，这正是「锁定尺寸 / 记住位置点了没反应」的成因之一。路径化的 `mutate` 只改指定字段，不带栅栏也不会覆盖并发写入的其它字段。

## 客户端 bundle 的两条硬约束

`lib/client/index.js` 会被 profile 与其它客户端 bundle **拼接成一个 classic `<script>`**，所以：

1. **必须是 classic script**，形状为 `window.__ModuleLoader__.load({ id, factory })`。任何 `import`/`export` 都是整个拼接脚本的语法错误（表现为「Failed to load plugins」+ 白屏）。
2. **每个 `require()` 都必须能被浏览器模块表答上**。模块表只 seed：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`（见 `packages/client/web/src/seed.ts`）。

因此**客户端代码不得引用宿主侧包**。本插件曾因为窗口边界常量放在 `src/config.ts`（顶部 `import Schema from '@deepseek-ai/schemastery'`）而把 schemastery 拖进了浏览器 bundle，报出 `missed the module table`。现在这些常量放在无依赖的 `src/shared/window-bounds.ts`，客户端经 `shared/pet-section.ts` 引它。

上游构建脚本会在打包前校验产物：命中禁止清单（`schemastery`、`dsh-settings`、`dsh-typert-protocol`、`dsh-host-directory-picker`、`electron`）或出现非 seed 的 `require` 都直接构建失败。本仓库只分发构建产物，不含该脚本；改动 bundle 时请手工守住这两条约束。

## 字段路径：为什么 `set()` 不能用点号

`SettingsScope.set(field, value)` 是**顶层标量**写入器，它把 `path: [field]` 原样转发给宿主。所以 `set('llm.apiKey', v)` 存下来的是一名叫 `llm.apiKey` 的字面量键，而不是嵌套的 `llm: { apiKey }`——schema 里没有这个字段，值永远读不回来。

本插件的所有写入都经过 `parseFieldPath()` 拆段（`src/shared/settings-path.ts`），并在启动时把历史上被扁平化的键搬回正确字段（`repairFlattenedKeys`）。相关回归测试在 `tests/settings-path.test.ts` 与 `tests/controller-write.test.ts`。

> AI生成