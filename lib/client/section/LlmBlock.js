/** LLM block: the companion OpenAI-compatible endpoint, with a host-side probe. */
import { createElement, useCallback, useEffect, useState } from 'react';
import { Card, Field, Status, TextInput } from './primitives.js';
import { styles } from '../ui.js';
/** Render the companion-LLM block. */
export function LlmBlock(props) {
    const { controller, section, remote, t } = props;
    const llm = section.llm ?? {};
    // The API key is a `role('secret')` field: it never arrives over the wire, so
    // a local draft holds the user's typed replacement and an empty draft means
    // "leave the stored key alone".
    const [apiKeyDraft, setApiKeyDraft] = useState('');
    const [baseUrlDraft, setBaseUrlDraft] = useState(String(llm.baseUrl ?? ''));
    const [modelDraft, setModelDraft] = useState(String(llm.model ?? ''));
    const [visionDraft, setVisionDraft] = useState(String(llm.visionModel ?? ''));
    const [temperatureDraft, setTemperatureDraft] = useState(String(llm.temperature ?? 0.8));
    const [probe, setProbe] = useState(null);
    const [testing, setTesting] = useState(false);
    // Adopt host-side values when they move underneath (another surface edited
    // the same document), without clobbering a draft the user is still typing in.
    useEffect(() => { setBaseUrlDraft(String(llm.baseUrl ?? '')); }, [llm.baseUrl]);
    useEffect(() => { setModelDraft(String(llm.model ?? '')); }, [llm.model]);
    useEffect(() => { setVisionDraft(String(llm.visionModel ?? '')); }, [llm.visionModel]);
    useEffect(() => { setTemperatureDraft(String(llm.temperature ?? 0.8)); }, [llm.temperature]);
    const commitText = useCallback((field, value) => {
        void controller.write(`llm.${field}`, value);
    }, [controller]);
    const test = useCallback(async () => {
        setTesting(true);
        setProbe(null);
        const result = await controller.testLlm(baseUrlDraft, apiKeyDraft, modelDraft);
        setTesting(false);
        setProbe({ ok: result.ok, message: result.message });
    }, [controller, baseUrlDraft, apiKeyDraft, modelDraft]);
    const apiKeySet = remote?.runtime?.apiKeySet === true;
    return createElement(Card, { title: t('llmTitle') }, createElement(Field, {
        label: t('llmBaseUrl'),
        children: createElement(TextInput, {
            value: baseUrlDraft,
            placeholder: 'http://127.0.0.1:1234/v1',
            onChange: setBaseUrlDraft,
        }),
    }), createElement('div', { style: styles.row }, createElement('button', {
        style: styles.buttonPrimary,
        onClick: () => commitText('baseUrl', baseUrlDraft),
    }, t('save')), createElement('span', { style: apiKeySet ? styles.badge : styles.badgeMuted }, `${t('llmApiKey')}: ${apiKeySet ? t('llmApiKeySet') : t('llmApiKeyUnset')}`)), createElement(Field, {
        label: t('llmApiKey'),
        hint: t('llmApiKeyHint'),
        children: createElement('div', { style: styles.row }, createElement(TextInput, {
            type: 'password',
            value: apiKeyDraft,
            placeholder: apiKeySet ? '••••••••' : '',
            onChange: setApiKeyDraft,
        }), createElement('button', {
            style: styles.buttonPrimary,
            onClick: () => { commitText('apiKey', apiKeyDraft); setApiKeyDraft(''); },
        }, t('save')), createElement('button', { style: styles.button, onClick: () => void controller.clear('llm.apiKey') }, t('reset'))),
    }), createElement(Field, {
        label: t('llmModel'),
        children: createElement('div', { style: styles.row }, createElement(TextInput, { value: modelDraft, onChange: setModelDraft }), createElement('button', { style: styles.buttonPrimary, onClick: () => commitText('model', modelDraft) }, t('save'))),
    }), createElement(Field, {
        label: t('llmVisionModel'),
        hint: t('llmVisionHint'),
        children: createElement('div', { style: styles.row }, createElement(TextInput, { value: visionDraft, onChange: setVisionDraft }), createElement('button', { style: styles.buttonPrimary, onClick: () => commitText('visionModel', visionDraft) }, t('save'))),
    }), createElement(Field, {
        label: t('llmTemperature'),
        children: createElement('div', { style: styles.row }, createElement('input', {
            style: styles.inputSmall,
            type: 'number',
            min: 0,
            max: 2,
            step: 0.1,
            value: temperatureDraft,
            onChange: (event) => setTemperatureDraft(event.target.value),
        }), createElement('button', {
            style: styles.buttonPrimary,
            onClick: () => {
                const parsed = Number(temperatureDraft);
                if (Number.isFinite(parsed))
                    commitText('temperature', String(Math.min(2, Math.max(0, parsed))));
            },
        }, t('save'))),
    }), createElement('div', { style: styles.row }, createElement('button', { style: styles.button, onClick: test, disabled: testing }, testing ? t('llmTesting') : t('llmTest')), probe
        ? createElement(Status, { tone: probe.ok ? 'ok' : 'fail' }, `${probe.ok ? t('llmTestOk') : t('llmTestFail')}：${probe.message}`)
        : null));
}
