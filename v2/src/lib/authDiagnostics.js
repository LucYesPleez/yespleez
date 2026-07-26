/**
 * WHY DID THE SESSION END?
 *
 * The owner is repeatedly signed out of the installed iOS home-screen PWA.
 * Two causes were investigated and ruled out before this file existed:
 *
 *   ✗ iOS ITP's 7-day script-writable-storage cap — does not apply to an
 *     installed home-screen web app, and this IS installed.
 *   ✗ auth-js signing out on a failed token refresh — 2.108.2 already
 *     distinguishes retryable fetch errors, and preserves the session when a
 *     PROACTIVE refresh fails while the access token is still valid. Both of
 *     the classic "a network blip logged me out" paths are already closed.
 *
 * That leaves two remaining explanations which need OPPOSITE fixes, and which
 * look identical from the outside — the user just sees a login screen:
 *
 *   A. Supabase deliberately removed the session (`_removeSession`), because a
 *      refresh token was genuinely rejected. Ours to fix, in app code.
 *   B. iOS evicted the origin's whole storage bucket while the PWA was
 *      suspended. Nothing in app code caused it and no app-code change fixes
 *      it; the answer is a different persistence strategy entirely.
 *
 * ⚠ THE CANARY IS WHAT SEPARATES THEM, AND IT ONLY WORKS BECAUSE IT LIVES IN
 * THE SAME STORAGE AREA AS THE TOKEN. Eviction (B) takes the whole bucket, so
 * it takes the canary too. A targeted `_removeSession` (A) deletes exactly one
 * key and cannot touch the canary. So at boot:
 *
 *   canary present, token present  → healthy
 *   canary present, token GONE     → (A) Supabase removed the session
 *   canary GONE,    token GONE     → (B) iOS evicted the bucket
 *   canary GONE,    token present  → someone cleared the canary by hand
 *
 * This is a measurement, not a fix. It is deliberately shipped BEFORE any
 * attempted fix, because two plausible guesses have already been wrong and a
 * third would cost another deploy-and-wait cycle to disprove.
 */

import { note, recentExplicitSignOut } from './authForensics';

