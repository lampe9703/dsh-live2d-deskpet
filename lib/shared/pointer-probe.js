/**
 * Coordinate mapping for the pet window's pixel hit test, kept pure so the
 * error-prone part is covered by a test.
 *
 * The renderer answers "is the cursor over the model?" by sampling the alpha
 * byte of the WebGL framebuffer under the pointer. Three coordinate systems have
 * to line up for that to be meaningful:
 *
 *   - DOM events report CSS pixels, relative to the canvas element's top-left;
 *   - the GL drawing buffer is in device pixels (`renderer.width/height`, i.e.
 *     CSS size times `resolution`), so a scaled display needs a conversion;
 *   - GL's origin is BOTTOM-left, while DOM's is TOP-left, so Y flips.
 *
 * Getting any of these wrong samples the wrong pixel and the click-through
 * region silently ends up somewhere other than under the cursor (mirrored, or
 * scaled off by the device pixel ratio).
 */
/**
 * Map a DOM pointer position onto the framebuffer pixel to sample.
 * @param pointer - cursor position in CSS pixels, relative to the canvas box.
 * @param cssSize - the canvas element's CSS box size.
 * @param bufferSize - the drawing buffer size in device pixels.
 * @returns the pixel to sample, or undefined when the point is outside the buffer.
 */
export function pointerToBufferPixel(pointer, cssSize, bufferSize) {
    if (cssSize.width <= 0 || cssSize.height <= 0)
        return undefined;
    if (pointer.x < 0 || pointer.y < 0)
        return undefined;
    if (pointer.x >= cssSize.width || pointer.y >= cssSize.height)
        return undefined;
    const scaleX = bufferSize.width / cssSize.width;
    const scaleY = bufferSize.height / cssSize.height;
    const x = Math.floor(pointer.x * scaleX);
    // GL's Y axis points up from the bottom edge, and the DOM row `y` is the
    // TOP-left corner of a pixel: row 0 is the LAST GL row, not the first one past
    // the end of the buffer.
    const y = bufferSize.height - 1 - Math.floor(pointer.y * scaleY);
    if (x < 0 || y < 0 || x >= bufferSize.width || y >= bufferSize.height)
        return undefined;
    return { x, y };
}
/**
 * Whether an alpha byte counts as "the model is here".
 *
 * The canvas is transparent except where the model draws, so any real alpha
 * means the pointer is over the character. The floor is above zero because
 * anti-aliased edges and faint shadow drawables leave a few nearly-transparent
 * pixels that should not capture the pointer — otherwise the click-through
 * region would grow a fuzzy fringe that steals clicks near the model.
 */
export const ALPHA_HIT_FLOOR = 8;
/**
 * Whether a sampled pixel should take mouse input.
 * @param alpha - the sampled alpha byte, or undefined when the sample failed.
 * @returns true when the pointer is over visible model pixels.
 */
export function isModelPixel(alpha) {
    return alpha !== undefined && Number.isFinite(alpha) && alpha > ALPHA_HIT_FLOOR;
}
/**
 * Whether a cursor position should take mouse input, combining the model hit
 * test with the window's own interactive furniture.
 *
 * The resize grip sits in a corner that is usually transparent, so without this
 * it would be unreachable whenever click-through is on.
 * @param overModel - whether the pointer is over model pixels.
 * @param overGrip - whether the pointer is inside the resize grip, which is only
 *   interactive while the window is unlocked.
 * @param gripEnabled - whether the grip is shown at all.
 * @returns true when the window should take mouse input.
 */
export function shouldTakePointer(overModel, overGrip, gripEnabled) {
    return overModel || (gripEnabled && overGrip);
}
