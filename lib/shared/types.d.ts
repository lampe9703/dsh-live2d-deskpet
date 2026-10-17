export type AgentState = 'idle' | 'think' | 'working' | 'celebrate' | 'error';
export type PetMode = 'auto' | 'task' | 'companion';
export type EffectivePetMode = Exclude<PetMode, 'auto'>;
export interface LlmConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    visionModel?: string;
    temperature: number;
}
/** One companion persona: the character the pet plays in companion mode. */
export interface Persona {
    id: string;
    name: string;
    emoji?: string;
    /** Main field: the system prompt that shapes the pet's personality. */
    systemPrompt: string;
    /** Spoken in a bubble once when this persona becomes active. */
    greeting?: string;
    /** Human-facing summary; never sent to the LLM. */
    description?: string;
    tags?: string[];
}
/** Persona collection as stored in the settings namespace. */
export interface PersonaConfig {
    /** Empty string = the built-in default persona. */
    activeId: string;
    personas: Persona[];
}
export interface WindowPosition {
    x: number;
    y: number;
}
export interface PetConfig {
    enabled: boolean;
    mode: PetMode;
    alwaysOnTop: boolean;
    modelId?: string;
    companionIntervalMinutes: number;
    screenshotsEnabled: boolean;
    cubismCorePath: string;
    windowWidth: number;
    windowHeight: number;
    windowLocked: boolean;
    /**
     * Whether clicks outside the model pass through to the window underneath.
     *
     * The pet is an always-on-top overlay, so without this it swallows every click
     * landing on its rectangle — including the transparent margin around the
     * character. With it on, only the model's own pixels take input.
     */
    clickThrough: boolean;
    /**
     * Whether the window's place on screen is remembered across restarts.
     *
     * Kept separate from {@link windowPosition} because the two answer different
     * questions: turning memory ON must not require inventing a position, and
     * `{ x: 0, y: 0 }` — the only value a fresh toggle could produce — would
     * teleport the pet into the screen corner on the next launch.
     */
    rememberWindowPosition: boolean;
    /** Absent/null = do not remember; `{ x, y }` = restore and keep updating. */
    windowPosition?: WindowPosition | null;
    persona: PersonaConfig;
    llm: LlmConfig;
}
/**
 * The settings-namespace section this plugin registers. It mirrors
 * {@link PetConfig}, so the web settings section and the Electron window read
 * one document: the section is the live value while a settings provider is
 * mounted, and the composition entry is the fallback when one is not.
 */
export interface PetSettingsSection extends Omit<PetConfig, 'modelId' | 'llm' | 'windowPosition'> {
    modelId: string;
    llm: Required<LlmConfig>;
    windowPosition?: WindowPosition | null;
}
export interface ModelInfo {
    id: string;
    name: string;
    modelPath: string;
    root: string;
    thumbnail?: string;
}
/** The browser-facing state snapshot served at `/api/live2d-deskpet/state`. */
export interface PetStateView {
    enabled: boolean;
    mode: PetMode;
    effectiveMode: EffectivePetMode;
    modelId: string;
    models: ModelInfo[];
    windowWidth: number;
    windowHeight: number;
    cubismCore: boolean;
}
/** One selectable model as the settings page renders it (no secrets, no host paths on the wire face). */
export interface ModelListView {
    id: string;
    name: string;
    modelPath: string;
    root: string;
    thumbnail?: string;
}
/** Live runtime facts only the host/Electron pair can observe. */
export interface RuntimeView {
    effectiveMode: EffectivePetMode;
    cubismCore: boolean;
    modelsRoot: string;
    dataDir: string;
    apiKeySet: boolean;
    windowPosition: WindowPosition | null;
}
/** Result envelope for `testLlm` on the Remote namespace. */
export interface LlmProbeResult {
    ok: boolean;
    message: string;
    models: string[];
}
/** Result envelope for `importModel` on the Remote namespace. */
export interface ImportModelResult {
    cancelled: boolean;
    model?: ModelListView;
    error?: string;
}
/** Result envelope for `removeModel` on the Remote namespace. */
export interface RemoveModelResult {
    error?: string;
}
export interface WireMessage {
    type: string;
    [key: string]: unknown;
}
//# sourceMappingURL=types.d.ts.map