/**
 * Playing a line out on screen in step with its spoken audio.
 *
 * The bubble used to be driven by an estimated reading time: a piece was shown
 * as soon as the model produced it and taken down {@link bubbleHoldMs} later.
 * With a synthesized voice that estimate is simply wrong. The synthesis happens
 * after the text arrives, so the bubble appeared seconds *before* any sound, and
 * the hold was unrelated to how long the clip actually ran — the bubble had
 * already moved on while the voice was still mid-sentence.
 *
 * This class makes the audio the clock:
 *
 *   - a piece is shown when its audio *starts*, not when it was requested, so
 *     text and voice begin together (the surface fades it in there);
 *   - it stays up for the clip's real duration, so the bubble clears as the
 *     sentence finishes (the surface fades it out on `ended`);
 *   - the next piece is synthesized while the current one plays, so synthesis
 *     latency is hidden behind playback instead of stalling the bubble.
 *
 * When the bridge is off or a clip cannot be produced the caller's `speak`
 * returns `undefined` and the piece falls back to the reading-time hold, which
 * is the behaviour the pet had before any voice existed.
 */
import { bubbleHoldMs } from './bubble-speech.js';
import { splitSpeechPieces } from './speech-split.js';
/** Speech synthesis and playback, expressed as what it takes to show a bubble. */
export class AudioBubbleSync {
    surface;
    speak;
    defer;
    #chain = Promise.resolve();
    #generation = 0;
    /**
     * @param surface - how a piece is displayed and how the bubble clears.
     * @param speak - synthesize and play one piece; resolves once it has finished
     *   sounding, with the clip length in milliseconds, or `undefined` when no
     *   audio could be produced for it.
     * @param defer - sleep injection point, for tests.
     */
    constructor(surface, speak, defer = (ms) => new Promise(resolve => setTimeout(resolve, ms))) {
        this.surface = surface;
        this.speak = speak;
        this.defer = defer;
    }
    /**
     * Speak a complete line, split into bubble-sized pieces.
     * @param text - the whole line to say.
     * @param speak - overrides the constructor's `speak` for this line only, which
     *   is how the greeting can suppress its own error notice while every spoken
     *   reply keeps reporting a bridge that has gone quiet.
     */
    say(text, speak) {
        const pieces = splitSpeechPieces(text);
        if (pieces.length === 0)
            return;
        // Supersede whatever is still being said *before* doing any work: the old
        // chain checks this generation and stops without touching the bubble.
        const generation = ++this.#generation;
        const speakPiece = speak ?? this.speak;
        this.#chain = this.#chain
            .then(() => this.#run(pieces, generation, speakPiece))
            .catch(() => { /* a failed line must not poison the next one */ });
    }
    /** Play every piece of one line in order, then clear the bubble. */
    async #run(pieces, generation, speak) {
        for (let index = 0; index < pieces.length; index++) {
            if (generation !== this.#generation)
                return;
            const piece = pieces[index];
            // 0.1.6 微调1：进入正式回复前先出「Think......」提示泡，且只在本行
            // 第一段出现——段与段之间已是回复进行时，不再提示。正文上屏时由同一
            // 气泡元素替换，不会重叠或残留。等待期间若本行已被更新的台词取代，
            // isAlive 变 false，提示泡不再画。
            const isAlive = () => generation === this.#generation;
            if (index === 0 && typeof this.surface.hint === 'function')
                await this.surface.hint(piece, isAlive);
            if (generation !== this.#generation)
                return;
            // 0.1.6 微调2：1 秒节奏闸门——上一只气泡上屏后 1 秒内不开新段。
            // 闸门在 speak 之前等待，音频与气泡同起，成对与节奏两不误。
            if (typeof this.surface.pace === 'function')
                await this.surface.pace();
            if (generation !== this.#generation)
                return;
            // Hold time to use if synthesis fails: the text is still shown, for
            // as long as it takes to read.
            const hold = bubbleHoldMs(piece);
            const started = Date.now();
            // 0.1.6 问题1修复：正在发声的段落必须上气泡。旧实现把 show 关在
            // generation 守卫里，双模式下新台词一到守卫就翻转，正在合成/播放的
            // 语音便成了「只有声音没有气泡」；代数守卫只拦被取代行的**后续**段
            // （上面的循环边界），拦不住已经出声的这一段。
            const outcome = await speak(piece, () => {
                this.surface.show(piece);
            });
            // `speak` implementations that predate the sync clock still return a
            // plain duration; accept both shapes.
            const clipMs = typeof outcome === 'number' ? outcome : outcome?.clipMs;
            if (generation !== this.#generation)
                return;
            if (clipMs === undefined) {
                // No audio (voice off, or the bridge failed): fall back to a read
                // pause. `speak` has already shown the piece in that case.
                const elapsed = Date.now() - started;
                await this.defer(Math.max(0, hold - elapsed));
                continue;
            }
            // Audio is running and the piece is on screen: keep it there for the
            // clip's remaining length. The clock starts when the audio actually
            // began, not when the request was issued: synthesis latency (seconds,
            // on a cold model) would otherwise be subtracted from the hold time.
            const clock = typeof outcome === 'object' && Number.isFinite(outcome?.startedAt)
                ? outcome.startedAt
                : started;
            const remaining = clipMs - (Date.now() - clock);
            if (remaining > 0)
                await this.defer(remaining);
        }
        if (generation === this.#generation)
            this.surface.clear();
    }
}
