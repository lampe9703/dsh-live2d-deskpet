/**
 * Model fitting for the pet window, kept pure and dependency-free so the
 * behaviour that broke can be pinned by a test.
 *
 * The original fit read `model.width` / `model.height` every time. Those already
 * include `model.scale`, so the formula was not idempotent: on a second call the
 * next scale works out as `min(canvas / (natural * previousScale))`, which is
 * exactly `1` whenever the canvas did not change. The first resize after load
 * therefore snapped the model to its natural pixel size — a 260px-wide window
 * showed one magnified fragment of the character.
 *
 * The fix is to measure the model ONCE at scale 1 and fit from that constant,
 * which is what these two helpers express.
 */
/** Fraction of the window the model fills, leaving a margin around it. */
export const MODEL_FILL_RATIO = 0.94;
/**
 * Recover a model's unscaled size from its current bounds.
 * @param bounds - `model.width` / `model.height`, which include the current scale.
 * @param scale - the model's current uniform scale.
 * @returns the unscaled size, or undefined when the read is unusable.
 */
export function naturalSizeFromBounds(bounds, scale) {
    const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const width = bounds.width / factor;
    const height = bounds.height / factor;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
        return undefined;
    return { width, height };
}
/**
 * The uniform scale that fits a model of `natural` size into `canvas`.
 *
 * Idempotent by construction: it depends only on the canvas and the model's
 * unscaled size, never on the scale currently applied.
 * @param canvas - the renderer surface, in pixels.
 * @param natural - the model's unscaled size.
 * @returns a positive scale, or undefined when either input is unusable.
 */
export function fitScale(canvas, natural) {
    if (natural.width <= 0 || natural.height <= 0)
        return undefined;
    if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height))
        return undefined;
    const scale = Math.min(canvas.width / natural.width, canvas.height / natural.height) * MODEL_FILL_RATIO;
    return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}
