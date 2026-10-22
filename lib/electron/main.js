import { app, BrowserWindow, Menu, desktopCapturer, screen, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activePersona, clampWindowHeight, clampWindowWidth } from '../shared/pet-section.js';
import { AGENT_ACTIVE_TAIL_MS, BUSY_AGENT_STATES, isAgentActive as computeAgentActive, resolveMode } from '../shared/agent-mode.js';
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from '../config.js';
import { CompanionService } from './services/CompanionService.js';
import { DshModeProbe } from './services/DshModeProbe.js';
import { ForegroundApp } from './services/ForegroundApp.js';
import { MemoryStore } from './services/MemoryStore.js';
const bridgeUrl = process.argv.find(arg => arg.startsWith('--bridge='))?.slice('--bridge='.length);
const petUrl = process.argv.find(arg => arg.startsWith('--pet-url='))?.slice('--pet-url='.length);
if (!bridgeUrl || !petUrl)
    throw new Error('Missing --bridge or --pet-url argument');
/** Current window geometry: the launched size, then whatever the user drags inside the window. */
const windowSize = readWindowSize(process.argv.find(arg => arg.startsWith('--window-size='))?.slice('--window-size='.length));
/** Whether the window starts locked (drag-resize disabled). */
const windowLocked = process.argv.find(arg => arg.startsWith('--window-locked='))?.slice('--window-locked='.length) === '1';
/**
 * Whether the window starts click-through.
 *
 * Defaults to ON so the window never swallows input before the first snapshot
 * arrives — an always-on-top overlay that eats clicks for a moment is worse than
 * one that momentarily lets them past.
 */
const clickThroughAtLaunch = process.argv.find(arg => arg.startsWith('--click-through='))?.slice('--click-through='.length) !== '0';
/** Remembered window position, when the host had one stored. */
const windowPosition = readWindowPosition(process.argv.find(arg => arg.startsWith('--window-position='))?.slice('--window-position='.length));
/**
 * Parse the `WIDTHxHEIGHT` argument the host passes at launch, then clamp it to
 * the published window range: the host clamps too, but the window is also
 * launched by `npm run smoke` without a host, and an out-of-range size there
 * would be indistinguishable from a settings bug.
 * @param value - the raw argument value, or undefined when absent.
 * @returns the parsed size, falling back to the shipped default.
 */
function readWindowSize(value) {
    const match = /^(\d{2,4})x(\d{2,4})$/u.exec(value ?? '');
    if (!match)
        return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
    return { width: clampWindowWidth(Number(match[1])), height: clampWindowHeight(Number(match[2])) };
}
/**
 * Parse the `X,Y` position argument the host passes at launch.
 * @param value - the raw argument value, or undefined when absent.
 * @returns the parsed position, or undefined when the host had none stored.
 */
function readWindowPosition(value) {
    const match = /^(-?\d+),(-?\d+)$/u.exec(value ?? '');
    if (!match)
        return undefined;
    return { x: Number(match[1]), y: Number(match[2]) };
}
let window;
let config;
let models = [];
let agentState = 'idle';
/**
 * 最近一次「agent 真的在干活」的时刻（0.2.2）。
 *
 * 只记时刻、不记布尔值：agent 干活是一阵一阵的（工具调用之间、模型出字之间
 * 都有几秒空档），只看瞬时状态的话，截图会从这些缝里钻进来。配合
 * `AGENT_ACTIVE_TAIL_MS` 形成一个尾巴，见 `isAgentActive()`。
 */
let lastAgentActiveAt = 0;
/**
 * 页面自报的焦点状态（0.2.3）：true / false / null（还没收到过）。
 *
 * 页面里的客户端用 `document.hasFocus()` 判断"用户此刻是不是就在 DSH 页面前面"，
 * 通过 loopback POST 上来。这比在 Electron 侧问 Windows "哪个窗口被钉在顶层"
 * 准确得多——后者既不是"是否在前台"，在原生模块没编译的机器上还会永远返回
 * false（本机就是这种情况：node-window-manager 的 addon.node 根本没构建）。
 */
