import { useState, useRef, useEffect } from 'react';
import { startRecording, canRecordVoice, formatDuration } from '../lib/voiceNotes';

/**
 * HOLD TO RECORD, RELEASE TO SEND, SLIDE AWAY TO CANCEL.
 *
 * Owns the gesture and the microphone; owns nothing about messaging. It hands
 * the caller a blob and a duration and has no idea a conversation exists.
 *
 * ── EVERY WAY A PRESS CAN END MUST RELEASE THE MICROPHONE ────────────
 *
 * A held button ends in more ways than it looks:
 *
 *   pointerup       the normal case — send
 *   slide away      deliberate cancel, the gesture everyone expects
 *   pointercancel   the browser took the gesture (scroll, call, app switch)
 *   unmount         the drawer closed mid-press
 *
 * All four run cancel() or stop(), both of which stop the media tracks. A path
 * that misses leaves the browser's recording indicator lit with nothing on
 * screen explaining why — the user has no way to make it stop, and no reason
 * to trust the app afterwards.
 *
 * ── WHY POINTER CAPTURE ──────────────────────────────────────────────
 *
 * Without it, sliding the finger off the button stops delivering pointermove
 * and pointerup to this element, so a cancel gesture would look identical to
 * the press never ending. Capture keeps the whole gesture addressed here
 * regardless of what it slides over.
 */

/** Slide this far from where the press started to cancel instead of send. */
const CANCEL_DISTANCE_PX = 60;

/**
 * Presses shorter than this send nothing.
 *
 * A tap on a hold-to-record button is an accident, not a message, and it
 * produces a blob of near-zero length that is unplayable but perfectly
 * sendable. Silently discarding it is wrong too — the hint is what teaches the
 * gesture, so a tap says "hold to record" rather than doing nothing.
 */
const MIN_DURATION_MS = 400;

export default function VoiceRecorderButton({ onRecorded, disabled = false, onNotice }) {
  const [recording, setRecording] = useState(false);
  const [elapsed,   setElapsed]   = useState(0);
  const [willCancel, setWillCancel] = useState(false);

  const handleRef = useRef(null);   // the live recorder, or null
  const startRef  = useRef(null);   // {x, y} of the press
  const tickRef   = useRef(null);
  const cancelRef = useRef(false);  // read inside async stop; state would be stale

  const supported = canRecordVoice();

  // The drawer can close mid-press. Without this the recorder keeps running
  // and the microphone stays open with no UI attached to it.
  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    clearInterval(tickRef.current);
  }, []);

  function stopTicking() {
    clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function begin(e) {
    if (disabled || !supported || handleRef.current) return;

    // Keeps pointermove/up addressed here even when the finger slides off.
    e.currentTarget.setPointerCapture?.(e.pointerId);

    startRef.current  = { x: e.clientX, y: e.clientY };
    cancelRef.current = false;
    setWillCancel(false);
    setElapsed(0);

    try {
      handleRef.current = await startRecording();
    } catch (err) {
      // Denial and unsupported need different words; only the message differs.
      onNotice?.(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was declined'
          : 'Cannot record on this device',
      );
      return;
    }

    // The press can END before getUserMedia resolves — a quick tap. The
    // pointerup handler already ran and found no handle, so nothing would ever
    // stop this recorder. Check for that and unwind immediately.
    if (cancelRef.current) {
      handleRef.current.cancel();
      handleRef.current = null;
      return;
    }

    setRecording(true);
    tickRef.current = setInterval(() => {
      setElapsed(handleRef.current?.elapsedMs() ?? 0);
    }, 100);
  }

  function move(e) {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    setWillCancel(Math.hypot(dx, dy) > CANCEL_DISTANCE_PX);
  }

  async function end(e, forceCancel = false) {
    e?.currentTarget?.releasePointerCapture?.(e.pointerId);

    const handle = handleRef.current;
    startRef.current = null;

    // Marks the "press ended before the recorder started" case for begin().
    cancelRef.current = true;

    if (!handle) {
      setRecording(false);
      return;
    }

    handleRef.current = null;
    stopTicking();
    setRecording(false);

    if (forceCancel || willCancel) {
      handle.cancel();
      setWillCancel(false);
      return;
    }

    let result;
    try {
      result = await handle.stop();
    } catch {
      onNotice?.('Recording failed');
      return;
    }

    if (result.durationMs < MIN_DURATION_MS) {
      onNotice?.('Hold to record');
      return;
    }
    onRecorded?.(result);
  }

  if (!supported) return null;   // no button rather than one that cannot work

  return (
    <>
      {recording && (
        <div
          aria-live="polite"
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: willCancel ? 'var(--neon)' : 'var(--text)',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: 999, flexShrink: 0,
            background: willCancel ? 'var(--neon)' : '#FF3B5C',
          }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(elapsed / 1000)}</span>
          <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {willCancel ? 'Release to cancel' : 'Slide away to cancel'}
          </span>
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={e => end(e, true)}
        // A press that ends outside any element still fires lostpointercapture.
        onLostPointerCapture={() => { if (handleRef.current) end(null, true); }}
        // Hold gestures otherwise raise the iOS text-selection callout.
        onContextMenu={e => e.preventDefault()}
        aria-label={recording ? 'Recording — release to send, slide away to cancel' : 'Hold to record a voice message'}
        style={{
          border: 'none', borderRadius: 999, width: 46, height: 46, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          touchAction: 'none',          // or the browser scrolls instead of recording
          userSelect: 'none',
          background: recording
            ? (willCancel ? 'rgba(255,59,92,.22)' : 'linear-gradient(135deg, #00E5FF, #BF5FFF)')
            : 'rgba(255,255,255,.07)',
          color: recording && !willCancel ? '#0a0a0f' : 'rgba(255,255,255,.72)',
          transform: recording ? 'scale(1.06)' : 'none',
          transition: 'background .2s ease, transform .12s ease',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
        </svg>
      </button>
    </>
  );
}
