/**
 * SCRUB MATH — the pure arithmetic behind dragging a Voicey's playhead.
 *
 * ── WHY THIS IS NOT INSIDE VoiceMessage ──────────────────────────────
 *
 * Same reason as voiceMachine: the test infrastructure renders nothing, so
 * anything living inside the component can only be reasoned about. A scrub that
 * is one pixel off, that lets the playhead leave the bar, or that divides by a
 * zero-width rect during the first layout pass, is exactly the kind of fault
 * that hides until a real finger finds it. These are the decisions; the
 * component performs them.
 */

/** Clamp to the unit interval — a fraction of the way through a note. */
export function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Where along the waveform a pointer is, as a 0..1 fraction.
 *
 * ⚠ GUARDS A ZERO-WIDTH RECT. Before first layout, or on a display-none
 * ancestor, getBoundingClientRect returns width 0 and the division is Infinity
 * or NaN — which would seek the note to its very end or to a broken time on the
 * first touch. A note with no width has no position to point at, so that is 0.
 *
 * @param {number} clientX  pointer x in viewport pixels
 * @param {{left:number,width:number}} rect  the scrub surface's bounding rect
 */
export function fractionFromPointer(clientX, rect) {
  if (!rect || !(rect.width > 0)) return 0;
  return clamp01((clientX - rect.left) / rect.width);
}

/**
 * The time to seek to, in seconds, for a given fraction and note length.
 *
 * ⚠ STOPS A HAIR SHORT OF THE END. Seeking to exactly duration fires the audio
 * element's `ended` event, which resets the playhead to 0 and marks the note
 * finished — so dragging to the far right would snap back to the start instead
 * of resting at the end where the finger is. A 50ms margin keeps the playhead
 * where it was dropped. Dragging to 0 has no such issue and is left exact, so
 * "drag back to the beginning" lands precisely on 0:00.
 *
 * @returns {number} seconds, always inside [0, duration)
 */
export function seekTarget(fraction, durationSec) {
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const f = clamp01(fraction);
  if (f <= 0) return 0;
  const t = f * d;
  const capped = d - 0.05;
  return capped > 0 ? Math.min(t, capped) : 0;
}

/** Nudge a fraction by a step, clamped — for arrow-key seeking. */
export function stepFraction(fraction, delta) {
  return clamp01(clamp01(fraction) + delta);
}

/** One arrow press moves the playhead this far. 5% is WhatsApp-ish and lands
 *  on a usable spot without demanding pixel aim from a keyboard. */
export const ARROW_STEP = 0.05;
