/**
 * THE GUIDED TOUR'S MEMORY — one flag, two entry points.
 *
 *   FIRST LAUNCH  runs once, automatically. Completing it or skipping it
 *                 spends it, permanently, on this device.
 *   HELP TOUR     replays the whole walkthrough, or jumps straight to one
 *                 section, whenever the user asks for it.
 *
 * ⚠ THE REPLAY PATH MUST NOT TOUCH THE FLAG. Someone re-watching the tour on
 * purpose has already been onboarded; writing the flag again is harmless but
 * CLEARING it is not, and the two paths are close enough that it would be an
 * easy mistake. `finishTour()` is called by the auto-run only.
 *
 * ⚠ EVERY READ AND WRITE IS GUARDED. Safari in private mode throws on
 * localStorage access rather than returning null, and this is read during the
 * render of a component that mounts on every route — an unguarded read takes
 * the whole app down. A device we cannot remember simply gets the tour again.
 */
const DONE_KEY = 'yp.tour.done';

/** True once the tour has been completed or skipped on this device. */
export function tourFinished() {
  try { return localStorage.getItem(DONE_KEY) === '1'; }
  catch { return true; }   // ⚠ fail CLOSED: no memory means no repeat nagging
}

/**
 * ⚠⚠ FINISHING THE TOUR IS AN EVENT, NOT JUST A FLAG, and it has to be.
 *
 * The install spotlight waits on `tourFinished()` so the two never dim the
 * screen at once — but it reads that during ITS OWN render, and the component
 * that finishes the tour is its SIBLING. A sibling's state change re-renders
 * only itself, so nothing tells InstallButton the world changed: it keeps the
 * value it last read, and the spotlight stays dormant until some unrelated
 * navigation happens to re-render the header.
 *
 * Measured exactly that way — the tour completed and the install coach never
 * appeared, then turned up later on the next tab press, looking like a random
 * popup instead of the next beat of onboarding.
 *
 * Same shape as installPrompt.js's availability listeners, for the same
 * reason: state that lives outside React and changes outside a render needs a
 * way to say so.
 */
const listeners = new Set();

/** Subscribe to "the tour is over". Returns an unsubscribe function. */
export function onTourFinished(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * THE SECOND ENTRY POINT — "Take the tour" in the ⓘ sheet.
 *
 * ⚠⚠ A REPLAY MUST NEVER TOUCH THE DONE FLAG. Someone re-watching on purpose
 * has already been onboarded; the flag exists to stop the tour ambushing them
 * on the next launch, and clearing it would do exactly that. So this opens the
 * tour and nothing else — no write, and the auto-run stays spent.
 *
 * A module-level event rather than props because the button lives in the ⓘ
 * sheet and the tour is run by a sibling component; threading a callback
 * between them would mean lifting state into GlobalHeader purely to hand it
 * back down.
 */
const starters = new Set();

/** Subscribe to "start the tour". Returns an unsubscribe function. */
export function onTourStart(fn) {
  starters.add(fn);
  return () => starters.delete(fn);
}

/** Replay the walkthrough, from `at` (0-based step index). */
export function startTour(at = 0) {
  for (const fn of starters) { try { fn(at); } catch { /* ignore */ } }
}

/** Spend the first-launch run. Completion and skip are the same outcome. */
export function finishTour() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
}

/**
 * HAND OVER TO WHATEVER COMES NEXT — currently the install spotlight.
 *
 * ⚠ SEPARATE FROM `finishTour()` ON PURPOSE, because the flag and the handover
 * happen at different moments on the skip path. Skipping shows the "where the
 * tour went" notice; the install coach must wait for that to be dismissed, or
 * it opens on top of it (spotlight 4800 over notice 4700) and the user gets
 * two overlays explaining two different things at once.
 *
 *   completed  finishTour() then announce, immediately.
 *   skipped    finishTour() now, announce when the notice is closed.
 */
export function announceTourFinished() {
  // A bad listener is not our problem, and must not stop the others running.
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

/** Review hatch — `?tour=reset` puts the first-launch run back. */
export function resetTour() {
  try { localStorage.removeItem(DONE_KEY); } catch { /* private mode */ }
}

/**
 * ⏱ TEMPORARY — `?tour=reset` replays it, `?tour=off` suppresses it.
 *
 * ⚠ WITHOUT THIS THE TOUR IS UNREVIEWABLE after its first run, on the only
 * device you have. Clearing site data would work and would also sign you out,
 * which is a high price for looking at page 1 again.
 */
export function tourOverride() {
  if (typeof window === 'undefined') return null;
  // HashRouter puts the app's own query after the '#', so both halves of the
  // URL have to be checked — `?tour=` alone misses `/#/discover?tour=reset`.
  const raw = window.location.search + window.location.hash;
  const m = /[?&]tour=(reset|off)/.exec(raw);
  return m ? m[1] : null;
}
