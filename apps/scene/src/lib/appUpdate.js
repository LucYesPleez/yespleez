/**
 * IS THIS TAB RUNNING THE CURRENT BUILD?
 *
 * ⭐⭐ WHY THIS EXISTS. A single-page app loads its JavaScript once. Navigations
 * are network-first so a fresh page load always gets the new bundle, but moving
 * between routes inside the app is not a navigation — so a tab left open all
 * morning keeps running whatever it started with, including past every fix
 * deployed since.
 *
 * Measured, not theorised: on 2026-08-14 a venue was added as a co-host on
 * three live events at 12:54, 12:57 and 13:05. The picker had stopped offering
 * venues at 09:56 and been live since ~10am. The code was right for three hours
 * before the events that it forbids were created, because the tab that created
 * them predated it.
 *
 * ── ⛔ WHY NOT THE SERVICE WORKER ────────────────────────────────────
 *
 * The obvious implementation listens for `updatefound` on the registration.
 * It would never fire here: `sw.js` carries a hand-written `SW_BUILD` constant
 * and is otherwise unchanged between deploys, so the browser fetches
 * byte-identical bytes, concludes there is no update, and stays silent. An
 * update detector that is quiet for the wrong reason is worse than none, since
 * its silence reads as "you are up to date".
 *
 * ── WHAT IS ACTUALLY COMPARED ────────────────────────────────────────
 *
 * The filename of the running entry chunk against the one the server is serving
 * now. Vite content-hashes it, so the name changes exactly when the code does —
 * it IS the version, with no constant to remember to bump and nothing to keep
 * in sync. `index.html` is a couple of kilobytes and already network-first.
 *
 * ⛔ NOTHING HERE RELOADS THE PAGE. Someone may be halfway through writing an
 * event; a reload they did not ask for costs them the lot. This reports, and
 * the person decides.
 */

const IS_PROD = import.meta.env?.PROD === true;

/**
 * The entry chunk this tab is running, e.g. `/assets/index-CwC8QdK1.js`.
 *
 * ⚠ `import.meta.url` resolves to the BUNDLE this module was compiled into, not
 * to this source file — which is the whole trick. In dev it is a source path
 * and matches nothing, hence the PROD guard on every public function.
 */
function runningEntry() {
  try {
    return new URL(import.meta.url).pathname;
  } catch (_) {
    return null;
  }
}

const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

/**
 * Pull the entry chunk's path out of an index.html.
 *
 * ⚠ EXPORTED FOR ITS TEST, and it is the fragile part: everything else here is
 * a comparison, but this is a regex against markup Vite emits and could change.
 * If it stops matching, `isStale` returns false forever and the banner never
 * appears — a silence that reads as "you are up to date".
 */
export function extractEntry(html) {
  const m = String(html || '').match(ENTRY_RE);
  return m ? m[0] : null;
}

/**
 * The entry chunk the server is serving right now, or null if it cannot be
 * determined.
 *
 * ⚠ `cache: 'no-store'` AND a cache-busting param. The service worker serves
 * navigations network-first, but this is a `fetch`, not a navigation — without
 * both, a proxy or the HTTP cache can hand back the very document this exists
 * to detect a change in, and the check silently always says "up to date".
 */
async function deployedEntry() {
  const res = await fetch('/index.html?_v=' + Date.now(), {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  return extractEntry(await res.text());
}

/**
 * True when the deployed build differs from this one.
 *
 * ⛔ RETURNS FALSE ON EVERY UNCERTAINTY — offline, a failed fetch, an
 * unrecognisable document, dev. A false positive here nags someone to reload
 * for no reason and trains them to ignore the banner, which costs more than the
 * occasional missed update.
 */
export async function isStale() {
  if (!IS_PROD) return false;
  const mine = runningEntry();
  if (!mine || !ENTRY_RE.test(mine)) return false;
  try {
    const theirs = await deployedEntry();
    return !!theirs && theirs !== mine;
  } catch (_) {
    return false;
  }
}

/**
 * Watch for a newer build and call `onStale` once, when there is one.
 *
 * Checks when the tab becomes visible — the moment someone comes back to it,
 * which is exactly when a long-lived session resumes — and on a slow interval
 * for tabs left in the foreground. A floor between checks keeps a tab switched
 * to repeatedly from making a request each time.
 *
 * Returns an unsubscribe function.
 */
const MIN_GAP_MS = 5 * 60 * 1000;
const INTERVAL_MS = 30 * 60 * 1000;

export function watchForUpdate(onStale) {
  if (!IS_PROD || typeof window === 'undefined') return () => {};

  let last = Date.now();      // the page just loaded; it is current by definition
  let stopped = false;

  async function check(force) {
    if (stopped) return;
    if (!force && Date.now() - last < MIN_GAP_MS) return;
    last = Date.now();
    if (await isStale()) {
      stopped = true;         // ⛔ announce once. A banner that reappears is nagging.
      onStale();
    }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') check(false); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => check(true), INTERVAL_MS);

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
