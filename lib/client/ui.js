export const styles = {
    page: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0', maxWidth: '760px' },
    card: {
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '12px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
    },
    row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    column: { display: 'flex', flexDirection: 'column', gap: '6px' },
    title: { fontSize: '15px', fontWeight: 600 },
    hint: { fontSize: '13px', opacity: 0.72, lineHeight: '1.6' },
    label: { fontSize: '12px', opacity: 0.6, minWidth: '76px' },
    mono: { fontSize: '12px', opacity: 0.72, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', wordBreak: 'break-all' },
    switchTrack: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
    switchBox: {
        width: '38px', height: '22px', borderRadius: '11px', position: 'relative',
        transition: 'background .18s ease', background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.35))',
    },
    switchKnob: {
        width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
        position: 'absolute', top: '3px', left: '3px', transition: 'left .18s cubic-bezier(.4,0,.2,1)',
    },
    button: {
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))', background: 'transparent',
        color: 'inherit', borderRadius: '8px', padding: '4px 10px', fontSize: '13px',
        cursor: 'pointer', fontFamily: 'inherit',
    },
    buttonPrimary: {
        border: 'none', background: 'var(--dsw-specific-accent, #4d6bfe)', color: '#fff',
        borderRadius: '8px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
    },
    buttonDanger: {
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))', background: 'transparent',
        color: '#ff7b72', borderRadius: '8px', padding: '4px 10px', fontSize: '13px',
        cursor: 'pointer', fontFamily: 'inherit',
    },
    input: {
        background: 'transparent', border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '8px', padding: '5px 8px', color: 'inherit', fontSize: '13px',
        fontFamily: 'inherit', flex: 1, minWidth: '160px',
    },
    inputSmall: {
        background: 'transparent', border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '8px', padding: '5px 8px', color: 'inherit', fontSize: '13px',
        fontFamily: 'inherit', width: '88px',
    },
    select: {
        background: 'var(--dsw-alias-bg-base, #1b1d23)',
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '8px', padding: '5px 8px', color: 'inherit', fontSize: '13px',
        fontFamily: 'inherit', flex: 1, minWidth: '160px',
    },
    textarea: {
        background: 'transparent', border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '8px', padding: '5px 8px', color: 'inherit', fontSize: '13px', fontFamily: 'inherit',
        width: '100%', minHeight: '56px', resize: 'vertical', overflowY: 'auto',
        lineHeight: '1.5', boxSizing: 'border-box',
    },
    badge: {
        fontSize: '12px', padding: '1px 8px', borderRadius: '99px',
        background: 'var(--dsw-specific-accent, #4d6bfe)', color: '#fff',
    },
    badgeMuted: {
        fontSize: '12px', padding: '1px 8px', borderRadius: '99px',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.35))', color: 'inherit',
    },
    ok: { fontSize: '13px', color: '#3fb950' },
    fail: { fontSize: '13px', color: '#ff7b72' },
    thumb: {
        width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
    },
    segment: {
        display: 'inline-flex', gap: '0', border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))',
        borderRadius: '8px', overflow: 'hidden',
    },
    segmentItem: {
        border: 'none', background: 'transparent', color: 'inherit', padding: '5px 12px',
        fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
    },
    segmentItemActive: {
        background: 'var(--dsw-specific-accent, #4d6bfe)', color: '#fff',
    },
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
export const SECTION_ROOT_CLASS = 'deskpet-section';
export const SWITCH_CLASS = 'deskpet-switch';
export const SWITCH_KNOB_CLASS = 'deskpet-switch-knob';
/**
 * Interaction states for the section's controls.
 *
 * Scoped under {@link SECTION_ROOT_CLASS} so nothing here can affect the rest of
 * the settings shell.
 */
export const SECTION_CSS = `
.${SECTION_ROOT_CLASS} button {
  transition: transform .12s ease, opacity .15s ease, filter .15s ease, background .15s ease;
}
.${SECTION_ROOT_CLASS} button:hover:not(:disabled) { filter: brightness(1.12); }
.${SECTION_ROOT_CLASS} button:active:not(:disabled) { transform: scale(.955) translateY(1px); filter: brightness(.94); }
.${SECTION_ROOT_CLASS} button:disabled { opacity: .5; cursor: default; }
.${SECTION_ROOT_CLASS} input, .${SECTION_ROOT_CLASS} textarea, .${SECTION_ROOT_CLASS} select {
  transition: border-color .15s ease, box-shadow .15s ease;
}
.${SECTION_ROOT_CLASS} input:focus, .${SECTION_ROOT_CLASS} textarea:focus, .${SECTION_ROOT_CLASS} select:focus {
  outline: none;
  border-color: var(--dsw-specific-accent, #4d6bfe);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-specific-accent, #4d6bfe) 28%, transparent);
}
.${SECTION_ROOT_CLASS} .${SWITCH_CLASS} { transition: filter .15s ease; }
.${SECTION_ROOT_CLASS} .${SWITCH_CLASS}:hover { filter: brightness(1.12); }
.${SECTION_ROOT_CLASS} .${SWITCH_CLASS}:active:not(.locked) .${SWITCH_KNOB_CLASS} { width: 19px; border-radius: 8px; }
.${SECTION_ROOT_CLASS} .${SWITCH_KNOB_CLASS} {
  transition: left .18s cubic-bezier(.4,0,.2,1), width .12s ease, border-radius .12s ease;
}
@media (prefers-reduced-motion: reduce) {
  .${SECTION_ROOT_CLASS} button, .${SECTION_ROOT_CLASS} .${SWITCH_CLASS},
  .${SECTION_ROOT_CLASS} .${SWITCH_KNOB_CLASS} { transition: none; }
}
`;
