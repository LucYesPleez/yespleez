import { useState, useRef, useEffect, useCallback } from 'react';
import { startRecording, canRecordVoice } from '../lib/voiceNotes';
import { computeRawEnvelope, combineEnvelopes } from '../lib/voiceWave';
import { decideToggle, decideSend, decideInterrupt, isTooShort } from '../lib/voiceMachine';

/**
 * THE RECORDING STATE MACHINE, WITHOUT ANY UI.
 *
 *   idle ──toggle──▶ recording ──toggle──▶ pending ──send──▶ uploading ──▶ sent ──▶ idle
 *                        │                    │
 *                        ├──send────────────▶ uploading
 *                        ├──discard──▶ idle   └──discard──▶ idle
 *                        └──6:00─────────────▶ uploading
 *
 * ── WHY THERE IS NO GESTURE ANY MORE (M9s) ───────────────────────────
 *
 * Recording used to be a press-and-hold with a drag: hold the microphone, drag
 * it sideways into a dock to lock, drag it down to discard. That model existed
 * to solve a problem hold-to-record creates and nothing else does — your finger
 * is stuck on the button, so there has to be a way to get it back. Lock was the
 * escape hatch.
 *
 * The microphone is now a TOGGLE that slides between the ends of its pill. You
 * are never holding anything, so there is nothing to escape from, and the whole
 * lock concept goes with it — along with the axis arithmetic, the dead zone,
 * the dock hit test and the pointer capture that made a drag survive leaving
 * the button. `lib/voiceGesture.js` is deleted, not disabled.
 *
 * ── WHY `pending` EXISTS ─────────────────────────────────────────────
 *
 * Toggling back stops capture but does NOT send. Under the old model, letting
 * go WAS sending, so there was never a finished-but-unsent recording. A toggle
 * separates those acts, and the state between them has to be real: the audio
 * exists, it is not going anywhere, and the user decides.
 *
 * That is the one thing this rewrite ADDS. Everything else it removes.
 *
 * ── WHAT THE CALLER GETS ─────────────────────────────────────────────
 *
 * `phase` is the only state the caller should branch on, and it must never be
 * copied into state of its own. A stored mode is a second source of truth that
 * can disagree with this one — the bug that produced a locked state with no way
 * out.
 */

/**
 * The too-short notice. Under the old hold model this read "Hold to record",
 * which taught the gesture; there is no gesture left to teach, so it says what
 * actually happened. The threshold itself lives in `lib/voiceMachine`.
 */
const TOO_SHORT_NOTICE = 'Too short to send';

/**
 * Hard ceiling (§6.3). At the measured ~27 kbps this is about 1.2 MB, well
 * inside M9b's 10 MB bucket limit.
 *
 * Reaching it STOPS AND SENDS. It never discards: someone who has talked for
 * six minutes meant it, and throwing it away at an invisible limit is the worst
 * available response. It does not stop to `pending` either — an unattended
 * recording that hits the ceiling should complete, not wait for a press that
 * may never come.
 */
export const MAX_DURATION_MS   = 6 * 60 * 1000;
export const WARN_REMAINING_MS = 15 * 1000;

/** How long `sent` shows before returning to idle. */
const SENT_DWELL_MS = 900;

