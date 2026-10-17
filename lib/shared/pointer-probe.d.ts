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
/** A point or size in one coordinate system. */
export interface Point {
    x: number;
    y: number;
}
/**
 * Map a DOM pointer position onto the framebuffer pixel to sample.
 * @param pointer - cursor position in CSS pixels, relative to the canvas box.
 * @param cssSize - the canvas element's CSS box size.
 * @param bufferSize - the drawing buffer size in device pixels.
 * @returns the pixel to sample, or undefined when the point is outside the buffer.
 */
export declare function pointerToBufferPixel(pointer: Point, cssSize: {
    width: number;
    height: number;
}, bufferSize: {
    width: number;
    height: number;
}): Point | undefined;
/**
 * Whether an alpha byte counts as "the model is here".
 *
 * The canvas is transparent except where the model draws, so any real alpha
 * means the pointer is over the character. The floor is above zero because
 * anti-aliased edges and faint shadow drawables leave a few nearly-transparent
 * pixels that should not capture the pointer — otherwise the click-through
 * region would grow a fuzzy fringe that steals clicks near the model.
 */
export declare const ALPHA_HIT_FLOOR = 8;
/**
 * Whether a sampled pixel should take mouse input.
 * @param alpha - the sampled alpha byte, or undefined when the sample failed.
 * @returns true when the pointer is over visible model pixels.
 */
export declare function isModelPixel(alpha: number | undefined): boolean;
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
export declare function shouldTakePointer(overModel: boolean, overGrip: boolean, gripEnabled: boolean): boolean;
//# sourceMappingURL=pointer-probe.d.ts.map