let pageFocused = null;
let locked = windowLocked;
/** Whether clicks outside the model pass through to the window underneath. */
let clickThrough = clickThroughAtLaunch;
/** The renderer's verdict for the current cursor position, reported over IPC. */
let pointerInteractive = false;
let activePersonaId;
let bridge;
let companion;
const probe = new DshModeProbe();
/** 前台窗口读取（陪伴提示词用）。 */
const foregroundApp = new ForegroundApp();
function send(message) { bridge?.readyState === WebSocket.OPEN && bridge.send(JSON.stringify(message)); }
/**
 * 记下 agent 状态，并顺手维护「活跃时刻」。
 *
 * 两个入口都要走这里：快照（重连/冷启动补发）与 agent-state 增量。漏一个，
 * 重连之后尾巴就会断，表现为「刚重连就冒出一张截图」。
 */
function noteAgentState(state) {
    agentState = state;
    if (BUSY_AGENT_STATES.has(state))
        lastAgentActiveAt = Date.now();
}
/**
 * 「现在算不算在用 agent」——活跃中，或者刚活跃过（尾巴内）。
 *
 * 这是 0.2.2 的核心判据：它替代了「DSH 窗口是否置顶」成为自动判断的首选依据。
 * 原因是置顶探测答的是「你在不在 DSH 里」，而用户要的是「agent 在不在跑」——
 * 起个长任务切去浏览器等结果是最常见的用法，那时窗口早就不置顶了。
 * 判定逻辑本身在 `shared/agent-mode.js`（纯函数，有单测）。
 */
