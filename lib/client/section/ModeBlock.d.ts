/** Mode block: auto / task / companion, plus the facts that only apply to companion. */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
type Translate = (key: DeskpetLocaleKey) => string;
/** Render the mode block. */
export declare function ModeBlock(props: {
    controller: DeskpetController;
    section: Record<string, any>;
    remote: any;
    t: Translate;
}): ReactNode;
export {};
//# sourceMappingURL=ModeBlock.d.ts.map