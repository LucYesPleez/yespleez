/**
 * THE LIVE METER'S MATHS.
 *
 * Extracted from `LiveWaveform` for the same reason the recorder's transition
 * table was: a component cannot be exercised by this project's test setup, and
 * an off-by-one here fails silently — the meter still animates, it is just
 * showing the wrong thing, which nobody would spot by looking at it.
 *
 * `alignRight` used to live here and is gone. It right-aligned a growing history
 * into a fixed row of bars, which is how the meter worked when it STEPPED:
 * values hopped one position left every sample while the bars stayed put. The
 * strip translates now, so the DOM does the aligning — the oldest bar element is
 * recycled to the end and the row slides. There is no history array to align any
 * more.
 */

/**
 * How tall one bar is drawn, in px.
 *
 * ⚠ PERCEPTUAL, NOT LINEAR, and that is the whole point of the function.
 *
 * `level()` is RMS scaled by 2.2 at the source, but speech RMS sits around .1
 * to .25 — so a normal speaking voice arrives as roughly .22 to .55. Drawn
 * linearly on the old 22px row that was 5 to 12 pixels: technically correct and
 * reported as "barely shows" from a real handset, because the entire top half
 * of the meter was reserved for shouting.
 *
 * The curve spends the height where voices actually live. A shout still reaches
 * the top: 1 maps to 1 for any exponent.
 *
 * The 2px floor matches how the stored waveform treats silence — a quiet moment
 * must read as a short bar, never as a gap, or a pause looks like a hole in the
 * recording.
 *
 * ⚠ DO NOT FIX THIS BY RAISING THE SOURCE GAIN. `level()` also has to stay
 * honest about loudness; multiplying it further clips every ordinary voice to a
 * flat maximum, and the meter stops responding exactly where it is most
 * informative. This is a display decision and it belongs on the display side.
 */
export function barHeight(level, height, curve = 0.6) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  return Math.max(2, Math.pow(v, curve) * height);
}

/**
 * How many bar elements a strip of this width needs.
 *
 * The strip SCROLLS: bars are a fixed width and the whole row translates, so
 * the element count follows the container rather than the other way round. Two
 * spare — one leaving on the left and one entering on the right — so there is
 * never a gap at either edge mid-slide.
 *
 * ⚠ FIXED WIDTH IS WHAT MAKES SCROLLING POSSIBLE AT ALL. While bars were
 * `flex: 1` they shared whatever space existed, so the pitch changed with the
 * container and a translate could not be expressed in pixels that stayed
 * correct. That is also why the old meter could never slide: it had no stable
 * distance to slide BY.
 */
export function barCapacity(width, pitch) {
  if (!(width > 0) || !(pitch > 0)) return 0;
  return Math.ceil(width / pitch) + 2;
}