function isAgentActive() {
    return computeAgentActive(agentState, lastAgentActiveAt, Date.now(), AGENT_ACTIVE_TAIL_MS);
}
function effectiveMode() {
    // 自动判断：agent 在跑（或刚跑过）→ Agent驱动；页面说自己有焦点 → 也是
    // Agent驱动（你就在 DSH 前面，不该截屏打扰）；页面说自己没焦点 → 截图驱动；
    // 从没收到过页面报告才退回窗口探测。
    return resolveMode(config?.mode ?? 'task', isAgentActive(), pageFocused, probe.isDshOnTop());
}
function pushRenderer(message) { window?.webContents.send('pet:event', message); }
/** Report the currently resolved mode upstream so the settings page can show it. */
function reportEffectiveMode() { send({ type: 'effective-mode', mode: effectiveMode() }); }
function makeWindow() {
    const display = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
        width: windowSize.width, height: windowSize.height,
        x: windowPosition?.x ?? display.x + display.width - windowSize.width - 40,
        y: windowPosition?.y ?? display.y + display.height - windowSize.height - 40,
        transparent: true, frame: false, resizable: !locked, hasShadow: false, alwaysOnTop: true,
        // The renderer is a bundled IIFE served by the pet host over loopback; the preload bridge is
        // the only capability it gets, so the window keeps Chromium's sandbox enabled.
        webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(config?.alwaysOnTop ?? true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Renderer diagnostics reach the DSH log because the pet window has no visible console.
    const contents = win.webContents;
    contents.on('console-message', (details) => {
        send({ type: 'renderer-error', error: `console[${String(details?.level)}] ${details?.message ?? ''} @${details?.sourceId ?? ''}:${details?.lineNumber ?? 0}` });
    });
    contents.on('did-fail-load', (error) => {
        send({ type: 'renderer-error', error: `did-fail-load ${error?.errorCode ?? 0} ${error?.errorDescription ?? ''} ${error?.validatedURL ?? ''}` });
    });
    void win.loadURL(new URL('index.html', petUrl).href);
    win.webContents.on('context-menu', () => showContextMenu(win));
    // A dragged resize is reported once it settles: every intermediate frame would otherwise
    // write the settings document dozens of times per gesture. A locked window
    // cannot be resized, so it reports nothing.
    let resizeTimer;
    win.on('resize', () => {
        if (locked)
            return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const [width, height] = win.getSize();
            send({ type: 'resize-window', width, height });
        }, 400);
    });
    // The settled position rides upstream on every move; the host decides
    // whether the settings document should remember it.
    let moveTimer;
    win.on('moved', () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
            const [x, y] = win.getPosition();
            send({ type: 'window-position', x, y });
        }, 800);
    });
    return win;
}
function showContextMenu(win) {
    const template = [
        { label: `模式：${effectiveMode() === 'task' ? 'Agent驱动' : '截图驱动'}`, enabled: false },
        { type: 'separator' },
        ...models.map(model => ({ label: model.name, type: 'radio', checked: model.id === config?.modelId, click: () => send({ type: 'select-model', modelId: model.id }) })),
        { type: 'separator' },
        { label: 'Agent驱动', type: 'radio', checked: config?.mode === 'task', click: () => send({ type: 'update-config', patch: { mode: 'task' } }) },
        { label: '截图驱动', type: 'radio', checked: config?.mode === 'companion', click: () => send({ type: 'update-config', patch: { mode: 'companion' } }) },
        { label: '自动判断', type: 'radio', checked: config?.mode === 'auto', click: () => send({ type: 'update-config', patch: { mode: 'auto' } }) },
        { type: 'separator' },
        { label: '打开设置', click: () => { win.show(); win.focus(); pushRenderer({ type: 'open-settings' }); } },
        { label: '退出桌宠', click: () => app.quit() },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
}
/**
 * 截一张主显示器。失败一律 throw 出具体原因，不返回 undefined。
 *
 * 旧实现 `return source?.thumbnail.isEmpty() ? undefined : source?.thumbnail.toPNG()`
 * 把三种完全不同的失败（没有屏幕源 / 缩略图为空 / 源顺序不是主屏）压成同一个
 * `undefined`，上层只能静默 return——于是"截屏没启动"根本无法定位。
 */
async function screenshot() {
    const primary = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        // 给视觉模型的图不需要原生分辨率；1280×720 已足够看清界面文字。
        thumbnailSize: { width: 1280, height: 720 },
        fetchWindowIcons: false,
    });
    if (sources.length === 0)
        throw new Error('desktopCapturer 没有返回任何屏幕源');
    // 多显示器时按 display_id 对齐主屏；对不上再退回第一个源。
    const source = sources.find(item => String(item.display_id) === String(primary.id)) ?? sources[0];
    if (!source)
        throw new Error('找不到与主显示器对应的屏幕源');
    if (source.thumbnail.isEmpty())
        throw new Error(`屏幕源「${source.name}」缩略图为空（可能被系统隐私设置或受保护内容遮挡）`);
    return source.thumbnail.toPNG();
}
/** Apply the lock to the live window: resize affordances off, renderer grip hidden. */
function applyLocked(next) {
    if (locked === next)
        return;
    locked = next;
    window?.setResizable(!locked);
}
/** Remember the click-through preference carried by the configuration. */
function applyClickThrough(next) {
    clickThrough = next;
    applyMousePassthrough();
}
/**
 * 让窗口对系统采集不可见。
 *
 * 为什么需要它：截屏取的是**整个屏幕**的缩略图（见 `screenshot()`），而桌宠窗口
 * 是 `transparent + alwaysOnTop + visibleOnFullScreen`——于是每一张截图里都有她
 * 自己，模型看到画面里一个动漫角色，自然就往那个方向说话。这不是提示词能修的
 * 问题，是采集层面的问题。
 *
 * Electron 在 Windows 上把 `setContentProtection(true)` 翻成
 * `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`：窗口对采集 API 完全
 * 不可见，截到的是它**背后**的画面，不是黑块（`WDA_MONITOR` 才是黑块，已排除）。
 * 需要 Windows 10 2004+（build 19041+）。
 *
 * 参数语义刻意反着写：配置项是「对系统截图可见」（正向描述，用户看得懂），
 * 而 API 要的是「隐藏」。**这一行是本节最容易写反的地方**：
 *   visibleToCapture=false（默认）→ 传 true  → 对采集不可见
 *   visibleToCapture=true          → 传 false → 可以被拍到
 *
 * 副作用（已写进设置页说明）：这是系统级标志，不分采集方——用户自己
 * Win+Shift+S 或录屏也拍不到她，所以要录屏展示时得先把开关打开。
 */
