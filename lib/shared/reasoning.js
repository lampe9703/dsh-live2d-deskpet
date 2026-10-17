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
/** Tag pairs models wrap private reasoning in, longest first per pair. */
const REASONING_TAGS = [
    { open: '<thinking>', close: '</thinking>' },
    { open: '<think>', close: '</think>' },
    { open: '<reasoning>', close: '</reasoning>' },
    { open: '<thought>', close: '</thought>' },
    { open: '<|begin_of_thought|>', close: '<|end_of_thought|>' },
    { open: '◁think▷', close: '◁/think▷' },
    { open: ' thinking', close: ' response' },
];
const OPEN_TAGS = REASONING_TAGS.map(pair => pair.open);
const CLOSE_TAGS = REASONING_TAGS.map(pair => pair.close);
const LONGEST_TAG = Math.max(...OPEN_TAGS.map(tag => tag.length), ...CLOSE_TAGS.map(tag => tag.length));
/**
 * How many characters at the end of `text` could still be the beginning of one
 * of `tags`.
 *
 * Only a real partial tag is held back, so ordinary text streams through without
 * a fixed lookahead delay.
 */
function partialTagLength(text, tags) {
    const limit = Math.min(text.length, LONGEST_TAG - 1);
    for (let length = limit; length > 0; length--) {
        const tail = text.slice(text.length - length);
        if (tags.some(tag => tag.startsWith(tail)))
            return length;
    }
    return 0;
}
/** The earliest index of any tag in `text`, with the tag that matched. */
function findEarliestTag(text, tags) {
    let best;
    for (const tag of tags) {
        const index = text.indexOf(tag);
        if (index === -1)
            continue;
        if (best === undefined || index < best.index)
            best = { index, tag };
    }
    return best;
}
const EMPTY_SPLIT = { visible: '', reasoning: '' };
/**
 * One streaming pass of reasoning separation.
 *
 * Create one per response, `push` every content delta, then `flush` at the end
 * of the stream. An unterminated reasoning block is treated as reasoning
 * throughout: a model that ran out of tokens mid-thought never said anything
 * visible, and speaking half a thought is worse than saying nothing.
 */
export class ReasoningFilter {
    #pending = '';
    #reasoning = '';
    /**
     * The closer of the block currently open, or undefined when outside one.
     *
     * This has to live on the instance: a chunk can end inside a block, and
     * without remembering that, the next `push` would look only for an OPENING tag,
     * decide the held-back text is ordinary speech, and leak the reasoning into the
     * bubble.
     */
    #closing;
    /**
     * Feed one content delta.
     * @param delta - the raw chunk of assistant content.
     * @returns the visible text this delta completed.
     */
    push(delta) {
        if (delta === '')
            return '';
        this.#pending += delta;
        let visible = '';
        for (;;) {
            if (this.#closing !== undefined) {
                const close = this.#pending.indexOf(this.#closing);
                if (close === -1) {
                    // Still inside the block: keep the remainder, holding back only a
                    // possible partial closer.
                    const hold = partialTagLength(this.#pending, [this.#closing]);
                    this.#reasoning += this.#pending.slice(0, this.#pending.length - hold);
                    this.#pending = this.#pending.slice(this.#pending.length - hold);
                    return visible;
                }
                this.#reasoning += this.#pending.slice(0, close);
                this.#pending = this.#pending.slice(close + this.#closing.length);
                this.#closing = undefined;
                continue;
            }
            const open = findEarliestTag(this.#pending, OPEN_TAGS);
            if (open === undefined) {
                const hold = partialTagLength(this.#pending, OPEN_TAGS);
                visible += this.#pending.slice(0, this.#pending.length - hold);
                this.#pending = this.#pending.slice(this.#pending.length - hold);
                return visible;
            }
            // Everything before the tag is the model talking to the user.
            visible += this.#pending.slice(0, open.index);
            this.#pending = this.#pending.slice(open.index + open.tag.length);
            const pair = REASONING_TAGS.find(candidate => candidate.open === open.tag);
            this.#closing = pair.close;
        }
    }
    /**
     * Finish the stream, releasing any held-back text.
     * @returns the trailing visible text.
     */
    flush() {
        // A block still open at the end was reasoning throughout: a model that ran
        // out of tokens mid-thought never said anything visible.
        if (this.#closing !== undefined) {
            this.#reasoning += this.#pending;
            this.#pending = '';
            this.#closing = undefined;
            return '';
        }
        const visible = this.#pending;
        this.#pending = '';
        return visible;
    }
    /** Everything withheld so far, for logging. */
    reasoning() {
        return this.#reasoning;
    }
}
/**
 * Non-streaming equivalent of {@link ReasoningFilter}: strip reasoning from a
 * finished string. Kept alongside the streaming filter so both share one notion
 * of what a reasoning tag is.
 */
export function stripReasoning(text) {
    const filter = new ReasoningFilter();
    const head = filter.push(text);
    const tail = filter.flush();
    return { visible: `${head}${tail}`.trim(), reasoning: filter.reasoning().trim() };
}
