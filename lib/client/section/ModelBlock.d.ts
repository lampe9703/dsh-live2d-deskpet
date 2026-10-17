/** Model block: pick the active model, import a folder, delete, Cubism Core status. */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
type Translate = (key: DeskpetLocaleKey) => string;
/** Render the model block. */
export declare function ModelBlock(props: {
    controller: DeskpetController;
    section: Record<string, any>;
    remote: any;
    t: Translate;
}): ReactNode;
export {};
//# sourceMappingURL=ModelBlock.d.ts.map