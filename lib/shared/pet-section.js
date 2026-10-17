// The speech bounds are quoted by COMPANION_SPEECH_STYLE below, so the prompt a
// persona is told and the budget the code enforces are the same numbers.
import { BUBBLE_MAX_CHARS, BUBBLE_MIN_CHARS, REPLY_MAX_CHARS, REPLY_MIN_CHARS } from './bubble-speech.js';
// Dependency-free on purpose: this module is bundled into the browser client, so
// it must not reach `config.ts` (which imports `@deepseek-ai/schemastery`, a
// package the browser module table does not carry).
import { WINDOW_HEIGHT_MAX, WINDOW_HEIGHT_MIN, WINDOW_WIDTH_MAX, WINDOW_WIDTH_MIN } from './window-bounds.js';
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
export function clampWindowWidth(width) {
    return finiteClamp(width, WINDOW_WIDTH_MIN, WINDOW_WIDTH_MAX);
}
/** Clamp one window edge into the published range, rounding to whole pixels. */
export function clampWindowHeight(height) {
    return finiteClamp(height, WINDOW_HEIGHT_MIN, WINDOW_HEIGHT_MAX);
}
function finiteClamp(value, min, max) {
    if (!Number.isFinite(value))
        return value === Infinity ? max : min;
    return Math.min(max, Math.max(min, Math.round(value)));
}
/** Fallback system message when no persona is active or its prompt is blank. */
export const DEFAULT_COMPANION_SYSTEM_PROMPT = '你是一个有分寸的桌面陪伴宠物。根据时间和屏幕上下文，用中文给出一句简短、自然、非侵扰性的主动关怀或提醒；不要泄露屏幕上的敏感信息。';
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
export const COMPANION_SPEECH_STYLE = '【说话方式】像真人闲聊那样断句：'
    + `每次回应用中文说 ${String(REPLY_MIN_CHARS)} 到 ${String(REPLY_MAX_CHARS)} 个字，`
    + `拆成两三句，每句 ${String(BUBBLE_MIN_CHARS)} 到 ${String(BUBBLE_MAX_CHARS)} 个字；`
    + '不要输出长段落，也不要罗列条目。';
/** The persona a given configuration activates, or undefined for the default one. */
export function activePersona(persona) {
    if (!persona || !persona.activeId)
        return undefined;
    return persona.personas.find(candidate => candidate.id === persona.activeId);
}
/**
 * Resolve the system prompt the companion LLM should run with.
 *
 * The active persona (or the built-in text) is followed by
 * {@link COMPANION_SPEECH_STYLE}, so every persona speaks in bubble-sized
 * sentences without the card author having to think about the pet's display.
 */
export function companionSystemPrompt(persona) {
    const voice = activePersona(persona)?.systemPrompt?.trim() || DEFAULT_COMPANION_SYSTEM_PROMPT;
    return `${voice}\n\n${COMPANION_SPEECH_STYLE}`;
}
/**
 * Project a committed settings section onto the next runtime config. Kept pure
 * so the mapping (model fallback, window clamping, persona/lock passthrough)
 * can be tested without a live host.
 * @param before - the config the host currently runs.
 * @param section - the section the settings namespace just committed.
 * @param modelExists - whether the section's `modelId` is still on disk.
 */
