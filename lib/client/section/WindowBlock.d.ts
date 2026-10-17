/**
 * Window block: the pet window's size, its lock, and position memory. The
 * user's complaint that the window is too large is what this block exists to
 * answer — the default is small and every edge is adjustable here.
 */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
type Translate = (key: DeskpetLocaleKey) => string;
/** Bounds mirror `src/config.ts`; keep both in step when either moves. */
export declare const WINDOW_WIDTH_MIN = 180;
export declare const WINDOW_WIDTH_MAX = 800;
export declare const WINDOW_HEIGHT_MIN = 240;
export declare const WINDOW_HEIGHT_MAX = 1000;
/** Render the window block. */
export declare function WindowBlock(props: {
    controller: DeskpetController;
    section: Record<string, any>;
    remote?: any;
    t: Translate;
}): ReactNode;
export {};
//# sourceMappingURL=WindowBlock.d.ts.map