import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { Config } from './config.js';
import { AgentStateResolver } from './core/AgentStateResolver.js';
import { DesktopPetHost } from './host/DesktopPetHost.js';
import { normalizeLlmBaseUrl } from './electron/services/OpenAiCompatibleClient.js';
import { MemoryStore } from './electron/services/MemoryStore.js';
import { normalizePersonaConfig } from './shared/pet-section.js';
import { planIntervalMigration, resolveIntervalSeconds } from './shared/companion-interval.js';
import { clampMemoryPromptChars, clampMemoryTurns } from './shared/companion-memory.js';
import { clampNsfwPrompt } from './shared/companion-nsfw.js';
import { deskpetRemoteParameters } from './shared/deskpet-invocations.js';
import { flattenedKeyRepairValue, isFlattenedPathKey, parseFieldPath } from './shared/settings-path.js';
import { extractUserPromptText } from './shared/user-prompt.js';
export const name = 'live2d-deskpet';
/** 排障日志：只有 DESKPET_DEBUG=1 时才落盘，默认不往用户目录写任何东西。 */
const DEBUG_LOG = process.env.DESKPET_DEBUG === '1';
const BOOT_LOG = join(homedir(), '.dsh', 'live2d-deskpet', 'bootstrap.log');
/** 匹配 JSON 里的 secret 字段值，用于写入前脱敏。 */
const SECRET_FIELD = /("(?:apiKey|translateApiKey)"\s*:\s*)"[^"]*"/gu;
/**
 * 匹配 JSON 里 nsfw 段的正文值（nsfw 段是扁平对象，段内无嵌套大括号）。
 * 键顺序无关：`"nsfw":{"prompt":…}` 与 `"nsfw":{"enabled":true,"prompt":…}`
 * 都能命中；段外其它同名键不受影响。
 */
