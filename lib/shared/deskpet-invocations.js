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
/**
 * Parameters per Remote method, in declaration order.
 *
 * `testLlm(baseUrl: string, apiKey?: string, model?: string)` — the last two are
 * optional on purpose: leaving the key blank means "use the stored one", and
 * leaving the model blank means "report the whole list".
 */
export const DESKPET_REMOTE_PARAMETERS = {
    getState: [],
    setConfig: [{ name: 'patch', typeSymbol: 'DeskpetConfigPatch' }],
    importModel: [],
    removeModel: [{ name: 'id', typeSymbol: 'ModelId' }],
    testLlm: [
        { name: 'baseUrl', typeSymbol: 'BaseUrl' },
        { name: 'apiKey', typeSymbol: 'ApiKey', optional: true },
        { name: 'model', typeSymbol: 'ModelName', optional: true },
    ],
    openModelsFolder: [],
};
/** Every Remote method this namespace exports, in the order the table declares. */
export const DESKPET_REMOTE_METHODS = Object.keys(DESKPET_REMOTE_PARAMETERS);
/** Parameters of one method, or an empty list for an unknown name. */
export function deskpetRemoteParameters(method) {
    return DESKPET_REMOTE_PARAMETERS[method] ?? [];
}
