/**
 * Window block: the pet window's size, its lock, and position memory. The
 * user's complaint that the window is too large is what this block exists to
 * answer — the default is small and every edge is adjustable here.
 */
import { createElement, useEffect, useState } from 'react';
import { Card, Status, Switch } from './primitives.js';
import { styles } from '../ui.js';
/** Bounds mirror `src/config.ts`; keep both in step when either moves. */
export const WINDOW_WIDTH_MIN = 180;
export const WINDOW_WIDTH_MAX = 800;
export const WINDOW_HEIGHT_MIN = 240;
export const WINDOW_HEIGHT_MAX = 1000;
/** Render the window block. */
export function WindowBlock(props) {
    const { controller, section, remote, t } = props;
    const [widthDraft, setWidthDraft] = useState(String(section.windowWidth ?? 260));
    const [heightDraft, setHeightDraft] = useState(String(section.windowHeight ?? 360));
    const [error, setError] = useState(null);
    const [writeError, setWriteError] = useState(null);
    useEffect(() => { setWidthDraft(String(section.windowWidth ?? 260)); }, [section.windowWidth]);
    useEffect(() => { setHeightDraft(String(section.windowHeight ?? 360)); }, [section.windowHeight]);
    const applySize = () => {
        const width = Number(widthDraft);
        const height = Number(heightDraft);
        if (!Number.isFinite(width) || !Number.isFinite(height)
            || width < WINDOW_WIDTH_MIN || width > WINDOW_WIDTH_MAX
            || height < WINDOW_HEIGHT_MIN || height > WINDOW_HEIGHT_MAX) {
            setError(t('windowOutOfRange')
                .replace('{minW}', String(WINDOW_WIDTH_MIN)).replace('{maxW}', String(WINDOW_WIDTH_MAX))
                .replace('{minH}', String(WINDOW_HEIGHT_MIN)).replace('{maxH}', String(WINDOW_HEIGHT_MAX)));
            return;
        }
        setError(null);
        void controller.mutate([
            { op: 'set', path: ['windowWidth'], value: Math.round(width) },
            { op: 'set', path: ['windowHeight'], value: Math.round(height) },
        ]).then(result => { setWriteError(result.ok ? null : result.message ?? null); });
    };
    /**
     * Persist one boolean, surfacing a refusal instead of letting the switch snap
     * back with no explanation.
     */
    const toggle = (field, next) => {
        void controller.write(field, next).then(result => {
            setWriteError(result.ok ? null : result.message ?? null);
        });
    };
    const locked = section.windowLocked === true;
    // Default on: the projection treats anything but an explicit `false` as on, so
    // the switch must agree with it rather than reading a missing field as off.
    const clickThrough = section.clickThrough !== false;
    const remembers = section.rememberWindowPosition === true;
    const position = section.windowPosition ?? null;
    // The host reports where the window is right now; used to seed memory the
    // first time it is switched on.
    const livePosition = remote?.runtime?.windowPosition ?? null;
    return createElement(Card, { title: t('windowTitle') }, createElement('div', { style: styles.row }, createElement('span', { style: styles.label }, t('windowWidth')), createElement('input', {
        style: styles.inputSmall,
        type: 'number',
        min: WINDOW_WIDTH_MIN,
        max: WINDOW_WIDTH_MAX,
        value: widthDraft,
        onChange: (event) => setWidthDraft(event.target.value),
    }), createElement('span', { style: styles.label }, t('windowHeight')), createElement('input', {
        style: styles.inputSmall,
        type: 'number',
        min: WINDOW_HEIGHT_MIN,
        max: WINDOW_HEIGHT_MAX,
        value: heightDraft,
        onChange: (event) => setHeightDraft(event.target.value),
    }), createElement('button', { style: styles.buttonPrimary, onClick: applySize }, t('windowApply'))), createElement('div', { style: styles.hint }, t('windowRange')
        .replace('{minW}', String(WINDOW_WIDTH_MIN)).replace('{maxW}', String(WINDOW_WIDTH_MAX))
        .replace('{minH}', String(WINDOW_HEIGHT_MIN)).replace('{maxH}', String(WINDOW_HEIGHT_MAX))), createElement('div', { style: styles.row }, createElement(Switch, {
        checked: locked,
        onToggle: () => toggle('windowLocked', !locked),
    }), createElement('span', null, t('windowLocked'))), createElement('div', { style: styles.hint }, t('windowLockedHint')), createElement('div', { style: styles.row }, createElement(Switch, {
        checked: clickThrough,
        onToggle: () => toggle('clickThrough', !clickThrough),
    }), createElement('span', null, t('windowClickThrough'))), createElement('div', { style: styles.hint }, t('windowClickThroughHint')), createElement('div', { style: styles.row }, createElement(Switch, {
        checked: remembers,
        onToggle: () => {
            // Enabling seeds the position from the host's live report, so the first
            // remembered value is where the window actually sits. A placeholder
            // such as {0,0} would pin the pet to the screen corner on the next
            // launch; when no live report is held yet, the host answers
            // `request-window-position` and fills the field in moments later.
            void (async () => {
                const enabled = !remembers;
                const result = await controller.write('rememberWindowPosition', enabled);
                if (result.ok && enabled && livePosition) {
                    const seeded = await controller.write('windowPosition', livePosition);
                    setWriteError(seeded.ok ? null : seeded.message ?? null);
                    return;
                }
                setWriteError(result.ok ? null : result.message ?? null);
            })();
        },
    }), createElement('span', null, t('windowRemember'))), createElement('div', { style: styles.hint }, t('windowRememberHint')), remembers && position
        ? createElement('div', { style: styles.row }, createElement('span', { style: styles.mono }, `x=${position.x} y=${position.y}`), createElement('button', { style: styles.button, onClick: () => void controller.clear('windowPosition') }, t('windowReset')))
        : null, error ? createElement(Status, { tone: 'fail' }, error) : null, writeError ? createElement(Status, { tone: 'fail' }, writeError) : null);
}
