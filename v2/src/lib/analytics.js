import { supabase } from './supabase';

/**
 * PRODUCT ANALYTICS — the one place a usage event is recorded.
 *
 * Writes to `public.usage_events` (migration A1). Same "one write path"
 * discipline as writeNotification.js and sendMessage: every call site calls
 * track(), nothing inserts into the table directly, so the row shape is
 * defined once.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────
 *
 * Answering product questions the app is the only thing that can answer:
 * how many people have INSTALLED YesPleez versus just visiting it, and
 * whether installed users behave differently. A generic web analytics tool
 * does not know what a gig, an application or a Voicey is; this does.
 *
 * ── THE THREE RULES ──────────────────────────────────────────────────
 *
 * 1. NEVER THROW, NEVER BLOCK, NEVER BE AWAITED FOR CORRECTNESS.
 *    Analytics failing must be indistinguishable from analytics working, as
 *    far as the user is concerned. Every call is fire-and-forget and every
 *    error is swallowed. A dropped ping is an acceptable loss; a send button
 *    that fails because a stats row could not be written is not.
 *
 * 2. NEVER `.select()` THE INSERT. There is deliberately no SELECT policy on
 *    usage_events, because the anon key is public and any read policy would
 *    publish the platform's usage data to anyone who opened devtools.
 *    `INSERT ... RETURNING` is governed by the SELECT policy, so adding
 *    `.select()` here makes every write fail. If you hit that, remove the
 *    `.select()` — do not add a policy. (beta_feedback needed the opposite;
 *    it shows the submitter their feedback ID. This never reads anything.)
 *
 * 3. NO PII. Coarse buckets only — no IP, no raw user agent, no search
 *    terms, no free text. `props` is for small structural facts (a kind, a
 *    count), never for content someone typed.
 */

/**
 * THE EVENT NAMES, FROZEN.
 *
 * ⚠ MUST match the CHECK constraint in
 * `20260724000001_a1_usage_events.sql`. `analytics.test.js` pins this list;
 * if you add an event here, add it there and apply the migration, or every
 * row carrying the new name is silently rejected by Postgres and the metric
 * reads zero forever while the app looks perfectly healthy.
 *
 * Referenced as EVENTS.SENT_VOICEY rather than by string literal at call
 * sites, so a typo is a TypeError at build/test time instead of a chart that
 * never fills in.
 */
export const EVENTS = Object.freeze({
  OPENED_APP:               'opened_app',
  SIGNED_UP:                'signed_up',
  INSTALL_PROMPT_SHOWN:     'install_prompt_shown',
  INSTALL_PROMPT_ACCEPTED:  'install_prompt_accepted',
  INSTALL_PROMPT_DISMISSED: 'install_prompt_dismissed',
  INSTALLED_PWA:            'installed_pwa',
  CREATED_EVENT:            'created_event',
  PUBLISHED_EVENT:          'published_event',
  APPLIED:                  'applied',
  SENT_MESSAGE:             'sent_message',
  SENT_VOICEY:              'sent_voicey',
  FOLLOWED:                 'followed',
  SHARED:                   'shared',
  // A2 — the shape of a visit, not just its acts.
  SCREEN_VIEW:              'screen_view',
  SESSION_END:              'session_end',
  ERROR:                    'error',
});

/**
 * Every value displayMode() and platform() can return.
 *
 * ⚠ ALSO MIRRORED BY A CHECK CONSTRAINT, and pinned by analytics.test.js for
 * the same reason as EVENTS: a value this code can produce but the database
 * refuses is not an error anyone sees — track() ignores the result, so the
 * row is simply gone. 'unknown' and 'other' are members, not escapes; they
 * must exist in both halves.
 */
export const DISPLAY_MODES = Object.freeze(
  ['standalone', 'browser', 'minimal-ui', 'fullscreen', 'twa', 'unknown'],
);
export const PLATFORMS = Object.freeze(['ios', 'android', 'desktop', 'other']);

/** The modes worth asking matchMedia about, most specific first. */
const QUERYABLE_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];

const DEVICE_KEY    = 'yp_device_id';
const INSTALLED_KEY = 'yp_installed_seen';
const SESSION_KEY   = 'yp_session_id';
const SESSION_AT    = 'yp_session_started';

/** Build-time app version, injected by vite.config.js. Null under `node --test`. */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;

