/** Mode block: auto / task / companion, plus the facts that only apply to companion. */
import { createElement } from 'react';
import { Card, Field, Segmented, Status, Switch } from './primitives.js';
import { styles } from '../ui.js';
/** Render the mode block. */
export function ModeBlock(props) {
    const { controller, section, remote, t } = props;
    const mode = section.mode ?? 'auto';
    const effective = remote?.runtime?.effectiveMode;
    return createElement(Card, { title: t('modeTitle') }, createElement(Field, {
        label: t('modeTitle'),
        children: createElement(Segmented, {
            value: mode,
            options: [
                { value: 'auto', label: t('modeAuto') },
                { value: 'task', label: t('modeTask') },
                { value: 'companion', label: t('modeCompanion') },
            ],
            onChange: value => void controller.write('mode', value),
        }),
    }), mode === 'auto' && effective
        ? createElement(Status, { tone: 'hint' }, t('modeEffective').replace('{mode}', effective === 'task' ? t('modeTask') : t('modeCompanion')))
        : null, createElement('div', { style: styles.row }, createElement(Switch, {
        checked: section.alwaysOnTop !== false,
        onToggle: () => void controller.write('alwaysOnTop', !(section.alwaysOnTop !== false)),
    }), createElement('span', null, t('alwaysOnTop'))), createElement(Field, {
        label: t('companionInterval'),
        children: createElement('div', { style: styles.row }, createElement('input', {
            style: styles.inputSmall,
            type: 'number',
            min: 1,
            max: 180,
            value: String(section.companionIntervalMinutes ?? 10),
            onChange: (event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed))
                    void controller.write('companionIntervalMinutes', Math.min(180, Math.max(1, Math.round(parsed))));
            },
        }), createElement('span', { style: styles.hint }, t('companionIntervalUnit'))),
    }), createElement('div', { style: styles.row }, createElement(Switch, {
        checked: section.screenshotsEnabled !== false,
        onToggle: () => void controller.write('screenshotsEnabled', !(section.screenshotsEnabled !== false)),
    }), createElement('span', null, t('screenshots'))));
}
