/**
 * WHERE EACH SAMPLE IS DRAWN.
 *
 * Extracted from `LiveWaveform` for the same reason the recorder's transition
 * table was: a component cannot be exercised by this project's test setup, and
 * an off-by-one here fails silently — the waveform still animates, it is just
 * showing the wrong instant in the wrong place, which nobody would spot by
 * looking at it.
 */

/**
 * Lay a growing history of levels into a fixed row of bars, RIGHT-ALIGNED.
 *
 * The newest sample is always the last bar. Older samples run backwards from
 * there, and any slots left over sit empty on the LEFT, so the field fills from
 * the right and the live edge never moves.
 *
 * @param {number[]} history  oldest first, newest last
 * @param {number} barCount   how many bars the row has
 * @returns {(number|undefined)[]} length `barCount`; `undefined` means "no bar"
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

export function alignRight(history, barCount) {
  const src = Array.isArray(history) ? history : [];
  const out = new Array(Math.max(0, barCount));

  // A history longer than the row means the oldest samples have scrolled off.
  // Taking the TAIL rather than the head is what makes the row a moving window
  // instead of a frozen picture of the first few seconds.
  const visible = src.length > barCount ? src.slice(src.length - barCount) : src;
  const offset = out.length - visible.length;

  for (let i = 0; i < out.length; i++) {
    out[i] = i < offset ? undefined : visible[i - offset];
  }
  return out;
}