/**
 * localStorage that cannot take the app down.
 *
 * Safari in private mode, and any browser with site data blocked, throws on
 * access rather than returning null. An analytics module is the last thing
 * that should be able to break a page load.
 */
function readStore(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

/**
 * sessionStorage, same defensive shape as above.
 *
 * A session belongs to a TAB, not to a device — which is exactly what
 * sessionStorage models: it survives a reload (a refresh is not a new visit)
 * and dies with the tab. localStorage would leak one "session" across every
 * tab open at once; memory alone would start a new session on every refresh.
 */
function readSession(key) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key, value) {
  try { window.sessionStorage.setItem(key, value); return true; } catch { return false; }
}

/**
 * A UUID, with a fallback that matters more than it looks like it should.
 *
 * ⚠ `crypto.randomUUID` IS A SECURE-CONTEXT API. It is undefined over plain
 * http on a LAN address — which is exactly how this app gets tested on a
 * real phone (`--host 0.0.0.0`, http://192.168.x.x:5173). The same origin
 * rule already hides the microphone there; without this fallback it would
 * also mean every phone test recorded zero analytics, and the bug would look
 * like "the table is empty" rather than "the API does not exist here".
 *
 * The fallback is not cryptographically strong and does not need to be. This
 * value labels a browser profile for counting; it authorises nothing.
 */
export function newUuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;   // version 4
      b[8] = (b[8] & 0x3f) | 0x80;   // variant 10
      const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* fall through */ }
  // Last resort: no crypto at all. Still a valid v4-shaped UUID so the uuid
  // column accepts it.
  const r = () => Math.floor(Math.random() * 16).toString(16);
  const s = Array.from({ length: 32 }, r);
  s[12] = '4';
  s[16] = (parseInt(s[16], 16) & 0x3 | 0x8).toString(16);
  const hex = s.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let memoryDeviceId = null;

/**
 * This browser profile's stable id.
 *
 * ⚠ NOT STABLE ACROSS AN iOS INSTALL. A home-screen PWA on iOS gets its own
 * storage sandbox, so the installed app mints a fresh id and cannot be
 * joined to the browser visits before it. Per-device install funnels are
 * Android/desktop only; on iOS install adoption is an aggregate signal.
 *
 * When localStorage is unavailable the id lives in memory for the page's
 * lifetime — such a visitor counts as a new device on every load, which
 * inflates device counts slightly and is still better than dropping them.
 */
export function deviceId() {
  const stored = readStore(DEVICE_KEY);
  if (stored) return stored;
  if (!memoryDeviceId) memoryDeviceId = newUuid();
  writeStore(DEVICE_KEY, memoryDeviceId);
  return memoryDeviceId;
}

let memorySessionId = null;
let memorySessionAt = 0;

/**
 * THE CURRENT VISIT'S ID.
 *
 * Groups events into a journey — "Discover → event → follow → close" — which
 * is what every behaviour question needs and what no amount of per-event data
 * can reconstruct afterwards. It identifies a VISIT and never a person: two
 * sessions from the same device are deliberately not joinable here, and
 * nothing about the id encodes who anyone is.
 *
 * Minted lazily so a page that records nothing never creates one.
 */
export function sessionId() {
  const stored = readSession(SESSION_KEY);
  if (stored) return stored;
  if (!memorySessionId) memorySessionId = newUuid();
  writeSession(SESSION_KEY, memorySessionId);
  writeSession(SESSION_AT, String(sessionStartedAt()));
  return memorySessionId;
}

/** When the current session began, as epoch ms. */
function sessionStartedAt() {
  const stored = Number(readSession(SESSION_AT));
  if (Number.isFinite(stored) && stored > 0) return stored;
  if (!memorySessionAt) memorySessionAt = Date.now();
  return memorySessionAt;
}

/**
 * Begin a new session.
 *
 * Called when the app resumes after the idle window — the SAME threshold that
 * decides a new `opened_app`, deliberately, so "session" means one thing
 * across the whole table. If the two ever diverge, a session could contain
 * two opens (or an open could span two sessions) and every funnel built on
 * either becomes untrustworthy.
 */
function startNewSession() {
  memorySessionId = newUuid();
  memorySessionAt = Date.now();
  writeSession(SESSION_KEY, memorySessionId);
  writeSession(SESSION_AT, String(memorySessionAt));
  lastScreenPath = null;   // the first screen of a new visit is not a repeat
  return memorySessionId;
}

