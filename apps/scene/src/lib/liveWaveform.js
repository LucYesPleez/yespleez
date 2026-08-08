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
 * The played-back analogue of `alignRight`: a trailing window of a
 * FULL-RESOLUTION, already-known waveform, ending exactly at the current
 * playhead — used to make a stored recording scroll the same way a live one
 * fills, instead of showing one static picture of the whole track.
 *
 * ⚠ SEPARATED FROM THE COMPONENT SPECIFICALLY SO THE FRACTION MATH HAS A TEST.
 * `fraction` (currentTime / duration) is provided by the caller rather than
 * computed here, because computing it needs a live `<audio>` element and this
 * function must not.
 *
 * @param {Uint8Array} bytes     the full decoded envelope, 0..255 per sample
 * @param {number} fraction      0..1, how far through playback
 * @param {number} barCount      how many bars the row draws
 * @param {number} max           the byte scale — WAVE_MAX in voiceWave.js
 * @returns {(number|undefined)[]} length `barCount`, values 0..1
 */
export function scrollWindow(bytes, fraction, barCount, max) {
  if (!bytes?.length) return new Array(Math.max(0, barCount)).fill(undefined);

  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  // At least 1: a fraction of exactly 0 must still show the very first sample,
  // not an empty row pretending nothing has played yet.
  const upTo = Math.max(1, Math.round(f * bytes.length));

  const history = new Array(upTo);
  for (let i = 0; i < upTo; i++) history[i] = bytes[i] / max;
  return alignRight(history, barCount);
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