export function useVoiceRecorder({ onRecorded, onNotice, onPark, onDiscard, disabled = false } = {}) {
  const [phase,   setPhase]   = useState('idle');
  const [elapsed, setElapsed] = useState(0);

  // Mirrors `phase` for synchronous reads inside async gaps and interval
  // callbacks, which see a stale closure otherwise.
  const phaseRef    = useRef('idle');
  const handleRef   = useRef(null);   // the live recorder
  const pendingRef  = useRef(null);   // a finished (combined) recording awaiting send
  // ⚠ SEGMENTS — the internal storage of one Voicey. Resume Recording appends a
  // new recording here when the user continues after a pause or a call. The user
  // never sees "segments"; the composer and the recipient see ONE note. This is
  // the array of raw {blob,durationMs,capture} results; the combined note is
  // rebuilt from it (one duration, one waveform) on every park.
  const segmentsRef = useRef([]);
  // One RAW envelope per segment, computed once when that segment is recorded.
  // The note's waveform is these concatenated and normalised — so a resume never
  // re-decodes a segment the user already finished (the "no expensive merge"
  // rule), and Send stays instant because the wave is already done.
  const rawEnvsRef  = useRef([]);
  const priorMsRef  = useRef(0);      // total ms of already-parked segments, for the live timer
  const abortRef    = useRef(false);  // toggled off before getUserMedia resolved
  const startingRef = useRef(false);  // inside the getUserMedia gap
  const tickRef     = useRef(null);

  const supported = canRecordVoice();

  // Stable identity: LiveWaveform keys an interval on this, and a new function
  // each render would restart the sampling loop continuously.
  const readLevel = useCallback(() => handleRef.current?.level?.() ?? 0, []);

  const setPhaseBoth = useCallback(next => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /**
   * Release the recorder. Idempotent, and safe to call from any state.
   *
   * `mode` decides the audio's fate: 'cancel' discards, 'keep' returns it.
   * Everything else is unconditional, because a teardown that only cleans up on
   * the happy path is not a teardown.
   */
  const teardown = useCallback(async (mode = 'cancel') => {
    const handle = handleRef.current;
    handleRef.current = null;

    clearInterval(tickRef.current);
    tickRef.current = null;

    if (!handle) return null;
    if (mode === 'cancel')  { handle.cancel(); return null; }
    // 'salvage' never rejects — it returns whatever an interruption left behind.
    if (mode === 'salvage') { try { return await handle.salvage(); } catch { return null; } }
    try { return await handle.stop(); } catch { return null; }
  }, []);

  // Unmount: drawer closed, or navigated away, possibly mid-recording. The
  // pending blob goes too — it belongs to a composer that no longer exists.
  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    pendingRef.current = null;
    segmentsRef.current = [];
    rawEnvsRef.current  = [];

    priorMsRef.current = 0;
    clearInterval(tickRef.current);
  }, []);

  /** Throw away whatever exists — live recording or parked note. */
  const discard = useCallback(async () => {
    // Covers a discard racing a start that has not resolved yet: the recorder
    // does not exist to be torn down, so the flag is the only thing that can
    // stop it arriving.
    abortRef.current = true;
    await teardown('cancel');
    pendingRef.current  = null;
    segmentsRef.current = [];
    rawEnvsRef.current  = [];

    priorMsRef.current  = 0;
    setElapsed(0);
    setPhaseBoth('idle');
    // Discard is one of the few acts allowed to destroy a recording — so it must
    // also clear any draft that was persisted for it, or the note the user threw
    // away would reappear on the next visit.
    try { onDiscard?.(); } catch { /* clearing a draft must not break discard */ }
  }, [teardown, setPhaseBoth, onDiscard]);

  /** Upload a finished result and show it through to its end. */
  const upload = useCallback(async result => {
    setPhaseBoth('uploading');
    try {
      await onRecorded?.(result);
      setPhaseBoth('sent');
      setTimeout(() => {
        // A new recording may already have started during the dwell.
        if (phaseRef.current === 'sent') { setElapsed(0); setPhaseBoth('idle'); }
      }, SENT_DWELL_MS);
    } catch {
      setPhaseBoth('idle');
    }
  }, [onRecorded, setPhaseBoth]);

  /**
   * Stop capturing and PARK the result. The audio is finished; nothing is sent.
   *
   * Returns the parked result so `send` can stop-and-send in one act without
   * routing through a `pending` render the user would see flash past.
   */
  /**
   * Fold a just-finished recording into the note and rebuild the combined
   * result — ONE note across every segment. The new segment is appended (unless
   * too short, in which case prior segments are kept and it is dropped), then
   * the waveform is recomputed continuously across all of them and the duration
   * summed. Returns null only when nothing valid exists at all.
   */
  const buildCombined = useCallback(async (newResult) => {
    if (newResult && !isTooShort(newResult)) {
      segmentsRef.current.push(newResult);
      // Decode ONLY the new segment — the earlier ones' envelopes are already
      // in rawEnvsRef. This is what keeps a resume cheap however long the note.
      rawEnvsRef.current.push(await computeRawEnvelope(newResult.blob));
    }
    const segs = segmentsRef.current;
    if (!segs.length) return null;

    const blobs      = segs.map(s => s.blob);
    const durationMs = segs.reduce((n, s) => n + (s.durationMs || 0), 0);
    const segMs      = segs.map(s => Math.max(0, Math.round(s.durationMs || 0)));
    // Concatenate the per-segment envelopes and normalise once — one continuous
    // waveform across the whole note, no re-decode.
    const wave       = combineEnvelopes(rawEnvsRef.current);
    return { segments: blobs, durationMs, segMs, wave, capture: segs[segs.length - 1].capture };
  }, []);

  const park = useCallback(async (mode = 'keep') => {
    const result = await teardown(mode);
    const combined = await buildCombined(result);

    if (!combined) {
      // Nothing long enough to keep — and no prior segments to fall back to.
      if (result) onNotice?.(TOO_SHORT_NOTICE);
      segmentsRef.current = [];
      rawEnvsRef.current  = [];

      priorMsRef.current  = 0;
      pendingRef.current  = null;
      setElapsed(0);
      setPhaseBoth('idle');
      return null;
    }

    pendingRef.current = combined;
    priorMsRef.current = combined.durationMs;   // a later resume counts from here
    setElapsed(combined.durationMs);
    setPhaseBoth('pending');
    // A parked note is durable content the moment it exists (toggle-off OR a
    // call). onPark persists it as a draft — with all its segments — so it
    // survives a reload, a crash, or the app being closed.
    try { onPark?.(combined); } catch { /* persistence must not break the recorder */ }
    return combined;
  }, [teardown, buildCombined, onNotice, setPhaseBoth, onPark]);

  /**
   * An interruption ended the capture — a call, the mic taken, headphones
   * pulled, the OS suspending audio. Salvage what was recorded and PARK it.
   *
   * ⚠ THE CONSTITUTIONAL RULE (decideInterrupt): a recording in progress is
   * never lost to anything but explicit Delete. This fires from voiceNotes when
   * the audio pipeline breaks; it turns that break into a draft the user can
   * send, replay or delete — the same three choices a clean stop gives them.
   *
   * Guards on phase: an interruption arriving while already parked, idle or
   * uploading has nothing to do. The pipeline events fire at most once per
   * recording, but a late one must still be inert.
   */
  const onInterrupt = useCallback(async () => {
    if (decideInterrupt({ phase: phaseRef.current }) !== 'park') return;
    const parked = await park('salvage');
    if (parked) onNotice?.('Recording saved — you were interrupted');
  }, [park, onNotice]);

  /**
   * Send — from either state that can hold audio.
   *
   * While recording this stops and sends in one act. While pending it uploads
   * what is already parked. Both are "the user pressed Send", so they are one
   * function rather than two the caller has to choose between.
   */
  const send = useCallback(async () => {
    const action = decideSend({ phase: phaseRef.current });

    if (action === 'upload-parked') {
      const held = pendingRef.current;   // already combined across segments
      pendingRef.current = null;
      segmentsRef.current = [];
      rawEnvsRef.current  = [];

      priorMsRef.current = 0;
      if (!held) { setElapsed(0); setPhaseBoth('idle'); return; }
      await upload(held);
      return;
    }

    if (action !== 'stop-and-upload') return;

    // Recording → send in one act. Fold the final segment in and send the whole
    // note (which may be several segments if the user resumed and then sent
    // without parking).
    const result = await teardown('keep');
    const combined = await buildCombined(result);
    segmentsRef.current = [];
    rawEnvsRef.current  = [];

    priorMsRef.current = 0;
    if (!combined) {
      if (result) onNotice?.(TOO_SHORT_NOTICE);
      setElapsed(0);
      setPhaseBoth('idle');
      return;
    }

    await upload(combined);
  }, [teardown, buildCombined, upload, onNotice, setPhaseBoth]);

  /** Begin capturing. */
  const start = useCallback(async () => {
    if (disabled || !supported || handleRef.current || startingRef.current) return;
    if (phaseRef.current !== 'idle') return;

    abortRef.current    = false;
    startingRef.current = true;
    // ⚠ BASELINE TO THE ACCUMULATED DURATION, NOT 0. On a resume the note is
    // already 2:37 long; the timer must continue from there the instant Continue
    // is pressed, never flash back to 0:00 — that flash is the one place the
    // segmented implementation would show through. A fresh recording has
    // priorMs 0, so this is 0 for it.
    setElapsed(priorMsRef.current);

    let handle;
    try {
      // onInterrupt fires when the audio pipeline breaks mid-recording. It is
      // registered here, at the source, because the recorder, its stream and
      // its AudioContext all live inside startRecording — the only place their
      // failure events can be heard.
      handle = await startRecording({ onInterrupt: () => void onInterrupt() });
    } catch (err) {
      startingRef.current = false;
      onNotice?.(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was declined'
          : 'Cannot record on this device',
      );
      await teardown('cancel');
      setElapsed(0);
      setPhaseBoth('idle');
      return;
    }

    startingRef.current = false;

    // The toggle can be pressed AGAIN before getUserMedia resolves. Without
    // this the second press finds no handle, returns, and nothing would ever
    // stop this recorder — the microphone would stay open with nothing on
    // screen to explain it. A ref, not state, because this runs inside an async
    // gap where state is stale.
    if (abortRef.current) {
      handle.cancel();
      await teardown('cancel');
      setElapsed(0);
      setPhaseBoth('idle');
      return;
    }

    handleRef.current = handle;
    setPhaseBoth('recording');

    tickRef.current = setInterval(() => {
      // ⚠ COUNTS FROM priorMs — the total of segments already recorded. On a
      // fresh recording that is 0; on a resume it is where the note left off, so
      // the live timer shows the WHOLE note's length, not just this segment, and
      // the 6-minute ceiling is measured across the whole note as it should be.
      const ms = priorMsRef.current + (handleRef.current?.elapsedMs() ?? 0);
      setElapsed(ms);
      if (ms >= MAX_DURATION_MS) void send();
    }, 100);
  }, [disabled, supported, onNotice, teardown, send, setPhaseBoth, onInterrupt]);

  /**
   * CONTINUE a parked note — record another segment and append it. This is what
   * makes Resume Recording work: a stopped MediaRecorder cannot resume, so
   * "continue" records a fresh segment and the note is rebuilt across all of
   * them (one duration, one waveform). Prior segments stay in segmentsRef; the
   * live timer counts on from where the note left off. The user never sees
   * "segments" — to them the same note simply gets longer.
   */
  const resume = useCallback(async () => {
    if (phaseRef.current !== 'pending') return;
    priorMsRef.current = pendingRef.current?.durationMs ?? 0;
    pendingRef.current = null;      // rebuilt on the next park; segmentsRef retained
    phaseRef.current   = 'idle';    // so start()'s idle guard passes
    await start();
  }, [start]);

  /**
   * THE TOGGLE. Slide right-to-left to record, left-to-right to stop.
   *
   * From `pending` it starts a NEW recording, discarding the parked one. The
   * microphone sitting back at the idle end is the only thing it can honestly
   * mean — the alternative is a toggle that does nothing in one of the three
   * states it is visible in.
   */
  const toggle = useCallback(async () => {
    if (disabled || !supported) return;

    switch (decideToggle({ phase: phaseRef.current, starting: startingRef.current })) {
      // Pressed again inside the getUserMedia gap. `start` honours this flag
      // when it resolves, and cancels the recorder it just opened.
      case 'abort-start':
        abortRef.current = true;
        return;

      case 'park':
        await park();
        return;

      case 'start':
        // Starting over discards a parked note AND all its segments — this is a
        // fresh note, not a continuation (that is `resume`).
        pendingRef.current  = null;
        segmentsRef.current = [];
        rawEnvsRef.current  = [];

        priorMsRef.current  = 0;
        phaseRef.current    = 'idle';    // so `start`'s idle guard passes
        await start();
        return;

      default:
        return;
    }
  }, [disabled, supported, park, start]);

  // Escape discards from any state that holds audio.
  //
  // NOTE: blur does NOT cancel, and that is a deliberate change. Under the hold
  // model an unlocked recording was cancelled on blur because the pointer
  // gesture could no longer complete and `pointerup` might never arrive. A
  // toggle has no such dependency — it is hands-free by construction, which is
  // exactly what lock used to buy. A notification stealing focus must not
  // destroy a recording in progress.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'pending') return undefined;
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); void discard(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, discard]);

  return {
    phase,
    elapsed,
    supported,
    remaining: MAX_DURATION_MS - elapsed,
    closing:   MAX_DURATION_MS - elapsed <= WARN_REMAINING_MS,
    recording: phase === 'recording',
    pending:   phase === 'pending',
    /** Anything the composer must not lose: live capture or a parked note. */
    active:    phase === 'recording' || phase === 'pending',
    busy:      phase === 'uploading',

    toggle,
    send,
    discard,
    resume,

    /**
     * Current loudness, 0..1, or 0 when nothing is recording.
     *
     * A stable function that reads through the ref, so the consumer can hold it
     * across renders without its effect restarting every frame.
     */
    getLevel: readLevel,
  };
}
