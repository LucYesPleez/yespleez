import { useRef } from 'react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { formatDuration } from '../lib/voiceNotes';
import HandIcon from './HandIcon';
import VoiceDock from './VoiceDock';
import LiveWaveform from './LiveWaveform';

/**
 * THE COMPOSER — one owner, one row, four modes.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * Before M9h the recorder rendered two absolutely-positioned elements INTO
 * `ConversationView`'s form, carrying `inset: '0 62px 0 0'` — a magic number
 * encoding a sibling button's width plus the flex gap. Two components owned
 * one row, and neither could be changed without silently invalidating the
 * other. That is why "can the user reach Send while locked?" was a layout
 * question at all.
 *
 * Now one component owns the row. There are no overlays and no magic numbers:
 * every mode is a different arrangement of the SAME flex row, so constant
 * height is structural rather than something each mode has to remember.
 *
 * ── MODE IS DERIVED, NEVER STORED ────────────────────────────────────
 *
 * The recorder's `phase` is the authority. A `mode` in state would be a second
 * source of truth that can disagree with it — the exact class of bug that
 * produced a locked state with no way out.
 *
 * ── THE TRAILING BUTTON IS ALWAYS THE SAME BUTTON ────────────────────
 *
 * Hand → Send → Send-while-locked is one control changing costume. It is never
 * unmounted and remounted, which is what makes the change read as a morph
 * rather than a replacement, and what guarantees the completion path can never
 * be laid out away.
 */

const HEIGHT = 46;   // every control in the row, so the row cannot change height

