/**
 * Window geometry bounds, deliberately free of any dependency.
 *
 * These live outside `config.ts` because the browser client reaches them
 * through `shared/pet-section.ts` (it clamps every window size the settings
 * panel renders). `config.ts` imports `@deepseek-ai/schemastery`, a host-side
 * schema package that is NOT in the browser module table — routing the bounds
 * through it dragged `require("@deepseek-ai/schemastery")` into the client
 * bundle, and the boot loader refused the entry with
 * `client-modules: require("@deepseek-ai/schemastery") missed the module table`.
 *
 * Keep this module import-free: anything added here rides into the browser.
 */
/** Window edges the settings section may drive; the Electron window clamps to the same range. */
export declare const WINDOW_WIDTH_MIN = 180;
export declare const WINDOW_WIDTH_MAX = 800;
export declare const WINDOW_HEIGHT_MIN = 240;
export declare const WINDOW_HEIGHT_MAX = 1000;
/** Default geometry: small enough to stay out of the way (user-requested), above the minimum edges. */
export declare const DEFAULT_WINDOW_WIDTH = 260;
export declare const DEFAULT_WINDOW_HEIGHT = 360;
//# sourceMappingURL=window-bounds.d.ts.map