export function sectionToConfig(before, section, modelExists) {
    return {
        ...before,
        enabled: section.enabled,
        mode: section.mode,
        alwaysOnTop: section.alwaysOnTop,
        companionIntervalMinutes: section.companionIntervalMinutes,
        screenshotsEnabled: section.screenshotsEnabled,
        cubismCorePath: section.cubismCorePath,
        windowWidth: clampWindowWidth(section.windowWidth),
        windowHeight: clampWindowHeight(section.windowHeight),
        windowLocked: section.windowLocked,
        clickThrough: section.clickThrough !== false,
        rememberWindowPosition: section.rememberWindowPosition === true,
        // The remembered position only reaches the runtime while memory is on; a
        // switched-off memory keeps the value on disk for the next time it is
        // switched on, but must not drive the window.
        windowPosition: section.rememberWindowPosition === true
            ? (validWindowPosition(section.windowPosition) ?? null)
            : null,
        modelId: section.modelId && modelExists(section.modelId)
            ? section.modelId
            : before.modelId,
        persona: normalizePersonaConfig(section.persona),
        llm: {
            baseUrl: section.llm.baseUrl,
            // An empty apiKey in the section is the redacted-secret placeholder, not
            // a request to clear it: only an explicit `unset` clears the field.
            apiKey: section.llm.apiKey || before.llm.apiKey,
            model: section.llm.model,
            visionModel: section.llm.visionModel,
            temperature: section.llm.temperature,
        },
        // 桌宠发声配置整体透传：启用开关、发声语种与 GSV 桥的端口/模型路径。
        voice: {
            enabled: section.voice?.enabled === true,
            lang: section.voice?.lang || 'ja',
            bridgePort: section.voice?.bridgePort || 9876,
            workspaceDir: section.voice?.workspaceDir || before.voice?.workspaceDir || '',
            pythonPath: section.voice?.pythonPath || before.voice?.pythonPath || '',
            modelsDir: section.voice?.modelsDir || before.voice?.modelsDir || '',
            tempDir: section.voice?.tempDir || before.voice?.tempDir || '',
            gptModel: section.voice?.gptModel || before.voice?.gptModel || '',
            sovitsModel: section.voice?.sovitsModel || before.voice?.sovitsModel || '',
            spkAudio: section.voice?.spkAudio || before.voice?.spkAudio || '',
            promptAudio: section.voice?.promptAudio || before.voice?.promptAudio || '',
            promptText: section.voice?.promptText || before.voice?.promptText || '',
            translateUrl: section.voice?.translateUrl || before.voice?.translateUrl || '',
            translateApiKey: section.voice?.translateApiKey || before.voice?.translateApiKey || '',
            translateModel: section.voice?.translateModel || before.voice?.translateModel || '',
        },
        // 任务节点语音：整体透传，缺省值由 schema 给。
        taskVoice: {
            enabled: section.taskVoice?.enabled !== false,
            onStart: section.taskVoice?.onStart === true,
            onConfirm: section.taskVoice?.onConfirm !== false,
            onDone: section.taskVoice?.onDone !== false,
            port: section.taskVoice?.port || before.taskVoice?.port || 9879,
        },
    };
}
/** Keep only well-formed `{ x, y }` positions; everything else reads as "absent". */
export function validWindowPosition(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const candidate = value;
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number')
        return undefined;
    return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
}
/** Defensively shape a stored persona collection: ids and prompts are strings, arrays are arrays. */
export function normalizePersonaConfig(value) {
    const source = typeof value === 'object' && value !== null ? value : { activeId: '', personas: [] };
    const personas = Array.isArray(source.personas) ? source.personas.filter(isPersona) : [];
    const activeId = typeof source.activeId === 'string' && personas.some(p => p.id === source.activeId)
        ? source.activeId
        : '';
    return { activeId, personas };
}
function isPersona(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return typeof candidate.id === 'string' && candidate.id !== ''
        && typeof candidate.name === 'string' && candidate.name !== ''
        && typeof candidate.systemPrompt === 'string';
}
/** Fields the v2 card carries at its top level and this plugin maps onto a persona. */
const V2_TEXT_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'creator_notes'];
/** Extension key dsh-cosplay records its own fields under, inside a v2 card. */
export const COSPLAY_EXTENSION_KEY = 'dshCosplay';
/** Extension key this plugin records its own fields under, inside a v2 card. */
export const DESKPET_EXTENSION_KEY = 'dsh-live2d-deskpet';
/**
 * Text fields folded into a system prompt, in the order they read best.
 *
 * `description`/`personality` come first because every card has them, then the
 * dsh-cosplay specifics (`style`/`rules`/`behavior`) and the scene/example
 * fields — so a card authored for cosplay keeps all of its characterisation
 * when it becomes a desktop-pet persona.
 */
