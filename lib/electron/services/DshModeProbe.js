import { createRequire } from 'node:module';
/**
 * Native always-on-top inspection is OS-specific. `node-window-manager` is optional
 * so the plugin continues to run on macOS/Linux without a native ABI dependency.
 *
 * The probe answers a five-second timer in `main.js`, and on Windows each
 * unguarded call paid twice: module resolution ran again on every call, and
 * `getWindows()` walks every top-level OS window (tens of native round trips).
 * The module is required once, and between real probes the cached verdict
 * is returned — a window's top-most state flips rarely and far slower than one
 * probe window, so a mode decision reaching the settings page up to one window
 * later is imperceptible.
 */
const PROBE_TTL_MS = 30_000;
/** Loaded once; a per-call `require` re-ran module resolution on the hot path. */
const require = createRequire(import.meta.url);
export class DshModeProbe {
    #last = false;
    #probedAt = 0;
    #manager;
    isDshAlwaysOnTop() {
        const now = Date.now();
        if (now - this.#probedAt < PROBE_TTL_MS)
            return this.#last;
        this.#probedAt = now;
        try {
            const manager = (this.#manager ??= require('node-window-manager'));
            const candidates = manager.windowManager.getWindows().filter(window => /deepseek harness|127\.0\.0\.1:3080|dsh/i.test(window.getTitle()));
            const matching = candidates.find(window => window.isAlwaysOnTop?.());
            this.#last = Boolean(matching);
        }
        catch {
            // Optional dependency missing or unusable on this platform: fall back to
            // the last positive observation, and re-try only after the probe window.
        }
        return this.#last;
    }
}
