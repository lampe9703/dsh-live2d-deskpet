/**
 * Persona block: the companion personas — list, create, edit, delete, activate,
 * plus SillyTavern v2 character-card import/export so existing cards can be
 * reused (and shared with dsh-cosplay on the same machine).
 */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
import type { Persona } from '../../shared/types.js';
type Translate = (key: DeskpetLocaleKey) => string;
/** Render the persona block. */
export declare function PersonaBlock(props: {
    controller: DeskpetController;
    section: Record<string, any>;
    cosplay?: Persona[];
    t: Translate;
}): ReactNode;
export {};
//# sourceMappingURL=PersonaBlock.d.ts.map