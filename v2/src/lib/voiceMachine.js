/**
 * WHAT A PRESS MEANS, GIVEN WHERE THE RECORDER IS.
 *
 * ── WHY THIS IS NOT INSIDE THE HOOK ──────────────────────────────────
 *
 * The same reason `voiceGesture.js` was not: the test infrastructure renders
 * nothing. There is no React renderer and no test dependency of any kind, so
 * logic living inside `useVoiceRecorder` cannot be exercised at all — it can
 * only be reasoned about, which is how the double-microphone below survived
 * being written in the first place.
 *
 * These are the decisions. The hook performs them. It calls these functions on
 * its real path rather than re-implementing the same table beside them, so a
 * test here is a test of what actually runs.
 */

/**
 * Recordings shorter than this are discarded rather than parked or sent.
 *
 * A toggle on and straight off is a mis-tap, and parking a 0.2s note would put
 * the user in a state they have to clean up after an accident.
 */
export const MIN_DURATION_MS = 400;

/**
 * What pressing the microphone means right now.
 *
 * @param {object} p
 * @param {string} p.phase     idle · recording · pending · uploading · sent
 * @param {boolean} p.starting true inside the getUserMedia gap
 * @returns {'abort-start'|'park'|'start'|'resume'|'ignore'}
 *
 * ⚠ `starting` IS CHECKED FIRST, AND THE ORDER IS THE WHOLE POINT.
 *
 * Permission prompts and device warm-up take real time, and `phase` is still
 * `idle` for all of it — the recorder does not exist yet. Fall through to the
 * `idle` case and the second press opens a SECOND microphone that nothing holds
 * a reference to: unstoppable, invisible, and still recording. That is the
 * worst failure this component has, so it is the first thing decided.
 */
export function decideToggle({ phase, starting = false } = {}) {
  if (starting) return 'abort-start';
  if (phase === 'recording') return 'park';
  // ⚠ `pending` RESUMES. IT MUST NEVER START OVER. ─────────────────────
  //
  // This returned 'start' until 2026-07-25, discarding the parked note and
  // all its segments. The reasoning was that the microphone "sitting back at
  // the idle end" could not honestly mean anything else. That reasoning was
  // WRONG, and a real device found it: interrupted mid-Voicey by a phone
  // call, the owner pressed the microphone — the same button they had just
  // been using, and the obvious one on screen — and the recording restarted
  // from zero. The note survived the phone call and was destroyed by the UI.
  //
  // OWNER'S STRENGTHENED CONSTITUTIONAL RULE (ratified 2026-07-25):
  //
  //   "If a parked Voicey exists, no recording control may implicitly
  //    discard it. The user must explicitly choose Continue, Send, Delete
  //    or Discard before a new recording can begin."
  //
  // So the toggle now means CONTINUE while a note is parked — the primary
  // action stays Continue until the parked recording is resolved. Starting a
  // genuinely new note is still possible and still one press away; it just
  // goes through Delete first, which is explicit, which is the entire point.
  //
  // This is a PRODUCT rule, not a platform workaround. It holds even where
  // interruption detection never fires: whatever the OS does or fails to do,
  // no ambiguous button may cost someone a recording.
  if (phase === 'pending') return 'resume';
  if (phase === 'idle') return 'start';
  // uploading · sent — the audio has already left. Nothing to toggle.
  return 'ignore';
}

/**
 * What pressing Send means right now.
 *
 * @returns {'upload-parked'|'stop-and-upload'|'ignore'}
 *
 * Both live and parked audio are "the user pressed Send", so one control covers
 * both. They differ only in whether capture still has to be stopped first.
 */
export function decideSend({ phase } = {}) {
  if (phase === 'pending')   return 'upload-parked';
  if (phase === 'recording') return 'stop-and-upload';
  return 'ignore';
}

/**
 * What an INTERRUPTION means right now — a phone call, the mic being taken by
 * another app, headphones pulled, the audio context suspended by the OS.
 *
 * @param {object} p
 * @param {string} p.phase  idle · recording · pending · uploading · sent
 * @returns {'park'|'ignore'}
 *
 * ⚠ THE CONSTITUTIONAL RULE: a recording in progress is PARKED, never lost.
 * The interruption stopped the audio pipeline; the audio captured up to that
 * moment still exists and belongs to the user. Parking it makes it a draft
 * they can send, delete, or re-record — the same three choices a clean stop
 * gives them. The ONLY things that may destroy a recording are an explicit
 * Delete and a cancel gesture before it completes; an incoming call is
 * neither.
 *
 * Anything not actively recording is ignored: a parked note is already safe,
 * and an upload in flight is past the point an interruption can touch.
 */
export function decideInterrupt({ phase } = {}) {
  return phase === 'recording' ? 'park' : 'ignore';
}

/**
 * Is this recording too short to be meant?
 *
 * A missing or malformed result counts as too short: something that cannot be
 * measured must not be sent, and treating it as valid would upload a note whose
 * length nothing knows.
 */
export function isTooShort(result) {
  // ⚠ `Number.isFinite`, NOT `typeof === 'number'`.
  //
  // `typeof NaN` is 'number' and every comparison against NaN is false, so a
  // duration that failed to measure would pass the length check and be uploaded
  // as though it were long enough. The one value that means "we do not know how
  // long this is" was the one value being treated as fine.
  if (!result || !Number.isFinite(result.durationMs)) return true;
  return result.durationMs < MIN_DURATION_MS;
}
