import { ModelRegistry } from '../core/ModelRegistry.js';
import type { AgentState, EffectivePetMode, ModelInfo, PetConfig, PetSettingsSection, RuntimeView, WindowPosition } from '../shared/types.js';
/**
 * Callbacks the host plugin supplies, mirroring user-driven window geometry
 * into the settings document (the single source of truth).
 */
export interface DesktopPetHostHooks {
    /** Report a window size the user dragged inside the pet window. */
    onWindowResize?(size: {
        width: number;
        height: number;
    }): void;
    /** Report the window's settled position (fired on every move that settles). */
    onWindowMove?(position: WindowPosition): void;
    /** Report the mode `auto` currently resolves to, as the Electron probe observes it. */
    onEffectiveMode?(mode: EffectivePetMode): void;
    /** Report a model picked from the pet window's context menu. */
    onModelSelect?(modelId: string): void;
    /** Report a mode picked from the pet window's context menu. */
    onModeSelect?(mode: 'auto' | 'task' | 'companion'): void;
}
/**
 * Owns the desktop pet's transport: one loopback HTTP origin that serves the renderer bundle and
 * the model files, plus a WebSocket carrying Harness state to the Electron window.
 *
 * Model assets are served over HTTP rather than `file://` because the Cubism loader reads them
 * with `fetch`/XHR, which Chromium refuses for the file scheme.
 *
 * The host holds no persistent copy of the configuration: committed settings sections arrive
 * through {@link applySettings} and every user-driven window change is reported through the
 * hooks for the caller to write back into the settings document.
 */
export declare class DesktopPetHost {
    #private;
    private readonly log;
    private readonly hooks;
    readonly registry: ModelRegistry;
    constructor(config: PetConfig, log: Pick<Console, 'info' | 'warn' | 'error'>, hooks?: DesktopPetHostHooks);
    /** Runtime data directory (`~/.dsh/live2d-deskpet`), surfaced for the settings page. */
    get dataDir(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    setAgentState(state: AgentState): void;
    /** 页面自报焦点（0.2.3）：true / false，只在变化时下发给 Electron。 */
    setPageFocused(focused: boolean): void;
    /** 记下用户这一回合的请求（0.2.8），节点播报时作为任务上下文。 */
    noteUserPrompt(text: string): void;
    /**
     * Apply a committed settings section. Mode, selected model, window size, and
     * companion LLM fields reach the Electron window without a restart; a size
     * change additionally drives the window itself.
     */
    applySettings(section: PetSettingsSection): Promise<void>;
    /** Rescan the model folder and republish the snapshot (after import/remove). */
    refresh(): Promise<void>;
    /** Copy a model folder into the registry; the caller decides whether to select it. */
    importModel(folder: string): Promise<ModelInfo>;
    /** Delete one model folder; the caller decides whether to switch the selection. */
    removeModel(id: string): Promise<void>;
    /** Model list the web settings section and the state endpoint publish. */
    models(): readonly ModelInfo[];
    /** Current configuration, as the state endpoint reports it. */
    currentConfig(): PetConfig;
    /** The Cubism runtime is present, so the window can actually render a model. */
    hasCubismCore(): boolean;
    /** Live runtime facts for the settings page; only the host can observe them. */
    runtimeView(): RuntimeView;
    /** Push the configured window geometry to the Electron window (it owns the actual resize). */
    syncWindowSize(): void;
    /** A remembered selection survives a restart only while that model is still on disk. */
    private resolveModelId;
    private handleRequest;
    /** Rejects traversal and absolute segments so a model request can only reach the model folder. */
    private resolveModelPath;
    private sendFile;
    private sendCubismCore;
    private readCubismCore;
    private onConnection;
    private onMessage;
    /** Model URLs carry the loopback origin because the renderer cannot build them itself. */
    private modelUrl;
    private sendSnapshot;
    private send;
    private launchElectron;
}
//# sourceMappingURL=DesktopPetHost.d.ts.map