/**
 * 读"当前前台窗口是谁"。
 *
 * 只为一个用途：截屏注入提示词里的"当前前台应用"。两条路，先快后稳：
 *
 *   1. `node-window-manager`（optionalDependency，本机已装）——同步、~1ms，
 *      能直接给进程名与窗口标题；
 *   2. PowerShell + user32（GetForegroundWindow）——~0.5–1.5s，但零原生依赖，
 *      在 native 模块 ABI 不匹配（Electron 换版本后常见）时兜底。
 *
 * 任何失败都返回 `undefined`，由调用方写成"未知"：前台应用只是提示词的锦上添花，
 * 读不到绝不能让整次陪伴失败。
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** PowerShell 兜底的总预算；超过就放弃，不拖慢陪伴节奏。 */
const PS_TIMEOUT_MS = 2_500;

/**
 * 从窗口标题里剥掉常见后缀（" - Visual Studio Code"、" — Mozilla Firefox"），
 * 只留真正在讲"在干什么"的那段。标题本身就是应用名时原样保留。
 */
function cleanTitle(title, app) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (text === '')
        return '';
    if (app && text.toLowerCase() === app.toLowerCase())
        return app;
    return text;
}

export class ForegroundApp {
    /** 缓存原生模块：解析一次，失败也不再重试（避免每轮都抛一次异常）。 */
    #manager;
    #nativeBroken = false;
    /** PowerShell 不可用（非 Windows / 被策略禁用）后不再尝试。 */
    #shellBroken = false;

    /**
     * @returns `{ app, title }`，读不到时 `undefined`。
     */
    async read() {
        const native = this.#readNative();
        if (native !== undefined)
            return native;
        return await this.#readShell();
    }

    /** 原生模块这条路；不可用时返回 undefined 让调用方降级。 */
    #readNative() {
        if (this.#nativeBroken)
            return undefined;
        try {
            const manager = (this.#manager ??= require('node-window-manager'));
            const active = manager.windowManager.getActiveWindow();
            if (!active)
                return undefined;
            const title = typeof active.getTitle === 'function' ? active.getTitle() : '';
            // `path` 是 exe 全路径，取 basename 当应用名；没有就退回标题。
            const path = typeof active.path === 'string' ? active.path : '';
            const app = path !== ''
                ? path.split(/[\\/]/u).pop()?.replace(/\.exe$/iu, '') ?? ''
                : '';
            const cleaned = cleanTitle(title, app);
            if (app === '' && cleaned === '')
                return undefined;
            return { app: app || cleaned, title: cleaned };
        }
        catch {
            // 模块缺失 / ABI 不匹配：记住，改走 PowerShell。
            this.#nativeBroken = true;
            return undefined;
        }
    }

    /** PowerShell 兜底（仅 Windows 有意义）。 */
    async #readShell() {
        if (process.platform !== 'win32' || this.#shellBroken)
            return undefined;
        // 一段脚本同时拿标题与进程名，用制表符分隔；输出强制 UTF-8，避免中文标题
        // 走 GBK 代码页变成乱码。
        const script = [
            '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
            '$OutputEncoding=[Text.Encoding]::UTF8;',
            'Add-Type -Namespace DeskpetFg -Name Native -MemberDefinition \'',
            '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
            '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
            '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);\';',
            '$h=[DeskpetFg.Native]::GetForegroundWindow();',
            'if ($h -eq [IntPtr]::Zero) { exit 0 }',
            '$sb=New-Object System.Text.StringBuilder 512;',
            '[void][DeskpetFg.Native]::GetWindowText($h,$sb,512);',
            '$procId=0; [void][DeskpetFg.Native]::GetWindowThreadProcessId($h,[ref]$procId);',
            // 变量名不能用 $pid：PowerShell 里它是只读的自动变量（当前进程号），
            // 赋值会静默失败，于是"前台应用"永远读成 powershell.exe。
            '$p=Get-Process -Id $procId -ErrorAction SilentlyContinue;',
            '"$($p.ProcessName)`t$($sb.ToString())"',
        ].join(' ');
        const raw = await new Promise(resolve => {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
                { timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
                (error, stdout) => {
                    if (error)
                        resolve(undefined);
                    else
                        resolve(String(stdout ?? ''));
                },
            );
        });
        if (raw === undefined) {
            this.#shellBroken = true;
            return undefined;
        }
        const line = raw.split(/\r?\n/u).map(part => part.trim()).find(part => part !== '') ?? '';
        if (line === '')
            return undefined;
        const [appPart, ...titleParts] = line.split('\t');
        const app = (appPart ?? '').trim();
        const cleaned = cleanTitle(titleParts.join('\t'), app);
        if (app === '' && cleaned === '')
            return undefined;
        return { app: app || cleaned, title: cleaned };
    }
}
