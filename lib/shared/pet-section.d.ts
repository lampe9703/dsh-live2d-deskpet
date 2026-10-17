import type { Persona, PersonaConfig, PetConfig, PetSettingsSection } from './types.js';
/**
 * Pure helpers shared by the host, the Electron window, and the tests: window
 * edge clamping, persona resolution, and the settings-section projection.
 */
/**
 * Clamp one window edge into the published range, rounding to whole pixels. A
 * non-finite input (malformed settings document, `NaN` from a UI calculation)
 * falls back to the minimum edge instead of propagating `NaN` into
 * `BrowserWindow`, which would throw at construction.
 */
export declare function clampWindowWidth(width: number): number;
/** Clamp one window edge into the published range, rounding to whole pixels. */
export declare function clampWindowHeight(height: number): number;
/** Fallback system message when no persona is active or its prompt is blank. */
export declare const DEFAULT_COMPANION_SYSTEM_PROMPT = "\u4F60\u662F\u4E00\u4E2A\u6709\u5206\u5BF8\u7684\u684C\u9762\u966A\u4F34\u5BA0\u7269\u3002\u6839\u636E\u65F6\u95F4\u548C\u5C4F\u5E55\u4E0A\u4E0B\u6587\uFF0C\u7528\u4E2D\u6587\u7ED9\u51FA\u4E00\u53E5\u7B80\u77ED\u3001\u81EA\u7136\u3001\u975E\u4FB5\u6270\u6027\u7684\u4E3B\u52A8\u5173\u6000\u6216\u63D0\u9192\uFF1B\u4E0D\u8981\u6CC4\u9732\u5C4F\u5E55\u4E0A\u7684\u654F\u611F\u4FE1\u606F\u3002";
/**
 * Delivery constraints appended to whichever persona prompt is active.
 *
 * This is the prompt-layer half of "speak in short sentences". The code layer
 * already guarantees the bubble never shows reasoning and never exceeds a few
 * lines, but it can only cut text up — it cannot make the model WRITE in a
 * speakable rhythm. Asking for short spoken sentences here is what stops pieces
 * from breaking mid-clause, and it keeps the reply from being one long
 * paragraph to begin with.
 *
 * It says nothing about where the model's reasoning goes on purpose: thinking is
 * the model's own business, and the display layer already keeps it out of the
 * bubble whichever shape it arrives in. Asking a model to suppress its
 * reasoning would also risk degrading the very thing the user wants kept.
 *
 * Appended rather than merged so a user-authored persona card stays intact.
 *
 * The character counts interpolated below are the very constants the display
 * layer enforces, so changing `BUBBLE_MAX_CHARS` re-tunes the request too.
 */
export declare const COMPANION_SPEECH_STYLE: string;
/** The persona a given configuration activates, or undefined for the default one. */
export declare function activePersona(persona: PersonaConfig | undefined): Persona | undefined;
/**
 * Resolve the system prompt the companion LLM should run with.
 *
 * The active persona (or the built-in text) is followed by
 * {@link COMPANION_SPEECH_STYLE}, so every persona speaks in bubble-sized
 * sentences without the card author having to think about the pet's display.
 */
export declare function companionSystemPrompt(persona: PersonaConfig | undefined): string;
/**
 * Project a committed settings section onto the next runtime config. Kept pure
 * so the mapping (model fallback, window clamping, persona/lock passthrough)
 * can be tested without a live host.
 * @param before - the config the host currently runs.
 * @param section - the section the settings namespace just committed.
 * @param modelExists - whether the section's `modelId` is still on disk.
 */
export declare function sectionToConfig(before: PetConfig, section: PetSettingsSection, modelExists: (id: string) => boolean): PetConfig;
/** Keep only well-formed `{ x, y }` positions; everything else reads as "absent". */
export declare function validWindowPosition(value: unknown): {
    x: number;
    y: number;
} | undefined;
/** Defensively shape a stored persona collection: ids and prompts are strings, arrays are arrays. */
export declare function normalizePersonaConfig(value: PersonaConfig | undefined): PersonaConfig;
/** SillyTavern v2 character-card shape this plugin imports and exports. */
export interface V2CharacterCard {
    spec: 'chara_card_v2';
    spec_version: '2.0';
    data: {
        name: string;
        description?: string;
        personality?: string;
        scenario?: string;
        first_mes?: string;
        mes_example?: string;
        system_prompt?: string;
        post_history_instructions?: string;
        creator_notes?: string;
        character_version?: string;
        creator?: string;
        tags?: string[];
        extensions?: Record<string, unknown>;
    };
}
/** Extension key dsh-cosplay records its own fields under, inside a v2 card. */
export declare const COSPLAY_EXTENSION_KEY = "dshCosplay";
/** Extension key this plugin records its own fields under, inside a v2 card. */
export declare const DESKPET_EXTENSION_KEY = "dsh-live2d-deskpet";
/**
 * Compose a system prompt from every descriptive field a card carries.
 *
 * An explicit `system_prompt` leads, but it does NOT suppress the other fields.
 * Real cards carry both: the card this was written against ships a 1 KB
 * `system_prompt` alongside a 3 KB `rules` block plus `personality`/`style`/
 * `behavior`. Letting the explicit field win outright silently discarded most of
 * the character. Fields already contained in the accumulated prompt are skipped,
 * so the usual case of a `system_prompt` restating `description` does not
 * duplicate text.
 */
export declare function composeSystemPrompt(source: Record<string, unknown>): string;
/** Whether a value looks like a dsh-cosplay role entry. */
export declare function isCosplayRole(value: unknown): boolean;
/**
 * Map one dsh-cosplay role card onto this plugin's persona shape.
 *
 * The id is carried over unchanged, so re-importing the same role is detectable
 * instead of silently duplicating it (the section assigns a fresh id when one
 * already exists).
 */
export declare function personaFromCosplayRole(role: unknown): Persona;
/** Convert one persona into a SillyTavern v2 character card. */
export declare function toV2Card(persona: Persona): V2CharacterCard;
/**
 * Convert a SillyTavern v2 character card (or a bare v1 card with `name`)
 * into a persona. Throws when the card carries no usable name.
 *
 * Cards exported by dsh-cosplay are accepted as-is: their ids and emoji live
 * under `extensions.dshCosplay`, and their characterisation is spread over
 * `personality`/`style`/`rules`/`behavior` rather than `system_prompt`.
 */
export declare function fromV2Card(card: unknown): Persona;
/** A fresh persona id, shared by every creation path. */
export declare function newPersonaId(): string;
/** Re-export for the v2 field list so tests can iterate the same mapping. */
export declare const V2_CARD_TEXT_FIELDS: readonly ["description", "personality", "scenario", "first_mes", "mes_example", "system_prompt", "creator_notes"];
//# sourceMappingURL=pet-section.d.ts.map