import { createRequire } from 'node:module';
/**
 * 窗口侧探测：DSH 是不是"在用户眼前"。
 *
 * 这是自动模式的**最后一道兜底**——只在页面从没上报过焦点（页面没开、老客户端）
 * 时才会被问到。正常路径是页面自己用 `document.hasFocus()` 回答，见
 * `lib/client/index.js` 的 `installPageFocusReporter`。
 *
 * 0.2.3 修正了两处：
 *   1. 判据。原来只认 `isAlwaysOnTop()`，那是"窗口被钉在顶层"（WS_EX_TOPMOST），
 *      普通的前台窗口永远不满足——于是名字叫 always-on-top，语义却被当成"在前台"
 *      读，结果"我把 DSH 放前面了，她还是判成截图驱动"。
 *      现在先看**前台窗口**，再退一步看置顶窗口。
 *   2. 可用性。`node-window-manager` 是 optionalDependency，本机的原生 addon
 *      （`build/Release/addon.node`）根本没编译，`require` 直接抛错、被 catch 吞掉，
 *      于是探测永远返回 false。这条兜底在这台机器上实际是死的——这也是为什么
 *      不能把自动模式押在它身上。
 *
 * 仍然保留 30 秒 TTL：`getWindows()` 要遍历所有顶层窗口，而模式决策对 30 秒的
 * 滞后无感。
 */
const PROBE_TTL_MS = 30_000;
/** 能认成 DSH 的窗口标题。 */
const DSH_TITLE = /deepseek harness|127\.0\.0\.1:3080|dsh/i;
/** Loaded once; a per-call `require` re-ran module resolution on the hot path. */
const require = createRequire(import.meta.url);
export class DshModeProbe {
    #last = false;
    #probedAt = 0;
    #manager;
    /** DSH 窗口是否在前台（或至少被钉在顶层）。 */
    isDshOnTop() {
        const now = Date.now();
        if (now - this.#probedAt < PROBE_TTL_MS)
            return this.#last;
        this.#probedAt = now;
        try {
            const manager = (this.#manager ??= require('node-window-manager'));
            const matches = (title) => DSH_TITLE.test(typeof title === 'string' ? title : '');
            // 前台窗口优先：这才是"用户正看着 DSH"。
            const active = manager.windowManager.getActiveWindow();
            if (active && matches(active.getTitle?.()))
                this.#last = true;
            else
                this.#last = manager.windowManager.getWindows()
                    .some(window => matches(window.getTitle?.()) && window.isAlwaysOnTop?.() === true);
        }
        catch {
            // 原生模块缺失或 ABI 不匹配（本机就是）：保持上一次的结论，30 秒后重试。
            // 绝不能因为这条兜底失败就让自动模式崩掉——页面焦点才是主路径。
        }
        return this.#last;
    }
}
