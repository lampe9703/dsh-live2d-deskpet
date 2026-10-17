/**
 * Section controller: the settings-namespace snapshot (durable preferences)
 * plus the Remote namespace (models, runtime facts, one-shot actions).
 *
 * The settings half reads and writes through `ctx.settingsScope`, which routes
 * every mutation over the host's `settings` Remote namespace with a revision
 * fence; the action half goes through the plugin's own Remote namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { DESKPET_SETTINGS_NAMESPACE } from './deskpet-remote.js';
import type { DeskpetRemoteApi, DeskpetRemoteState } from './deskpet-remote.js';
import type { PetConfig, Persona } from '../shared/types.js';
/** dsh-cosplay's settings namespace; read-only from here. */
export declare const COSPLAY_NAMESPACE = "cosplay";
/**
 * Map a cosplay namespace value onto importable personas, skipping anything
 * malformed so one bad role cannot blank the whole list.
 */
export declare function cosplayRolesFrom(value: unknown): Persona[];
/** Durable preferences the settings namespace carries. */
export type DeskpetSection = Partial<PetConfig> & {
    windowLocked?: boolean;
    windowPosition?: {
        x: number;
        y: number;
    } | null;
};
/** Where a field write currently stands, for the surface's inline feedback. */
export type WriteStatus = 'idle' | 'saving' | 'saved' | 'failed';
/** Outcome of one write, so callers never have to assume it succeeded. */
export interface WriteResult {
    ok: boolean;
    /** Explanation when `ok` is false; safe to show beside the control. */
    message?: string;
}
/** One path-addressed namespace edit, as the host transport takes it. */
export interface SettingsPathOp {
    op: 'set' | 'unset';
    path: readonly string[];
    value?: unknown;
}
/** The host `settings` Remote namespace, structurally typed. */
export interface SettingsWriteTransport {
    /**
     * `expectedRevision` is REQUIRED here even though the write sends it as
     * absent. The harness declares three parameters for this endpoint and its
     * client proxy enforces the count before any wire call —
     * `client api: settings/mutate expected 3 argument(s), got 2` — so omitting it
     * fails at runtime, which is exactly what broke every control and the persona
     * import. Keeping the parameter required makes the compiler catch a
     * two-argument call instead.
     *
     * Passing `undefined` is the supported way to write unconditionally: the
     * generated client codec for this field is
     * `z.union([z.undefined(), z.number()])`
     * (`packages/api/settings-controller/lib/typert.remote-client.js`), and the
     * proxy omits `undefined` fields when it assembles the wire args.
     */
    mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision: number | undefined): Promise<SettingsWriteResponse>;
}
/** Envelope the host answers a settings write with. */
export type SettingsWriteResponse = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/** One snapshot the section renders from. */
export interface DeskpetSnapshot {
    /** `loading` until the namespace reports, `unavailable` when it never will. */
    status: 'loading' | 'ready' | 'unavailable';
    /** Durable preferences from the settings namespace. */
    section: DeskpetSection;
    /** Models and runtime facts from the Remote namespace. */
    remote: DeskpetRemoteState | undefined;
    /** Personas offered by dsh-cosplay, ready to import; empty when absent. */
    cosplay: Persona[];
    /** Message explaining an `unavailable` status. */
    error: string | null;
    /** Inline feedback for the most recent write. */
    write: WriteStatus;
    /** Message shown beside the write status. */
    message: string | null;
}
/** The section's controller: one store, both data planes. */
export declare class DeskpetController {
    private readonly ctx;
    readonly store: {
        getSnapshot: () => DeskpetSnapshot;
        set(next: DeskpetSnapshot): void;
        subscribe(listener: () => void): () => void;
    };
    private remote;
    constructor(ctx: ClientContext);
    private get scope();
    /** Bind the Remote namespace the host mounted; called once after `$mount`. */
    attachRemote(api: DeskpetRemoteApi): void;
    private set;
    /**
     * Subscribe to the settings namespace, then read the Remote state once.
     * A namespace the client cannot see settles the store as `unavailable` and
     * the section renders its own unavailable copy.
     */
    load(): () => void;
    /**
     * Mirror dsh-cosplay's role library, when that plugin is installed.
     *
     * Reusing its namespace keeps one role library for both plugins: a card a user
     * already wrote for cosplay is offered here directly, with no export/import
     * round trip. This only ever READS the namespace — cosplay owns its document.
     */
    private observeCosplay;
    /** Bind the cosplay namespace, tolerating a build that has no such plugin. */
    private cosplayScope;
    /** Re-read the Remote half (models, runtime facts). */
    refreshRemote(): Promise<void>;
    /** Write one durable field, reporting the outcome beside the control. */
    write(field: string | readonly string[], value: unknown): Promise<WriteResult>;
    /** Clear one durable field so it re-inherits the composition default. */
    clear(field: string | readonly string[]): Promise<WriteResult>;
    /** Atomically write several durable fields (persona edits, window geometry). */
    mutate(ops: ReadonlyArray<{
        op: 'set' | 'unset';
        path: readonly string[];
        value?: unknown;
    }>): Promise<WriteResult>;
    /**
     * Send path ops to the host, then fold the answer into the shared mirror.
     *
     * This deliberately does NOT go through `SettingsScope.mutate`: that method
     * swallows every host rejection (`if (!response.ok) { await recover(); return }`),
     * so a refused write resolves as success and the surface reports "saved" for
     * an edit that never landed. Talking to the namespace's own transport returns
     * the error, and `acceptView` keeps the mirror — and so the panel — in step
     * without a second wire read.
     *
     * The write is sent WITHOUT a revision fence on purpose. The fence is what the
     * panel used to trip over: the deskpet host rewrites window geometry whenever
     * the window is resized or moved, which bumps the namespace revision, so a
     * click carrying the revision the panel last saw was rejected as a conflict
     * and silently dropped. `mutate` applies its ops to the section as stored at
     * the front of the host queue and only touches the named paths, so writing
     * unconditionally cannot lose a concurrent edit to a different field.
     */
    private commit;
    /** Degraded write path: no error detail, but the same path-addressed ops. */
    private commitViaScope;
    /**
     * The host transport for this namespace, structurally typed to avoid a value
     * import. Reading it is defensive on purpose: Cordis throws
     * `cannot get property "remote.settings" without inject` when the namespace
     * key is not declared, and that throw used to escape the caller before any
     * write was attempted — every control in the panel died on click. A missing
     * transport now degrades to the scope path instead of breaking the section.
     */
    private writeTransport;
    /** The shared describe mirror, when the settings provider mounted one. */
    private mirror;
    /** Import a model folder through the host's native picker. */
    importModel(): Promise<string | null>;
    /** Delete one model folder through the host. */
    removeModel(id: string): Promise<string | null>;
    /** Probe the companion endpoint through the host (host-side fetch, no CORS). */
    testLlm(baseUrl: string, apiKey: string, model: string): Promise<import("../shared/types.js").LlmProbeResult>;
    /** Reveal the model folder in the OS file manager. */
    openModelsFolder(): Promise<string | null>;
    /** The personas list, defended against a section that carries none yet. */
    personas(): Persona[];
    /**
     * Append one persona and activate it if nothing is active yet.
     *
     * Both import paths (a v2 card file and a role taken from dsh-cosplay) land
     * here, so "an id that already exists gets a fresh one" is decided once and
     * cannot drift between them.
     */
    addPersona(persona: Persona): Promise<WriteResult>;
    /** Name shown for the Remote namespace, for diagnostics copy. */
    get remoteNamespace(): string;
}
export { DESKPET_SETTINGS_NAMESPACE };
//# sourceMappingURL=section-store.d.ts.map