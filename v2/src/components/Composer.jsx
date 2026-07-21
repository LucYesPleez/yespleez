import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { formatDuration } from '../lib/voiceNotes';
import HandIcon from './HandIcon';
import VoicePill, { PILL_WIDTH as PILL_W } from './VoicePill';
import LiveWaveform from './LiveWaveform';

/**
 * THE COMPOSER — one glass capsule, four slots, four states.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  [ + ]   Message……………………   [ ~~|mic ]   [ hand ]         │
 * └──────────────────────────────────────────────────────────┘
 *    left        centre            pill        trailing
 *
 * ── ONE COMPONENT, NOT FOUR CONTROLS IN A ROW ────────────────────────
 *
 * The capsule is the object; the controls live INSIDE it. Before M9t each
 * element carried its own border and fill — the field was a bordered pill, the
 * buttons were separate circles — so the composer read as four things that
 * happened to be adjacent. Now one outline, one glass surface, one shadow, and
 * the controls sit in it rather than beside each other.
 *
 * The field in particular has no border or background of its own any more. It
 * is a hole in the glass, which is what stops the capsule from looking like a
 * frame drawn around a smaller frame.
 *
 * ── FOUR SLOTS THAT NEVER CHANGE COUNT ───────────────────────────────
 *
 * Every state is the SAME four slots wearing different costumes. Nothing mounts
 * or unmounts on a state change, so nothing can jump:
 *
 *   slot      idle          typing        recording      pending
 *   ────────────────────────────────────────────────────────────────
 *   left      + (disabled)  + (disabled)  discard        discard
 *   centre    field         field         timer + wave   duration
 *   pill      at rest       collapsed     live           at rest
 *   trailing  hand          send          send           send
 *
 * The pill COLLAPSES rather than unmounting when you type — width and opacity
 * to zero — because a control that vanishes on the first keystroke is the
 * abrupt layout change this redesign exists to remove. Everything else is a
 * costume change on a box that never moves.
 *
 * ── MODE IS DERIVED, NEVER STORED ────────────────────────────────────
 *
 * The recorder's `phase` is the authority. A `mode` in state would be a second
 * source of truth that can disagree with it — the exact class of bug that
 * produced a locked state with no way out.
 */

/**
 * The composer's own surface, and the colour the wallpaper dissolves into.
 *
 * ONE constant, used twice — as this element's fill and as the opaque end of
 * the fade above it. If the two ever differ the seam comes back, just softer
 * and harder to name.
 *
 * `SCRIM_CLEAR` is the same colour at zero alpha rather than `transparent`.
 * `transparent` is rgba(0,0,0,0), so on some engines a gradient to it passes
 * through grey on the way — a faint dirty band across the bottom of the image.
 */
const SCRIM       = 'rgba(11,11,15,.88)';
const SCRIM_CLEAR = 'rgba(11,11,15,0)';

/** Every control in the capsule. One number governs the whole row. */
const CONTROL = 46;

