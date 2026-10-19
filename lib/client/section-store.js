import { DESKPET_REMOTE_NAMESPACE, DESKPET_SETTINGS_NAMESPACE } from './deskpet-remote.js';
import { parseFieldPath } from '../shared/settings-path.js';
import { isCosplayRole, newPersonaId, personaFromCosplayRole } from '../shared/pet-section.js';
/** dsh-cosplay's settings namespace; read-only from here. */
export const COSPLAY_NAMESPACE = 'cosplay';
/**
 * Map a cosplay namespace value onto importable personas, skipping anything
 * malformed so one bad role cannot blank the whole list.
 */
export function cosplayRolesFrom(value) {
    const roles = value?.roles;
    if (!Array.isArray(roles))
        return [];
    const mapped = [];
    for (const role of roles) {
        if (!isCosplayRole(role))
            continue;
        try {
            mapped.push(personaFromCosplayRole(role));
        }
        catch {
            // A role that cannot be mapped is simply not offered.
        }
    }
    return mapped;
}
/**
 * Turn a host rejection into copy a user can act on. The raw code is kept so a
 * support request still names the exact failure.
 */
function describeSettingsFailure(error) {
    const suffix = `（${error.code}）`;
    if (error.code === 'settings/rejected' && error.message.includes('writer lock')) {
        return `设置写入被占用超时：另一个 DSH 进程持有 settings.yaml 的写锁。`
            + `关闭多余的 DSH 实例后重试；若该文件是上次异常退出留下的，删除 ${'settings.yaml.lock'} 即可。${suffix}`;
    }
    if (error.code === 'settings/conflict') {
        return `设置已被其它页面修改，请重试。${suffix}`;
    }
    return `设置写入失败：${error.message}${suffix}`;
}
const INITIAL = {
    status: 'loading',
    section: {},
    remote: undefined,
    cosplay: [],
    error: null,
    write: 'idle',
    message: null,
};
/** Minimal snapshot store: React 18's `useSyncExternalStore` needs a cached reference. */
function createSnapshotStore(initial) {
    let snapshot = initial;
    const listeners = new Set();
    return {
        getSnapshot: () => snapshot,
        set(next) {
            snapshot = next;
            for (const listener of [...listeners])
                listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}
/** The section's controller: one store, both data planes. */
export class DeskpetController {
    ctx;
    store = createSnapshotStore(INITIAL);
    remote;
    constructor(ctx) {
        this.ctx = ctx;
    }
    get scope() {
        return this.ctx.settingsScope.bind({ namespace: DESKPET_SETTINGS_NAMESPACE });
    }
    /** Bind the Remote namespace the host mounted; called once after `$mount`. */
    attachRemote(api) {
        this.remote = api;
    }
    set(patch) {
        this.store.set({ ...this.store.getSnapshot(), ...patch });
    }
    /**
     * Subscribe to the settings namespace, then read the Remote state once.
     * A namespace the client cannot see settles the store as `unavailable` and
     * the section renders its own unavailable copy.
     */
    load() {
        const scope = this.scope;
        const read = () => {
            const snapshot = scope.getSnapshot();
            if (snapshot.status === 'unavailable') {
                this.set({ status: 'unavailable', error: null });
                return;
            }
            this.set({
                status: snapshot.status === 'ready' ? 'ready' : 'loading',
                section: (snapshot.value ?? {}),
            });
        };
        const dispose = scope.subscribe(read);
        read();
        const disposeCosplay = this.observeCosplay();
        void this.refreshRemote();
        return () => { dispose(); disposeCosplay(); };
    }
    /**
     * Mirror dsh-cosplay's role library, when that plugin is installed.
     *
     * Reusing its namespace keeps one role library for both plugins: a card a user
     * already wrote for cosplay is offered here directly, with no export/import
     * round trip. This only ever READS the namespace — cosplay owns its document.
     */
    observeCosplay() {
        const scope = this.cosplayScope();
        if (scope === undefined)
            return () => { };
        const read = () => { this.set({ cosplay: cosplayRolesFrom(scope.getSnapshot().value) }); };
        const dispose = scope.subscribe(read);
        read();
        return dispose;
    }
    /** Bind the cosplay namespace, tolerating a build that has no such plugin. */
    cosplayScope() {
        try {
            return this.ctx.settingsScope.bind({ namespace: COSPLAY_NAMESPACE });
        }
        catch {
            return undefined;
        }
    }
    /** Re-read the Remote half (models, runtime facts). */
    async refreshRemote() {
        const api = this.remote;
        if (!api) {
            this.set({ remote: undefined, error: '桌宠 Remote 通道未挂载。' });
            return;
        }
        try {
            const response = await api.getState();
            if (!response.ok || !response.value) {
                this.set({ error: response.error?.message ?? '读取桌宠运行态失败。' });
                return;
            }
            this.set({ remote: response.value, status: 'ready', error: null });
        }
        catch (error) {
            this.set({ error: error.message });
        }
    }
    /** Write one durable field, reporting the outcome beside the control. */
    async write(field, value) {
        return this.commit([{ op: 'set', path: parseFieldPath(field), value }]);
    }
    /** Clear one durable field so it re-inherits the composition default. */
    async clear(field) {
        return this.commit([{ op: 'unset', path: parseFieldPath(field) }]);
    }
    /** Atomically write several durable fields (persona edits, window geometry). */
    async mutate(ops) {
        return this.commit(ops.map(op => (op.op === 'unset'
            ? { op: 'unset', path: parseFieldPath(op.path) }
            : { op: 'set', path: parseFieldPath(op.path), value: op.value })));
    }
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
    async commit(ops) {
        this.set({ write: 'saving', message: null });
        if (ops.length === 0)
            return { ok: true };
        const transport = this.writeTransport();
        if (!transport) {
            // The namespace's own transport is the reporting path; when this build of
            // the harness does not expose it, fall back to the scope (which cannot
            // report a refusal) rather than refusing to write at all.
            return this.commitViaScope(ops);
        }
        try {
            // Three arguments, always: the harness declares `(ns, ops,
            // expectedRevision)` and its client proxy rejects a shorter call outright.
            // `undefined` writes unconditionally — the proxy omits undefined fields —
            // which is what this panel wants, since the deskpet host bumps the
            // namespace revision on every window resize/move.
            const response = await transport.mutate(DESKPET_SETTINGS_NAMESPACE, ops, undefined);
            if (!response.ok) {
                const message = describeSettingsFailure(response.error);
                this.set({ write: 'failed', message });
                return { ok: false, message };
            }
            // Fold the host's fresh view in so every surface re-reads one document.
            this.mirror()?.acceptView(response.value);
            this.set({ write: 'saved', message: null });
            void this.refreshRemote();
            return { ok: true };
        }
        catch (error) {
            const message = error.message;
            this.set({ write: 'failed', message });
            return { ok: false, message };
        }
    }
    /** Degraded write path: no error detail, but the same path-addressed ops. */
    async commitViaScope(ops) {
        try {
            await this.scope.mutate(ops.map(op => (op.op === 'unset'
                ? { op: 'unset', path: [...op.path] }
                : { op: 'set', path: [...op.path], value: op.value })));
            this.set({ write: 'saved', message: null });
            void this.refreshRemote();
            return { ok: true };
        }
        catch (error) {
            const message = error.message;
            this.set({ write: 'failed', message });
            return { ok: false, message };
        }
    }
    /**
     * The host transport for this namespace, structurally typed to avoid a value
     * import. Reading it is defensive on purpose: Cordis throws
     * `cannot get property "remote.settings" without inject` when the namespace
     * key is not declared, and that throw used to escape the caller before any
     * write was attempted — every control in the panel died on click. A missing
     * transport now degrades to the scope path instead of breaking the section.
     */
    writeTransport() {
        try {
            const remote = this.ctx.remote;
            return remote?.settings;
        }
        catch {
            return undefined;
        }
    }
    /** The shared describe mirror, when the settings provider mounted one. */
    mirror() {
        try {
            const binder = this.ctx.settingsScope;
            const describe = binder.describe;
            return describe === undefined ? undefined : describe.call(binder);
        }
        catch {
            return undefined;
        }
    }
    /** Import a model folder through the host's native picker. */
    async importModel() {
        const api = this.remote;
        if (!api)
            return '桌宠 Remote 通道未挂载。';
        try {
            const response = await api.importModel();
            if (!response.ok || !response.value)
                return response.error?.message ?? '导入失败。';
            if (response.value.cancelled)
                return null;
            if (response.value.error)
                return response.value.error;
            await this.refreshRemote();
            return null;
        }
        catch (error) {
            return error.message;
        }
    }
    /** Delete one model folder through the host. */
    async removeModel(id) {
        const api = this.remote;
        if (!api)
            return '桌宠 Remote 通道未挂载。';
        try {
            const response = await api.removeModel(id);
            if (!response.ok || !response.value)
                return response.error?.message ?? '删除失败。';
            await this.refreshRemote();
            return response.value.error ?? null;
        }
        catch (error) {
            return error.message;
        }
    }
    /** Probe the companion endpoint through the host (host-side fetch, no CORS). */
    async testLlm(baseUrl, apiKey, model) {
        const api = this.remote;
        if (!api)
            return { ok: false, message: '桌宠 Remote 通道未挂载。', models: [] };
        try {
            const response = await api.testLlm(baseUrl, apiKey || undefined, model || undefined);
            if (!response.ok || !response.value)
                return { ok: false, message: response.error?.message ?? '测试失败。', models: [] };
            return response.value;
        }
        catch (error) {
            return { ok: false, message: error.message, models: [] };
        }
    }
    /** Reveal the model folder in the OS file manager. */
    async openModelsFolder() {
        const api = this.remote;
        if (!api)
            return '桌宠 Remote 通道未挂载。';
        try {
            const response = await api.openModelsFolder();
            return response.value?.error ?? null;
        }
        catch (error) {
            return error.message;
        }
    }
    /** 0.1.7：一键清空陪伴记忆（宿主侧原子清空 turns.jsonl），成功后刷新运行态。 */
    async clearCompanionMemory() {
        const api = this.remote;
        if (!api)
            return '桌宠 Remote 通道未挂载。';
        try {
            const response = await api.clearCompanionMemory();
            if (!response.ok)
                return response.error?.message ?? '清空失败。';
            await this.refreshRemote();
            return response.value?.error ?? null;
        }
        catch (error) {
            return error.message;
        }
    }
    /** The personas list, defended against a section that carries none yet. */
    personas() {
        const list = this.store.getSnapshot().section.persona?.personas;
        return Array.isArray(list) ? list : [];
    }
    /**
     * Append one persona and activate it if nothing is active yet.
     *
     * Both import paths (a v2 card file and a role taken from dsh-cosplay) land
     * here, so "an id that already exists gets a fresh one" is decided once and
     * cannot drift between them.
     */
    async addPersona(persona) {
        const existing = this.personas();
        const duplicate = existing.some(candidate => candidate.id === persona.id);
        const added = { ...persona, id: duplicate ? newPersonaId() : persona.id };
        const next = [...existing, added];
        const activeId = String(this.store.getSnapshot().section.persona?.activeId ?? '');
        return this.mutate([
            { op: 'set', path: ['persona', 'personas'], value: next },
            { op: 'set', path: ['persona', 'activeId'], value: activeId || added.id },
        ]);
    }
    /** Name shown for the Remote namespace, for diagnostics copy. */
    get remoteNamespace() { return DESKPET_REMOTE_NAMESPACE; }
}
export { DESKPET_SETTINGS_NAMESPACE };
