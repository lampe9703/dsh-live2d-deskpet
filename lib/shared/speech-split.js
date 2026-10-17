/**
 * Splitting one spoken line into the pieces the bubble shows, for audio sync.
 *
 * The existing {@link SpeechQueue} in `bubble-speech.ts` is built for the
 * *streaming* path: it holds a piece back so a short tail can merge, which is
 * what lets a reply ending in "需要我帮忙吗？" become one bubble instead of a
 * normal bubble plus a stub. That hold-back is exactly what must NOT happen
 * here — the greeting (and any already-complete line) arrives whole, and a piece
 * held back for a merge that will never come would simply never be spoken.
 *
 * The bounds are deliberately the same as `bubble-speech`'s, so a line speaks in
 * the same rhythm whichever path produced it.
 */
import { BUBBLE_MAX_CHARS, BUBBLE_MIN_CHARS } from './bubble-speech.js';
/** Sentence-final punctuation: always a speech-piece boundary. */
const SENTENCE_END = ['。', '！', '？', '!', '?', '…', '；', ';', '\n'];
/** Weaker punctuation: a boundary only when the piece would otherwise overflow. */
const CLAUSE_END = ['，', ',', '、', '：', ':', ' '];
/**
 * Cut one complete string into bubble-sized pieces.
 *
 * A piece ends at the first sentence terminator at or past
 * {@link BUBBLE_MIN_CHARS}; when no terminator comes before
 * {@link BUBBLE_MAX_CHARS} the text is cut at the last clause mark inside the
 * window, or hard-wrapped when there is none. A tail shorter than the minimum is
 * kept as its own final piece rather than dropped: with a complete line there is
 * no later piece to merge it into, and those characters still have to be shown
 * and spoken.
 * @param text - the whole line.
 * @returns one entry per bubble, in order; empty input yields no pieces.
 */
export function splitSpeechPieces(text) {
    const pieces = [];
    let pending = text.trim();
    while (pending !== '') {
        const cut = cutIndex(pending);
        const head = pending.slice(0, cut).trim();
        pending = pending.slice(cut).trim();
        if (head !== '')
            pieces.push(head);
    }
    return pieces;
}
/**
 * Where the next piece ends within `text`.
 * @returns a cut index in `(0, text.length]`.
 */
function cutIndex(text) {
    // A terminator at or past the minimum wins outright: sentences are the
    // natural unit, and saying two short ones together reads worse than saying
    // them in turn.
    for (let index = BUBBLE_MIN_CHARS - 1; index < text.length; index++) {
        if (SENTENCE_END.includes(text[index]))
            return index + 1;
        if (index + 1 >= BUBBLE_MAX_CHARS)
            break;
    }
    if (text.length <= BUBBLE_MAX_CHARS)
        return text.length;
    // Too long with no terminator inside the window: retreat to the last clause
    // mark so the cut lands between thoughts rather than inside one.
    for (let index = BUBBLE_MAX_CHARS - 1; index >= BUBBLE_MIN_CHARS; index--) {
        if (CLAUSE_END.includes(text[index]))
            return index + 1;
    }
    return BUBBLE_MAX_CHARS;
}
