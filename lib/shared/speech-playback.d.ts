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
/** Schedules `run` after `ms`; the window passes `setTimeout`. */
export type Deferrer = (run: () => void, ms: number) => unknown;
/** What the playback does with a piece, and what it does when the queue drains. */
export interface SpeechSurface {
    /** Display one piece. Called once per piece, in order. */
    show(piece: string): void;
    /** Called once after the last piece has had its time on screen. */
    clear(): void;
}
/** One queued piece, played out on a timer. */
export declare class SpeechPlayback {
    #private;
    private readonly surface;
    private readonly hold;
    private readonly defer;
    /**
     * @param surface - how a piece is displayed and how the bubble clears.
     * @param hold - how long a piece stays up; defaults to the reading-time rule.
     * @param defer - timer injection point, for tests.
     */
    constructor(surface: SpeechSurface, hold?: (piece: string) => number, defer?: Deferrer);
    /**
     * Queue a piece.
     * @param text - a piece from the streaming client; blank input is ignored.
     */
    say(text: string): void;
}
//# sourceMappingURL=speech-playback.d.ts.map