function applyContentProtection(hidden) {
    try {
        window?.setContentProtection(hidden === true);
    }
    catch {
        // 老系统 / 远程桌面会话上这个 API 可能抛错。它只是"更干净的画面"，
        // 失败时保持现状即可，绝不能因此把主进程带崩。
    }
}
/**
 * Route mouse input to the window underneath unless the pet itself is wanted.
 *
 * The pet is an always-on-top overlay, so by default it would swallow every
 * click that lands on its rectangle, including the fully transparent parts of
 * the model's bounding box. `setIgnoreMouseEvents(true, { forward: true })` hands
 * clicks to whatever is below while still delivering mouse MOVE events here,
 * which is what lets the renderer notice the cursor has reached the character
 * and ask for input back.
 *
 * The renderer owns the hit test because only it knows where the model's pixels
 * are; this function just combines its verdict with the user's preference.
 */
function applyMousePassthrough() {
    window?.setIgnoreMouseEvents(clickThrough && !pointerInteractive, { forward: true });
}
/** Greet once when the active persona changes, so a switch is felt immediately. */
function announcePersona(next) {
    const persona = activePersona(next.persona);
    const id = persona?.id ?? '';
    if (id === activePersonaId)
        return;
    const changed = activePersonaId !== undefined;
    activePersonaId = id;
    if (changed && persona?.greeting?.trim())
        pushRenderer({ type: 'say', text: persona.greeting.trim() });
}
function installBridge() {
    bridge = new WebSocket(bridgeUrl);
    bridge.addEventListener('message', async (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'snapshot') {
            config = message.config;
            models = message.models;
            // 0.1.6 问题2：宿主快照带最新 agent 状态，优先采信（旧版本不带该
            // 字段时保持本地缓存），让重连/冷启动后的渲染端立即恢复正确状态。
            if (typeof message.agentState === 'string')
                noteAgentState(message.agentState);
            // 0.2.3：焦点状态随快照恢复，重连后不必等下一次 focus/blur。
            if (typeof message.pageFocused === 'boolean')
                pageFocused = message.pageFocused;
            window?.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
            applyLocked(config.windowLocked === true);
            applyClickThrough(config.clickThrough === true);
            // 0.2.1：对系统采集可见性。默认（false）＝不可见，装好即解决"认不出自己"。
            applyContentProtection(config.visibleToCapture !== true);
            companion?.configure(config, effectiveMode);
            announcePersona(config);
            pushRenderer({ type: 'snapshot', config, models, agentState, mode: effectiveMode() });
        }
        if (message.type === 'agent-state') {
            // 0.2.2：这里同时维护「活跃时刻」，自动判断的模式切换靠它。
            noteAgentState(message.state);
            pushRenderer({ type: 'agent-state', state: agentState });
        }
        // 0.2.3：页面自报焦点。自动模式的第二判据，见 effectiveMode()。
        if (message.type === 'page-focus' && typeof message.focused === 'boolean')
            pageFocused = message.focused;
        // 任务节点播报：页面侧的观察器已经把它变成一句中文，这里只负责转给窗口。
        if (message.type === 'task-event')
            pushRenderer(message);
        // 0.2.1：Agent 模式的发言。宿主已经把「文字 + 情绪」算好（LLM 或固定文案），
        // 这里只把它转成渲染进程认识的 `say` 事件——于是气泡 / TTS / 情绪动作
        // 与截图驱动走的是完全同一套下游，注入层也才拿得到 emotion。
        if (message.type === 'agent-speech')
            pushRenderer({
                type: 'say',
                text: message.text,
                ...(message.emotion ? { emotion: message.emotion, intensity: message.intensity, confidence: message.confidence } : {}),
            });
        if (message.type === 'window-size'
            && typeof message.width === 'number' && typeof message.height === 'number') {
            applyLocked(message.locked === true);
            if (typeof message.clickThrough === 'boolean')
                applyClickThrough(message.clickThrough);
            // The settings slider is continuous and can reach the window before the
            // next snapshot; clamping here keeps the two faces from disagreeing.
            window?.setSize(clampWindowWidth(message.width), clampWindowHeight(message.height));
        }
        // The host asks for the live position when position memory is switched on,
        // so the first remembered value is where the window really sits.
        if (message.type === 'request-window-position') {
            const [x, y] = window?.getPosition() ?? [0, 0];
            send({ type: 'window-position', x, y });
        }
    });
    bridge.addEventListener('close', () => setTimeout(installBridge, 1500));
}
app.whenReady().then(() => {
    window = makeWindow();
    // Applied before the first snapshot so the overlay never swallows a click that
    // belonged to the window underneath.
    applyMousePassthrough();
    // 0.2.1：窗口一建好就按初始配置设一次。等第一次 snapshot 才设的话，那之前
    // 任何一张截图（以及截图驱动可能在配置到达前就排上的那一轮）里都还有她。
    // config 此时通常还是 undefined，`!== true` 得到 true＝不可见，正是默认值。
    applyContentProtection(config?.visibleToCapture !== true);
    companion = new CompanionService({
        takeScreenshot: screenshot,
        // 前台应用：native 优先、PowerShell 兜底；读不到返回 undefined，
        // 提示词里写成“未知”。
        foreground: () => foregroundApp.read(),
        // 陪伴记忆（0.1.7）：文件读写都在 MemoryStore 里，这里只递目录——
        // 与宿主（设置页清空/计数）读写同一份 turns.jsonl。
        // 目录规则与 DesktopPetHost 的 dataDir 一致：~/.dsh/live2d-deskpet/memory。
        memory: new MemoryStore(join(homedir(), '.dsh', 'live2d-deskpet', 'memory'), {
            log: message => send({ type: 'companion-log', message }),
        }),
        // 0.2.0：情绪随气泡一起下发。emotion 来自陪伴 LLM 回复开头的隐藏标记
        // （shared/emotion-tag.js 剥掉），没有就留空，渲染进程自己走关键词兜底。
        say: (text, emotion) => pushRenderer({ type: 'say', text, ...(emotion ? { emotion: emotion.emotion, intensity: emotion.intensity, confidence: emotion.confidence } : {}) }),
        // 陪伴链路的日志单独走一条消息类型：宿主那边记成 info，和渲染器报错分开，
        // 否则"陪伴：captured 214KB"会混在 console 报错里。
        log: message => send({ type: 'companion-log', message }),
        // 阶段上报：宿主写日志 + 设置页显示"最近一次截屏"。
        status: status => send({ type: 'companion-status', ...status, mode: effectiveMode() }),
        // While the main agent streams, its token throughput is the visible metric:
        // defer the companion's screenshot + local inference until it settles.
        agentBusy: () => agentState === 'working' || agentState === 'think',
    });
    installBridge();
    // `DESKPET_CAPTURE` writes the window's own pixels to a PNG, which verifies rendering on a
    // display where a transparent always-on-top window cannot be inspected by a screen capture.
    const capturePath = process.env.DESKPET_CAPTURE;
    if (capturePath) {
        setTimeout(() => {
            void window?.webContents.capturePage().then(image => writeFile(capturePath, image.toPNG()));
        }, Number(process.env.DESKPET_CAPTURE_DELAY_MS ?? 12_000)).unref();
    }
    ipcMain.on('pet:command', (_event, message) => send(message));
    // The renderer reports whether the cursor is over the model; the window then
    // either takes mouse input or forwards it to whatever sits underneath.
    ipcMain.on('pet:pointer-interactive', (_event, interactive) => {
        pointerInteractive = interactive === true;
        applyMousePassthrough();
    });
    ipcMain.on('pet:resize', (_event, width, height) => {
        // The grip is hidden while locked; a stale drag frame is still refused here.
        if (locked)
            return;
        if (typeof width === 'number' && typeof height === 'number') {
            window?.setSize(Math.round(width), Math.round(height));
        }
    });
    const modeTimer = setInterval(() => {
        pushRenderer({ type: 'mode', mode: effectiveMode() });
        reportEffectiveMode();
    }, 5_000);
    modeTimer.unref();
});
app.on('window-all-closed', () => { });
