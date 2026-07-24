/**
 * PLAYBACK SPEED — the 1× / 1.5× / 2× cycle for Voicey playback.
 *
 * Pure and persisted, kept out of the component for the usual reason: the test
 * infrastructure renders nothing, so the cycle and the preference have to live
 * where they can be exercised.
 *
 * ── WHY IT PERSISTS ACROSS NOTES ─────────────────────────────────────
 *
 * Someone who sets 1.5× is telling you how fast they like to listen, not making
 * a decision about one note. A speed that reset to 1× on the next Voicey would
 * make them re-tap it down a whole thread. So the choice is remembered — in
 * localStorage, so it also survives a reload.
 */

/** The offered speeds, in cycle order. 2× is the ceiling: speech past it stops
 *  being speech, and the brief asks for exactly these three. */
export const SPEEDS = [1, 1.5, 2];

/** The next speed in the cycle. An unrecognised current value resets to 1×
 *  rather than sticking, so a bad stored value cannot strand the control. */
export function nextSpeed(current) {
  const i = SPEEDS.indexOf(current);
  return SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
}

/** "1×", "1.5×", "2×" — the label on the control. */
export function formatSpeed(s) {
  return `${s}×`;
}

const KEY = 'yp_voice_speed';

/** The remembered speed, or 1× when nothing valid is stored. */
export function loadSpeed() {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;   // private mode / storage blocked — playback still works
  }
}

/** Remember a speed for the next note and the next session. */
export function saveSpeed(s) {
  try { window.localStorage.setItem(KEY, String(s)); } catch { /* storage blocked */ }
}
