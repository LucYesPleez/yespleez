/**
 * RETURN INTENT — the single slot that carries "what I was doing" across auth.
 *
 * Onboarding O2 (ratified 2026-08-12). When a signed-out visitor attempts a
 * participation action, the ParticipationGate writes ONE intent here; after
 * authentication /auth consumes it, puts the person back on `route`, and — for
 * auto-safe actions only — completes what they came to do. Tap → account →
 * done, never tap → account → where did I end up.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────
 *
 *     { v: 1, route: '/event/abc', action: 'save_event',
 *       context: { eventId: 'abc' }, ts: 1765500000000 }
 *
 * ⛔ IDS ONLY in `context` — never user-authored content, never titles, never
 * URLs. The executor re-fetches whatever it needs by id, which is also what
 * validates the action is still possible after auth (lib/intentActions.js).
 *
 * ── THE RULES ────────────────────────────────────────────────────────
 *
 * · ONE slot, last write wins. You cannot want two things at the moment of
 *   one gate.
 * · sessionStorage, deliberately. mailer_autoconfirm is ON (verified against
 *   auth/v1/settings, 2026-08-12), so signup establishes the session in the
 *   SAME tab and the intent never has to cross a tab boundary. sessionStorage
 *   also means an abandoned intent dies with the tab instead of ambushing a
 *   sign-in next week.
 * · EXACTLY ONCE. consumeIntent deletes the slot BEFORE returning it, so a
 *   crash mid-resume loses the intent rather than replaying it — the safe
 *   failure direction — and StrictMode's double-invoked effects find an empty
 *   slot the second time.
 * · Stale, foreign-versioned or malformed intents are DISCARDED, never
 *   "best-effort" executed.
 * · ⚠ This is UX state, not a security boundary. RLS decides what any of it
 *   is allowed to do; an intent forged in devtools can do nothing a hand-typed
 *   request could not.
 */

const KEY = 'yp_return_intent';
const VERSION = 1;
export const INTENT_TTL_MS = 30 * 60 * 1000;

// Storage is reached lazily and defensively: Safari private mode and some
// webviews throw on ACCESS, not only on write, and an intent must never be
// able to take the app down.
function store() {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Record what the visitor was trying to do. Returns false when nothing could
 * be stored — the caller's gate still shows; only the resume is lost.
 */
export function captureIntent({ route, action, context }) {
  const s = store();
  if (!s || typeof route !== 'string' || !route.startsWith('/')) return false;
  try {
    s.setItem(KEY, JSON.stringify({
      v: VERSION, route, action: action ?? null, context: context ?? null, ts: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the intent out of the slot — destructively, exactly once.
 * Returns null for: no intent, unreadable storage, unparseable JSON, a
 * version this code does not speak, a route that is not an in-app path, or
 * an intent older than INTENT_TTL_MS.
 *
 * `now` is injectable for tests only.
 */
export function consumeIntent(now = Date.now()) {
  const s = store();
  if (!s) return null;
  let raw;
  try {
    raw = s.getItem(KEY);
    // Deleted before any validation or return — this line IS the
    // exactly-once guarantee, so nothing may move above it.
    s.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let intent;
  try { intent = JSON.parse(raw); } catch { return null; }

  if (intent?.v !== VERSION) return null;
  if (typeof intent.route !== 'string' || !intent.route.startsWith('/')) return null;
  if (typeof intent.ts !== 'number' || now - intent.ts > INTENT_TTL_MS) return null;

  return intent;
}

/** Explicit dismissal — the gate's "Not now" and sign-out both call this. */
export function clearIntent() {
  try { store()?.removeItem(KEY); } catch { /* nothing to lose */ }
}
