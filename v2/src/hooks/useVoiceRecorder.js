import { useState, useRef, useEffect, useCallback } from 'react';
import { startRecording, canRecordVoice } from '../lib/voiceNotes';
import { commitAxis, resolveGesture, CANCEL_DISTANCE_PX } from '../lib/voiceGesture';

/**
 * THE RECORDING STATE MACHINE, WITHOUT ANY UI.
 *
 * Lifted out of `VoiceRecorderButton` unchanged during the M9h composer
 * redesign. Not a rewrite — the teardown, the race guards and the gesture
 * arithmetic are the same code that was verified on a real device, and the
 * point of moving it is that it can now be driven by a composer that owns its
 * own row instead of a button that drew into someone else's.
 *
 *   idle ──press──▶ recording ──release──▶ uploading ──▶ sent ──▶ idle
 *                      │  │
 *                      │  └──slide up──▶ locked ──send──▶ uploading ──▶ …
 *                      │                   │
 *                      └──slide left───────┴──discard──▶ idle
 *
 * ── WHAT THE CALLER GETS AND WHAT IT MUST NOT DO ─────────────────────
 *
 * `handlers` go on the press target. `refs` go on the three animated nodes —
 * the hook writes transform and opacity to them directly during a drag, so a
 * pointermove never re-renders React. The caller decides what those nodes look
 * like; it must not decide when they move.
 *
 * `phase` is the only state the caller should branch on, and it must never be
 * copied into state of its own. A stored mode is a second source of truth that
 * can disagree with this one.
 */

/** Presses shorter than this send nothing — a tap is an accident, not a message. */
const MIN_DURATION_MS = 400;

/**
 * Hard ceiling (§6.3). At the measured ~27 kbps this is about 1.2 MB, well
 * inside M9b's 10 MB bucket limit.
 *
 * Reaching it STOPS AND SENDS. It never discards: someone who has talked for
 * six minutes meant it, and throwing it away at an invisible limit is the worst
 * available response.
 */
export const MAX_DURATION_MS   = 6 * 60 * 1000;
export const WARN_REMAINING_MS = 15 * 1000;

/** How long `sent` shows before returning to idle. */
const SENT_DWELL_MS = 900;

/** Ignore the click that ENDS the lock gesture. See onPrimaryClick. */
const LOCK_CLICK_GUARD_MS = 350;

