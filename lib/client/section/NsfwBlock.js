/** NSFW block: adult-content anchor switch plus an optional overriding prompt. */
import { createElement, useState } from 'react';
import { Card, Field, Status, Switch, TextArea } from './primitives.js';
import { styles } from '../ui.js';
import { NSFW_PROMPT_MAX_CHARS, clampNsfwPrompt } from '../../shared/companion-nsfw.js';
/**
 * 成人向提示段（0.1.8；0.1.9 更名为「nsfw提示段」）。
 *
 * 开关（nsfw.enabled）打开即注入插件内置的锚定块——用户**不需要**写任何提示词；
 * 多行文本框（nsfw.prompt）只在想覆盖内置正文时才用，留空 = 内置。写入前经
 * clampNsfwPrompt（trim + 截 8000 字），「恢复内置」写空串回到内置正文。
 *
 * 正文只在请求发出时拼进 system，不进气泡、不进角色卡导出、不进日志；
 * 本卡片也不回显内置正文本身（它对用户是常量，无需看）。
 *
 * 0.1.9：删除卡片底部的两段长说明（nsfwPromptHint / nsfwPrivacyHint）与
 * 卡片更名同步——效果免责与隐私说明保留在 docs/settings-panel.zh-CN.md，
 * UI 只留开关下方一句短说明（nsfwHint）。
 */
export function NsfwBlock(props) {
    const { controller, section, t } = props;
    const nsfw = section.nsfw ?? {};
    const enabled = nsfw.enabled === true;
    // null = 未编辑过：文本框跟随已提交的 section 值；一旦编辑就持有本地草稿，
    // 避免宿主 2.5s 轮询刷新快照时把正在输入的内容顶掉。
    const [draft, setDraft] = useState(null);
    const [notice, setNotice] = useState(null);
    const value = draft !== null ? draft : String(nsfw.prompt ?? '');
    const count = [...value].length;
    const writePrompt = async (next) => {
        const clamped = clampNsfwPrompt(next);
        setDraft(clamped);
        const result = await controller.write('nsfw.prompt', clamped);
        setNotice(result?.ok === false
            ? { ok: false, text: t('nsfwSaveFailed') }
            : { ok: true, text: t('nsfwSaved') });
    };
    return createElement(Card, { title: t('nsfwTitle') }, createElement('div', { style: styles.row }, createElement(Switch, {
        checked: enabled,
        onToggle: () => void controller.write('nsfw.enabled', !enabled),
    }), createElement('span', null, t('nsfwEnabled'))), createElement('div', { style: styles.hint }, t('nsfwHint')), createElement(Field, {
        label: t('nsfwPromptLabel'),
        children: createElement('div', { style: styles.column }, createElement(TextArea, {
            value,
            placeholder: t('nsfwPlaceholder'),
            onChange: (next) => setDraft(next),
        }), createElement('div', { style: styles.row }, createElement('button', {
            style: styles.buttonPrimary,
            onClick: () => void writePrompt(value),
        }, t('nsfwSave')), createElement('button', {
            style: styles.button,
            onClick: () => void writePrompt(''),
        }, t('nsfwRestore')), createElement('span', { style: styles.hint }, t('nsfwCount').replace('{count}', String(count)).replace('{max}', String(NSFW_PROMPT_MAX_CHARS)))), notice ? createElement(Status, { tone: notice.ok ? 'ok' : 'fail' }, notice.text) : null),
    }));
}
