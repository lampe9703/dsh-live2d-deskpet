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
export const BUBBLE_MIN_CHARS = 20;
/** Longest piece of text one bubble shows, in characters. */
export const BUBBLE_MAX_CHARS = 40;
/**
 * Shortest reply asked of the model, in characters.
 *
 * Prompt-level only: code can cut text down but cannot put words back, so this
 * bound is stated in the system prompt rather than enforced here.
 */
export const REPLY_MIN_CHARS = 30;
/**
 * Longest reply spoken across all of one reply's bubbles, in characters.
 *
 * The model is asked for {@link REPLY_MIN_CHARS}–{@link REPLY_MAX_CHARS}, but a
 * model that ignores the request must still not be able to cover the character:
 * speech past this budget is dropped, cut back to the last boundary inside it
 * so the last bubble does not end mid-clause.
 */
export const REPLY_MAX_CHARS = 60;
/**
 * How long one bubble stays on screen when there is **no audio** to follow, in
 * milliseconds.
 *
 * With a working voice bridge this value is never used: the audio clip is the
 * clock (see `AudioBubbleSync`). It only covers the degraded path — voice
 * switched off, or the bridge failed to synthesize — where the text still has
 * to be readable for a while. Nothing here limits a bubble that has audio.
 */
export const BUBBLE_HOLD_MS = 4000;
/**
 * Extra hold per character, so a full 40-character bubble is readable inside
 * the same pace as a short one.
 *
 * At 40 ms/character a 20-character bubble holds for 4.8 s and a 40-character
 * one for 5.6 s. Set this to 0 for a flat {@link BUBBLE_HOLD_MS} per bubble.
 */
export const BUBBLE_CHAR_MS = 40;
/**
 * How long one bubble stays on screen.
 *
 * Used by the Electron window's speech backlog; kept here so every bubble
 * timing and size rule sits in one file.
 * @param piece - the text about to be displayed.
 * @returns the hold in milliseconds, never below {@link BUBBLE_HOLD_MS}.
 */
export function bubbleHoldMs(piece) {
    return BUBBLE_HOLD_MS + piece.length * BUBBLE_CHAR_MS;
}
/**
 * 「Think......」提示泡文案（0.1.6 微调1）。
 *
 * 桌宠已确认要回复、但尚未进入「语音 + 对话泡」阶段时显示的占位气泡；
 * 进入正式回复后被同一气泡元素替换。注意：6 个半角点是文案的一部分，
 * 保留原文样式，不要“修正”成省略号。renderer bundle 内联了同一份值
 * （bundle 运行时不 import 本文件，两处由 verify 脚本断言一致）。
 */
export const THINK_HINT_TEXT = 'Think......';
/**
 * 任一气泡出现到下一个气泡出现的最小间隔（0.1.6 微调2），毫秒。
 *
 * 覆盖所有会话泡与提示泡（含 {@link THINK_HINT_TEXT} 泡），由
 * {@link BubblePacer} 这一个节奏控制点统一管理，避免多处各自计时导致漂移。
 * 语义是「出现到下一次出现」的最小间隔；语音时长与节奏冲突时语音优先，
 * 节奏闸门只决定下一段何时允许开始（见 BubblePacer 注释）。
 */
export const BUBBLE_MIN_GAP_MS = 1000;
/**
 * 气泡节奏器：所有气泡上屏时刻的唯一控制点（0.1.6 微调2）。
 *
 * 每只气泡上屏时 `markShown()` 记锚点；下一次上屏前 `waitSlot()` 保证与
 * 锚点至少间隔 `minGapMs`。时钟可通过 `defer` 注入，便于测试不真等 1 秒。
 */
export class BubblePacer {
    #lastShownAt = 0;
    #minGapMs;
    #defer;
    constructor(minGapMs = BUBBLE_MIN_GAP_MS, defer = (ms) => new Promise(resolve => setTimeout(resolve, ms))) {
        this.#minGapMs = minGapMs;
        this.#defer = defer;
    }
    /** 任意气泡真正上屏时调用，作为下一个间隔的锚点。 */
    markShown() {
        this.#lastShownAt = Date.now();
    }
    /** 等待下一个可用的上屏时刻（与上一次上屏至少间隔 minGapMs）。 */
    async waitSlot() {
        const wait = this.#lastShownAt + this.#minGapMs - Date.now();
        if (wait > 0)
            await this.#defer(wait);
    }
}
/** Punctuation that always ends a spoken piece. */
const HARD_BOUNDARIES = ['。', '！', '？', '!', '?', '；', ';', '…', '\n'];
/** Punctuation used when it is the first boundary inside the window. */
const SOFT_BOUNDARIES = ['，', ',', '、', '：', ':', ' '];
/**
 * Position just past the first boundary in `[from, limit)`.
 *
 * Hard and soft boundaries compete on position alone: letting a hard terminator
 * anywhere in the window win would let a trailing "？" swallow every comma
 * before it, which is how a whole paragraph once ended up in one bubble.
 * @returns the cut position, or -1 when no boundary qualifies.
 */