/** Breathing room between the glass and the controls inside it. */
const INSET = 6;

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
  const rec = useVoiceRecorder({ onRecorded, onNotice, disabled: !canWrite || sending });

  const hasText = Boolean(draft.trim());
  const busy    = rec.busy;

  // Derived. See header.
  const mode =
    rec.phase === 'recording' ? 'recording'
    : rec.phase === 'pending'   ? 'pending'
    : hasText                   ? 'typing'
    : 'idle';

  // The centre belongs to the voice note from the moment recording starts until
  // the "Sent" dwell ends — one continuous story in one place.
  const showVoiceSlot = rec.active || busy || rec.phase === 'sent';

  // Collapsed while typing, and while the note is on its way — in both cases
  // starting a recording is not the next thing anyone wants.
  const pillOpen = rec.supported && !hasText && !busy && rec.phase !== 'sent';

  const trailingIsSend = hasText || rec.active;

  function submit(e) {
    e.preventDefault();
    if (hasText) onSubmit?.(e);
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: '14px', flexShrink: 0,
        position: 'relative',   // anchors the fade above
        background: SCRIM,
      }}
    >
      {/* ⚠ THE FADE HAS TO SIT ABOVE THIS ELEMENT, NOT INSIDE IT.

          The wallpaper is painted on the message list and simply STOPS where
          the list ends — which is exactly where this form begins. A gradient
          running from transparent at the form's own top therefore starts AT the
          boundary, so the image still cuts off against it in a dead straight
          line. That was the first attempt, and the line survived it.

          This strip is anchored to `bottom: 100%`, so it lives in the 76px
          ABOVE the composer, over the last of the image, fading from the
          composer's exact colour up to nothing. The boundary is now inside a
          gradient rather than at the end of one.

          `pointer-events: none` so it cannot swallow taps on the last message
          it covers. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: '100%', height: 76,
          background: `linear-gradient(to top, ${SCRIM}, ${SCRIM_CLEAR})`,
          pointerEvents: 'none',
        }}
      />
      <div
        className="yp-composer"
        // Drives the capsule's recording accent, and gives the state one
        // inspectable name rather than leaving it implied by which children
        // happen to be mounted.
        data-state={mode}
        style={{
          display: 'flex', alignItems: 'center', gap: INSET,
          padding: INSET, borderRadius: 999, boxSizing: 'border-box',
        }}
      >
        {/* ── LEFT · attach, or discard ───────────────────────────────
            ONE button, two costumes, like the trailing one. A separate discard
            that appeared beside a separate + would change the slot count
            mid-recording and shove the field sideways.

            THE + IS DISABLED, DELIBERATELY. `image`, `video`, `file` and
            `location` are declared message kinds with no client implementation,
            so a working-looking + would be a control that does nothing — the
            padlock defect. It holds its place in the layout and says why. It
            becomes live the day attachments ship, with no layout change. */}
        <button
          type="button"
          onClick={rec.active ? () => void rec.discard() : undefined}
          disabled={!rec.active}
          aria-label={
            rec.active
              ? (mode === 'pending' ? 'Discard voice message' : 'Discard recording')
              : 'Attachments — coming soon'
          }
          title={rec.active ? undefined : 'Attachments coming soon'}
          className={`yp-ctl ${rec.active ? 'yp-ctl-danger' : 'yp-ctl-attach'}`}
          style={{ width: CONTROL, height: CONTROL }}
        >
          {rec.active ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
              <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          )}
        </button>

        {/* ── CENTRE · the hole in the glass ──────────────────────────
            No border and no background: the capsule already draws the surface,
            and a second outline here is what made the old composer read as a
            frame inside a frame. Both costumes share one box, so swapping them
            costs no layout. */}
        {showVoiceSlot ? (
          <VoiceSlot rec={rec} phase={rec.phase} />
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
            className="yp-composer-field"
            style={{ flex: 1, minWidth: 0, height: CONTROL }}
          />
        )}

        {/* ── PILL · collapses, never unmounts ────────────────────────
            Width and opacity to zero so typing does not pop a control out of
            the row. `overflow: hidden` on the wrapper keeps the pill's own
            geometry intact while the slot closes around it — animating the
            pill itself would squash the microphone. */}
        <span
          className="yp-slot-collapse"
          style={{
            width: pillOpen ? PILL_W : 0,
            opacity: pillOpen ? 1 : 0,
            // A zero-width flex child still gets a gap on BOTH sides, so
            // closing the slot would otherwise leave 6px of nothing behind.
            // Cancelling one gap makes the collapse land exactly closed.
            marginRight: pillOpen ? 0 : -INSET,
          }}
          aria-hidden={!pillOpen}
        >
          {rec.supported && (
            <VoicePill
              recording={mode === 'recording'}
              disabled={!canWrite || sending || !pillOpen}
              onToggle={() => void rec.toggle()}
            />
          )}
        </span>

        {/* ── TRAILING · hand, or send ────────────────────────────────
            Never unmounted, always last, so the way to finish can never be
            squeezed out by anything beside it. */}
        <button
          type={hasText && !rec.active ? 'submit' : 'button'}
          onClick={
            rec.active ? () => void rec.send()
            : hasText   ? undefined              // the form submits
            : () => onSendHand?.()
          }
          disabled={!canWrite || sending || busy}
          aria-label={
            rec.active ? 'Send voice message'
            : hasText   ? 'Send'
            : 'Send a Yes'
          }
          title={trailingIsSend ? undefined : 'Send a Yes'}
          // The Hand wears the gradient as a RING; Send wears it as a fill. Same
          // gradient — the difference is "this is ours" versus "this is the act".
          className={`yp-ctl${trailingIsSend ? ' yp-ctl-send' : ' yp-hand-ring'}`}
          style={{ width: CONTROL, height: CONTROL }}
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
      </div>
    </form>
  );
}

/**
 * The voice readout — the centre slot's other costume, at the field's exact
 * height so nothing around it moves when recording starts.
 */
function VoiceSlot({ rec, phase }) {
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

  // PARKED. A still dot, not a pulsing one: the pulse means a live microphone,
  // and reusing it here would say the thing this state exists to deny.
  if (phase === 'pending') {
    return (
      <div style={{ ...slot, gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, flexShrink: 0, background: '#BF5FFF' }} />
        <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', flexShrink: 0 }}>
          {formatDuration(rec.elapsed / 1000)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Ready to send
        </span>
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

      {/* The field becomes the recording: live audio rolling right to left, so
          the thing taking up the composer is the thing being captured. */}
      <LiveWaveform getLevel={rec.getLevel} />
    </div>
  );
}

/** The field's exact box — no surface of its own; the capsule is the surface. */
const slot = {
  flex: 1, minWidth: 0, height: CONTROL, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center',
  padding: '0 4px',
};
