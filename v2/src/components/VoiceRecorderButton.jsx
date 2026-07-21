import { useState, useRef, useEffect, useCallback } from 'react';
import { startRecording, canRecordVoice, formatDuration } from '../lib/voiceNotes';
import { commitAxis, resolveGesture, CANCEL_DISTANCE_PX, LOCK_DISTANCE_PX } from '../lib/voiceGesture';

/**
 * HOLD TO RECORD · SLIDE LEFT TO CANCEL · SLIDE UP TO LOCK.
 *
 * Owns the gesture, the microphone and the recording lifecycle. Knows nothing
 * about messaging: it hands the caller a blob, a duration and the negotiated
 * capture settings, and never learns what happens to them.
 *
 * ── THE STATE MACHINE IS EXPLICIT, AND IT IS THE WHOLE COMPONENT ─────
 *
 *   idle ──press──▶ recording ──release──▶ uploading ──▶ sent ──▶ idle
 *                      │  │
 *                      │  └──slide up──▶ locked ──send──▶ uploading ──▶ …
 *                      │                   │
 *                      └──slide left───────┴──cancel──▶ cancelled ──▶ idle
 *
 * Every transition is named and every one runs `teardown()`. The alternative —
 * booleans for recording, locked, cancelling — makes illegal states
 * representable (locked while cancelling, uploading while recording) and those
 * are exactly the states that leave a microphone open.
 *
 * ── WHY POINTERMOVE DOES NOT CALL setState ───────────────────────────
 *
 * A drag fires pointermove at display rate. Re-rendering React on each one to
 * move a button by three pixels drops frames on a mid-range phone during the
 * single interaction where smoothness is the entire product impression.
 *
 * So movement writes `transform` and `opacity` straight to DOM nodes through
 * refs, batched into one rAF. React state changes only on the discrete
 * transitions above — six times per recording, not six hundred.
 *
 * Everything animated is `transform` or `opacity`, so nothing here can cause a
 * reflow, and the recording bar is absolutely positioned over the composer so
 * appearing costs no layout either.
 *
 * ── EVERY EXIT PATH RELEASES EVERYTHING ──────────────────────────────
 *
 * A press ends in more ways than it looks like it can:
 *
 *   pointerup             the normal case — send
 *   slide left            deliberate cancel
 *   slide up              lock; the press ends but recording continues
 *   pointercancel         the browser took the gesture (scroll, call, app switch)
 *   lostpointercapture    the press ended somewhere this element never sees
 *   Escape                desktop, and the only keyboard way out of locked
 *   window blur           the gesture cannot be completed once focus is gone
 *   unmount               drawer closed, or navigation away mid-press
 *
 * All of them route through `teardown()`, which stops the recorder, stops every
 * track, closes the AudioContext (in `voiceNotes`), clears the timer and
 * releases pointer capture. Miss one and the browser's recording indicator
 * stays lit with nothing on screen to explain it — the user cannot make it
 * stop, and has no reason to trust the app afterwards.
 */

/** Presses shorter than this send nothing — a tap is an accident, not a message. */
const MIN_DURATION_MS = 400;

/**
 * Hard ceiling (§6.3 — "sensible ceiling on duration to bound storage, value to
 * be set by product"). At the measured ~27 kbps this is about 1.2 MB, well
 * inside M9b's 10 MB bucket limit.
 *
 * Reaching it STOPS AND SENDS. It never discards: a user who has talked for six
 * minutes has said something they meant, and throwing it away at the moment
 * they hit an invisible limit is the worst possible response.
 */
const MAX_DURATION_MS  = 6 * 60 * 1000;
const WARN_REMAINING_MS = 15 * 1000;

/** How long "Sent" shows before returning to idle. */
const SENT_DWELL_MS = 900;