export default function Composer({
  draft,
  onDraftChange,
  onSubmit,
  onRecorded,
  onSendHand,
  onNotice,
  sending = false,
  canWrite = true,
  placeholder,
  inputRef,
  onInputEvent,
}) {
  // The gesture hit-tests this, so the hook needs the live element rather than
  // a distance — where the dock sits depends on the width of the text field.
  const dockRef = useRef(null);
  const rec = useVoiceRecorder({ onRecorded, onNotice, disabled: !canWrite || sending, dockRef });

  const hasText = Boolean(draft.trim());

  // Derived. See header.
  const mode =
    rec.phase === 'locked'    ? 'recordingLocked'
    : rec.phase === 'recording' ? 'recordingHeld'
    : hasText                   ? 'typing'
    : 'idle';

  const recording = mode === 'recordingHeld' || mode === 'recordingLocked';
  const busy      = rec.phase === 'uploading';

  function submit(e) {
    e.preventDefault();
    if (hasText) onSubmit?.(e);
  }

  /** Trailing button: Send when there is text or a locked recording, else Hand. */
  const trailingIsSend = hasText || mode === 'recordingLocked';

  return (
    <form onSubmit={submit} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '12px 16px 16px', flexShrink: 0,
      // Translucent, not solid, so the wallpaper bleeds through the bar rather
      // than being cut off by a hard edge at the bottom of the thread.
      //
      // Darkened enough to keep the input and its placeholder legible over the
      // bright half of the image — the composer is the one surface that must
      // stay readable regardless of what is behind it.
      background: 'linear-gradient(0deg, rgba(0,0,0,.62) 0%, rgba(0,0,0,.34) 100%)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    }}>
      {/* ── LEADING ─────────────────────────────────────────────────
          Discard while locked; nothing otherwise.

          There is deliberately no attachments (+) button yet. Images and files
          are declared kinds with no implementation, so a + would be a control
          that does nothing — the same defect as the padlock that could not
          send. It goes in when attachments do. */}
      {mode === 'recordingLocked' && (
        <button
          type="button"
          onClick={() => void rec.discard()}
          aria-label="Discard recording"
          style={{
            width: HEIGHT, height: HEIGHT, flexShrink: 0, borderRadius: 999,
            border: '1px solid rgba(255,59,92,.35)', background: 'rgba(255,59,92,.12)',
            color: '#FF3B5C', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
            <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
          </svg>
        </button>
      )}

      {/* ── CENTRE ──────────────────────────────────────────────────
          The text field and the recording display are the same slot, so
          swapping them cannot change the row's height or the position of
          anything beside them. */}
      {recording || busy || rec.phase === 'sent' ? (
        <RecordingDisplay rec={rec} phase={rec.phase} mode={mode} />
      ) : (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => { onDraftChange(e.target.value); onInputEvent?.(); }}
          onSelect={onInputEvent}
          onKeyUp={onInputEvent}
          onBlur={onInputEvent}
          disabled={!canWrite || sending}
          placeholder={placeholder}
          aria-label="Message"
          style={{
            flex: 1, minWidth: 0, height: HEIGHT, boxSizing: 'border-box',
            background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 999, padding: '0 18px', color: 'var(--text)', fontSize: 14.5,
            outline: 'none',
          }}
        />
      )}

      {/* ── THE DOCK ────────────────────────────────────────────────
          Permanent, and to the LEFT of the microphone so the gesture travels
          rightward into it. It is on screen before anything happens, which is
          what makes "drag the microphone here" guessable without being told. */}
      {rec.supported && !hasText && (
        <VoiceDock
          ref={dockRef}
          // Bound to the row's own constant rather than left to VoiceDock's
          // default, so the dock and the microphone cannot drift apart — one
          // number governs every control in the composer.
          size={HEIGHT}
          active={recording}
          locking={rec.justLocked}
        />
      )}

      {/* ── MIC ─────────────────────────────────────────────────────
          Hidden once there is text: recording and a half-typed message are two
          different intentions, and showing both invites the question of what
          happens to the draft. The draft is preserved either way — it lives in
          shell state, not here — so the mic simply returns when the field is
          cleared. */}
      {rec.supported && !hasText && mode !== 'recordingLocked' && (
        <>
          <button
            ref={rec.refs.button}
            type="button"
            disabled={!canWrite || sending || busy}
            {...rec.handlers}
            onContextMenu={e => e.preventDefault()}   // suppresses the iOS hold callout
            aria-label={
              mode === 'recordingHeld'
                ? 'Recording — release to send, drag onto the waveform to lock, drag down to cancel'
                : 'Hold to record a voice message'
            }
            style={{
              width: HEIGHT, height: HEIGHT, flexShrink: 0, borderRadius: 999, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: canWrite ? 'pointer' : 'not-allowed',
              touchAction: 'none',   // or the browser scrolls instead of recording
              userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
              willChange: 'transform',
              background: recording ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.07)',
              color: recording ? '#0a0a0f' : 'rgba(255,255,255,.72)',
              transition: 'background .2s ease',   // never on transform: it tracks the finger
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
            </svg>
          </button>
        </>
      )}

      {/* ── TRAILING · one button, three costumes ───────────────────
          Hand when there is nothing to say, Send when there is, Send when a
          locked recording is waiting. Always mounted, always 46px, always
          last — so the way to finish can never be squeezed out by anything
          beside it. */}
      <button
        type={trailingIsSend && mode !== 'recordingLocked' ? 'submit' : 'button'}
        onClick={
          mode === 'recordingLocked' ? rec.onPrimaryClick
          : hasText                  ? undefined              // the form submits
          : () => onSendHand?.()
        }
        disabled={!canWrite || sending || busy}
        aria-label={
          mode === 'recordingLocked' ? 'Send voice message'
          : hasText                  ? 'Send'
          : 'Send a Yes'
        }
        title={hasText || mode === 'recordingLocked' ? undefined : 'Send a Yes'}
        style={{
          width: HEIGHT, height: HEIGHT, flexShrink: 0, borderRadius: 999, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: canWrite && !busy ? 'pointer' : 'not-allowed',
          background: trailingIsSend
            ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)'
            : 'rgba(255,255,255,.07)',
          color: trailingIsSend ? '#0a0a0f' : 'rgba(255,255,255,.72)',
          boxShadow: trailingIsSend ? '0 8px 22px -8px rgba(191,95,255,.75)' : 'none',
          transition: 'background .25s ease, box-shadow .25s ease, color .2s ease',
        }}
      >
        {busy ? '…' : trailingIsSend ? (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        ) : (
          // 38 in a 46px button, larger than it looks: the artwork is uncropped
          // so its own padding is inside the box, and `contain` fits the whole
          // image rather than the mark. ~33px of actual ink.
          <HandIcon size={38} />
        )}
      </button>
    </form>
  );
}

/**
 * The recording readout — occupies the text field's slot, at the field's exact
 * height, so nothing around it moves when recording starts.
 */
function RecordingDisplay({ rec, phase, mode }) {
  if (phase === 'uploading' || phase === 'sent') {
    return (
      <div style={{ ...slot, gap: 8, color: 'var(--muted)', fontSize: 13 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999,
          background: phase === 'sent' ? '#3DDC84' : 'var(--muted)',
        }} />
        {phase === 'sent' ? 'Sent' : 'Sending…'}
      </div>
    );
  }

  return (
    <div style={{ ...slot, gap: 10 }}>
      <span style={{
        width: 9, height: 9, borderRadius: 999, flexShrink: 0,
        background: rec.closing ? '#FFB020' : '#FF3B5C',
        animation: 'ypPulse 1.4s ease-in-out infinite',
      }} />
      <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', flexShrink: 0 }}>
        {formatDuration(rec.elapsed / 1000)}
      </span>

      {rec.closing && (
        <span style={{ fontSize: 11.5, color: '#FFB020', flexShrink: 0 }}>
          {formatDuration(Math.max(0, rec.remaining) / 1000)} left
        </span>
      )}

      {mode === 'recordingLocked' ? (
        // LOCKED: the field becomes the recording. Live audio fills the space
        // the placeholder used to occupy, growing left to right, so the thing
        // taking up the composer is the thing being captured.
        <LiveWaveform getLevel={rec.getLevel} />
      ) : (
        <span
          ref={rec.refs.cancelHint}
          style={{
            marginLeft: 'auto', opacity: 0, fontSize: 12, color: 'var(--neon)',
            whiteSpace: 'nowrap', willChange: 'opacity', flexShrink: 0,
          }}
        >
          Release to cancel
        </span>
      )}
    </div>
  );
}

/** The text field's exact box, so the swap costs no layout. */
const slot = {
  flex: 1, minWidth: 0, height: HEIGHT, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center',
  padding: '0 18px', borderRadius: 999,
  background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
};
