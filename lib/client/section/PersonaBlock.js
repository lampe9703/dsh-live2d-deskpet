/**
 * Persona block: the companion personas — list, create, edit, delete, activate,
 * plus SillyTavern v2 character-card import/export so existing cards can be
 * reused (and shared with dsh-cosplay on the same machine).
 */
import { createElement, useCallback, useRef, useState } from 'react';
import { Card, Field, Status, TextArea, TextInput } from './primitives.js';
import { styles } from '../ui.js';
import { fromV2Card, newPersonaId, toV2Card } from '../../shared/pet-section.js';
const BLANK_PERSONA = { id: '', name: '', emoji: '', systemPrompt: '', greeting: '', description: '', tags: [] };
/** Render the persona block. */
export function PersonaBlock(props) {
    const { controller, section, cosplay, t } = props;
    const personaSection = section.persona ?? {};
    const personas = Array.isArray(personaSection.personas) ? personaSection.personas : [];
    const activeId = personaSection.activeId ?? '';
    const library = Array.isArray(cosplay) ? cosplay : [];
    const [draft, setDraft] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const fileRef = useRef(null);
    const setField = useCallback((key, value) => {
        setDraft(current => (current ? { ...current, [key]: value } : current));
    }, []);
    /** Persist the whole persona list plus the active id in one atomic write. */
    const persist = useCallback(async (next, nextActiveId) => {
        const result = await controller.mutate([
            { op: 'set', path: ['persona', 'personas'], value: next },
            { op: 'set', path: ['persona', 'activeId'], value: nextActiveId },
        ]);
        // The controller reports the host's answer; a refused write must not read as
        // a successful save (which is how an import used to vanish without a word).
        if (!result.ok)
            setError(result.message ?? t('personaSaveFailed'));
        return result.ok;
    }, [controller, t]);
    const save = useCallback(async () => {
        if (!draft)
            return;
        if (!draft.name.trim()) {
            setError(t('personaNameRequired'));
            return;
        }
        setError(null);
        const next = draft.id
            ? personas.map(candidate => (candidate.id === draft.id ? { ...draft, name: draft.name.trim() } : candidate))
            : [...personas, { ...draft, id: newPersonaId(), name: draft.name.trim() }];
        const savedId = draft.id || next[next.length - 1].id;
        // A first persona becomes active automatically: the section would otherwise
        // leave the user with a configured persona that nothing uses.
        const nextActive = activeId || savedId;
        if (await persist(next, nextActive))
            setDraft(null);
    }, [draft, personas, activeId, persist, t]);
    const remove = useCallback(async (persona) => {
        if (!window.confirm(t('personaDeleteConfirm').replace('{name}', persona.name)))
            return;
        const next = personas.filter(candidate => candidate.id !== persona.id);
        await persist(next, activeId === persona.id ? '' : activeId);
    }, [personas, activeId, persist, t]);
    const exportPersona = useCallback((persona) => {
        const blob = new Blob([JSON.stringify(toV2Card(persona), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${persona.name || persona.id || 'persona'}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, []);
    const importPersona = useCallback(async (file) => {
        try {
            const text = await file.text();
            if (!text.trim())
                throw new Error(t('personaImportEmpty'));
            const imported = fromV2Card(JSON.parse(text));
            const result = await controller.addPersona(imported);
            if (result.ok) {
                setError(null);
                setNotice(t('personaImported').replace('{name}', imported.name));
            }
            else {
                setNotice(null);
                setError(`${t('personaImportFailed')}：${result.message ?? ''}`);
            }
        }
        catch (failure) {
            // JSON.parse and fromV2Card both throw on unusable input; the message is
            // the only thing telling the user which part of the card is wrong.
            setNotice(null);
            setError(`${t('personaImportFailed')}：${failure.message}`);
        }
        finally {
            if (fileRef.current)
                fileRef.current.value = '';
        }
    }, [controller, t]);
    /**
     * Import a role straight out of dsh-cosplay's library. The mapping carries the
     * role's id over, so importing the same role twice creates a copy rather than
     * silently replacing the first one.
     */
    const importFromCosplay = useCallback(async (role) => {
        const result = await controller.addPersona(role);
        if (result.ok) {
            setError(null);
            setNotice(t('personaImported').replace('{name}', role.name));
        }
        else {
            setNotice(null);
            setError(`${t('personaImportFailed')}：${result.message ?? ''}`);
        }
    }, [controller, t]);
    return createElement(Card, {
        title: t('personaTitle'),
        actions: createElement('div', { style: styles.row }, createElement('button', { style: styles.buttonPrimary, onClick: () => setDraft({ ...BLANK_PERSONA }) }, t('personaNew')), createElement('button', { style: styles.button, onClick: () => fileRef.current?.click() }, t('personaImport')), createElement('input', {
            ref: fileRef,
            type: 'file',
            accept: '.json,application/json',
            style: { display: 'none' },
            onChange: (event) => {
                const file = event.target.files?.[0];
                if (file)
                    void importPersona(file);
            },
        })),
    }, createElement(Field, {
        label: t('personaActive'),
        children: createElement('select', {
            style: styles.select,
            value: activeId,
            onChange: (event) => void persist(personas, event.target.value),
        }, createElement('option', { value: '' }, t('personaDefault')), personas.map(persona => createElement('option', { key: persona.id, value: persona.id }, `${persona.emoji ?? ''} ${persona.name}`.trim()))),
    }), personas.length === 0
        ? createElement('div', { style: styles.hint }, t('personaEmpty'))
        : createElement('div', { style: styles.column }, personas.map(persona => createElement('div', { key: persona.id, style: styles.row }, createElement('span', null, `${persona.emoji ?? ''} ${persona.name}`.trim()), persona.id === activeId ? createElement('span', { style: styles.badge }, '★') : null, createElement('span', {
            style: { ...styles.hint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, persona.description ?? ''), createElement('button', { style: styles.button, onClick: () => void persist(personas, persona.id) }, t('personaUse')), createElement('button', { style: styles.button, onClick: () => setDraft({ ...persona }) }, t('personaEdit')), createElement('button', { style: styles.button, onClick: () => exportPersona(persona) }, t('personaExport')), createElement('button', { style: styles.buttonDanger, onClick: () => void remove(persona) }, t('personaDelete'))))), library.length > 0
        ? createElement('div', { style: styles.column }, createElement('div', { style: styles.label }, t('personaFromCosplay')), createElement('div', { style: styles.hint }, t('personaCosplayHint')), library.map(role => createElement('div', { key: `cosplay-${role.id}`, style: styles.row }, createElement('span', null, `${role.emoji ?? ''} ${role.name}`.trim()), createElement('span', {
            style: { ...styles.hint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, role.description ?? ''), createElement('button', {
            style: styles.button,
            onClick: () => void importFromCosplay(role),
        }, t('personaCosplayImport')))))
        : null, draft
        ? createElement('div', { style: { ...styles.card, background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))' } }, createElement('div', { style: styles.title }, draft.id ? `${t('personaEdit')}：${draft.name}` : t('personaNew')), createElement('div', { style: styles.row }, createElement('span', { style: styles.label }, t('personaName')), createElement(TextInput, { value: draft.name, onChange: value => setField('name', value) }), createElement('span', { style: styles.label }, t('personaEmoji')), createElement(TextInput, { value: draft.emoji ?? '', style: { ...styles.inputSmall }, onChange: value => setField('emoji', value) })), createElement(Field, {
            label: t('personaPrompt'),
            hint: t('personaPromptHint'),
            children: createElement(TextArea, {
                value: draft.systemPrompt,
                minHeight: '110px',
                onChange: value => setField('systemPrompt', value),
            }),
        }), createElement(Field, {
            label: t('personaGreeting'),
            hint: t('personaGreetingHint'),
            children: createElement(TextArea, {
                value: draft.greeting ?? '',
                minHeight: '56px',
                onChange: value => setField('greeting', value),
            }),
        }), createElement(Field, {
            label: t('personaDescription'),
            children: createElement(TextArea, {
                value: draft.description ?? '',
                minHeight: '56px',
                onChange: value => setField('description', value),
            }),
        }), createElement('div', { style: styles.row }, createElement('button', { style: styles.buttonPrimary, onClick: () => void save() }, t('personaSave')), createElement('button', { style: styles.button, onClick: () => { setDraft(null); setError(null); } }, t('personaCancel'))))
        : null, notice ? createElement(Status, { tone: 'ok' }, notice) : null, error ? createElement(Status, { tone: 'fail' }, error) : null);
}
