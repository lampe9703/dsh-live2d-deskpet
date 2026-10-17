/** LLM block: the companion OpenAI-compatible endpoint, with a host-side probe. */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
type Translate = (key: DeskpetLocaleKey) => string;
/** Render the companion-LLM block. */
export declare function LlmBlock(props: {
    controller: DeskpetController;
    section: Record<string, any>;
    remote: any;
    t: Translate;
}): ReactNode;
export {};
//# sourceMappingURL=LlmBlock.d.ts.map