export function useVoiceRecorder({ onRecorded, onNotice, disabled = false, dockRef } = {}) {
  const [phase,   setPhase]   = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  // True for one animation's length after locking, so the dock can confirm the
  // dock once. State rather than a class toggle because the animation must be
  // able to REPLAY on a second recording — a class that never leaves cannot.
  const [justLocked, setJustLocked] = useState(false);

  // Mirrors `phase` for synchronous reads inside event handlers, which see a
  // stale closure otherwise — the bug that lets a pointerup arrive believing it
  // is still recording after the gesture already locked.
  const phaseRef    = useRef('idle');
  const handleRef   = useRef(null);    // the live recorder
  const originRef   = useRef(null);    // {x, y} of the press
  const axisRef     = useRef(null);    // committed gesture axis
  const settledRef  = useRef(false);   // "only one gesture may succeed"
  const abortRef    = useRef(false);   // press ended before getUserMedia resolved
  const pointerRef  = useRef({ id: null, el: null });
  const tickRef     = useRef(null);
  const lockedAtRef = useRef(0);
  const rafRef      = useRef(null);
  const frameRef    = useRef({ dx: 0, dy: 0 });

  // Animated nodes, written directly during a drag.
  const buttonRef     = useRef(null);
  const cancelHintRef = useRef(null);
  const lockHintRef   = useRef(null);

  const supported = canRecordVoice();

  // Stable identity: LiveWaveform keys an interval on this, and a new function
  // each render would restart the sampling loop continuously.
  const readLevel = useCallback(() => handleRef.current?.level?.() ?? 0, []);

  const setPhaseBoth = useCallback(next => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Return every animated node to rest, in one place. */
  const resetVisuals = useCallback(() => {
    if (buttonRef.current) buttonRef.current.style.transform = 'translate3d(0,0,0)';
    if (cancelHintRef.current) cancelHintRef.current.style.opacity = '0';
    if (lockHintRef.current) {
      lockHintRef.current.style.opacity   = '0';
      lockHintRef.current.style.transform = 'translate3d(0,0,0)';
    }
    if (dockRef?.current) dockRef.current.style.setProperty('--dock-near', '0');
    frameRef.current = { dx: 0, dy: 0 };
  }, [dockRef]);

  /**
   * Release everything. Idempotent, and safe to call from any state.
   *
   * `mode` decides the recorder's fate: 'cancel' discards, 'keep' returns the
   * audio. Everything else is unconditional, because a teardown that only
   * cleans up on the happy path is not a teardown.
   */
  const teardown = useCallback(async (mode = 'cancel') => {
    const handle = handleRef.current;
    handleRef.current = null;

    clearInterval(tickRef.current);
    tickRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const { id, el } = pointerRef.current;
    if (id !== null && el?.hasPointerCapture?.(id)) {
      try { el.releasePointerCapture(id); } catch { /* already gone */ }
    }
    pointerRef.current = { id: null, el: null };

    originRef.current = null;
    axisRef.current   = null;
    resetVisuals();

    if (!handle) return null;
    if (mode === 'cancel') { handle.cancel(); return null; }
    try { return await handle.stop(); } catch { return null; }
  }, [resetVisuals]);

  // Unmount: drawer closed, or navigated away, possibly mid-press.
  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    clearInterval(tickRef.current);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const discard = useCallback(async () => {
    settledRef.current = true;
    await teardown('cancel');
    setElapsed(0);
    setPhaseBoth('idle');
  }, [teardown, setPhaseBoth]);

  /** Stop, hand the audio up, and show the upload through to its end. */
  const send = useCallback(async () => {
    settledRef.current = true;
    const result = await teardown('keep');

    if (!result) { setElapsed(0); setPhaseBoth('idle'); return; }

    if (result.durationMs < MIN_DURATION_MS) {
      // Silently dropping teaches nothing; the hint is what teaches the gesture.
      onNotice?.('Hold to record');
      setElapsed(0);
      setPhaseBoth('idle');
      return;
    }

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
  }, [teardown, onRecorded, onNotice, setPhaseBoth]);

  // Escape and blur, bound only while a recording exists.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'locked') return undefined;

    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); void discard(); } };

    // Blur while UNLOCKED cancels: the pointer gesture cannot complete once the
    // window is gone, and the pointerup may never arrive at all.
    //
    // Blur while LOCKED does NOT cancel — hands-free recording that survives an
    // app switch is the entire reason lock exists, and a notification stealing
    // focus must not destroy a recording in progress.
    const onBlur = () => { if (phaseRef.current === 'recording') void discard(); };

    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [phase, discard]);

  function lock() {
    settledRef.current  = true;      // the gesture is spent; nothing else may fire
    lockedAtRef.current = Date.now();

    // Hand the pointer back immediately, or Discard cannot be pressed —
    // capture would keep routing every event to the press target.
    const { id, el } = pointerRef.current;
    if (id !== null && el?.hasPointerCapture?.(id)) {
      try { el.releasePointerCapture(id); } catch { /* already gone */ }
    }
    pointerRef.current = { id: null, el: null };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    resetVisuals();
    setPhaseBoth('locked');

    setJustLocked(true);
    setTimeout(() => setJustLocked(false), 480);
  }

  /** One write per frame, transform and opacity only — never layout. */
  function paint() {
    rafRef.current = null;
    const { dx, dy } = frameRef.current;
    const axis = axisRef.current;
    const { cancelProgress, dockProgress } = resolveGesture({
      dx, dy, axis,
      point: { x: frameRef.current.x, y: frameRef.current.y },
      dockRect: dockRef?.current?.getBoundingClientRect() ?? null,
    });

    if (buttonRef.current) {
      // The microphone follows the finger on whichever axis was committed.
      // Horizontal travel is UNCAPPED in both directions — the dock's distance
      // depends on the width of the text field, so any cap would be wrong at
      // some viewport. Downward is capped at the cancel threshold, past which
      // the gesture has already fired and further travel means nothing.
      const x = axis === 'x' ? dx : 0;
      const y = axis === 'y' ? Math.max(0, Math.min(CANCEL_DISTANCE_PX, dy)) : 0;
      buttonRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    if (cancelHintRef.current) cancelHintRef.current.style.opacity = String(cancelProgress);

    // THE DOCK LIGHTS UP AS THE MICROPHONE NEARS IT. This is the entire
    // affordance — the reason nobody needs telling what the control is for.
    // Written as a CSS variable so the styling stays in the stylesheet while
    // the value tracks the finger at display rate, with no re-render.
    if (dockRef?.current) {
      dockRef.current.style.setProperty('--dock-near', dockProgress.toFixed(3));
    }
  }

  async function onPointerDown(e) {
    if (disabled || !supported || handleRef.current || phaseRef.current !== 'idle') return;

    // Keeps pointermove/up addressed here even when the finger leaves the
    // target — without it, sliding away stops delivering events and a cancel
    // gesture becomes indistinguishable from a press that never ended.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointerRef.current = { id: e.pointerId, el: e.currentTarget };

    originRef.current  = { x: e.clientX, y: e.clientY };
    axisRef.current    = null;
    settledRef.current = false;
    abortRef.current   = false;
    setElapsed(0);

    let handle;
    try {
      handle = await startRecording();
    } catch (err) {
      onNotice?.(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was declined'
          : 'Cannot record on this device',
      );
      await teardown('cancel');
      return;
    }

    // The press can END before getUserMedia resolves — a quick tap. The
    // pointerup handler already ran, found no handle and returned, so nothing
    // would ever stop this recorder and the microphone would stay open. A ref,
    // not state, because this runs inside an async gap where state is stale.
    if (abortRef.current) {
      handle.cancel();
      await teardown('cancel');
      return;
    }

    handleRef.current = handle;
    setPhaseBoth('recording');

    tickRef.current = setInterval(() => {
      const ms = handleRef.current?.elapsedMs() ?? 0;
      setElapsed(ms);
      if (ms >= MAX_DURATION_MS && !settledRef.current) void send();
    }, 100);
  }

  function onPointerMove(e) {
    // Locked has no gesture left to make: the finger is free and the recording
    // continues without it. This is also what stops horizontal movement from
    // cancelling after a lock.
    if (phaseRef.current !== 'recording' || settledRef.current || !originRef.current) return;

    const dx = e.clientX - originRef.current.x;
    const dy = e.clientY - originRef.current.y;

    if (!axisRef.current) axisRef.current = commitAxis(dx, dy);

    frameRef.current = { dx, dy, x: e.clientX, y: e.clientY };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(paint);

    const { action } = resolveGesture({
      dx, dy, axis: axisRef.current,
      point: { x: e.clientX, y: e.clientY },
      dockRect: dockRef?.current?.getBoundingClientRect() ?? null,
    });
    if (action === 'cancel')    void discard();
    else if (action === 'lock') lock();
  }

  /**
   * Send, when locked — but not on the click that ENDED the lock gesture.
   *
   * `lock()` releases pointer capture so Discard becomes pressable, which means
   * the following pointerup goes to whatever is under the finger. Release above
   * the button and it targets the row; drift back down over the button first
   * and it targets the button, synthesising a click that would send the instant
   * the user locked — without them ever pressing Send.
   */
  function onPrimaryClick() {
    if (Date.now() - lockedAtRef.current < LOCK_CLICK_GUARD_MS) return;
    void send();
  }

  function onPointerUp() {
    abortRef.current = true;        // covers the pre-getUserMedia tap
    if (phaseRef.current !== 'recording' || settledRef.current) return;
    void send();
  }

  function onPointerCancel() {
    abortRef.current = true;
    if (phaseRef.current === 'recording' && !settledRef.current) void discard();
  }

  function onLostPointerCapture() {
    // A press that ended somewhere the target never saw. Only meaningful while
    // still recording — locking releases capture deliberately.
    abortRef.current = true;
    if (phaseRef.current === 'recording' && !settledRef.current) void discard();
  }

  return {
    phase,
    elapsed,
    supported,
    remaining: MAX_DURATION_MS - elapsed,
    closing:   MAX_DURATION_MS - elapsed <= WARN_REMAINING_MS,
    active:    phase === 'recording' || phase === 'locked',
    busy:      phase === 'uploading',

    send,
    discard,

    /**
     * Current loudness, 0..1, or 0 when nothing is recording.
     *
     * A stable function that reads through the ref, so the consumer can hold it
     * across renders without its effect restarting every frame.
     */
    getLevel: readLevel,
    justLocked,

    /** Spread onto the press target. */
    handlers: {
      onPointerDown, onPointerMove, onPointerUp,
      onPointerCancel, onLostPointerCapture,
    },
    onPrimaryClick,

    /** Attach to the animated nodes. The hook writes to them during a drag. */
    refs: { button: buttonRef, cancelHint: cancelHintRef, lockHint: lockHintRef },
  };
}