// Supabase's own key, as GoTrueClient builds it: `sb-<project-ref>-auth-token`,
// where the ref is the subdomain of the project URL. Derived rather than
// hardcoded so a project/environment change cannot silently point the canary
// at a key that no longer exists — which would read as "evicted" forever.
export function authTokenKey(url = safeEnvUrl()) {
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

// `import.meta.env` is a Vite construct and simply does not exist under plain
// Node, where reading a property off it throws rather than yielding undefined.
// Isolated here so the key derivation above stays a pure function of its
// argument and can be tested without a bundler.
function safeEnvUrl() {
  try {
    return import.meta.env.VITE_SUPABASE_URL;
  } catch {
    return undefined;
  }
}

/**
 * THE LOAD-BEARING DECISION, as a pure function.
 *
 * Extracted from captureBootState so the verdict can be tested against all
 * four storage states directly. A diagnostic that misclassifies is worse than
 * no diagnostic: it does not merely fail to answer the question, it sends the
 * next day of work confidently at the wrong cause. The plumbing around it
 * (reading localStorage, writing the log) is incidental; this is the part that
 * has to be right.
 *
 * @param {{hasToken: boolean, hasCanary: boolean, hasHistory: boolean}} state
 * @returns {'healthy'|'session-removed'|'storage-evicted'|'canary-cleared'|'first-run'}
 */
export function classifyStorage({ hasToken, hasCanary, hasHistory, hasMirror }) {
  if (hasToken && hasCanary)  return 'healthy';

  // ⚠ A MISSING CANARY MEANS NOTHING ON THE FIRST RUN, AND THAT COST US A
  // READING. The canary cannot predate the code that writes it, so the very
  // first boot after this shipped found every already-signed-in user holding a
  // token with no canary and reported 'canary-cleared' — a confident verdict
  // about an event that never happened, printed as the headline above a log
  // that contained the real evidence. `hasHistory` is what separates "the
  // canary vanished" from "the canary was never planted".
  if (hasToken && !hasCanary) return hasHistory ? 'canary-cleared' : 'first-run';
  if (!hasToken && hasCanary) return 'session-removed';

  // Neither the token nor the canary is here. Both were in localStorage, so
  // localStorage itself is the thing that cannot be trusted to explain this —
  // the answer has to come from outside it.
  //
  // The cookie is outside it. Its survival says localStorage was cleared while
  // the origin's other storage was not, which is eviction.
  if (hasMirror) return 'storage-evicted';

  // No mirror either. `hasHistory` can still distinguish a partial wipe (the
  // log lived, the canary did not) from a device that has simply never signed
  // in here — but it CANNOT prove a full eviction, because a full eviction
  // takes the log too and leaves this identical to first-run. Reported as
  // unknown rather than guessed: see the mirror comment above.
  if (hasHistory) return 'storage-partial-wipe';
  return 'first-run';
}

const CANARY_KEY    = 'yp_auth_canary';
const LOG_KEY       = 'yp_auth_log';
const INCIDENT_KEY  = 'yp_auth_incidents';
const LOG_MAX       = 40;
const INCIDENT_MAX  = 20;

/**
 * ⚠ TWO LOGS, BECAUSE ONE ROLLING LOG LOSES THE THING IT IS FOR.
 *
 * Measured, not assumed: sixty seconds of ordinary use produced forty entries
 * and filled the rolling buffer completely. auth-js emits SIGNED_IN and
 * INITIAL_SESSION several times per boot, so routine activity alone flushes
 * the buffer within a handful of app opens — while the sign-out being hunted
 * may be days apart. The evidence would be gone every time it mattered.
 *
 * So the verdicts that are ABNORMAL are written to their own log, which
 * nothing routine ever appends to. `healthy` and `first-run` are not incidents
 * and stay out of it; that is what keeps twenty slots equal to twenty real
 * events rather than twenty minutes of noise.
 */
const INCIDENT_VERDICTS = new Set([
  'session-removed', 'storage-evicted', 'storage-partial-wipe', 'canary-cleared',
]);

// Every read and write goes through these. localStorage throws rather than
// returning null in a few real situations (iOS private browsing, storage
// disabled, quota) and a diagnostic that can itself crash the app on boot is
// worse than no diagnostic at all.
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

/**
 * ⚠ THE MIRROR CANARY LIVES IN A COOKIE, AND THE POINT IS THAT A COOKIE IS NOT
 * localStorage.
 *
 * Storage cannot witness its own erasure. The first version of this file tried
 * to detect eviction by checking whether the log survived — but an evicted
 * bucket takes the log with it, so a real wipe left nothing behind to read and
 * classified as `first-run`. The branch named `storage-evicted` could never
 * actually fire for the case it was named after.
 *
 * A cookie fixes that because iOS governs cookies under a different policy
 * from script-writable storage: the two are not evicted together. So a missing
 * localStorage canary beside a surviving cookie is positive evidence that
 * localStorage specifically was cleared — which is the exact claim being made.
 *
 * If BOTH are gone, that is reported as unknown rather than guessed at. A
 * diagnostic is allowed to say it does not know; it is not allowed to be
 * confidently wrong, which is the failure mode this whole file exists to end.
 */
const MIRROR_KEY = 'yp_auth_mirror';
const MIRROR_MAX_AGE = 60 * 60 * 24 * 365;

function mirrorGet() {
  try {
    return document.cookie.split('; ').some(c => c.startsWith(`${MIRROR_KEY}=`));
  } catch {
    return false;
  }
}

function mirrorSet() {
  try {
    // SameSite=Lax so it survives a normal top-level open of the PWA; no
    // Secure flag hardcoded because localhost is http and would silently drop
    // it — the value is a timestamp, not a credential.
    document.cookie = `${MIRROR_KEY}=1; path=/; max-age=${MIRROR_MAX_AGE}; SameSite=Lax`;
  } catch {
    // A blocked cookie only costs the eviction branch its evidence; every
    // other verdict still works.
  }
}

function readList(key) {
  try {
    const raw = lsGet(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append one entry to the rolling ring buffer. Oldest entries fall off the
 * front, so this can never grow without bound and never needs pruning.
 *
 * Consecutive duplicates collapse into a count rather than occupying a slot
 * each: auth-js fires SIGNED_IN three or four times per boot with identical
 * payloads, and left alone those repeats are most of the buffer. Collapsing
 * them keeps the same information in one slot.
 */
export function recordAuthEvent(kind, detail) {
  const log = readList(LOG_KEY);
  const last = log[log.length - 1];
  if (last && last.kind === kind && last.detail === detail) {
    last.n = (last.n || 1) + 1;
    last.t = new Date().toISOString();
  } else {
    log.push({ t: new Date().toISOString(), kind, ...(detail ? { detail } : {}) });
  }
  lsSet(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
}

/** The abnormal-verdict log. Nothing routine writes here — see INCIDENT_VERDICTS. */
function recordIncident(verdict) {
  const list = readList(INCIDENT_KEY);
  list.push({ t: new Date().toISOString(), verdict });
  lsSet(INCIDENT_KEY, JSON.stringify(list.slice(-INCIDENT_MAX)));
}

export function readAuthLog() {
  return readList(LOG_KEY);
}

export function readAuthIncidents() {
  return readList(INCIDENT_KEY);
}

/**
 * Classify how this boot found its storage, and log the verdict.
 *
 * ⚠ MUST RUN BEFORE THE SUPABASE CLIENT TOUCHES THE SESSION. `getSession()`
 * can trigger a refresh, and a refresh can legitimately remove the token — so
 * reading after it would blame eviction for a sign-out that happened one
 * millisecond ago, in this very page load. Called as the first statement in
 * main.jsx for exactly this reason.
 *
 * @returns {'healthy'|'session-removed'|'storage-evicted'|'storage-partial-wipe'
 *           |'canary-cleared'|'first-run'|'unavailable'}
 */
export function captureBootState() {
  const tokenKey = authTokenKey();
  if (!tokenKey) {
    recordAuthEvent('boot', 'unavailable: could not derive the auth storage key');
    return 'unavailable';
  }

  const hasToken  = lsGet(tokenKey) !== null;
  const hasCanary = lsGet(CANARY_KEY) !== null;

  // ⚠ hasHistory reads BOTH logs. The incident log is the one that survives
  // routine churn, so an origin whose rolling buffer happens to be empty can
  // still prove — via a recorded incident — that its storage persisted.
  const verdict = classifyStorage({
    hasToken,
    hasCanary,
    hasMirror: mirrorGet(),
    hasHistory: readList(LOG_KEY).length > 0 || readList(INCIDENT_KEY).length > 0,
  });

  recordAuthEvent('boot', verdict);
  if (INCIDENT_VERDICTS.has(verdict)) recordIncident(verdict);

  // Re-arm both canaries whenever a session is present, so the NEXT incident
  // is classifiable. Without this, one wipe leaves them permanently absent and
  // every later sign-out misreads. The mirror is refreshed on every healthy
  // boot as well — a cookie has an expiry, and one that quietly lapses would
  // start reporting phantom evictions.
  if (hasToken) {
    if (!hasCanary) lsSet(CANARY_KEY, new Date().toISOString());
    mirrorSet();
  }

  return verdict;
}

/**
 * Keep the canary in step with the session, and record the auth events that
 * explain a disappearance after the fact.
 *
 * The canary is planted whenever a session exists and deliberately NOT removed
 * on sign-out — its whole purpose is to outlive the token so its own absence
 * means something. Clearing it on SIGNED_OUT would erase the very signal it
 * exists to carry.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {() => void} unsubscribe
 */
export function armAuthDiagnostics(supabase) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (session) { lsSet(CANARY_KEY, new Date().toISOString()); mirrorSet(); }

    // TOKEN_REFRESHED is the healthy heartbeat and fires often; logging every
    // one would push the interesting entries out of a 40-slot ring buffer
    // within a day. The events that explain a sign-out are kept.
    if (event === 'TOKEN_REFRESHED') return;

    const expiresIn = session?.expires_at
      ? `${Math.round((session.expires_at * 1000 - Date.now()) / 1000)}s`
      : null;

    // ⏱ TEMPORARY — attribute the sign-out. GoTrue emits an identical
    // SIGNED_OUT whether the user pressed the button or a refresh was
    // rejected, and telling those apart is the first thing worth knowing.
    // Labelling only; nothing here changes what happens next.
    if (event === 'SIGNED_OUT') {
      const origin = recentExplicitSignOut() ? 'EXPLICIT (user pressed sign out)' : 'IMPOSED (not user-initiated)';
      recordAuthEvent(event, origin);
      note('SIGNED_OUT', origin);
      return;
    }

    recordAuthEvent(event, expiresIn ? `expires in ${expiresIn}` : null);
    note(event, expiresIn ? `expires in ${expiresIn}` : null);
  });

  return () => subscription.unsubscribe();
}
