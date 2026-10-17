/** The settings section root: status gate, then the five blocks. */
import { createElement, useSyncExternalStore } from 'react';
import { SECTION_ROOT_CLASS, styles } from '../ui.js';
import { ModelBlock } from './ModelBlock.js';
import { ModeBlock } from './ModeBlock.js';
import { LlmBlock } from './LlmBlock.js';
import { VoiceBlock } from './VoiceBlock.js';
import { PersonaBlock } from './PersonaBlock.js';
import { WindowBlock } from './WindowBlock.js';
/** Render the Live2D deskpet settings page. */
export function DeskpetSection(props) {
    const { controller } = props;
    const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
    const t = (key) => tFn(key);
    if (snapshot.status === 'loading' && !snapshot.remote) {
        return createElement('div', { style: styles.hint }, t('loading'));
    }
    if (snapshot.status === 'unavailable') {
        return createElement('div', { style: styles.page }, createElement('div', { style: styles.hint }, t('unavailable')), snapshot.error ? createElement('div', { style: styles.hint }, snapshot.error) : null);
    }
    return createElement('div', 
    // Scopes the injected `SECTION_CSS` interaction states to this section only.
    { className: SECTION_ROOT_CLASS, style: styles.page }, snapshot.error ? createElement('div', { style: styles.fail }, snapshot.error) : null, 
    // A refused write is the one failure the panel used to hide: the settings
    // scope swallows host rejections, so the control snapped back with no
    // explanation. Surfaces it once, at the top, for any block.
    snapshot.write === 'failed' && snapshot.message
        ? createElement('div', { style: styles.fail }, snapshot.message)
        : null, createElement(ModelBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }), createElement(ModeBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }), createElement(LlmBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }), createElement(VoiceBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }), createElement(PersonaBlock, { controller, section: snapshot.section, cosplay: snapshot.cosplay, t }), createElement(WindowBlock, { controller, section: snapshot.section, remote: snapshot.remote, t }));
}
/**
 * Translation lookup injected by `apply`. Kept module-local so the section is
 * a plain component: the client entry swaps the implementation when the
 * harness locale service reports a language change, and the ledger bump
 * re-registers the slot with fresh copy.
 */
let tFn = key => key;
/** Swap the active translator (called on registration and locale change). */
export function setTranslator(next) {
    tFn = next;
}
