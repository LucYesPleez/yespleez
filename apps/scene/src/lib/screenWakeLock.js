/**
 * SCREEN WAKE LOCK — hold the display awake for exactly as long as a recording
 * is running, and not one moment longer.
 *
 * ⚠ THE BUG THIS EXISTS TO END. A beta tester's Voiceys all stopped at 29
 * seconds. Four runs in his log were cut by `track/mute` at 28696, 28717, 28793
 * and 29010ms — a 314ms spread, which is a CLOCK, not an environment. It was his
 * iPhone's Auto-Lock at 30 seconds: the display timer counts from his last
 * TOUCH, which is the tap that started recording, and iOS mutes microphone
 * capture the instant the screen locks. Reproduced on the owner's own device by
 * setting Auto-Lock to 30 seconds.
 *
 * It looked car-specific for weeks because he noticed it while driving, and a
 * car is simply the one place nobody looks at their phone: Face ID's
 * Attention Aware Features will not let the display dim while you ARE looking at
 * it, so it never fired at a desk. Bluetooth was never involved.
 *
 * ── WHAT THIS CAN AND CANNOT DO ──────────────────────────────────────
 *
 * A web app CANNOT capture the microphone with the screen locked on iOS — there
 * is no background audio capability for the web the way there is for a native
 * app. So this raises the ceiling from "your Auto-Lock setting" to "as long as
 * they keep recording"; it does not mean record-and-pocket-the-phone. A
 * deliberate press of the power button still ends capture, and that is correct:
 * the interruption path parks the note rather than losing it.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────
 *
 * `voiceNotes.js` says of itself that it is the most fragile module in the app,
 * and it has earned that. Everything awkward here — re-acquiring after the OS
 * takes the lock away, never throwing, releasing on every exit — lives in this
 * file so the recorder's own diff is one call at each end of its lifecycle, and
 * so this logic is testable without a MediaRecorder.
 *
 * ── THE THREE RULES ──────────────────────────────────────────────────
 *
 *   1. NEVER THROW. An unsupported browser, a denied request or a hidden
 *      document must degrade to "no lock", never to a broken recording. Losing
 *      a Voicey because a screen hint failed would be worse than the bug.
 *   2. RE-ACQUIRE WHEN THE PAGE COMES BACK. The platform drops the lock whenever
 *      the document hides, and does not give it back on its own. Desktop keeps
 *      recording through a tab switch, so this is a real path, not a formality.
 *   3. RELEASE MEANS RELEASE. Once recording stops, a later visibilitychange
 *      must NOT re-acquire — that would leave the screen burning after the user
 *      is done, which is its own bug and a battery complaint.
 */

/** The live WakeLockSentinel, or null when we do not hold one. */
let sentinel = null;
/** Whether a recording still WANTS the lock. Rule 3 hangs off this. */
let wanted = false;
/** Attached once while wanted, so we do not stack listeners per recording. */
let listening = false;

/**
 * Environment seam. Tests inject a fake navigator/document; production reads the
 * globals. Injected rather than imported so this file has no test-only branches
 * in the shipped path.
 */
let env = null;
export function __setWakeLockEnv(e) { env = e; }

function nav() { return env?.navigator ?? (typeof navigator !== 'undefined' ? navigator : null); }
function doc() { return env?.document  ?? (typeof document  !== 'undefined' ? document  : null); }

/** Rule 1 in one place: anything the platform does here is survivable. */
async function requestLock() {
  const api = nav()?.wakeLock;
  if (!api?.request) return false;
  try {
    const held = await api.request('screen');
    // A release that happens without us asking — the OS took it back when the
    // page hid, or the user locked the phone anyway. Drop our reference so the
    // visibility handler knows there is something to re-acquire.
    try { held?.addEventListener?.('release', () => { if (held === sentinel) sentinel = null; }); } catch { /* optional */ }
    sentinel = held;
    return true;
  } catch {
    // Denied, unsupported, or the document was not visible. Not an error here:
    // recording continues, it simply races the user's Auto-Lock as it did before.
    return false;
  }
}

function onVisibilityChange() {
  // Rule 3, belt AND braces. `releaseScreenWakeLock` detaches this listener, so
  // most of the time we are simply not called after a recording ends — but a
  // detach can fail (no document, a throwing removeEventListener), and a
  // listener that outlived its recording would relight the screen behind the
  // user. `wanted` is the state-based half of the guard and does not depend on
  // removal having worked.
  if (!wanted || sentinel) return;
  if (doc()?.visibilityState !== 'visible') return;
  requestLock();
}

function startListening() {
  if (listening) return;
  const d = doc();
  if (!d?.addEventListener) return;
  d.addEventListener('visibilitychange', onVisibilityChange);
  listening = true;
}

function stopListening() {
  if (!listening) return;
  try { doc()?.removeEventListener?.('visibilitychange', onVisibilityChange); } catch { /* ignore */ }
  listening = false;
}

/**
 * Hold the screen awake. Safe to call when already held, and safe to call in a
 * browser that has never heard of the API.
 *
 * @returns {Promise<boolean>} whether a lock is actually held — for diagnostics
 *          and tests. No caller should branch on it: recording proceeds either way.
 */
export async function acquireScreenWakeLock() {
  wanted = true;
  startListening();
  if (sentinel) return true;
  return requestLock();
}

/**
 * Let the screen sleep again. Idempotent, and paired with the recorder's own
 * idempotent `release()` so every exit path — stop, cancel, park, salvage,
 * unmount — drops the lock without needing its own code path.
 */
export async function releaseScreenWakeLock() {
  wanted = false;
  stopListening();
  const held = sentinel;
  sentinel = null;
  if (!held?.release) return;
  try { await held.release(); } catch { /* already gone; nothing to undo */ }
}

/** Whether a lock is currently held. Diagnostics and tests only. */
export function isScreenWakeLockHeld() { return sentinel !== null; }

/** Test seam — forget all state between cases. */
export function __resetScreenWakeLock() {
  stopListening();
  sentinel = null;
  wanted = false;
  listening = false;
}
