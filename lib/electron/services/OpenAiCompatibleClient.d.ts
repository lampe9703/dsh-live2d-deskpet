import type { LlmConfig } from '../../shared/types.js';
/**
 * Normalize an OpenAI-compatible base URL: trailing slashes dropped, `/v1`
 * appended when the caller omitted it, so both `http://host` and
 * `http://host/v1` address the same endpoint.
 */
export declare function normalizeLlmBaseUrl(baseUrl: string): string;
/** Callbacks one streamed completion reports through. */
export interface StreamSinks {
    /** Called per bubble-sized piece, in order, as the reply streams in. */
    onSpeech?: (piece: string) => void;
    /** Called once at the end with everything the model thought but did not say. */
    onReasoning?: (reasoning: string) => void;
}
export declare class OpenAiCompatibleClient {
    private readonly config;
    constructor(config: LlmConfig);
    /**
     * Stream one completion, reporting the reply a bubble at a time.
     *
     * Reasoning never reaches `onSpeech`: a `reasoning_content` delta is routed
     * straight to `onReasoning`, and any inline ` thinking… response` in `content` is
     * filtered out mid-stream by {@link ReasoningFilter}. Thinking stays enabled —
     * it is withheld from the bubble, not switched off.
     * @param prompt - the user turn (screen context and time).
     * @param image - optional screenshot sent as an `image_url` data URL.
     * @param sinks - speech and reasoning callbacks.
     * @param systemPrompt - persona prompt; falls back to the built-in companion text.
     * @returns the visible reply text, with reasoning removed.
     */
    stream(prompt: string, image?: Buffer, sinks?: StreamSinks, systemPrompt?: string): Promise<string>;
}
//# sourceMappingURL=OpenAiCompatibleClient.d.ts.map