/**
 * THE INSTALL COACH'S MEMORY — one flag, and the pulse cadence that follows it.
 *
 * The coach has exactly two lives:
 *
 *   ACT ONE   the spotlight. Shown once, on a phone that could install and
 *             hasn't. The icon is lit, everything else is dimmed and blurred,
 *             and the halo breathes every 8s until they tap it or say later.
 *   ACT TWO   ambient. After "maybe later" the overlay never returns. All that
 *             remains is the icon itself, which breathes once 4s into each new
 *             page and then settles to one breath every 12s.
 *
 * ⚠ THERE IS NO THIRD ACT, AND NO WAY BACK TO THE FIRST. Dismissal is
 * permanent per device. An install teacher that re-teaches is an ad, which is
 * the one thing this must never become. The ambient pulse is the entire
 * remaining ask, and it is deliberately quiet enough to ignore forever.
 *
 * ⚠ NOTHING HERE DECIDES WHETHER THE ICON EXISTS. That is InstallButton's job
 * (installed? platform? capability?) and this only ever answers "has the
 * spotlight already been spent?". Once the app is installed the icon unmounts
 * and both acts end with it — no flag needed, and none written.
 */
const DISMISSED_KEY = 'yp.installCoach.dismissed';

/** How long one breath lasts, start to fully faded. Shared by both acts. */
export const BREATH_MS = 3600;

/** Act one: the halo breathes this often while the spotlight is up. */
export const SPOTLIGHT_INTERVAL_MS = 8000;

/** Act two: one breath this long after landing on a new page… */
export const AMBIENT_FIRST_MS = 4000;

/** …then this is the resting cadence, forever. */
export const AMBIENT_INTERVAL_MS = 12000;

/**
 * ⚠ EVERY READ AND WRITE IS GUARDED. Safari in private mode throws on
 * localStorage access rather than returning null, and an unguarded read here
 * would take down the whole header — the one place a user cannot route around.
 * A device we cannot remember simply gets the spotlight again; that is a far
 * cheaper failure than no header at all.
 */
export function coachDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; }
  catch { return false; }
}

export function dismissCoach() {
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* private mode */ }
}

/** Test/preview escape hatch — `?coach=reset` puts the spotlight back. */
export function resetCoach() {
  try { localStorage.removeItem(DISMISSED_KEY); } catch { /* private mode */ }
}
