/** Memory block: companion short-term memory switch, kept turns, clear button, stored count. */
import { createElement, useState } from 'react';
import { Card, Field, Status, Switch } from './primitives.js';
import { styles } from '../ui.js';
/**
 * 陪伴记忆（0.1.7 v1）。
 *
 * 只展示与写配置：开关（memory.enabled）、保留轮数（memory.shortTermTurns，
 * 1–30）、一键清空（走 Remote 的 clearCompanionMemory，宿主原子清空
 * turns.jsonl）、当前条目数（宿主 getState 读文件补上的 runtime.memoryTurns）。
 * 运行时数据不随配置存，关闭开关不删文件。
 *
 * 0.1.9：删除开关下方的整段功能说明（memoryHint）——卡片自解释，
 * 长文案让设置页显得啰嗦；功能说明保留在 docs/settings-panel.zh-CN.md。
 */
export function MemoryBlock(props) {
    const { controller, section, remote, t } = props;
    const memory = section.memory ?? {};
    const enabled = memory.enabled === true;
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const turns = remote?.runtime?.memoryTurns;
    const clear = async () => {
        setBusy(true);
        setNotice(null);
        const failure = await controller.clearCompanionMemory();
        setBusy(false);
        setNotice(failure ? { ok: false, text: failure } : { ok: true, text: t('memoryCleared') });
    };
    return createElement(Card, { title: t('memoryTitle') }, createElement('div', { style: styles.row }, createElement(Switch, {
        checked: enabled,
        onToggle: () => void controller.write('memory.enabled', !enabled),
    }), createElement('span', null, t('memoryEnabled'))), createElement(Field, {
        label: t('memoryTurns'),
        hint: t('memoryTurnsHint'),
        children: createElement('div', { style: styles.row }, createElement('input', {
            style: styles.inputSmall,
            type: 'number',
            min: 1,
            max: 30,
            value: String(memory.shortTermTurns ?? 8),
            onChange: (event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed))
                    void controller.write('memory.shortTermTurns', Math.min(30, Math.max(1, Math.round(parsed))));
            },
        }), createElement('span', { style: styles.hint }, t('memoryTurnsUnit'))),
    }), createElement('div', { style: styles.row }, createElement('button', {
        style: styles.buttonDanger, onClick: () => void clear(), disabled: busy,
    }, busy ? t('memoryClearing') : t('memoryClear')), typeof turns === 'number'
        ? createElement('span', { style: styles.hint }, t('memoryCount').replace('{count}', String(turns)))
        : null, notice ? createElement(Status, { tone: notice.ok ? 'ok' : 'fail' }, notice.text) : null), createElement('div', { style: styles.hint }, t('memoryPathHint')));
}
