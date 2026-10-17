/**
 * Locale bundle for the Live2D deskpet settings section. The namespace key
 * is registered through `ctx.locale.register` and declared on the harness
 * `LocaleNamespaceMap` so `ctx.locale.bind` type-checks.
 */
/** Keys this section renders. */
export type DeskpetLocaleKey = 'nav' | 'title' | 'loading' | 'unavailable' | 'modelTitle' | 'modelSelect' | 'modelNone' | 'modelImport' | 'modelImporting' | 'modelRemove' | 'modelRemoveConfirm' | 'modelOpenFolder' | 'modelFolderHint' | 'modelUse' | 'modelEmpty' | 'cubismReady' | 'cubismMissing' | 'cubismPath' | 'cubismPathHint' | 'modeTitle' | 'modeAuto' | 'modeTask' | 'modeCompanion' | 'modeEffective' | 'alwaysOnTop' | 'companionInterval' | 'companionIntervalUnit' | 'screenshots' | 'llmTitle' | 'llmBaseUrl' | 'llmApiKey' | 'llmApiKeySet' | 'llmApiKeyUnset' | 'llmApiKeyHint' | 'llmModel' | 'llmVisionModel' | 'llmVisionHint' | 'llmTemperature' | 'llmTest' | 'llmTesting' | 'llmTestOk' | 'llmTestFail' | 'personaTitle' | 'personaActive' | 'personaDefault' | 'personaNew' | 'personaEdit' | 'personaDelete' | 'personaDeleteConfirm' | 'personaUse' | 'personaEmpty' | 'personaName' | 'personaEmoji' | 'personaPrompt' | 'personaPromptHint' | 'personaGreeting' | 'personaGreetingHint' | 'personaDescription' | 'personaTags' | 'personaSave' | 'personaCancel' | 'personaImport' | 'personaExport' | 'personaNameRequired' | 'personaSaveFailed' | 'personaImportFailed' | 'personaImportEmpty' | 'personaImported' | 'personaFromCosplay' | 'personaCosplayHint' | 'personaCosplayImport' | 'windowTitle' | 'windowWidth' | 'windowHeight' | 'windowLocked' | 'windowLockedHint' | 'windowRemember' | 'windowRememberHint' | 'windowApply' | 'windowReset' | 'windowOutOfRange' | 'windowClickThrough' | 'windowClickThroughHint' | 'windowRange' | 'save' | 'saving' | 'saved' | 'saveFailed' | 'reset';
/** English copy. */
export declare const en: Record<DeskpetLocaleKey, string>;
/** Chinese copy (the dialogue language of the shipped product). */
export declare const zh: Record<DeskpetLocaleKey, string>;
declare module '@deepseek-ai/dsh-client-locale/client' {
    interface LocaleNamespaceMap {
        /** Live2D deskpet settings copy. */
        'settings.live2dDeskpet': DeskpetLocaleKey;
    }
}
export type { DeskpetLocaleKey as LocaleKey };
//# sourceMappingURL=locales.d.ts.map