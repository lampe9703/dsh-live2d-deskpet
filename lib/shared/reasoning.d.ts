/**
 * Separating a model's private reasoning from what it actually says.
 *
 * The companion bubble should show the reply, not the working-out. Reasoning
 * reaches a client in two shapes and both have to be handled without disabling
 * thinking itself:
 *
 *   1. a separate `reasoning_content` (or `reasoning`) delta field — DeepSeek,
 *      LM Studio and others stream it alongside `content`;
 *   2. inline in `content`, wrapped in a tag pair — Qwen3 and many abliterated
 *      builds emit ` thinking… response` as ordinary text.
 *
 * Shape 2 has to be filtered DURING streaming, because a tag arrives split
 * across chunks (`"<thi"` then `"nk>"`). A naive `replace(/ thinking[\s\S]*?<\/think>/g, '')`
 * on the finished string works, but letting the raw tokens through first means
 * the bubble has already spoken the reasoning.
 *
 * The filter is pure and streaming: feed it deltas, get back the visible text it
 * completed. Reasoning is returned separately so a caller can log it rather than
 * discard it silently.
 */
/** Text that has been separated into what is spoken and what is withheld. */
export interface ReasoningSplit {
    /** Text the model addressed to the user. */
    visible: string;
    /** Text the model produced for itself. */
    reasoning: string;
}
/**
 * One streaming pass of reasoning separation.
 *
 * Create one per response, `push` every content delta, then `flush` at the end
 * of the stream. An unterminated reasoning block is treated as reasoning
 * throughout: a model that ran out of tokens mid-thought never said anything
 * visible, and speaking half a thought is worse than saying nothing.
 */
export declare class ReasoningFilter {
    #private;
    /**
     * Feed one content delta.
     * @param delta - the raw chunk of assistant content.
     * @returns the visible text this delta completed.
     */
    push(delta: string): string;
    /**
     * Finish the stream, releasing any held-back text.
     * @returns the trailing visible text.
     */
    flush(): string;
    /** Everything withheld so far, for logging. */
    reasoning(): string;
}
/**
 * Non-streaming equivalent of {@link ReasoningFilter}: strip reasoning from a
 * finished string. Kept alongside the streaming filter so both share one notion
 * of what a reasoning tag is.
 */
export declare function stripReasoning(text: string): ReasoningSplit;
//# sourceMappingURL=reasoning.d.ts.map