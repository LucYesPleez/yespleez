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