const PROMPT_SOURCE_FIELDS = [
    'description', 'personality', 'style', 'rules', 'behavior', 'scenario', 'mes_example',
];
/** Read a plain object field, or undefined when absent/not a string. */
function textField(source, key) {
    const value = source[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
/** A nested plain object, or an empty one. */
function objectField(source, key) {
    const value = source[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
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
export function composeSystemPrompt(source) {
    const parts = [];
    const explicit = textField(source, 'system_prompt');
    if (explicit)
        parts.push(explicit);
    for (const field of PROMPT_SOURCE_FIELDS) {
        const value = textField(source, field);
        if (value === undefined)
            continue;
        if (parts.some(part => part.includes(value)))
            continue;
        parts.push(value);
    }
    return parts.join('\n');
}
/** Whether a value looks like a dsh-cosplay role entry. */
export function isCosplayRole(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const role = value;
    return typeof role.id === 'string' && role.id !== '' && typeof role.name === 'string' && role.name !== '';
}
/**
 * Map one dsh-cosplay role card onto this plugin's persona shape.
 *
 * The id is carried over unchanged, so re-importing the same role is detectable
 * instead of silently duplicating it (the section assigns a fresh id when one
 * already exists).
 */
export function personaFromCosplayRole(role) {
    if (!isCosplayRole(role))
        throw new Error('这不是一条 dsh-cosplay 角色卡。');
    const source = role;
    return {
        id: source.id,
        name: source.name.trim(),
        emoji: typeof source.emoji === 'string' ? source.emoji : '',
        systemPrompt: composeSystemPrompt(source),
        greeting: typeof source.first_mes === 'string' ? source.first_mes : '',
        description: textField(source, 'creator_notes') ?? textField(source, 'description') ?? '',
        tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === 'string') : [],
    };
}
/** Convert one persona into a SillyTavern v2 character card. */
export function toV2Card(persona) {
    const data = { name: persona.name };
    if (persona.systemPrompt)
        data.system_prompt = persona.systemPrompt;
    if (persona.greeting)
        data.first_mes = persona.greeting;
    if (persona.description)
        data.description = persona.description;
    if (persona.tags?.length)
        data.tags = [...persona.tags];
    // Two extension blocks: ours carries the persona verbatim (authoritative on
    // re-import, so a card exported here round-trips exactly), and a dsh-cosplay
    // block keeps the id/emoji where that plugin's importer looks for them.
    const shared = { id: persona.id, ...(persona.emoji ? { emoji: persona.emoji } : {}) };
    data.extensions = {
        [DESKPET_EXTENSION_KEY]: {
            ...shared,
            name: persona.name,
            systemPrompt: persona.systemPrompt,
            greeting: persona.greeting,
            description: persona.description,
            tags: [...(persona.tags ?? [])],
        },
        [COSPLAY_EXTENSION_KEY]: shared,
    };
    return { spec: 'chara_card_v2', spec_version: '2.0', data };
}
/**
 * Restore a persona from this plugin's own extension block.
 *
 * The block is written by {@link toV2Card} and holds the persona verbatim, so it
 * is authoritative: re-deriving the persona from the v2 text fields would fold
 * `description` into the prompt again on every export/import cycle and grow it
 * each time.
 * @returns the persona, or undefined when the block is absent or incomplete.
 */
function personaFromOwnExtension(block, fallbackName) {
    if (typeof block.id !== 'string' || block.id === '')
        return undefined;
    if (typeof block.systemPrompt !== 'string')
        return undefined;
    return {
        id: block.id,
        name: typeof block.name === 'string' && block.name.trim() ? block.name.trim() : fallbackName,
        emoji: typeof block.emoji === 'string' ? block.emoji : '',
        systemPrompt: block.systemPrompt,
        greeting: typeof block.greeting === 'string' ? block.greeting : '',
        description: typeof block.description === 'string' ? block.description : '',
        tags: Array.isArray(block.tags) ? block.tags.filter((tag) => typeof tag === 'string') : [],
    };
}
/**
 * Convert a SillyTavern v2 character card (or a bare v1 card with `name`)
 * into a persona. Throws when the card carries no usable name.
 *
 * Cards exported by dsh-cosplay are accepted as-is: their ids and emoji live
 * under `extensions.dshCosplay`, and their characterisation is spread over
 * `personality`/`style`/`rules`/`behavior` rather than `system_prompt`.
 */
export function fromV2Card(card) {
    const data = typeof card === 'object' && card !== null
        ? (card.data ?? card)
        : {};
    if (typeof data !== 'object' || data === null)
        throw new Error('导入的角色卡不是有效的 JSON 对象。');
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name)
        throw new Error('导入的角色卡缺少 name 字段。');
    const extensions = objectField(data, 'extensions');
    const cosplay = objectField(extensions, COSPLAY_EXTENSION_KEY);
    const own = objectField(extensions, DESKPET_EXTENSION_KEY);
    // A card this plugin exported restores exactly.
    const restored = personaFromOwnExtension(own, name);
    if (restored !== undefined)
        return restored;
    // An older export carried only `{ id, emoji }`. Its identity is still
    // authoritative — deriving a fresh id would turn every re-import into a
    // duplicate — so take the identity from our block and the text from the card.
    const identity = typeof own.id === 'string' && own.id !== '' ? own : cosplay;
    // dsh-cosplay keeps `style`/`rules`/`behavior` INSIDE its extension block, so
    // the prompt has to be composed from the top level and that block together —
    // reading only the top level silently dropped the characterisation a cosplay
    // card is largely made of. Top-level fields win where both define one.
    const persona = {
        id: typeof identity.id === 'string' && identity.id ? identity.id : newPersonaId(),
        name,
        systemPrompt: composeSystemPrompt({ ...cosplay, ...data }),
        emoji: typeof identity.emoji === 'string' ? identity.emoji : '',
        greeting: typeof data.first_mes === 'string' ? data.first_mes : '',
        description: textField(data, 'creator_notes') ?? textField(data, 'description') ?? '',
        tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string') : [],
    };
    return persona;
}
/** A fresh persona id, shared by every creation path. */
export function newPersonaId() {
    return `persona-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
/** Re-export for the v2 field list so tests can iterate the same mapping. */
export const V2_CARD_TEXT_FIELDS = V2_TEXT_FIELDS;