/**
 * A route reduced to its SHAPE: '/profile/9d4ad715-…' becomes '/profile/:id'.
 *
 * ⚠ THIS IS THE PRIVACY CONTROL, NOT TIDINESS. A raw path names the exact
 * profile, event or conversation someone looked at; a table of those is the
 * named browsing history the ratified privacy rule forbids
 * (docs/analytics-vision-2026-07.md §8). Normalising in the CLIENT means an
 * un-normalised path never leaves the device — there is nothing to strip
 * later and nothing to leak in between.
 *
 * It is also what makes the data usable: without it every profile view is its
 * own unique "screen" and no screen can be counted.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normaliseScreenPath(pathname) {
  const segs = String(pathname ?? '/')
    .split('?')[0]                       // a query string is never recorded
    .split('/')
    .filter(Boolean)
    .map(seg => (UUID_RE.test(seg) || /^\d+$/.test(seg)) ? ':id' : seg);
  return '/' + segs.join('/');
}

/**
 * HOW THE APP IS RUNNING — the headline signal this whole table exists for.
 *
 * Checked most-specific first. `navigator.standalone` is the iOS-only
 * answer and is consulted before the media queries because older iOS
 * Safari reports a home-screen launch there and NOT through
 * `display-mode: standalone`.
 *
 * Returns 'unknown' rather than guessing 'browser' when nothing can be
 * determined. Defaulting to 'browser' would quietly inflate the browser-only
 * count, i.e. bias the one number being measured, in the direction that
 * makes the PWA look less successful than it is.
 */
export function displayMode() {
  try {
    // Android app-store wrapper. Distinct from a home-screen install.
    if (typeof document !== 'undefined' && document.referrer?.startsWith('android-app://')) return 'twa';

    if (typeof navigator !== 'undefined' && navigator.standalone === true) return 'standalone';

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      for (const mode of QUERYABLE_MODES) {
        if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
      }
    }
  } catch { /* fall through */ }
  return 'unknown';
}

/** True when the app is running as an installed app rather than in a browser tab. */
export function isInstalled() {
  const mode = displayMode();
  return mode === 'standalone' || mode === 'fullscreen' || mode === 'twa';
}

/**
 * Coarse platform bucket.
 *
 * iPadOS 13+ identifies itself as a Mac, so a Macintosh UA with more than
 * one touch point is an iPad. Without that branch every iPad lands in
 * 'desktop' and iOS install numbers are wrong.
 */
export function platform() {
  try {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  } catch { /* fall through */ }
  return 'other';
}

/**
 * Coarse browser bucket. Order matters — every Chromium browser also says
 * "Chrome", and every browser on iOS says "Safari" underneath, so the
 * specific brands are tested before the generic ones.
 */
export function browserName() {
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua))                    return 'edge';
    if (/OPR\/|Opera/.test(ua))              return 'opera';
    if (/SamsungBrowser/.test(ua))           return 'samsung';
    if (/FxiOS|Firefox/.test(ua))            return 'firefox';
    if (/CriOS/.test(ua))                    return 'chrome';
    if (/Chrome\//.test(ua))                 return 'chrome';
    if (/Safari/.test(ua))                   return 'safari';
  } catch { /* fall through */ }
  return null;
}

/**
 * The signed-in user, held here rather than fetched per event.
 *
 * The A1 policy accepts a NULL user_id from a signed-in user precisely so a
 * ping that races session resolution is under-attributed instead of
 * REJECTED — but under-attribution is still a loss, so initAnalytics()
 * resolves the session before its first ping and App keeps this current.
 */
let currentUserId = null;

/** Keep track() attributing to the right account. Called from App's auth listener. */
export function setAnalyticsUser(userId) {
  currentUserId = userId ?? null;
}

/**
 * Record one usage event. Fire-and-forget by contract — callers do NOT await
 * this and there is nothing useful to await for.
 *
 * @param {string} name   one of EVENTS.*
 * @param {object} [props] small structural detail. No PII, no free text.
 */
