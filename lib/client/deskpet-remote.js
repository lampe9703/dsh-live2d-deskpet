import { DESKPET_REMOTE_METHODS, deskpetRemoteParameters } from '../shared/deskpet-invocations.js';
/** Remote namespace the host registers through the Typert manifest. */
export const DESKPET_REMOTE_NAMESPACE = 'live2dDeskpet';
/** Settings namespace the durable preferences live in. */
export const DESKPET_SETTINGS_NAMESPACE = 'live2d-deskpet';
const passthroughSchema = { parse: (value) => value };
const strictCodec = (typeSymbol) => ({ mode: 'strict', typeSymbol, schema: passthroughSchema });
/**
 * Invocation table mirroring the host manifest. The parameter table itself is
 * shared with the host ({@link DESKPET_REMOTE_PARAMETERS}) so the two can never
 * disagree about which fields are optional — a drift there is what made
 * "test connection" report a missing API key.
 */
export function deskpetInvocationDescriptors() {
    const invocation = (method, resultSymbol = 'DeskpetRuntimeResult') => ({
        id: `dsh-live2d-deskpet#${DESKPET_REMOTE_NAMESPACE}/${method}`,
        service: DESKPET_REMOTE_NAMESPACE,
        namespace: DESKPET_REMOTE_NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters: deskpetRemoteParameters(method).map(parameter => ({
            name: parameter.name,
            wire: parameter.name,
            source: 'json',
            codec: strictCodec(parameter.typeSymbol),
            // A missing wire field is only allowed where the host declares `T | undefined`.
            ...(parameter.optional === true ? { acceptsUndefined: true } : {}),
        })),
        result: strictCodec(resultSymbol),
    });
    return DESKPET_REMOTE_METHODS.map(method => invocation(method));
}
/** The mount payload `ctx.remote.$mount` consumes. */
export const DESKPET_REMOTE = {
    package: 'dsh-live2d-deskpet',
    descriptors: deskpetInvocationDescriptors(),
};
