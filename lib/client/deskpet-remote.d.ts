/**
 * Remote descriptors and the call wrapper for the settings page's action
 * channel. The settings NAMESPACE carries the durable JSON preferences; the
 * actions a namespace cannot express (picking a folder, deleting a model,
 * probing the LLM endpoint, opening the model folder) ride this namespace.
 *
 * The client mount requires strict codecs, so every descriptor declares one
 * with a passthrough schema (same shape dsh-cosplay uses).
 */
import type { ImportModelResult, LlmProbeResult, ModelListView, RemoveModelResult, RuntimeView } from '../shared/types.js';
/** Remote namespace the host registers through the Typert manifest. */
export declare const DESKPET_REMOTE_NAMESPACE = "live2dDeskpet";
/** Settings namespace the durable preferences live in. */
export declare const DESKPET_SETTINGS_NAMESPACE = "live2d-deskpet";
/** State the settings page reads in one call. */
export interface DeskpetRemoteState {
    config: Partial<{
        enabled: boolean;
        mode: 'auto' | 'task' | 'companion';
        alwaysOnTop: boolean;
        modelId: string;
        companionIntervalMinutes: number;
        screenshotsEnabled: boolean;
        cubismCorePath: string;
        windowWidth: number;
        windowHeight: number;
        windowLocked: boolean;
        windowPosition: {
            x: number;
            y: number;
        } | null;
        persona: {
            activeId: string;
            personas: unknown[];
        };
    }>;
    models: ModelListView[];
    runtime: RuntimeView;
}
/**
 * Invocation table mirroring the host manifest. The parameter table itself is
 * shared with the host ({@link DESKPET_REMOTE_PARAMETERS}) so the two can never
 * disagree about which fields are optional — a drift there is what made
 * "test connection" report a missing API key.
 */
export declare function deskpetInvocationDescriptors(): {
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
        kind: "direct";
    };
    parameters: {
        acceptsUndefined?: true | undefined;
        name: string;
        wire: string;
        source: "json";
        codec: {
            mode: string;
            typeSymbol: string;
            schema: {
                parse: (value: unknown) => unknown;
            };
        };
    }[];
    result: {
        mode: string;
        typeSymbol: string;
        schema: {
            parse: (value: unknown) => unknown;
        };
    };
}[];
/** The mount payload `ctx.remote.$mount` consumes. */
export declare const DESKPET_REMOTE: {
    package: string;
    descriptors: {
        id: string;
        service: string;
        namespace: string;
        method: string;
        invocation: {
            kind: "direct";
        };
        parameters: {
            acceptsUndefined?: true | undefined;
            name: string;
            wire: string;
            source: "json";
            codec: {
                mode: string;
                typeSymbol: string;
                schema: {
                    parse: (value: unknown) => unknown;
                };
            };
        }[];
        result: {
            mode: string;
            typeSymbol: string;
            schema: {
                parse: (value: unknown) => unknown;
            };
        };
    }[];
};
/** The Remote namespace's callable surface, as the client reflects it. */
export interface DeskpetRemoteApi {
    getState(): Promise<{
        ok: boolean;
        value?: DeskpetRemoteState;
        error?: {
            message?: string;
        };
    }>;
    importModel(): Promise<{
        ok: boolean;
        value?: ImportModelResult;
        error?: {
            message?: string;
        };
    }>;
    removeModel(id: string): Promise<{
        ok: boolean;
        value?: RemoveModelResult;
        error?: {
            message?: string;
        };
    }>;
    testLlm(baseUrl: string, apiKey?: string, model?: string): Promise<{
        ok: boolean;
        value?: LlmProbeResult;
        error?: {
            message?: string;
        };
    }>;
    openModelsFolder(): Promise<{
        ok: boolean;
        value?: {
            error?: string;
        };
        error?: {
            message?: string;
        };
    }>;
}
//# sourceMappingURL=deskpet-remote.d.ts.map