export function track(name, props = {}) {
  try {
    // Guard rather than trust: a call site importing a name that is not in
    // EVENTS would otherwise produce rows Postgres rejects, one per action,
    // invisibly. Failing loudly in dev is how that gets noticed on day one.
    if (!Object.values(EVENTS).includes(name)) {
      if (import.meta.env?.DEV) console.warn('[analytics] unknown event name, not sent:', name);
      return;
    }

    const row = {
      device_id:    deviceId(),
      session_id:   sessionId(),
      user_id:      currentUserId,
      name,
      display_mode: displayMode(),
      platform:     platform(),
      browser:      browserName(),
      app_version:  APP_VERSION,
      props:        props && typeof props === 'object' ? props : {},
    };

    // No `.select()` — see rule 2 in the header. No await: the promise is
    // deliberately detached, and .then() swallows both outcomes so an
    // unhandled rejection can never reach the console or a global handler.
    supabase.from('usage_events').insert(row).then(
      ({ error }) => {
        if (error && import.meta.env?.DEV) console.warn('[analytics]', name, error.message);
      },
      () => {},
    );
  } catch {
    // Detection or storage threw. Nothing to do and nothing worth telling
    // the user — rule 1.
  }
}

let lastScreenPath = null;

/**
 * Record a screen view. Called on every route change.
 *
 * ── DEDUPED, BECAUSE REACT WILL CALL THIS TWICE ──────────────────────
 *
 * StrictMode double-invokes effects in development, and a router can settle
 * on the same path more than once. Without this guard the most-viewed-screen
 * table would rank screens by how often React re-rendered them, which is a
 * confident and completely fictional answer. Consecutive repeats only — a
 * genuine A → B → A really is three views.
 *
 * @param {string} pathname raw route; normalised here before it is sent
 */
export function trackScreenView(pathname) {
  try {
    const path = normaliseScreenPath(pathname);
    if (path === lastScreenPath) return;
    lastScreenPath = path;
    track(EVENTS.SCREEN_VIEW, { path });
  } catch { /* rule 1 */ }
}

/**
 * Record how long this visit has lasted, at the moment of leaving.
 *
 * ⚠ EMITS ON EVERY BACKGROUNDING, NOT ONCE AT THE END — and the duration is
 * always measured FROM THE START OF THE SESSION, never since the last emit.
 *
 * There is often no "end" to wait for: a mobile browser can discard a tab
 * without firing anything further, so a single row written at a true end
 * would simply be missing for most real sessions. Writing a cumulative figure
 * each time the app is backgrounded means the LAST row to survive is still
 * correct, whatever else was lost.
 *
 * The reader therefore takes MAX(duration_s) per session_id. SUM would
 * multiply every session by how often the user switched apps — a number that
 * looks plausible and is wildly wrong. This is documented in the A2 migration
 * as well, because it is the one place this data invites a wrong query.
 */
function trackSessionEnd() {
  try {
    const seconds = Math.round((Date.now() - sessionStartedAt()) / 1000);
    if (seconds < 1) return;              // a bounce is not a duration
    track(EVENTS.SESSION_END, { duration_s: seconds });
  } catch { /* rule 1 */ }
}

/**
 * Report a crash. Called by ErrorBoundary.
 *
 * ⚠ `message` IS THE ONE PIECE OF FREE TEXT THIS MODULE SENDS, and it is
 * permitted because an error message is written by the code, not typed by the
 * user — rule 3 exists to keep out what PEOPLE write. It is truncated anyway,
 * because a message can interpolate values and a bounded field cannot become
 * an accidental data dump.
 *
 * Without this, a crash is invisible: the user sees "something went wrong",
 * closes the app, and nothing anywhere records that it happened.
 */
export function trackError(error, screenPath) {
  try {
    track(EVENTS.ERROR, {
      name:    String(error?.name || 'Error').slice(0, 60),
      message: String(error?.message || '').slice(0, 200),
      screen:  normaliseScreenPath(screenPath ?? currentHashPath()),
    });
  } catch { /* rule 1 — an error while reporting an error must stay silent */ }
}

