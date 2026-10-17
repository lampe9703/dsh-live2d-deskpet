/** Voice block: the GSV-TTS local synthesis bridge driving the pet's spoken voice. */
import { createElement, useState } from 'react';
import { Card, Field, Status, Switch, Segmented, TextInput } from './primitives.js';
import { styles } from '../ui.js';
/** String fields that can be edited here, keyed by their `voice.*` path suffix. */
const STRING_FIELDS = [
    'pythonPath', 'modelsDir', 'gptModel', 'sovitsModel',
    'spkAudio', 'promptAudio', 'promptText',
    'translateUrl', 'translateApiKey', 'translateModel',
];
/**
 * Render the voice/speech block.
 *
 * The pet's bubble text stays in the language the companion LLM writes (Chinese),
 * while the spoken voice is synthesized by the local GSV bridge. `lang` chooses
 * whether that voice is Japanese, Chinese, or auto.
 */
export function VoiceBlock(props) {
    const { controller, section, remote, t } = props;
    const voice = section.voice ?? {};
    const [draft, setDraft] = useState(() => Object.fromEntries(STRING_FIELDS.map(key => [key, String(voice[key] ?? '')])));
    const [error, setError] = useState(null);
    const write = (key, value) => { void controller.write(`voice.${key}`, value); setError(null); };
    const errors = remote?.runtime?.voiceReady === false ? t('voiceBridgeDown') : null;
    return createElement(Card, { title: t('voiceTitle') }, createElement('div', { style: styles.row }, createElement(Switch, {
        checked: voice.enabled === true,
        onToggle: () => write('enabled', !(voice.enabled === true)),
    }), createElement('span', null, t('voiceEnabled'))), createElement(Field, {
        label: t('voiceLang'),
        hint: t('voiceLangHint'),
        children: createElement(Segmented, {
            value: voice.lang ?? 'ja',
            options: [
                { value: 'ja', label: t('voiceLangJa') },
                { value: 'zh', label: t('voiceLangZh') },
                { value: 'auto', label: t('voiceLangAuto') },
            ],
            onChange: (value) => write('lang', value),
        }),
    }), createElement(Field, {
        label: t('voicePort'),
        children: createElement('div', { style: styles.row }, createElement(TextInput, {
            value: String(voice.bridgePort ?? 9876),
            onChange: (value) => { const n = Number(value); if (Number.isFinite(n)) write('bridgePort', n); },
        })),
    }), STRING_FIELDS.map(key => createElement(Field, {
        key,
        label: t(`voiceField_${key}`),
        hint: (key === 'pythonPath' ? t('voicePythonHint')
            : key === 'modelsDir' ? t('voiceModelsHint')
                : key === 'promptText' ? t('voicePromptHint')
                    : key === 'translateUrl' ? t('voiceTranslateHint') : undefined),
        children: createElement('div', { style: styles.row }, createElement(TextInput, {
            value: String(voice[key] ?? ''),
            placeholder: PLACEHOLDERS[key],
            onChange: (value) => setDraft(cur => ({ ...cur, [key]: value })),
        }), createElement('button', { style: styles.buttonPrimary, onClick: () => write(key, draft[key]) }, t('save'))),
    })), errors ? createElement(Status, { tone: 'fail' }, errors) : null, error ? createElement(Status, { tone: 'fail' }, error) : null);
}
const PLACEHOLDERS = {
    pythonPath: 'C:\\...\\gsv-venv\\Scripts\\python.exe',
    modelsDir: '...\\gsv_models',
    gptModel: 'Nanami_Chiaki-e15.ckpt',
    sovitsModel: 'Nanami_Chiaki_e20_s940.pth',
    spkAudio: '...\\laffey.mp3',
    promptAudio: '...\\AnAn.ogg',
    promptText: 'ちが……ちがう。レイア、貴様は間違っている。',
    translateUrl: 'http://127.0.0.1:1234/v1',
    translateApiKey: '••••••••',
    translateModel: 'model-id',
};
