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
    companionIntervalMinutes: Schema.number().min(1).max(180).default(10).volatile(),
    screenshotsEnabled: Schema.boolean().default(true).volatile(),
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
});
