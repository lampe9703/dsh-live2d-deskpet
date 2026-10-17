/**
 * The Remote invocation parameter table for the deskpet namespace, declared
 * once and consumed by BOTH the host manifest and the client mount.
 *
 * The two sides must agree field-for-field. The gateway validates an incoming
 * `args` object against the HOST table (`assertExactArguments`), and a wire field
 * may only be absent when its parameter is declared `acceptsUndefined`:
 *
 *     const acceptsMissing = new Set(descriptor.parameters
 *       .filter(parameter => parameter.source === 'json'
 *         && (parameter.acceptsUndefined === true || parameter.codec.mode === 'src-json'))
 *       .map(parameter => parameter.wire))
 *
 * Declaring the table in two places let it drift, and the drift was user-visible:
 * the host table marked `testLlm`'s optional `apiKey`/`model` as required, while
 * the panel legitimately omits them when the key field is left blank (the key
 * being already stored) — so "test connection" always failed with
 * `args fields do not match the descriptor: missing "apiKey"` even though the
 * pet was replying normally.
 *
 * Keep this module dependency-free: the client bundle imports it.
 */
/** One parameter of a deskpet Remote invocation. */
export interface DeskpetRemoteParameter {
    /** Source-level name, which is also the wire key. */
    readonly name: string;
    /** Boundary type symbol; descriptive only for this hand-written table. */
    readonly typeSymbol: string;
    /**
     * Whether the host method declares `T | undefined` for this position.
     *
     * This must mirror the host signature exactly. Marking an optional parameter
     * as required makes its absence a rejected call; marking a required one as
     * optional lets a missing argument reach the method as `undefined`.
     */
    readonly optional?: boolean;
}
/**
 * Parameters per Remote method, in declaration order.
 *
 * `testLlm(baseUrl: string, apiKey?: string, model?: string)` — the last two are
 * optional on purpose: leaving the key blank means "use the stored one", and
 * leaving the model blank means "report the whole list".
 */
export declare const DESKPET_REMOTE_PARAMETERS: Readonly<Record<string, readonly DeskpetRemoteParameter[]>>;
/** Every Remote method this namespace exports, in the order the table declares. */
export declare const DESKPET_REMOTE_METHODS: string[];
/** Parameters of one method, or an empty list for an unknown name. */
export declare function deskpetRemoteParameters(method: string): readonly DeskpetRemoteParameter[];
//# sourceMappingURL=deskpet-invocations.d.ts.map