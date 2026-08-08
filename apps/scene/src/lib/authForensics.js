/**
 * ⏱ TEMPORARY — WHY did Supabase end a session that still had 33 minutes on
 * its access token?
 *
 * Added 2026-07-26 after the first captured logout. What we know from
 * authDiagnostics: not iOS eviction (the log and token both survived, and an
 * explicit SIGNED_OUT fired), and not expiry. What we do NOT know is the
 * cause, because the existing log records THAT it signed out, never WHY.
 *
 * This records the auth traffic and page-lifecycle events immediately
 * preceding a SIGNED_OUT, so the next occurrence can be reconstructed as a
 * sequence rather than guessed at.
 *
 * ⚠⚠ OBSERVE ONLY. NOTHING HERE MAY CHANGE AUTH BEHAVIOUR. The fetch wrapper
 * forwards its arguments untouched, returns the real Response untouched, and
 * reads only a CLONE. Every recording path is wrapped so that a fault in this
 * file can never reject a real auth request. Explicitly out of scope, by
 * instruction: no change to refresh logic, no serialising of rotation, no
 * "fix" of any kind. This exists to produce evidence and then be deleted.
 *
 * ⚠⚠ NEVER RECORD A TOKEN. A successful /token response body contains a live
 * access_token AND refresh_token. Writing those into localStorage would put
 * working credentials somewhere with different access rules than the session
 * they unlock — a worse problem than the bug being investigated. So: bodies
 * are parsed ONLY on a non-2xx response, and only four known error fields are
 * copied out. The success path records a status code and nothing else.
 */

const LOG_KEY = 'yp_auth_forensics';
const LOG_MAX = 60;

// The four fields GoTrue actually uses for errors. An allow-list, not a
// blocklist: a blocklist would leak any field a future version adds.
const ERROR_FIELDS = ['error', 'error_description', 'error_code', 'code', 'msg', 'message'];

function read() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append one entry. Never throws — a diagnostic must not be able to break a page. */
export function note(kind, detail) {
  try {
    const log = read();
    log.push({ t: new Date().toISOString(), kind, ...(detail ? { detail } : {}) });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
  } catch {
    // storage full, disabled, or private mode — losing a log line is fine
  }
}

export function readForensics() {
  return read();
}

export function clearForensics() {
  try { localStorage.removeItem(LOG_KEY); } catch { /* nothing to do */ }
}

/**
 * ⚠ THE ONLY PLACE AN EXPLICIT SIGN-OUT IS DISTINGUISHED FROM AN IMPOSED ONE.
 * Called immediately before `supabase.auth.signOut()` in App.jsx, which is the
 * app's only call site. Without this marker the two are indistinguishable in
 * the log: GoTrue emits the same SIGNED_OUT event whether the user pressed the
 * button or a refresh was rejected, and "was this self-inflicted?" is the
 * first question worth ruling out.
 */
export function markExplicitSignOut() {
  note('EXPLICIT_SIGNOUT', 'user pressed sign out');
}

/**
 * Was a sign-out user-initiated? True if markExplicitSignOut fired in the last
 * few seconds. Used only to LABEL a log entry, never to alter behaviour.
 */
export function recentExplicitSignOut(withinMs = 5000) {
  const last = [...read()].reverse().find(e => e.kind === 'EXPLICIT_SIGNOUT');
  if (!last) return false;
  return Date.now() - new Date(last.t).getTime() < withinMs;
}

/**
 * `grant_type` separates a token REFRESH from a fresh sign-in, which is the
 * difference between "the session was rejected" and "the user logged back in".
 * Read from the request body without consuming anything the client needs —
 * `init.body` is a plain string here, so this is a read of a value we were
 * handed, not of a stream.
 */
function grantTypeOf(url, init) {
  try {
    const q = new URL(url, location.origin).searchParams.get('grant_type');
    if (q) return q;
    if (typeof init?.body === 'string' && init.body.includes('refresh_token')) return 'refresh_token(body)';
  } catch { /* fall through */ }
  return null;
}

function endpointOf(url) {
  try { return new URL(url, location.origin).pathname.replace('/auth/v1', ''); }
  catch { return String(url).slice(0, 80); }
}

/**
 * A fetch that watches Supabase auth traffic and forwards everything else
 * untouched.
 *
 * ⚠ THE CLONE, AND WHY THE BODY IS READ WITHOUT AWAITING. A Response body is a
 * one-shot stream: reading it here would leave GoTrue with an empty body and
 * break the very auth flow being measured, so a clone is read instead. And the
 * real Response is returned IMMEDIATELY — the clone is drained in a floating
 * promise — so instrumentation adds no latency to the auth path and cannot
 * change a timing-sensitive sequence while trying to observe it.
 */
export function forensicFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);

  // Everything that is not auth passes through with zero overhead.
  if (!url || !url.includes('/auth/v1/')) return fetch(input, init);

  const endpoint = endpointOf(url);
  const grant = grantTypeOf(url, init);
  const started = Date.now();
  note('AUTH_REQUEST', grant ? `${endpoint} grant=${grant}` : endpoint);

  return fetch(input, init).then((res) => {
    try {
      const ms = Date.now() - started;
      if (res.ok) {
        // ⚠ SUCCESS BODIES HOLD LIVE TOKENS — status only, never content.
        note('AUTH_RESPONSE', `${endpoint} ${res.status} (${ms}ms)`);
      } else {
        res.clone().text().then((text) => {
          let picked = '';
          try {
            const j = JSON.parse(text);
            picked = ERROR_FIELDS
              .filter(k => j?.[k] != null)
              .map(k => `${k}=${String(j[k]).slice(0, 120)}`)
              .join(' ');
          } catch {
            // Not JSON. Truncated hard: an error page is not a token, but it
            // is also not worth storing at length.
            picked = text.slice(0, 120);
          }
          note('AUTH_ERROR', `${endpoint} ${res.status} (${ms}ms) ${picked}`);
        }).catch(() => note('AUTH_ERROR', `${endpoint} ${res.status} (body unreadable)`));
      }
    } catch {
      // Recording failed; the response is already on its way back regardless.
    }
    return res;
  }).catch((err) => {
    // A NETWORK failure, not an HTTP error — distinct, and the thing auth-js
    // treats as retryable. Re-thrown unchanged so behaviour is identical.
    try { note('AUTH_NETWORK_FAIL', `${endpoint} ${String(err?.message || err).slice(0, 120)}`); } catch { /* ignore */ }
    throw err;
  });
}

/**
 * Page lifecycle, because "session recovery" is not visible in the HTTP call —
 * a recovery refresh and a scheduled one are the same request. What separates
 * them is what happened a moment earlier: an iOS PWA resuming from suspension
 * fires `visible` and then immediately refreshes. With these lines in the same
 * log, "resumed at T, refreshed at T+0.2s, signed out at T+0.4s" is legible as
 * a sequence; without them it is three unexplained events.
 */
export function armLifecycleForensics() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    note('VISIBILITY', document.visibilityState);
  });
  window.addEventListener('pageshow', (e) => {
    // `persisted` means the page came back from the bfcache rather than
    // loading fresh — the exact resume path a suspended PWA takes.
    note('PAGESHOW', e.persisted ? 'from bfcache (resumed)' : 'fresh load');
  });
  window.addEventListener('online',  () => note('NETWORK', 'online'));
  window.addEventListener('offline', () => note('NETWORK', 'offline'));
}