function firstCut(text, from, limit) {
    const end = Math.min(text.length, limit);
    for (let index = from; index < end; index++) {
        const char = text[index];
        if (HARD_BOUNDARIES.includes(char) || SOFT_BOUNDARIES.includes(char))
            return index + 1;
    }
    return -1;
}
/**
 * Cut a boundary-free run at `limit`, stepping back to a space when that avoids
 * splitting a word. Chinese needs no such courtesy; Latin text does.
 */
function hardWrap(text, limit) {
    const space = text.slice(0, limit).lastIndexOf(' ');
    return space > 0 && space >= limit - 12 ? space : limit;
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
export function takeBubbleChunk(pending, final = false) {
    const text = pending.replace(/^\s+/u, '');
    if (text === '')
        return undefined;
    const cut = firstCut(text, BUBBLE_MIN_CHARS, BUBBLE_MAX_CHARS + 1);
    if (cut !== -1)
        return { chunk: text.slice(0, cut).trim(), rest: text.slice(cut) };
    if (text.length > BUBBLE_MAX_CHARS) {
        // Nothing to break on: hard-wrap at the budget rather than speak a bubble
        // that covers the model.
        const wrap = hardWrap(text, BUBBLE_MAX_CHARS);
        return { chunk: text.slice(0, wrap).trim(), rest: text.slice(wrap) };
    }
    // Under the budget with no boundary yet. A boundary may still arrive, so wait
    // unless the stream has ended.
    return final ? { chunk: text.trim(), rest: '' } : undefined;
}
/**
 * Cut `text` down to `limit` characters for the reply-wide budget.
 *
 * Prefers a boundary in the second half of the retained head, so a capped reply
 * ends at a comma or full stop instead of mid-clause. Returns at most `limit`
 * characters, so the caller's running total stays within budget.
 * @param text - the piece that would exceed the budget.
 * @param limit - characters still allowed.
 */
export function trimToBudget(text, limit) {
    if (limit <= 0)
        return '';
    if (text.length <= limit)
        return text;
    const head = text.slice(0, limit);
    for (let index = head.length - 1; index >= Math.floor(limit / 2); index--) {
        const char = head[index];
        if (HARD_BOUNDARIES.includes(char) || SOFT_BOUNDARIES.includes(char))
            return head.slice(0, index + 1);
    }
    return head;
}
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
export class SpeechQueue {
    #ready = [];
    #spoken = 0;
    #exhausted = false;
    /**
     * Offer one piece.
     * @param piece - a piece from {@link takeBubbleChunk}.
     * @returns the pieces to display now, in order.
     */
    push(piece) {
        if (piece !== '')
            this.#ready.push(piece);
        return this.#drain(false);
    }
    /**
     * Finish the reply.
     * @returns every remaining piece, including the one held back for merging.
     */
    flush() {
        return this.#drain(true);
    }
    /**
     * Emit whatever can be emitted.
     * @param final - whether no more pieces will arrive.
     */
    #drain(final) {
        const spoken = [];
        // One piece stays held while more may arrive, which is what allows the
        // merge below.
        while (this.#ready.length > (final ? 0 : 1)) {
            let piece = this.#ready.shift();
            const next = this.#ready[0];
            if (next !== undefined && (piece.length < BUBBLE_MIN_CHARS || next.length < BUBBLE_MIN_CHARS)
                && piece.length + next.length <= BUBBLE_MAX_CHARS) {
                piece += this.#ready.shift();
            }
            const budgeted = this.#budget(piece);
            if (budgeted === undefined)
                break;
            spoken.push(budgeted);
        }
        return spoken;
    }
    /**
     * Apply the reply-wide budget to one piece.
     * @returns the text to display, or undefined once nothing more may be shown.
     */
    #budget(piece) {
        if (this.#exhausted)
            return undefined;
        const remaining = REPLY_MAX_CHARS - this.#spoken;
        if (remaining <= 0) {
            this.#exhausted = true;
            return undefined;
        }
        const trimmed = trimToBudget(piece, remaining);
        if (trimmed === '') {
            this.#exhausted = true;
            return undefined;
        }
        // A stub is not worth speaking. When what still fits is shorter than one
        // bubble should be, and the reply has already reached the length the model
        // was asked for, the reply ends here instead of trailing off mid-sentence.
        // The second condition matters: with less than the minimum spoken so far,
        // saying something short beats falling silent below the requested length.
        if (trimmed.length < piece.length && trimmed.length < BUBBLE_MIN_CHARS
            && this.#spoken >= REPLY_MIN_CHARS) {
            this.#exhausted = true;
            return undefined;
        }
        this.#spoken += trimmed.length;
        // The budget is spent: anything later would be a fragment of a sentence the
        // reader never saw the start of.
        if (trimmed.length < piece.length)
            this.#exhausted = true;
        return trimmed;
    }
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
export function splitForBubble(text) {
    const pieces = [];
    let pending = text;
    for (;;) {
        const taken = takeBubbleChunk(pending, true);
        if (taken === undefined || taken.rest === pending)
            break;
        pending = taken.rest;
        if (taken.chunk !== '')
            pieces.push(taken.chunk);
    }
    return pieces;
}
