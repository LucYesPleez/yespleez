/**
 * THE DEMO-MIX PREVIEW CAP — the first twenty minutes of a set.
 *
 * ⭐⭐ THE PLAYHEAD IS THE LIMIT, not the listener's attention. Playing straight
 * through, dragging the scrubber, or skipping in chunks all reach 20:00 and all
 * stop, because what is being previewed is the first twenty minutes of the SET.
 *
 * ⚠⚠ THIS IS THE THIRD VERSION AND THE FIRST TWO BOTH LIED:
 *
 *   `CLIP_MS = 90s`  filled the bar in ninety seconds and then sat at 100%
 *                    while an hour-long set played on. Its own comment said
 *                    "presentation only" — a promise on screen, no rule behind.
 *   allowance        counted twenty minutes of LISTENING, so a drag to 1:15:00
 *                    played happily on. It measured time spent, not ground
 *                    covered, and a whole 92-minute set was reachable in twenty
 *                    minutes of scrubbing.
 *
 * ⭐ Extracted from MiniPlayer so the rule can be tested WITHOUT a widget. The
 * browser preview pane cannot play media at all — position and duration both
 * read 0 — so a test driving the real player would prove nothing either way.
 * The maths is checked here, synchronously; the component only wires it up.
 */

/** The preview length. One number, one rule, every surface. */
export const PREVIEW_MS = 20 * 60 * 1000;

/**
 * Has the playhead reached the cap?
 *
 * ⚠ `>=`, not `>`. At exactly 20:00 the twentieth minute has been heard and the
 * preview is spent; `>` would keep it alive for one more poll and let the cap
 * read 20:00.5 on a slow tick.
 *
 * ⚠ A position that cannot be read (null, NaN, a provider that has not loaded)
 * is NOT a reason to stop. Silence is not evidence of having heard twenty
 * minutes, and stopping on it would kill a player that had merely been slow to
 * answer.
 */
export function isPastCap(positionMs, capMs = PREVIEW_MS) {
  const pos = Number(positionMs);
  if (!Number.isFinite(pos) || pos < 0) return false;
  return pos >= capMs;
}

/**
 * How full the preview bar is, 0..100.
 *
 * ⛔ MEASURED AGAINST THE CAP, NEVER THE TRACK. The bar reports how much of the
 * PREVIEW is gone, so on a 92-minute set it fills at 20:00 rather than crawling
 * to a quarter and stopping — which is what made the old bar a lie.
 *
 * ⚠ A mix shorter than the cap therefore never fills it, and that is correct:
 * the mix ends first, on the provider's own finish event. ⛔ Nothing waits out
 * the remaining minutes — see the note in MiniPlayer about not holding a short
 * demo open.
 */
export function previewProgress(positionMs, capMs = PREVIEW_MS) {
  const pos = Number(positionMs);
  if (!Number.isFinite(pos) || pos <= 0) return 0;
  return Math.min((pos / capMs) * 100, 100);
}
