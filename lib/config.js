import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, WINDOW_HEIGHT_MAX, WINDOW_HEIGHT_MIN, WINDOW_WIDTH_MAX, WINDOW_WIDTH_MIN, } from './shared/window-bounds.js';
// Re-exported so host-side callers keep one import site. The bounds themselves
// live in `shared/window-bounds.js`, which is dependency-free — importing them
// from this module is what pulled `@deepseek-ai/schemastery` into the browser
// bundle, where it is not in the module table.
export { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, WINDOW_HEIGHT_MAX, WINDOW_HEIGHT_MIN, WINDOW_WIDTH_MAX, WINDOW_WIDTH_MIN, } from './shared/window-bounds.js';
const PersonaSchema = Schema.object({
    id: Schema.string().required(),
    name: Schema.string().required(),
    emoji: Schema.string().default(''),
    systemPrompt: Schema.string().default(''),
    greeting: Schema.string().default(''),
    description: Schema.string().default(''),
    tags: Schema.array(Schema.string()).default([]),
});
/**
 * 0.2.x：每个字段都标 volatile —— volatile-only 变更由 loader 原地提交进运行时
 * 引用，不会整插件重载（桌宠窗口尺寸/模型/语音这些改动都需要热更）。
 * 只有 volatile 字段会出现在 0.2 的设置表单里；本插件带自绘设置页，
 * 宿主 apply 里会关闭自动表单（configure({ auto: false })）。
 */
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).volatile().description('Enable the desktop pet.'),
    mode: Schema.union(['auto', 'task', 'companion']).default('auto').volatile(),
    alwaysOnTop: Schema.boolean().default(true).volatile(),
    modelId: Schema.string().default('').volatile(),
    // 0.1.7：陪伴截屏间隔从分钟改为秒，最小 10 秒（10–10800，默认 600 =
    // 旧默认 10 分钟）。旧 companionIntervalMinutes 由 lib/index.js 的迁移
    // 逻辑一次性换算成新键；schema 里不再声明旧字段，已存的旧键只是透传。
    companionIntervalSeconds: Schema.number().min(10).max(10800).default(600).volatile(),
    screenshotsEnabled: Schema.boolean().default(true).volatile(),
    // 0.2.1：桌宠对系统截图可见性。**默认 false＝不可见**——装好即解决"截图里
    // 有她自己、于是把画面里的角色当成说话素材"。默认值设成 true 等于装完没生效，
    // 用户还得自己去找开关，所以这里刻意反着给。
    // 语义是正向的（"可见"），主进程里要取反再传给 setContentProtection，
    // 见 lib/electron/main.js 的 applyContentProtection。
    visibleToCapture: Schema.boolean().default(false).volatile(),
    // 0.2.0：情绪动作引擎（Soullink）。开启后桌宠说话时按「当前情绪」即时生成
    // 表情与身体动作，替代原先按状态查表的固定姿态；同时陪伴 LLM 的 system 尾部
    // 会多一段「开头先吐情绪标记」的约束。关闭时行为与 0.1.9 逐字节等价——
    // 注入脚本不写任何参数，查表姿态照旧生效。
    emotionEngine: Schema.boolean().default(true).volatile(),
    cubismCorePath: Schema.string().default('').volatile().description('live2dcubismcore.min.js file, or the folder containing it.'),
    windowWidth: Schema.number().min(WINDOW_WIDTH_MIN).max(WINDOW_WIDTH_MAX).default(DEFAULT_WINDOW_WIDTH).volatile(),
    windowHeight: Schema.number().min(WINDOW_HEIGHT_MIN).max(WINDOW_HEIGHT_MAX).default(DEFAULT_WINDOW_HEIGHT).volatile(),
    windowLocked: Schema.boolean().default(false).volatile(),
    // On by default: an overlay that eats clicks meant for the app behind it is
    // the opposite of what a desktop pet should feel like.
    clickThrough: Schema.boolean().default(true).volatile(),
    // Memory of the window's place on screen is its own switch: the stored
    // position alone cannot express "remember", because a fresh toggle has no
    // position to store yet and `{ x: 0, y: 0 }` would pin the pet to the corner.
    rememberWindowPosition: Schema.boolean().default(false).volatile(),
    // schemastery has no null type, so the position passes through `any` and
    // `validWindowPosition()` shapes it at every consumer.
    windowPosition: Schema.any().volatile(),
    // 0.2 volatile 规则：volatile 对象内部的子字段不得再标 volatile
    // （"volatile fields require a fixed object path without an enclosing
    //   volatile field"）——嵌套对象只在最外层标 volatile，整体热更。
    persona: Schema.object({
        activeId: Schema.string().default(''),
        personas: Schema.array(PersonaSchema).default([]),
    }).default({ activeId: '', personas: [] }).volatile(),
    llm: Schema.object({
        baseUrl: Schema.string().default('http://127.0.0.1:1234/v1'),
        apiKey: Schema.string().role('secret').default(''),
        model: Schema.string().default(''),
        visionModel: Schema.string().default(''),
        temperature: Schema.number().min(0).max(2).default(0.8),
    }).default({}).volatile(),
    // 桌宠发声：接入工作区 GSV-TTS-Lite（七海千秋 NANAMI）作语音合成。    // 气泡文字由陪伴 LLM 用中文生成，发声语种由 lang 决定（ja 走中译日/日语音读）。
    voice: Schema.object({
        enabled: Schema.boolean().default(true).description('启用 GSV-TTS 本地语音合成。'),
        lang: Schema.union(['ja', 'zh', 'auto']).default('ja').description('发声语种：ja=日语，zh=中文，auto=自动。'),
        bridgePort: Schema.number().default(9876).description('本地合成桥端口。'),
        // 工作区根目录：pythonPath / modelsDir / 参考音频 / tempDir 留空时都从它派生。
        // 默认值在宿主侧按 homedir() 现算（仓库里不写死任何绝对路径），
        // 也可以用环境变量 GSV_WORKSPACE 覆盖。
        workspaceDir: Schema.string().default('').description('GSV-TTS 工作区根目录（留空按默认位置推导）。'),
        pythonPath: Schema.string().default('').description('GSV 运行环境 python.exe 路径。'),
        modelsDir: Schema.string().default('').description('gsv_models 目录（含 GPT 与 SoVITS 模型）。'),
        // 桥的临时文件目录。本机标准 temp 目录会让 Python 的 mkstemp 永久挂起，
        // 必须指向可写目录（默认见宿主里的 GSV_DEFAULT_TMP）。
        tempDir: Schema.string().default('').description('语音桥临时文件目录（留空用工作区默认）。'),
        gptModel: Schema.string().default('').description('GPT .ckpt 文件名（缺省用 s1v3.ckpt）。'),
        sovitsModel: Schema.string().default('').description('SoVITS .pth 文件名（缺省用 s2Gv2ProPlus.pth）。'),
        spkAudio: Schema.string().default('').description('目标说话人参考音频（如 laffey.mp3）。'),
        promptAudio: Schema.string().default('').description('提示音频（如 AnAn.ogg）。'),
        promptText: Schema.string().default('').description('提示音频对应的日文文本。'),
        translateUrl: Schema.string().default('').description('可选 OpenAI 兼容中译日端点。'),
        translateApiKey: Schema.string().role('secret').default(''),
        translateModel: Schema.string().default(''),
    }).default({}).volatile(),
    // 任务节点语音：页面内的观察器把"开始 / 需要确认 / 完成"推给宿主，宿主再让
    // 桌宠用中文气泡 + 日语语音播一句。start 默认关闭——它每回合都会触发，最容易吵。
    // port 是页面侧上报的固定端口（桌宠自己的 HTTP 服务是随机端口，页面猜不到）。
    taskVoice: Schema.object({
        enabled: Schema.boolean().default(true).description('任务节点语音播报总开关。'),
        onStart: Schema.boolean().default(false).description('任务开始时播报。'),
        onConfirm: Schema.boolean().default(true).description('需要你确认时播报。'),
        onDone: Schema.boolean().default(true).description('任务完成时播报。'),
        port: Schema.number().default(9879).description('页面侧上报任务事件的本地端口。'),
    }).default({}).volatile(),
    // 陪伴记忆（0.1.7 v1）：持久化最近 N 轮"时间 / 前台应用 / 桌宠发言"并注入
    // 请求，解决"每轮只有 system + 当前 user、没有历史"导致的重复套话。
    // 默认关闭——不配置时行为与 0.1.6 完全一致。
    // 运行时数据（turns.jsonl）在 ~/.dsh/live2d-deskpet/memory/，**不在配置里**。
    memory: Schema.object({
        enabled: Schema.boolean().default(false).description('记录最近几轮陪伴对话并注入提示词，减少重复套话。'),
        shortTermTurns: Schema.number().min(1).max(30).default(8).description('保留并注入的最近轮数。'),
        maxPromptChars: Schema.number().min(200).max(20000).default(1200).description('历史注入的字符预算。'),
    }).default({}).volatile(),
    // 成人向陪伴（0.1.8）：开关打开即注入插件内置的「锚定块」，用户无需编写任何
    // 提示词；prompt 只在需要覆盖内置正文时才填（留空 = 用内置）。整段 volatile——
    // settings 机制的三堵墙（未知键 merge 透传 / unset 非 volatile 抛错 / 默认值
    // 物化成 volatile ref）决定了新段必须整段 volatile，且不改既有字段名、不做迁移。
    // 正文是插件内常量（shared/companion-nsfw.js），不从配置/网络/角色卡读取；
    // 只作用于 config.llm 指向的独立陪伴端点，与 DSH 主 agent 无关。
    // 注意：不设 role('secret')，但任何日志都不得打印 prompt 正文。
    nsfw: Schema.object({
        enabled: Schema.boolean().default(false).description('开启后向陪伴提示词注入成人向锚定块。'),
        prompt: Schema.string().default('').description('可选的自定义覆盖正文；留空表示使用内置锚定块。'),
    }).default({}).volatile(),
});