export default function VoiceRecorderButton({ onRecorded, disabled = false, onNotice }) {
  const [phase,   setPhase]   = useState('idle');   // idle|recording|locked|uploading|sent
  const [elapsed, setElapsed] = useState(0);

  // Mirrors `phase` for synchronous reads inside event handlers, which see a
  // stale closure otherwise — the bug that lets a pointerup arrive believing it
  // is still recording after the gesture already locked.
  const phaseRef   = useRef('idle');
  const handleRef  = useRef(null);    // the live recorder
  const originRef  = useRef(null);    // {x, y} of the press
  const axisRef    = useRef(null);    // committed gesture axis
  const settledRef = useRef(false);   // "only one gesture may succeed"
  const abortRef   = useRef(false);   // press ended before getUserMedia resolved
  const pointerRef = useRef({ id: null, el: null });
  const tickRef    = useRef(null);
  const lockedAtRef = useRef(0);    // guards the click that ends the lock gesture
  const rafRef     = useRef(null);
  const frameRef   = useRef({ dx: 0, dy: 0 });

  // Animated nodes, written directly during a drag.
  const buttonRef = useRef(null);
  const cancelRef = useRef(null);
  const lockRef   = useRef(null);

  const supported = canRecordVoice();

  const setPhaseBoth = useCallback(next => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /**
   * Release everything. Idempotent, and safe to call from any state.
   *
   * `mode` decides the recorder's fate: 'cancel' discards, 'keep' returns the
   * audio. Everything else it does is unconditional, because a teardown that
   * only cleans up on the happy path is not a teardown.
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
  }, []);

  /** Return every animated node to rest, without transition, in one place. */
  function resetVisuals() {
    if (buttonRef.current) buttonRef.current.style.transform = 'translate3d(0,0,0)';
    if (cancelRef.current) cancelRef.current.style.opacity = '0';
    if (lockRef.current) {
      lockRef.current.style.opacity   = '0';
      lockRef.current.style.transform = 'translate3d(0,0,0)';
    }
    frameRef.current = { dx: 0, dy: 0 };
  }

  // Unmount: drawer closed, or navigated away, possibly mid-press.
  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    clearInterval(tickRef.current);
    cancelAnimationFrame(rafRef.current);
  }, []);

  // Escape and blur. Bound only while a recording exists, so the app is not
  // carrying global listeners for a button nobody is using.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'locked') return undefined;

    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); void abandon(); } };

    // Blur while UNLOCKED cancels: the pointer gesture cannot be completed once
    // the window is gone, and the pointerup may never arrive at all.
    //
    // Blur while LOCKED does NOT cancel — hands-free recording that survives an
    // app switch is the entire reason lock exists, and a notification stealing
    // focus must not destroy a recording in progress.
    const onBlur = () => { if (phaseRef.current === 'recording') void abandon(); };

    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function abandon() {
    settledRef.current = true;
    await teardown('cancel');
    setElapsed(0);
    setPhaseBoth('idle');
  }

  /** Stop, hand the audio up, and show the upload through to its end. */
  async function finish() {
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
        // Guard: a new recording may already have started during the dwell.
        if (phaseRef.current === 'sent') { setElapsed(0); setPhaseBoth('idle'); }
      }, SENT_DWELL_MS);
    } catch {
      setPhaseBoth('idle');
    }
  }

  // ── the press ─────────────────────────────────────────────────────

  async function onPointerDown(e) {
    if (disabled || !supported || handleRef.current || phaseRef.current !== 'idle') return;

    // Keeps pointermove/up addressed here even when the finger leaves the
    // button — without it, sliding away stops delivering events and a cancel
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
      // Never discards. See MAX_DURATION_MS.
      if (ms >= MAX_DURATION_MS && !settledRef.current) void finish();
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

    frameRef.current = { dx, dy };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(paint);

    const { action } = resolveGesture(dx, dy, axisRef.current);
    if (action === 'cancel')    void abandon();
    else if (action === 'lock') lock();
  }

  /** One write per frame, transform and opacity only — never layout. */
  function paint() {
    rafRef.current = null;
    const { dx, dy } = frameRef.current;
    const axis = axisRef.current;
    const { cancelProgress, lockProgress } = resolveGesture(dx, dy, axis);

    if (buttonRef.current) {
      // The button follows the finger along the committed axis only, so a
      // drifting drag does not wander diagonally away from the gesture.
      const x = axis === 'x' ? Math.max(-CANCEL_DISTANCE_PX, Math.min(0, dx)) : 0;
      const y = axis === 'y' ? Math.max(-LOCK_DISTANCE_PX,   Math.min(0, dy)) : 0;
      buttonRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    if (cancelRef.current) cancelRef.current.style.opacity = String(cancelProgress);
    if (lockRef.current) {
      lockRef.current.style.opacity   = String(Math.max(0.35, lockProgress));
      lockRef.current.style.transform = `translate3d(0, ${-8 * lockProgress}px, 0)`;
    }
  }

  function lock() {
    settledRef.current = true;      // the gesture is spent; nothing else may fire
    lockedAtRef.current = Date.now();

    // Hand the pointer back immediately, or the Send and Cancel buttons cannot
    // be pressed — capture would keep routing every event to the mic button.
    const { id, el } = pointerRef.current;
    if (id !== null && el?.hasPointerCapture?.(id)) {
      try { el.releasePointerCapture(id); } catch { /* already gone */ }
    }
    pointerRef.current = { id: null, el: null };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    resetVisuals();
    setPhaseBoth('locked');
  }

  /**
   * Send, when locked — but not on the click that ENDED the lock gesture.
   *
   * `lock()` releases pointer capture so Cancel becomes pressable, which means
   * the subsequent pointerup goes to whatever is under the finger. Release
   * above the button and it targets the form; drift back down over the button
   * first and it targets the button, synthesising a click that would send the
   * instant the user locked — without them ever pressing Send.
   *
   * A short deadline after locking distinguishes "the gesture finishing" from
   * "a deliberate press", which nothing in the click event itself can.
   */
  function onPrimaryClick() {
    if (Date.now() - lockedAtRef.current < 350) return;
    void finish();
  }

  function onPointerUp() {
    abortRef.current = true;        // covers the pre-getUserMedia tap

    // Locked, cancelled or already sending: the press ending means nothing.
    if (phaseRef.current !== 'recording' || settledRef.current) return;
    void finish();
  }

  function onPointerCancel() {
    abortRef.current = true;
    if (phaseRef.current === 'recording' && !settledRef.current) void abandon();
  }

  function onLostPointerCapture() {
    // A press that ended somewhere this element never saw. Only meaningful
    // while still recording — locking releases capture deliberately.
    abortRef.current = true;
    if (phaseRef.current === 'recording' && !settledRef.current) void abandon();
  }

  if (!supported) return null;   // no button at all, rather than one that cannot work

  const active    = phase === 'recording' || phase === 'locked';
  const remaining = MAX_DURATION_MS - elapsed;
  const closing   = remaining <= WARN_REMAINING_MS;

  return (
    <>
      {/* Absolutely positioned over the composer: appearing costs no layout, so
          nothing reflows at the moment smoothness matters most. */}
      {(active || phase === 'uploading' || phase === 'sent') && (
        <div style={{
          position: 'absolute', inset: '0 62px 0 0',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 4px 0 16px', pointerEvents: active ? 'auto' : 'none',
        }}>
          {phase === 'uploading' || phase === 'sent' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: phase === 'sent' ? '#3DDC84' : 'var(--muted)',
              }} />
              {phase === 'sent' ? 'Sent' : 'Sending…'}
            </div>
          ) : (
            <>
              <span style={{
                width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                background: closing ? '#FFB020' : '#FF3B5C',
                animation: 'ypPulse 1.4s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', flexShrink: 0 }}>
                {formatDuration(elapsed / 1000)}
              </span>

              {closing && (
                <span style={{ fontSize: 11.5, color: '#FFB020', flexShrink: 0 }}>
                  {formatDuration(Math.max(0, remaining) / 1000)} left
                </span>
              )}

              {phase === 'locked' ? (
                // CANCEL ONLY. Send is the primary button — see the comment on
                // `finish` there. Two Sends would be two answers to the same
                // question, and the one in here is the one that can be squeezed.
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    Locked
                  </span>
                  <button
                    type="button" onClick={() => void abandon()} aria-label="Discard recording"
                    style={ghostButton}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span
                  ref={cancelRef}
                  style={{
                    marginLeft: 'auto', opacity: 0, fontSize: 12, color: 'var(--neon)',
                    whiteSpace: 'nowrap', willChange: 'opacity',
                  }}
                >
                  ◀ Release to cancel
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* The lock affordance sits above the button and only exists mid-gesture. */}
      {phase === 'recording' && (
        <div
          ref={lockRef}
          aria-hidden="true"
          style={{
            position: 'absolute', right: 20, bottom: 62,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            opacity: 0, willChange: 'transform, opacity', pointerEvents: 'none',
            fontSize: 11, color: 'var(--muted)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>▲</span>
        </div>
      )}

      {/* THE PRIMARY BUTTON, AND WHY IT SENDS WHEN LOCKED.
 *
 * It used to show a padlock and do nothing. That made `locked` a state whose
 * completion path lived only in the bar to the left — present, but competing
 * for horizontal space — while the one control that can never be squeezed, is
 * always under the thumb, and sits exactly where Send lives for text, was
 * inert. Pressing the obvious thing and getting nothing reads as "there is no
 * way to send", which is how this was reported.
 *
 * So locked makes this Send. The completion path is now structurally
 * guaranteed rather than dependent on layout: this button is 46px, flexShrink 0
 * and always rendered, so no width, no timer string and no translation can take
 * it away.
 *
 * Pointer handlers stay bound in every phase — they no-op unless idle — because
 * removing and re-adding them across a state change is how a pointer sequence
 * gets orphaned mid-gesture. */}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || phase === 'uploading'}
        onClick={phase === 'locked' ? onPrimaryClick : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onContextMenu={e => e.preventDefault()}   // suppresses the iOS hold callout
        // Every phase names itself. The last branch used to catch `uploading`
        // and `sent` too, so the button announced "Hold to record" while it was
        // busy sending and refusing presses — a label describing an action that
        // would not happen.
        aria-label={
          phase === 'locked'    ? 'Send voice message'
          : phase === 'recording' ? 'Recording — release to send, slide left to cancel, slide up to lock'
          : phase === 'uploading' ? 'Sending voice message'
          : phase === 'sent'      ? 'Voice message sent'
          : 'Hold to record a voice message'
        }
        style={{
          position: 'relative', zIndex: 1,
          border: 'none', borderRadius: 999, width: 46, height: 46, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          touchAction: 'none',        // or the browser scrolls instead of recording
          userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          willChange: 'transform',
          background: active ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.07)',
          color: active ? '#0a0a0f' : 'rgba(255,255,255,.72)',
          // No transition on transform: it must track the finger exactly. The
          // background may ease, because nothing is dragging it.
          transition: 'background .2s ease',
        }}
      >
        {phase === 'locked' ? (
          // The same paper plane the text composer sends with — locked
          // recording finishes the way every other message does.
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        ) : (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
          </svg>
        )}
      </button>
    </>
  );
}

const ghostButton = {
  border: '1px solid rgba(255,255,255,.18)',
  background: 'rgba(255,255,255,.06)',
  color: 'var(--text)',
  borderRadius: 999,
  padding: '7px 14px',
  fontSize: 12.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
