/**
 * Shared visual vocabulary for the Live2D deskpet settings section. Colours
 * come from the harness CSS variables so the section follows the shell's
 * theme (the Web GUI ships a dark theme) instead of hard-coding surfaces.
 */
import type { CSSProperties } from 'react';
export declare const styles: {
    page: CSSProperties;
    card: CSSProperties;
    row: CSSProperties;
    column: CSSProperties;
    title: CSSProperties;
    hint: CSSProperties;
    label: CSSProperties;
    mono: CSSProperties;
    switchTrack: CSSProperties;
    switchBox: CSSProperties;
    switchKnob: CSSProperties;
    button: CSSProperties;
    buttonPrimary: CSSProperties;
    buttonDanger: CSSProperties;
    input: CSSProperties;
    inputSmall: CSSProperties;
    select: CSSProperties;
    textarea: CSSProperties;
    badge: CSSProperties;
    badgeMuted: CSSProperties;
    ok: CSSProperties;
    fail: CSSProperties;
    thumb: CSSProperties;
    segment: CSSProperties;
    segmentItem: CSSProperties;
    segmentItemActive: CSSProperties;
};
/**
 * Class names the stylesheet below hooks into.
 *
 * The section renders with inline styles, which cannot express `:hover`,
 * `:active` or `:disabled`. A single injected stylesheet supplies those states
 * for every control at once, so each call site keeps its inline sizing while
 * still getting press feedback — that is what makes a click feel like it landed
 * even before the write answers.
 */
export declare const SECTION_ROOT_CLASS = "deskpet-section";
export declare const SWITCH_CLASS = "deskpet-switch";
export declare const SWITCH_KNOB_CLASS = "deskpet-switch-knob";
/**
 * Interaction states for the section's controls.
 *
 * Scoped under {@link SECTION_ROOT_CLASS} so nothing here can affect the rest of
 * the settings shell.
 */
export declare const SECTION_CSS = "\n.deskpet-section button {\n  transition: transform .12s ease, opacity .15s ease, filter .15s ease, background .15s ease;\n}\n.deskpet-section button:hover:not(:disabled) { filter: brightness(1.12); }\n.deskpet-section button:active:not(:disabled) { transform: scale(.955) translateY(1px); filter: brightness(.94); }\n.deskpet-section button:disabled { opacity: .5; cursor: default; }\n.deskpet-section input, .deskpet-section textarea, .deskpet-section select {\n  transition: border-color .15s ease, box-shadow .15s ease;\n}\n.deskpet-section input:focus, .deskpet-section textarea:focus, .deskpet-section select:focus {\n  outline: none;\n  border-color: var(--dsw-specific-accent, #4d6bfe);\n  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-specific-accent, #4d6bfe) 28%, transparent);\n}\n.deskpet-section .deskpet-switch { transition: filter .15s ease; }\n.deskpet-section .deskpet-switch:hover { filter: brightness(1.12); }\n.deskpet-section .deskpet-switch:active:not(.locked) .deskpet-switch-knob { width: 19px; border-radius: 8px; }\n.deskpet-section .deskpet-switch-knob {\n  transition: left .18s cubic-bezier(.4,0,.2,1), width .12s ease, border-radius .12s ease;\n}\n@media (prefers-reduced-motion: reduce) {\n  .deskpet-section button, .deskpet-section .deskpet-switch,\n  .deskpet-section .deskpet-switch-knob { transition: none; }\n}\n";
//# sourceMappingURL=ui.d.ts.map