const NSFW_PROMPT_FIELD = /("nsfw"\s*:\s*\{[^{}]*?"prompt"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/gu;
/**
 * 把 JSON 文本里的密钥值与 nsfw 正文替换成 `***`。
 *
 * `commit()` 会把整份 patch 记进排障日志（patch 里可能带 `llm.apiKey` /
 * `voice.translateApiKey` / `nsfw.prompt`），启动探针还会记整份初始状态。
 * 密钥与 nsfw 正文明文落到磁盘是不可接受的，所以写之前统一过一遍——
 * 0.1.8 起 nsfw 的自定义正文与 secret 同级别对待。
 */
export function redactSecrets(text) {
    return String(text)
        .replace(SECRET_FIELD, '$1"***"')
        .replace(NSFW_PROMPT_FIELD, '$1"***"');
}
function probeLog(message) {
    if (!DEBUG_LOG)
        return;
    try {
        void mkdir(join(homedir(), '.dsh', 'live2d-deskpet'), { recursive: true }).catch(() => { });
        void appendFile(BOOT_LOG, '[' + new Date().toISOString() + '] ' + redactSecrets(message) + '\n').catch(() => { });
    }
    catch { /* 探针自身绝不抛 */ }
}
function safeKeys(obj) {
    try { return Object.keys(obj ?? {}).slice(0, 40).join(','); }
    catch { return '<uninspectable>'; }
}
/**
 * 0.2：宿主 inject 只声明 cosplay 实证过的最小集（settings/typert）。
 * directoryPicker 由 web-app bundle 的 directory-picker-auto **动态**挂载，
 * 时序上完全可能晚于本 entry 的激活窗口——声明式等待它会永久 pending，
 * 所以降级为运行时软探测（capability() 缺席时 importModel 报"环境不支持"）。
 */
export const inject = ['settings', 'typert'];
export { Config };
/** Loader entry id this plugin's insert line creates in the profile (settings.update target). */
export const DESKPET_ENTRY_ID = 'live2d-deskpet';
/** Package name — the descriptor id prefix both faces must agree on. */
const DESKPET_PACKAGE = 'dsh-live2d-deskpet';
/** Remote namespace the settings page's action channel mounts as. */
export const DESKPET_REMOTE_NAMESPACE = 'live2dDeskpet';
/**
 * 读取 Config 字段：0.2.x 运行时把 volatile 字段包成带 `.get()` 的引用，桩测试或
 * 普通对象下退化为普通值。引用可能逐层包裹，循环解包直到拿到普通值。
 */
function readField(holder) {
    let current = holder;
    for (let depth = 0; depth < 8; depth++) {
        if (current === undefined || current === null)
            return current;
        if (typeof current.get !== 'function')
            return current;
        current = current.get();
    }
    return current;
}
/** Merge one patch into the entry config on the profile's Cordis patch layer. */
async function writeConfig(ctx, patch) {
    if (typeof ctx.settings?.update === 'function') {
        await ctx.settings.update(DESKPET_ENTRY_ID, patch);
        return;
    }
    throw new Error('live2d-deskpet: ctx.settings.update 不可用，无法持久化配置（0.2 宿主形态）。');
}
/**
 * DSH 0.2 entry.
 *
 * 0.2 已移除客户端/宿主的 `settingsScope` 与命名空间注册（settings.register），
 * 插件设置改由本行 Config 承载：每个 volatile 字段是 loader 维护的运行时引用，
 * 写入走 `ctx.settings.update(ENTRY_ID, patch)`（落到 profile 的 cordis patch 层），
 * volatile-only 变更不重启插件——热更在这里通过"写后即 syncHost"驱动。
 */
/** 探测某服务方法是否存在——cordis proxy 对未 inject 的服务读取会抛错，必须隔离。 */
function safeServiceCall(ctx, prop, method) {
    try {
        return typeof ctx?.[prop]?.[method];
    }
    catch {
        return 'guarded';
    }
}
export function apply(ctx, config) {
    probeLog('apply enter; ctx keys=[' + safeKeys(ctx) + ']; services=' + JSON.stringify({
        loggerName: typeof ctx?.logger,
        settingsUpdate: safeServiceCall(ctx, 'settings', 'update'),
        settingsConfigure: safeServiceCall(ctx, 'settings', 'configure'),
        typertRegister: safeServiceCall(ctx, 'typert', 'register'),
        directoryPicker: safeServiceCall(ctx, 'directoryPicker', 'capability'),
        fiber: typeof ctx?.fiber,
        effect: typeof ctx?.effect,
        inject: typeof ctx?.inject,
        on: typeof ctx?.on,
        reflect: typeof ctx?.reflect,
    }));
    const log = ctx.logger?.(name) ?? console;
    // ── 0.1.7：旧分钟间隔键 → 新秒键的一次性迁移标记 ──
    // 旧键已不在 schema 里，settings 服务无法 unset 它（非 volatile 路径会被拒），
    // 它会永远留在 patch 文档里并透传进 config；标记文件保证换算只发生一次。
    const intervalMarkerPath = join(homedir(), '.dsh', 'live2d-deskpet', 'interval-migrated.json');
    const intervalMarkerPresent = readIntervalMarkerSync(intervalMarkerPath);
    const intervalMigration = planIntervalMigration(readField(config?.companionIntervalSeconds), readField(config?.companionIntervalMinutes), intervalMarkerPresent);
    // ── 状态源：行内 Config（volatile 引用逐字段解包） ──
    const readState = () => normalizeState({
        enabled: readField(config?.enabled),
        mode: readField(config?.mode),
        alwaysOnTop: readField(config?.alwaysOnTop),
        modelId: readField(config?.modelId),
        // 秒键优先；只有存在旧分钟键且秒键未被显式设置时才按旧键换算（详见
        // shared/companion-interval.js 的注释）。换算结果会由下方迁移逻辑写回。
        companionIntervalSeconds: resolveIntervalSeconds(readField(config?.companionIntervalSeconds), readField(config?.companionIntervalMinutes), intervalMarkerPresent),
        screenshotsEnabled: readField(config?.screenshotsEnabled),
        // 0.2.1：对系统截图可见（默认不可见）。漏投影这一处，键就会被白名单丢掉，
        // 表现是"开关点了没反应"。
        visibleToCapture: readField(config?.visibleToCapture),
        // 0.2.0：情绪动作引擎（缺省开，显式 false 才关）。
        emotionEngine: readField(config?.emotionEngine),
        cubismCorePath: readField(config?.cubismCorePath),
        windowWidth: readField(config?.windowWidth),
        windowHeight: readField(config?.windowHeight),
        windowLocked: readField(config?.windowLocked),
        clickThrough: readField(config?.clickThrough),
        rememberWindowPosition: readField(config?.rememberWindowPosition),
        windowPosition: readField(config?.windowPosition),
        persona: readField(config?.persona),
        llm: readField(config?.llm),
        voice: readField(config?.voice),
        taskVoice: readField(config?.taskVoice),
        memory: readField(config?.memory),
        nsfw: readField(config?.nsfw),
    });
    /** 内层字段也可能是 volatile 引用（0.2 逐字段包装）：按已知形状逐一解包。 */
    function unwrapInner(source, keys) {
        const plain = (source && typeof source === 'object') ? source : {};
        const out = {};
        for (const key of keys)
            out[key] = readField(plain[key]);
        return out;
    }
    const PERSONA_KEYS = ['activeId', 'personas'];
    const LLM_KEYS = ['baseUrl', 'apiKey', 'model', 'visionModel', 'temperature'];
    const VOICE_KEYS = ['enabled', 'lang', 'bridgePort', 'workspaceDir', 'pythonPath', 'modelsDir', 'tempDir', 'gptModel',
        'sovitsModel', 'spkAudio', 'promptAudio', 'promptText', 'translateUrl', 'translateApiKey', 'translateModel'];
    const TASK_VOICE_KEYS = ['enabled', 'onStart', 'onConfirm', 'onDone', 'port'];
    const MEMORY_KEYS = ['enabled', 'shortTermTurns', 'maxPromptChars'];
    const NSFW_KEYS = ['enabled', 'prompt'];
    function normalizeState(raw) {
        // personas 数组元素的字段同样解一层引用。
        const persona = unwrapInner(raw.persona, PERSONA_KEYS);
        if (Array.isArray(persona.personas)) {
            persona.personas = persona.personas.map((entry) => {
                const card = unwrapInner(entry, ['id', 'name', 'emoji', 'systemPrompt', 'greeting', 'description', 'tags']);
                return card;
            });
        }
        const memory = unwrapInner(raw.memory, MEMORY_KEYS);
        const nsfw = unwrapInner(raw.nsfw, NSFW_KEYS);
        return {
            enabled: raw.enabled !== false,
            mode: raw.mode ?? 'auto',
            alwaysOnTop: raw.alwaysOnTop !== false,
            modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
            // 0.1.7：秒级间隔（readState 里已把旧分钟键换算进来），这里只负责夹取。
            companionIntervalSeconds: Number.isFinite(Number(raw.companionIntervalSeconds))
                ? Math.min(10800, Math.max(10, Math.round(Number(raw.companionIntervalSeconds))))
                : 600,
            screenshotsEnabled: raw.screenshotsEnabled !== false,
            // 0.2.1：只有显式 true 才"对截图可见"，缺省一律不可见。
            visibleToCapture: raw.visibleToCapture === true,
            emotionEngine: raw.emotionEngine !== false,
            cubismCorePath: typeof raw.cubismCorePath === 'string' ? raw.cubismCorePath : '',
            windowWidth: Number.isFinite(raw.windowWidth) ? raw.windowWidth : undefined,
            windowHeight: Number.isFinite(raw.windowHeight) ? raw.windowHeight : undefined,
            windowLocked: raw.windowLocked === true,
            clickThrough: raw.clickThrough !== false,
            rememberWindowPosition: raw.rememberWindowPosition === true,
            windowPosition: raw.windowPosition ?? null,
            persona: normalizePersonaConfig(persona),
            llm: unwrapInner(raw.llm, LLM_KEYS),
            voice: unwrapInner(raw.voice, VOICE_KEYS),
            taskVoice: unwrapInner(raw.taskVoice, TASK_VOICE_KEYS),
            // 陪伴记忆：开关默认关（不配置时行为与 0.1.6 一致），预算由纯函数夹取。
            memory: {
                enabled: memory.enabled === true,
                shortTermTurns: clampMemoryTurns(memory.shortTermTurns),
                maxPromptChars: clampMemoryPromptChars(memory.maxPromptChars),
            },
            // 成人向陪伴（0.1.8）：默认关（不配置时请求形状与 0.1.7 一致），
            // 自定义正文一律经 clampNsfwPrompt（trim + 截 8000）。
            nsfw: {
                enabled: nsfw.enabled === true,
                prompt: clampNsfwPrompt(nsfw.prompt),
            },
        };
    }
    let host;
    let tail = Promise.resolve();
    /** Serialize host lifecycle work behind the serialized write path. */
    const enqueue = (work) => {
        tail = tail.then(work).catch(error => {
            probeLog('enqueue work FAILED: ' + String(error?.stack ?? error?.message ?? error));
            log.error(`live2d-deskpet: ${error.message}`);
        });
    };
    /**
     * 0.2 的 `settings.update(ENTRY_ID, patch)` 对顶层键是整体替换：只写
     * `{ voice: { lang } }` 会把 voice 里其它键（enabled/pythonPath…）一并抹掉。
     * 写入前把对象型键与当前状态深合并，部分写入不再丢兄弟键。
     */
    function mergePatch(patch) {
        const current = readState();
        const merged = { ...patch };
        // 0.1.8：nsfw 加入深合并列表——设置页写 `{ nsfw: { enabled } }` 时不能
        // 把已保存的 prompt 一并抹掉（同理反向）。
        for (const key of ['persona', 'llm', 'voice', 'taskVoice', 'memory', 'nsfw']) {
            const incoming = patch[key];
            if (incoming === undefined || typeof incoming !== 'object' || incoming === null || Array.isArray(incoming))
                continue;
            const base = current[key] ?? {};
            const next = { ...base, ...incoming };
            // 只保留有值的字段：readState 会把缺失键解成 undefined，写回时不能带进去。
            for (const field of Object.keys(next)) {
                if (next[field] === undefined)
                    delete next[field];
            }
            merged[key] = next;
        }
        return merged;
    }
    /** 持久化 patch，并把新状态热更进宿主（volatile 写不触发重载，只能自己驱动）。 */
    async function commit(patch) {
        const merged = mergePatch(patch);
        probeLog('commit patch=' + JSON.stringify(merged).slice(0, 200));
        await writeConfig(ctx, merged);
        probeLog('writeConfig OK');
        const section = readState();
        enqueue(() => syncHost(section));
        return section;
    }
    const hooks = {
        onWindowResize: (size) => {
            void commit({ windowWidth: size.width, windowHeight: size.height }).catch(error => probeLog('onWindowResize commit FAILED: ' + String(error?.message ?? error)));
        },
        onWindowMove: (position) => {
            // Only a window whose memory is switched on mirrors its moves back; the
            // stored value survives while memory is off so it can be restored later.
            if (readState().rememberWindowPosition !== true)
                return;
            void commit({ windowPosition: position });
        },
        onModelSelect: (modelId) => {
            void commit({ modelId });
        },
        onModeSelect: (mode) => {
            void commit({ mode });
        },
    };
    // ── Agent 驱动的"回合结束"信号（不依赖页面 DOM） ──────────────────────────
    //
    // Agent 模式原来只有一条信号源：页面里的 DOM 观察器 POST `done`。那条链路
    // 断在任何一环（页面没开、页脚还没填文本、锚点变化）都会让桌宠整局不吭声，
    // 而且完全静默——用户看到的就是"Agent 模式下没有声音也没有对话泡"。
    //
    // 这里补一条确定性信号：状态机从"忙"（working/think）落回"空闲"并稳定
    // SETTLE_MS 之后，视为这一回合结束。宿主那层本来就有 20s 冷却，两条信号
    // 同时到达也只会播一次。
    const BUSY_STATES = new Set(['working', 'think']);
    /** 落回空闲后要稳定这么久才认"结束"（避免流式输出中间的抖动误报）。 */
    const SETTLE_MS = 1_500;
    /** 忙了不到这么久就结束的，多半是没干什么事的空回合，不值得播报。 */
    const MIN_BUSY_MS = 2_000;
    let busySince = 0;
    let settleTimer;
    /** 最近一次收到任意 harness 事件的时间：异常回落的判据（0.1.6 问题2）。 */
    let lastHarnessEventAt = Date.now();
    const states = new AgentStateResolver();
    states.on('change', state => {
        host?.setAgentState(state);
        if (BUSY_STATES.has(state)) {
            if (busySince === 0) {
                busySince = Date.now();
                // 0.2.7：回合开始改由**状态翻转**派发（闲 → 忙）。
                //
                // 原来靠页面观察器盯 `[data-streaming]`，但那个属性挂在推理行
                // （ReasoningRow）的摘要上，一个回合里会反复出现，于是 start 被
                // 重复播报——实测就发生在审批弹窗弹出的瞬间（"弹选择框，她回
                // 了解，我开始动手了"）。状态机这边"进入忙"一个回合只发生一次，
                // 语义正好是"开始处理"。
                host?.handleTaskEvent?.('start', '');
            }
            if (settleTimer !== undefined) {
                clearTimeout(settleTimer);
                settleTimer = undefined;
            }
            return;
        }
        if (busySince === 0)
            return;
        const busyFor = Date.now() - busySince;
        busySince = 0;
        if (busyFor < MIN_BUSY_MS)
            return;
        if (settleTimer !== undefined)
            clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            settleTimer = undefined;
            // 空闲窗口里又忙起来了：这是新一轮，不是上一轮结束。
            if (BUSY_STATES.has(states.state))
                return;
            // detail 传空：这里没有任务信息，别把实现词（原来传的是 'agent-settled'）
            // 当成摘要喂给模型。0.2.6 的信息闸会把它挡掉，这里从源头就干净。
            host?.handleTaskEvent?.('done', '');
        }, SETTLE_MS);
        settleTimer.unref?.();
    });
    // ── 异常回落（0.1.6 问题2）──────────────────────────────────────
    //
    // AgentStateResolver 只在事件分类命中时变化；agent 进程被杀 / 会话异常中断
    // 时 harness 侧不会再发任何事件，状态机会永远停在 working/think——桌宠卡死
    // 在「工作中」，陪伴模式也会因 agentBusy 误判而一直让路。这里定时检查：
    // 忙状态持续 STALE_BUSY_MS 之久没有任何 harness 事件，就强制回落 idle。
    //
    // 回落前先把 busySince 清零、settleTimer 清掉，再让 resolver 发一次 change，
    // 绕开 busy→idle 的「回合结束」判定，避免异常中断被误播成一句「任务完成啦」。
    //
    // 阈值取 5 分钟：回合内的事件（流式分片等）频率远高于此，正常长任务不会误报；
    // 超过 5 分钟完全无事件的忙状态，视为 agent 已死。代价是超过 5 分钟且期间
    // 不产生任何 harness 事件的长工具调用会被误回落一次（下一次事件会纠正回来）。
    const STALE_BUSY_MS = 300_000;
    const WATCHDOG_TICK_MS = 30_000;
    const staleBusyWatchdog = setInterval(() => {
        if (!host || !BUSY_STATES.has(states.state))
            return;
        if (Date.now() - lastHarnessEventAt < STALE_BUSY_MS)
            return;
        busySince = 0;
        if (settleTimer !== undefined) {
            clearTimeout(settleTimer);
            settleTimer = undefined;
        }
        states.set('idle');
    }, WATCHDOG_TICK_MS);
    staleBusyWatchdog.unref?.();
    const unsubscribers = ['agent/status', 'session/event', 'session/updated'].map(event => ctx
        .on(event, (...payload) => {
            lastHarnessEventAt = Date.now();
            // 0.2.8：把"用户这一回合让他做什么"记下来，节点播报时一起给模型。
            // 这是任务节点播报唯一真正缺的那条信息——阶段有了、内容没有，模型只能
            // 用人设腔凑一句泛泛的话。只认 `user/message` 且 source.kind 不是系统注入。
            if (event === 'session/event') {
                const task = extractUserPromptText(payload[1]);
                if (task !== '')
                    host?.noteUserPrompt(task);
            }
            states.consume(payload);
        }));
    async function syncHost(section) {
        if (!section.enabled) {
            if (host) {
                const stopping = host;
                host = undefined;
                await stopping.stop();
            }
            return;
        }
        if (!host) {
            host = new DesktopPetHost(section, log, hooks);
            probeLog('host.start begin');
            await host.start();
            probeLog('host.start OK');
            return;
        }
        await host.applySettings(section);
    }
    probeLog('initial state=' + JSON.stringify(readState()).slice(0, 400));
    enqueue(() => syncHost(readState()));
    void migrateLegacyDocument(ctx, readState, commit, log);
    // 0.1.7：旧分钟间隔键的一次性迁移（写回新键 + 落标记；失败下次启动重试）。
    void migrateCompanionInterval(commit, log, intervalMarkerPath, intervalMigration);
    probeLog('apply end reached');
    ctx.effect(() => () => {
        unsubscribers.forEach(stop => stop());
        clearInterval(staleBusyWatchdog);
        if (settleTimer !== undefined) {
            clearTimeout(settleTimer);
            settleTimer = undefined;
        }
        const stopping = host;
        host = undefined;
        void stopping?.stop();
    }, 'live2d-deskpet: host teardown');
    // ── 设置表单策略：本插件自带设置页，关闭 0.2 的自动生成表单（cosplay 形态） ──
    ctx.inject(['settings'], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
    // ── Typert Remote: the settings page's action channel (dsh-cosplay's pattern) ──
    class DeskpetRuntime extends TypertRemoteService {
        constructor(ctx_) { super(ctx_, DESKPET_REMOTE_NAMESPACE); }
        async getState() {
            const current = host?.currentConfig() ?? readState();
            const models = (host?.models() ?? []).map(toModelListView);
            const runtime = host?.runtimeView() ?? {
                effectiveMode: 'task', cubismCore: false,
                modelsRoot: join(homedir(), '.dsh', 'live2d-deskpet', 'models'),
                dataDir: join(homedir(), '.dsh', 'live2d-deskpet'),
                apiKeySet: false, windowPosition: null,
            };
            // 0.1.7：记忆条目数与目录由宿主直接读文件补充（Electron 侧写的是同一份）。
            // 读失败一律 0 条：设置页显示的数字永远不能是报错理由。
            runtime.memoryDir = runtime.memoryDir ?? join(homedir(), '.dsh', 'live2d-deskpet', 'memory');
            try {
                runtime.memoryTurns = await (host
                    ? host.companionMemoryCount()
                    : new MemoryStore(runtime.memoryDir).count());
            }
            catch {
                runtime.memoryTurns = 0;
            }
            return { config: publicConfig(current), models, runtime };
        }
        /** 设置页唯一的写通道：一条 patch 合并进本行 Config 并热更宿主。 */
        async setConfig(patch) {
            if (typeof patch !== 'object' || patch === null)
                return { error: '空的配置补丁。' };
            try {
                await commit(patch);
                return {};
            }
            catch (error) {
                return { error: error.message };
            }
        }
        async importModel() {
            if (!host)
                return { cancelled: false, error: '桌宠未运行。' };
            // 0.2：directoryPicker 由动态装载的插件提供且本插件未声明 inject——
            // cordis proxy 对未声明服务的读取直接抛错，所以整段隔离探测。
            let capability;
            try {
                const picker = ctx.directoryPicker;
                if (typeof picker?.capability === 'function')
                    capability = picker.capability();
            }
            catch { /* 服务缺席：按不支持处理 */ }
            if (!capability || capability.kind !== 'native')
                return { cancelled: false, error: '当前环境不支持选择文件夹。' };
            const picked = await capability.pick(new AbortController().signal);
            if (!picked)
                return { cancelled: true };
            try {
                const model = await host.importModel(picked);
                await commit({ modelId: model.id });
                return { cancelled: false, model: toModelListView(model) };
            }
            catch (error) {
                return { cancelled: false, error: error.message };
            }
        }
        async removeModel(id) {
            if (!host)
                return { error: '桌宠未运行。' };
            try {
                await host.removeModel(id);
                // Removing the selected model falls back inside the host; keep the
                // stored config in step with what actually renders.
                await commit({ modelId: host.currentConfig().modelId });
                return {};
            }
            catch (error) {
                return { error: error.message };
            }
        }
        async testLlm(baseUrl, apiKey, model) {
            if (!baseUrl?.trim())
                return { ok: false, message: '请先填写 Base URL。', models: [] };
            const current = host?.currentConfig();
            const url = `${normalizeLlmBaseUrl(baseUrl)}/models`;
            try {
                const response = await fetch(url, {
                    headers: {
                        ...(apiKey || current?.llm.apiKey ? { authorization: `Bearer ${apiKey || current?.llm.apiKey}` } : {}),
                    },
                });
                if (!response.ok)
                    return { ok: false, message: `HTTP ${response.status} ${response.statusText || ''}`.trim(), models: [] };
                const body = JSON.parse(await response.text());
                const ids = (body.data ?? []).map(entry => String(entry.id ?? '')).filter(Boolean);
                if (model && ids.length > 0 && !ids.includes(model)) {
                    return { ok: false, message: `连接成功，但列表中没有模型「${model}」。可用模型：${ids.slice(0, 8).join('、')}`, models: ids };
                }
                return { ok: true, message: ids.length > 0 ? `连接成功，${ids.length} 个模型可用。` : '连接成功（服务端未返回模型列表）。', models: ids };
            }
            catch (error) {
                return { ok: false, message: `连接失败：${error.message}`, models: [] };
            }
        }
        async openModelsFolder() {
            const target = host?.registry.root ?? join(homedir(), '.dsh', 'live2d-deskpet', 'models');
            try {
                if (process.platform === 'win32')
                    spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref();
                else if (process.platform === 'darwin')
                    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
                else
                    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
                return {};
            }
            catch (error) {
                return { error: error.message };
            }
        }
        /**
         * 0.1.7：一键清空陪伴记忆（turns.jsonl）。
         *
         * 走 MemoryStore 的原子写（临时文件 + rename），与 Electron 侧的追加
         * 写同一份文件；桌宠未运行时也允许清（目录是固定的，不依赖宿主存活）。
         */
        async clearCompanionMemory() {
            const dir = host?.companionMemoryDir ?? join(homedir(), '.dsh', 'live2d-deskpet', 'memory');
            const store = new MemoryStore(dir, { log: message => log.info(`live2d-deskpet ${String(message)}`) });
            const ok = await store.clear();
            return ok ? {} : { error: '记忆文件无法写入（目录不可用）。' };
        }
    }
    for (const method of ['getState', 'setConfig', 'importModel', 'removeModel', 'testLlm', 'openModelsFolder', 'clearCompanionMemory']) {
        markRemoteMethod(DeskpetRuntime.prototype, method);
    }
    const runtime = new DeskpetRuntime(ctx);
    void runtime;
    ctx.effect(() => {
        try {
            probeLog('typert.register begin');
            const dispose = ctx.typert.register(DESKPET_MANIFEST);
            probeLog('typert.register OK');
            return () => { void dispose(); };
        }
        catch (error) {
            probeLog('typert.register FAILED: ' + String(error?.stack ?? error?.message ?? error));
            return () => { };
        }
    }, 'live2d-deskpet: typert manifest');
    // ── internals exposed below this line are module-private by convention ──
    function toModelListView(model) {
        return { id: model.id, name: model.name, modelPath: model.modelPath, root: model.root, thumbnail: model.thumbnail };
    }
    /** Strip the API key before any config crosses the Remote wire. */
    function publicConfig(config_) {
        if (!config_)
            return {};
        const persona = normalizePersonaConfig(config_.persona);
        return {
            ...config_,
            persona,
            llm: { ...config_.llm, apiKey: undefined },
            voice: { ...config_.voice, translateApiKey: undefined },
        };
    }
}
/**
 * Apply the TC39 `@Remote` marker to a prototype method without decorator
 * syntax (same approach as dsh-cosplay: the marker only needs the initializer
 * to run against an instance-derived prototype).
 */
function markRemoteMethod(proto, methodName) {
    const probe = Object.create(proto);
    const method = proto[methodName];
    const fakeContext = {
        kind: 'method',
        name: methodName,
        static: false,
        private: false,
        access: { get: () => method, set: () => { } },
        metadata: {},
        addInitializer(fn) {
            fn.call(probe);
        },
    };
    // The context shape is structurally sufficient for Remote's addInitializer use;
    // cast past the full ClassMethodDecoratorContext surface TS requires.
    Remote(method, fakeContext);
}
/**
 * 0.2 主机侧 codec：`src-json` 不要求 create() 工厂（typert-registry 的
 * validateCodec 会拒绝 `strict codec has no create() factory`）。参数与结果都是
 * JSON 形状，src-json 的线格式足够。客户端挂载那一侧另需 strict（client bundle 里）。
 */
const srcJsonCodec = (typeSymbol) => ({ mode: 'src-json', typeSymbol });
/**
 * Build one invocation descriptor from the shared parameter table.
 *
 * `acceptsUndefined` is emitted for every parameter the host declares as
 * `T | undefined`. Without it the gateway treats the field as required and a
 * call that legitimately omits it is rejected outright —
 * `args fields do not match the descriptor: missing "apiKey"`.
 */
function invocation(method, resultSymbol = 'DeskpetRuntimeResult') {
    return {
        id: `${DESKPET_PACKAGE}#${DESKPET_REMOTE_NAMESPACE}/${method}`,
        service: DESKPET_REMOTE_NAMESPACE,
        namespace: DESKPET_REMOTE_NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters: deskpetRemoteParameters(method).map(parameter => ({
            name: parameter.name,
            wire: parameter.name,
            source: 'json',
            codec: srcJsonCodec(parameter.typeSymbol),
            ...(parameter.optional === true ? { acceptsUndefined: true } : {}),
        })),
        result: srcJsonCodec(resultSymbol),
    };
}
/** Typert manifest mirroring {@link DeskpetRuntime}'s methods for the client mount. */
const DESKPET_MANIFEST = {
    package: 'dsh-live2d-deskpet',
    face: 'host',
    schemas: [],
    model: {
        services: [
            {
                key: DESKPET_REMOTE_NAMESPACE,
                exportName: 'DeskpetRuntime',
                description: 'Live2D 桌宠设置页的动作通道：模型导入删除、LLM 测试连接、打开模型目录、读取运行态、写入配置、清空陪伴记忆。',
                tags: [],
                members: [
                    { kind: 'method', name: 'getState', signature: 'getState(): DeskpetState' },
                    { kind: 'method', name: 'setConfig', signature: 'setConfig(patch: Patch): Promise<WriteResult>' },
                    { kind: 'method', name: 'importModel', signature: 'importModel(): Promise<ImportModelResult>' },
                    { kind: 'method', name: 'removeModel', signature: 'removeModel(id: string): Promise<RemoveModelResult>' },
                    { kind: 'method', name: 'testLlm', signature: 'testLlm(baseUrl: string, apiKey?: string, model?: string): Promise<LlmProbeResult>' },
                    { kind: 'method', name: 'openModelsFolder', signature: 'openModelsFolder(): Promise<{ error?: string }>' },
                    { kind: 'method', name: 'clearCompanionMemory', signature: 'clearCompanionMemory(): Promise<{ error?: string }>' },
                ],
            },
        ],
        events: [],
        objects: [],
    },
    invocations: [
        invocation('getState'),
        invocation('setConfig', 'DeskpetWriteResult'),
        invocation('importModel'),
        invocation('removeModel'),
        invocation('testLlm'),
        invocation('openModelsFolder'),
        invocation('clearCompanionMemory'),
    ],
};
/**
 * 读取"旧分钟间隔键已迁移"标记（存在即视为迁移完成）。
 *
 * 读不动/内容损坏都按"不存在"处理：迁移本身是幂等的，重跑一遍无害，还能顺带
 * 修复损坏的标记。同步读取，apply 里在读第一次 readState 之前就要拿到结果。
 */
function readIntervalMarkerSync(path) {
    try {
        JSON.parse(readFileSync(path, 'utf8'));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 0.1.7：把旧版 `companionIntervalMinutes`（分钟）一次性迁移成
 * `companionIntervalSeconds`（秒）。
 *
 * 为什么需要标记文件而不是"改完就完"：
 *   - 旧键已不在 schema 里，settings 服务会拒绝 unset 非 volatile 路径，所以
 *     旧键删不掉，会一直留在 patch 文档里并透传进插件 config；
 *   - 新键有 schema 默认值 600，从解析后的 config 里分不清"用户显式填了 600"
 *     还是"没填"。没有标记的话，用户日后显式改回 600 秒会被旧键再次覆盖。
 *
 * 失败语义：settings 写回失败时不落标记，下次启动重试；标记写失败也不影响
 * 正确性（重跑迁移是幂等的——显式秒值已存在时只补标记、不改值）。
 *
 * @param commit - 写回并热更（与设置页同一通道）。
 * @param log - 宿主 logger。
 * @param markerPath - 标记文件路径。
 * @param plan - {@link planIntervalMigration} 的规划结果；null 表示无事可做。
 */
async function migrateCompanionInterval(commit, log, markerPath, plan) {
    if (!plan)
        return;
    try {
        if (plan.patch) {
            await commit(plan.patch);
            log.info(`live2d-deskpet: 截屏间隔已从旧分钟配置迁移为 ${String(plan.patch.companionIntervalSeconds)} 秒（companionIntervalMinutes → companionIntervalSeconds）。`);
        }
        else {
            log.info(`live2d-deskpet: 检测到旧分钟配置残留但秒级间隔已显式设置为 ${String(plan.seconds)} 秒，旧键已不再参与计算。`);
        }
    }
    catch (error) {
        // 写不进去就保持现状，下次启动再试；绝不因为迁移失败阻断插件。
        log.warn(`live2d-deskpet: 截屏间隔迁移失败（下次启动重试）：${String(error?.message ?? error)}`);
        return;
    }
    try {
        await mkdir(dirname(markerPath), { recursive: true });
        await writeFile(markerPath, JSON.stringify({
            from: 'companionIntervalMinutes',
            to: 'companionIntervalSeconds',
            at: new Date().toISOString(),
            seconds: plan.seconds,
        }, null, 2), 'utf8');
    }
    catch { /* 标记写失败不影响结果：迁移幂等，下次启动重试 */ }
}
/**
 * 0.2 适配期兜底：把旧版 `~/.dsh/live2d-deskpet/settings.json` 里**本行还没配**的
 * 字段一次性补进 Config。
 *
 * ⚠️ 这段逻辑曾经是本插件"LLM 端点与密钥保存一会儿就失效"的根因：
 *
 *   - 它每次 `apply` 都跑（启动、热重载、插件更新都会重新 apply）；
 *   - 它把旧文档的 `llm` **整块盖**到当前配置上（`{ ...current.llm, ...legacyLlm }`），
 *     而旧文档里的 `apiKey` 是空串、`baseUrl` 是出厂默认 `127.0.0.1:1234`；
 *   - 于是用户在设置页填好的 SiliconFlow 端点与密钥，在下一次 apply 的瞬间被写回
 *     默认值——表现就是"保存成功，过一会儿又没了"。
 *
 * 现在的规则只有两条：
 *   1. **只补空，不覆盖**：任何当前已有值的字段一律不动（密钥尤其）；
 *   2. **只跑一次**：合并完成后把旧文档改名成 `settings.json.migrated`，之后永远
 *      不会再参与合并（改名失败也无所谓——规则 1 已经让重复执行变成空操作）。
 *
 * @param ctx - 插件上下文（保留位，兼容旧调用形状）。
 * @param readState - 读取当前生效配置。
 * @param commit - 写回并热更。
 * @param log - 宿主 logger。
 */
export async function migrateLegacyDocument(ctx, readState, commit, log) {
    const legacyPath = join(homedir(), '.dsh', 'live2d-deskpet', 'settings.json');
    const migratedPath = `${legacyPath}.migrated`;
    let legacy;
    try {
        legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
    }
    catch {
        // 没有旧文档（或读不动）：schema 默认值就是最终状态。
        return;
    }
    if (typeof legacy !== 'object' || legacy === null)
        return;
    /** 当前值为空（未设置）时才算"可以补"。 */
    const empty = value => value === undefined || value === null || value === '';
    const current = readState();
    const patch = {};
    for (const key of ['modelId', 'windowWidth', 'windowHeight', 'cubismCorePath']) {
        const value = legacy[key];
        if (!empty(value) && empty(current[key]))
            patch[key] = value;
    }
    // llm 只补 baseUrl（且只在当前还是空的时候）。apiKey / model / visionModel /
    // temperature 一律不从旧文档继承：旧文档里这些字段要么是空串，要么早已过期，
    // 拿它们盖掉用户在设置页刚保存的值正是这个 bug 的来源。
    const legacyLlm = typeof legacy.llm === 'object' && legacy.llm !== null ? legacy.llm : {};
    if (!empty(legacyLlm.baseUrl) && empty(current.llm?.baseUrl))
        patch.llm = { baseUrl: legacyLlm.baseUrl };
    if (Object.keys(patch).length > 0) {
        try {
            await commit(patch);
            log.info('live2d-deskpet: 已把旧版 settings.json 里尚未配置的字段补进本行 Config（不覆盖已有值）。');
        }
        catch (error) {
            // 写不进去就保持现状，下次启动再试；绝不因为迁移失败阻断插件。
            log.warn(`live2d-deskpet: 旧版 settings.json 合并失败：${error.message}`);
            return;
        }
    }
    try {
        await rename(legacyPath, migratedPath);
    }
    catch { /* 改名失败不影响结果：规则 1 让重复执行成为空操作 */ }
}
// 0.2 通用：读取扁平化设置键的辅助已随 namespace 通道移除，导出保留位以兼容旧引用。
export { isFlattenedPathKey, parseFieldPath, flattenedKeyRepairValue };
