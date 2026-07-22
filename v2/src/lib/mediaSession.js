/**
 * THE MEDIA SESSION MANAGER — one pair of ears, arbitrated.
 *
 * There is exactly one audio output and several things that want it: a
 * SoundCloud embed, a Mixcloud set, an uploaded WAV, a Voicey. Media elements
 * do not compete for audio focus the way native players do, so without
 * arbitration they simply all play at once.
 *
 * ── ⚠ THE CENTRAL DISTINCTION: RESUMABLE vs INTERRUPTING ─────────────
 *
 * Not every source deserves the same treatment when something else starts.
 *
 *   LONG-FORM (resumable)      a demo mix, a SoundCloud set, an uploaded track.
 *                              Someone listening to a 40-minute set has made a
 *                              commitment. Interrupting it must be temporary.
 *
 *   SHORT-FORM (interrupting)  a Voicey, an audio message. Communication.
 *                              Seconds long, and the reason you opened the app.
 *
 * A phone gets this right: a call pauses your music and the music comes back.
 * A messenger that stops your set to play a four-second voice note, and then
 * leaves you in silence, has taken something away.
 *
 * So: short-form PARKS long-form and resumes it. Short-form interrupting
 * short-form does not resume — two voice notes in a row is someone moving on,
 * not an interruption, and auto-resuming the first would be a player fighting
 * its listener.
 *
 * ── WHY A MODULE SINGLETON ───────────────────────────────────────────
 *
 * This is genuinely global: the rule holds across the thread, the drawer, the
 * mini player and any two components that never share a tree. A context would
 * work only where it was mounted, and lifting it would put playback in the app
 * shell for the sake of one reference.
 *
 * ── SOURCES ARE NOT ALL `<audio>` ELEMENTS ───────────────────────────
 *
 * A SoundCloud embed is an iframe driven through its widget API; a Voicey is a
 * media element. They cannot be paused the same way, so a source registers what
 * it CAN do rather than what it IS: `pause`, and optionally `resume`. The
 * manager never touches a DOM node it did not receive.
 */

/** What currently holds audio, or null. */
let current = null;

/**
 * The long-form source parked by an interruption, waiting to come back.
 *
 * Only ever one deep. If a Voicey interrupts a set, and a second Voicey
 * interrupts the first, the SET is still what resumes — the middle link is
 * short-form and was never resumable. A stack would model something that cannot
 * happen.
 */
let parked = null;

/** Kinds a source may declare. `long` is resumable; `short` interrupts. */
export const LONG = 'long';
export const SHORT = 'short';

/**
 * Take audio for this source, parking or stopping whatever held it.
 *
 * ⚠ CALL IMMEDIATELY BEFORE STARTING PLAYBACK, never after. Claiming afterwards
 * lets both sound for a frame — brief, audible, and exactly the defect this
 * exists to prevent.
 *
 * @param {object} source
 * @param {'long'|'short'} source.kind
 * @param {() => void} source.pause    stop this source where it is
 * @param {() => void} [source.resume] restart it from where it stopped; a
 *                                     source without this is never resumed
 */
export function claimAudio(source) {
  if (!source?.pause) return;

  const previous = current;
  current = source;

  if (!previous || previous === source) return;

  previous.pause();

  if (source.kind === SHORT && previous.kind === LONG && previous.resume) {
    // A short interruption over long-form playback: remember to bring it back.
    parked = previous;
  } else if (source.kind === SHORT && previous.kind === SHORT) {
    // ⚠ SHORT OVER SHORT KEEPS WHATEVER WAS ALREADY PARKED, and this branch is
    // the whole reason parking is one deep rather than a stack. Play a Voicey
    // over a set, then a second Voicey over the first: the middle link is
    // short-form and was never resumable, so the SET is still what should come
    // back. Clearing here — which an earlier version did — silently dropped the
    // music the moment two voice notes were played in a row, which is the
    // ordinary case, not an edge one.
  } else {
    // Any other handover — choosing a different set, or starting long-form
    // fresh — is a deliberate change of what is playing. Clearing is what stops
    // a set resuming an hour later because someone once played a Voicey over it.
    parked = null;
  }
}

/**
 * This source has finished or been stopped. Resume what it interrupted, if
 * anything.
 *
 * ⚠ RESUME BELONGS TO COMPLETION, NOT TO PAUSE. A listener who deliberately
 * pauses a Voicey half way has not asked for the music back — they have asked
 * for silence. Callers therefore call this on `ended`, and `releaseAudio` on a
 * manual stop.
 */
export function finishAudio(source) {
  if (current !== source) return;
  current = null;

  const toResume = parked;
  parked = null;

  if (source?.kind === SHORT && toResume?.resume) {
    toResume.resume();
    // It holds the claim again, so a later interruption parks it correctly.
    current = toResume;
  }
}

/**
 * Give up the claim WITHOUT resuming anything — a manual pause, or an unmount.
 *
 * Guarded because pause and unmount arrive in either order, and a late release
 * from an old source must not clear a claim a newer one has taken.
 */
export function releaseAudio(source) {
  if (current !== source) return;
  current = null;
  // ⚠ `parked` SURVIVES. Pausing a Voicey rather than letting it end should not
  // discard the set underneath it — the listener may still resume it by hand,
  // and forgetting it here would make that impossible.
}

/** Forget everything. Tests, and teardown. */
export function resetAudio() {
  current = null;
  parked = null;
}

/** Exported for tests and diagnostics. */
export function currentAudio() { return current; }
export function parkedAudio()  { return parked; }
