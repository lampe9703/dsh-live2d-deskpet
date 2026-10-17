/** Model block: pick the active model, import a folder, delete, Cubism Core status. */
import { createElement, useCallback, useState } from 'react';
import { Card, Fact, Field, Status } from './primitives.js';
import { styles } from '../ui.js';
/** Render the model block. */
export function ModelBlock(props) {
    const { controller, section, remote, t } = props;
    const models = remote?.models ?? [];
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const importModel = useCallback(async () => {
        setBusy(true);
        setError(null);
        const failure = await controller.importModel();
        setBusy(false);
        if (failure)
            setError(failure);
    }, [controller]);
    const removeModel = useCallback(async (model) => {
        if (!window.confirm(t('modelRemoveConfirm').replace('{name}', model.name)))
            return;
        setError(null);
        const failure = await controller.removeModel(model.id);
        if (failure)
            setError(failure);
    }, [controller, t]);
    const cubismReady = remote?.runtime?.cubismCore === true;
    return createElement(Card, {
        title: t('modelTitle'),
        actions: createElement('div', { style: styles.row }, createElement('button', { style: styles.buttonPrimary, onClick: importModel, disabled: busy }, busy ? t('modelImporting') : t('modelImport')), createElement('button', { style: styles.button, onClick: () => void controller.openModelsFolder() }, t('modelOpenFolder'))),
    }, models.length === 0
        ? createElement('div', { style: styles.hint }, t('modelEmpty'))
        : createElement(Field, {
            label: t('modelSelect'),
            hint: t('modelFolderHint'),
            children: createElement('select', {
                style: styles.select,
                value: section.modelId ?? '',
                onChange: (event) => void controller.write('modelId', event.target.value),
            }, createElement('option', { value: '' }, t('modelNone')), models.map(model => createElement('option', { key: model.id, value: model.id }, model.name))),
        }), models.length > 0
        ? createElement('div', { style: styles.column }, models.map(model => createElement('div', { key: model.id, style: styles.row }, createElement('span', { style: { ...styles.hint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, model.name), model.id === section.modelId ? createElement('span', { style: styles.badge }, '✓') : null, createElement('button', { style: styles.button, onClick: () => void controller.write('modelId', model.id) }, t('modelUse')), createElement('button', { style: styles.buttonDanger, onClick: () => void removeModel(model) }, t('modelRemove')))))
        : null, createElement('div', { style: styles.row }, createElement('span', { style: cubismReady ? styles.badge : styles.badgeMuted }, cubismReady ? t('cubismReady') : t('cubismMissing'))), createElement(Field, {
        label: t('cubismPath'),
        hint: t('cubismPathHint'),
        children: createElement('input', {
            style: styles.input,
            value: section.cubismCorePath ?? '',
            onChange: (event) => void controller.write('cubismCorePath', event.target.value),
        }),
    }), remote?.runtime?.modelsRoot ? createElement(Fact, { label: 'models', value: remote.runtime.modelsRoot, mono: true }) : null, error ? createElement(Status, { tone: 'fail' }, error) : null);
}
