/**
 * Splitting a reply into bubble-sized pieces.
 *
 * The bubble floats over the character, so a long reply covers the model it
 * belongs to. The bounds below are the whole policy:
 *
 *   - every bubble holds {@link BUBBLE_MIN_CHARS}–{@link BUBBLE_MAX_CHARS}
 *     characters, and
 *   - one whole reply speaks at most {@link REPLY_MAX_CHARS} characters,
 *
 * This is the deterministic half of the "speak in short sentences" behaviour.
 * A prompt can ask the model to write short sentences, but a prompt cannot
 * guarantee it — a model that returns 400 characters in one breath still has to
 * be broken up before it reaches the bubble. The other half is
 * `COMPANION_SPEECH_STYLE`, which is built from these same constants so the
 * prompt and the code can never quote different numbers.
 */
/** Shortest piece a bubble should show, in characters. */
export declare const BUBBLE_MIN_CHARS = 20;
/** Longest piece of text one bubble shows, in characters. */
export declare const BUBBLE_MAX_CHARS = 40;
/**
 * Shortest reply asked of the model, in characters.
 *
 * Prompt-level only: code can cut text down but cannot put words back, so this
 * bound is stated in the system prompt rather than enforced here.
 */
export declare const REPLY_MIN_CHARS = 30;
/**
 * Longest reply spoken across all of one reply's bubbles, in characters.
 *
 * The model is asked for {@link REPLY_MIN_CHARS}–{@link REPLY_MAX_CHARS}, but a
 * model that ignores the request must still not be able to cover the character:
 * speech past this budget is dropped, cut back to the last boundary inside it
 * so the last bubble does not end mid-clause.
 */
export declare const REPLY_MAX_CHARS = 60;
/**
 * How long one bubble stays on screen before the next piece replaces it, at
 * minimum, in milliseconds.
 *
 * The pieces of a reply arrive as fast as the model streams them — often all of
 * one reply inside a second. Showing each on arrival made the bubble flash
 * through the whole line before it could be read, so the window plays them out
 * on a timer instead, starting from this hold.
 */
export declare const BUBBLE_HOLD_MS = 4000;
/**
 * Extra hold per character, so a full 40-character bubble is readable inside
 * the same pace as a short one.
 *
 * At 40 ms/character a 20-character bubble holds for 4.8 s and a 40-character
 * one for 5.6 s. Set this to 0 for a flat {@link BUBBLE_HOLD_MS} per bubble.
 */
export declare const BUBBLE_CHAR_MS = 40;
/**
 * How long one bubble stays on screen.
 *
 * Used by the Electron window's speech backlog; kept here so every bubble
 * timing and size rule sits in one file.
 * @param piece - the text about to be displayed.
 * @returns the hold in milliseconds, never below {@link BUBBLE_HOLD_MS}.
 */
export declare function bubbleHoldMs(piece: string): number;
/** One piece to speak, plus whatever is left to speak later. */
export interface BubbleChunk {
    /** Text to hand to the bubble, trimmed. */
    chunk: string;
    /** Text that did not fit and should stay pending. */
    rest: string;
}
/**
 * Take the next piece to speak off the head of the pending text.
 *
 * Boundaries before {@link BUBBLE_MIN_CHARS} are deliberately skipped, so two
 * short sentences end up in one bubble rather than two clipped ones. That also
 * means the callback is not called for text that is merely short: a caller
 * cannot show "好的。" and then merge it into the next line afterwards.
 *
 * The only piece that may come back under the minimum is the last one, when the
 * model's whole reply is shorter than {@link BUBBLE_MIN_CHARS} or its final
 * sentence is — {@link SpeechQueue} folds a short tail into the piece before it
 * wherever the two fit one bubble between them.
 * @param pending - text received but not yet spoken.
 * @param final - whether the stream has ended, which flushes a short remainder.
 * @returns the next piece and the remainder, or undefined when nothing is ready.
 */
export declare function takeBubbleChunk(pending: string, final?: boolean): BubbleChunk | undefined;
/**
 * Cut `text` down to `limit` characters for the reply-wide budget.
 *
 * Prefers a boundary in the second half of the retained head, so a capped reply
 * ends at a comma or full stop instead of mid-clause. Returns at most `limit`
 * characters, so the caller's running total stays within budget.
 * @param text - the piece that would exceed the budget.
 * @param limit - characters still allowed.
 */
export declare function trimToBudget(text: string, limit: number): string;
/**
 * Turns pieces into what the bubble actually shows, with two corrections the
 * splitting step cannot make on its own.
 *
 * 1. **A short piece is held back one step.** When the next piece is also short
 *    the two merge, so a reply ending in "需要我帮忙吗？" becomes one bubble
 *    instead of a normal one followed by a seven-character stub. The cost is
 *    that the first bubble waits for the second piece to arrive.
 * 2. **The reply-wide budget is spent here.** Once
 *    {@link REPLY_MAX_CHARS} characters have been spoken the rest is dropped.
 *
 * Both live here rather than in the streaming client so they are testable
 * without a socket.
 */
export declare class SpeechQueue {
    #private;
    /**
     * Offer one piece.
     * @param piece - a piece from {@link takeBubbleChunk}.
     * @returns the pieces to display now, in order.
     */
    push(piece: string): string[];
    /**
     * Finish the reply.
     * @returns every remaining piece, including the one held back for merging.
     */
    flush(): string[];
}
/**
 * Split a complete string into bubble pieces, ignoring
 * {@link REPLY_MAX_CHARS}.
 *
 * For callers that already hold the whole text (tests, tooling). The streaming
 * path uses {@link SpeechQueue} instead, which both merges a short tail and
 * honours the reply budget.
 * @param text - the whole reply.
 * @returns one entry per bubble, in order.
 */
export declare function splitForBubble(text: string): string[];
//# sourceMappingURL=bubble-speech.d.ts.map