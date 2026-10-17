/** The settings section root: status gate, then the five blocks. */
import { type ReactNode } from 'react';
import type { DeskpetController } from '../section-store.js';
import type { DeskpetLocaleKey } from '../locales.js';
/** Owner props the settings shell passes to a section. */
export interface DeskpetSectionProps {
    controller: DeskpetController;
    close?: () => void;
}
/** Render the Live2D deskpet settings page. */
export declare function DeskpetSection(props: DeskpetSectionProps): ReactNode;
/** Swap the active translator (called on registration and locale change). */
export declare function setTranslator(next: (key: DeskpetLocaleKey) => string): void;
//# sourceMappingURL=DeskpetSection.d.ts.map