/** The app is a HashRouter, so the route lives after the '#'. */
function currentHashPath() {
  try {
    return (window.location.hash || '').replace(/^#/, '') || '/';
  } catch {
    return '/';
  }
}

/**
 * INSTALL DETECTION.
 *
 * Two independent signals, because no single one covers both platforms:
 *
 *   `appinstalled`      Chromium only. Fires at the moment of installation.
 *   first standalone    Every platform, and THE ONLY iOS signal. The first
 *   launch             time we are ever launched in standalone mode, this
 *                       device installed at some earlier point.
 *
 * The localStorage flag deduplicates the second signal, which would
 * otherwise fire on every single launch of the installed app and turn a
 * one-off "installed" count into a duplicate of the daily-open count.
 *
 * ⚠ The flag lives in the SAME storage sandbox as the install it describes,
 * which is what makes it correct on iOS: the installed app has never seen
 * the browser's copy of the flag, so its first launch correctly reports an
 * install rather than being deduplicated away by the browser's history.
 */
function trackInstallSignals() {
  try {
    if (isInstalled() && !readStore(INSTALLED_KEY)) {
      writeStore(INSTALLED_KEY, String(Date.now()));
      track(EVENTS.INSTALLED_PWA, { source: 'first_standalone_launch' });
    }

    window.addEventListener('appinstalled', () => {
      if (!readStore(INSTALLED_KEY)) writeStore(INSTALLED_KEY, String(Date.now()));
      track(EVENTS.INSTALLED_PWA, { source: 'appinstalled' });
    });

    // ⚠ CHROMIUM ONLY, and currently DORMANT: `beforeinstallprompt` requires
    // a registered service worker, and this app has none yet. Until one
    // exists this listener never fires and Android/desktop cannot install at
    // all — the metric it feeds will read zero for a reason that has nothing
    // to do with user interest.
    //
    // Not calling preventDefault(), deliberately: that would suppress the
    // browser's own install affordance in exchange for a custom prompt this
    // app does not have, i.e. it would REDUCE installs to improve a funnel.
    // EVENTS.INSTALL_PROMPT_ACCEPTED / _DISMISSED stay reserved for when a
    // custom prompt exists and can report its own outcome.
    window.addEventListener('beforeinstallprompt', () => {
      track(EVENTS.INSTALL_PROMPT_SHOWN);
    });
  } catch { /* rule 1 */ }
}

/**
 * THE APP-OPEN PING, AND WHY IT IS NOT JUST "ON PAGE LOAD".
 *
 * An installed PWA is not reloaded the way a tab is. It is backgrounded and
 * resumed, sometimes for weeks, so counting page loads would report the
 * installed users — the ones this table exists to measure — as barely
 * active, and would make the installed cohort look WORSE than the browser
 * cohort purely as an artefact of measurement.
 *
 * So an open is also recorded when the app returns to the foreground after
 * being away longer than the idle window. Thirty minutes is short enough
 * that a genuine "came back to it later" counts and long enough that
 * flicking to another app and back does not.
 */
const IDLE_WINDOW_MS = 30 * 60 * 1000;
let lastOpenAt = 0;

function pingOpen(reason) {
  lastOpenAt = Date.now();
  track(EVENTS.OPENED_APP, { reason, installed: isInstalled() });
}

/** StrictMode double-invokes effects in dev; init must be idempotent. */
let started = false;

/**
 * Start analytics. Call once, from App, after the session is known.
 *
 * Awaits the session before the first ping so that ping is attributed to the
 * right account — see the note on currentUserId.
 */
export async function initAnalytics() {
  if (started) return;
  started = true;

  try {
    const { data } = await supabase.auth.getSession();
    currentUserId = data?.session?.user?.id ?? null;
  } catch {
    currentUserId = null;
  }

  pingOpen('load');
  trackInstallSignals();

  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        // Leaving. Record the length so far — there may be no later chance.
        trackSessionEnd();
        return;
      }
      if (Date.now() - lastOpenAt < IDLE_WINDOW_MS) return;
      // Back after the idle window: a genuinely new visit, so a new session
      // id as well. Minted BEFORE the open ping so that ping belongs to the
      // session it starts rather than to the one that just ended.
      startNewSession();
      pingOpen('resume');
    });

    // pagehide catches the closes visibilitychange misses — notably iOS
    // Safari discarding a tab, and bfcache navigations. Both fire in the
    // ordinary close path, and the duplicate is harmless because the reader
    // takes MAX(duration_s) per session.
    window.addEventListener('pagehide', trackSessionEnd);
  } catch { /* rule 1 */ }
}

/** Test seam: reset module state between cases. Not used by the app. */
export function __resetAnalyticsForTests() {
  started = false;
  lastOpenAt = 0;
  currentUserId = null;
  memoryDeviceId = null;
  memorySessionId = null;
  memorySessionAt = 0;
  lastScreenPath = null;
}
