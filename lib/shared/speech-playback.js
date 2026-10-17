/**
 * Playing spoken pieces out on screen, one at a time.
 *
 * The window used to display each piece the moment it arrived from the model.
 * Pieces arrive as fast as the model streams them, so a whole reply flashed
 * through the bubble in well under a second: the first line had barely appeared
 * before the next replaced it, and a slower model looked no different.
 *
 * This class holds the pieces and releases them on a timer, so each one stays
 * up for as long as it takes to read (see {@link bubbleHoldMs}). The clock is
 * injected, which is what keeps the timing testable without a window.
 */
import { bubbleHoldMs } from './bubble-speech.js';
/** One queued piece, played out on a timer. */
export class SpeechPlayback {
    surface;
    hold;
    defer;
    #pending = [];
    #playing = false;
    /**
     * @param surface - how a piece is displayed and how the bubble clears.
     * @param hold - how long a piece stays up; defaults to the reading-time rule.
     * @param defer - timer injection point, for tests.
     */
    constructor(surface, hold = bubbleHoldMs, defer = (run, ms) => setTimeout(run, ms)) {
        this.surface = surface;
        this.hold = hold;
        this.defer = defer;
    }
    /**
     * Queue a piece.
     * @param text - a piece from the streaming client; blank input is ignored.
     */
    say(text) {
        const piece = text.trim();
        if (piece === '')
            return;
        this.#pending.push(piece);
        // Already playing: the queue owns the next display, so do not interrupt a
        // piece that is still being read.
        if (!this.#playing)
            this.#next();
    }
    /** Show the next piece, or clear the bubble when there is none. */
    #next() {
        const piece = this.#pending.shift();
        if (piece === undefined) {
            this.#playing = false;
            this.surface.clear();
            return;
        }
        this.#playing = true;
        this.surface.show(piece);
        this.defer(() => { this.#next(); }, this.hold(piece));
    }
}
