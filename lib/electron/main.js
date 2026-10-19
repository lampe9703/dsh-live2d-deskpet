import { app, BrowserWindow, Menu, desktopCapturer, screen, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activePersona, clampWindowHeight, clampWindowWidth } from '../shared/pet-section.js';
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
function effectiveMode() {
    return config?.mode === 'auto' ? (probe.isDshAlwaysOnTop() ? 'task' : 'companion') : (config?.mode ?? 'task');
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
                agentState = message.agentState;
            window?.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
            applyLocked(config.windowLocked === true);
            applyClickThrough(config.clickThrough === true);
            companion?.configure(config, effectiveMode);
            announcePersona(config);
            pushRenderer({ type: 'snapshot', config, models, agentState, mode: effectiveMode() });
        }
        if (message.type === 'agent-state') {
            agentState = message.state;
            pushRenderer({ type: 'agent-state', state: agentState });
        }
        // 任务节点播报：页面侧的观察器已经把它变成一句中文，这里只负责转给窗口。
        if (message.type === 'task-event')
            pushRenderer(message);
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
        say: text => pushRenderer({ type: 'say', text }),
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
