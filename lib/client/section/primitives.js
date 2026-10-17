/** Small presentational primitives shared by the section's five blocks. */
import { createElement } from 'react';
import { SWITCH_CLASS, SWITCH_KNOB_CLASS, styles } from '../ui.js';
/** A titled card, the section's one layout primitive. */
export function Card(props) {
    return createElement('div', { style: styles.card }, createElement('div', { style: styles.row }, createElement('div', { style: styles.title }, props.title), props.actions), props.children);
}
/** One labelled control row. */
export function Field(props) {
    return createElement('div', { style: styles.column }, createElement('div', { style: styles.row }, createElement('span', { style: styles.label }, props.label), props.children), props.hint ? createElement('div', { style: styles.hint }, props.hint) : null);
}
/**
 * The harness-styled toggle used for every boolean in the section.
 *
 * The knob's travel is a `left` transition (see {@link styles.switchKnob} plus
 * the `.deskpet-switch-knob` rule in `SECTION_CSS`), so the slide only plays
 * when `checked` actually changes — a write that never updates the committed
 * section leaves the knob parked, which is exactly what a silently refused
 * write looked like.
 */
export function Switch(props) {
    return createElement('label', {
        className: SWITCH_CLASS,
        style: { ...styles.switchTrack, ...(props.disabled ? { opacity: 0.5, cursor: 'default' } : {}) },
    }, createElement('span', {
        style: {
            ...styles.switchBox,
            background: props.checked ? 'var(--dsw-specific-accent, #4d6bfe)' : styles.switchBox.background,
        },
        onClick: () => { if (!props.disabled)
            props.onToggle(); },
    }, createElement('span', {
        className: SWITCH_KNOB_CLASS,
        style: { ...styles.switchKnob, left: props.checked ? '19px' : '3px' },
    })), props.label ? createElement('span', null, props.label) : null);
}
/** A segmented three-way (or N-way) chooser. */
export function Segmented(props) {
    return createElement('div', { style: styles.segment }, props.options.map(option => createElement('button', {
        key: option.value,
        style: {
            ...styles.segmentItem,
            ...(option.value === props.value ? styles.segmentItemActive : {}),
        },
        onClick: () => props.onChange(option.value),
    }, option.label)));
}
/** A text input bound to a string field. */
export function TextInput(props) {
    return createElement('input', {
        style: props.style ?? styles.input,
        type: props.type ?? 'text',
        value: props.value,
        placeholder: props.placeholder,
        onChange: (event) => props.onChange(event.target.value),
    });
}
/** A multiline input bound to a string field. */
export function TextArea(props) {
    return createElement('textarea', {
        style: props.minHeight ? { ...styles.textarea, minHeight: props.minHeight } : styles.textarea,
        value: props.value,
        placeholder: props.placeholder,
        onChange: (event) => props.onChange(event.target.value),
    });
}
/** A label/value line used for read-only runtime facts. */
export function Fact(props) {
    return createElement('div', { style: styles.row }, createElement('span', { style: styles.label }, props.label), createElement('span', { style: props.mono ? styles.mono : styles.hint }, props.value));
}
/** Inline failure/success line. */
export function Status(props) {
    const style = props.tone === 'ok' ? styles.ok : props.tone === 'fail' ? styles.fail : styles.hint;
    return createElement('div', { style }, props.children);
}
