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
 * @returns {'abort-start'|'park'|'start'|'ignore'}
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
  // From `pending`, starting over discards the parked note. The microphone
  // sitting back at the idle end is the only thing the toggle can honestly mean
  // there — the alternative is a control that does nothing in one of the three
  // states it is visible in.
  if (phase === 'idle' || phase === 'pending') return 'start';
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
