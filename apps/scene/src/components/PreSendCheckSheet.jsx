import { useState } from 'react';
import ProfileCard from './ProfileCard';

/**
 * "CHECK YOUR INFO BEFORE YOU SEND" — the pre-send confirmation.
 *
 * Shows what the recipient will genuinely see, from the same column list their
 * card reads, so nobody is reassured about a different thing. Every row is
 * listed including the empty ones: this is a private view of an outgoing
 * message and its job is to surface what is MISSING while it can still be
 * fixed.
 *
 * ⛔ IT CONFIRMS, IT NEVER GATES. Dismissing it — once or forever — skips the
 * CONFIRMATION and nothing else. The P6 requirements gate is enforced in
 * `canSendEnquiry` before this dialog ever opens, and no button here can pass
 * it. A dismissible thing and an enforced thing must never be the same thing.
 *
 * ⛔ IT DOES NOT KNOW WHAT IT IS CONFIRMING. `rows`, `subtitle`, `note` and the
 * actions all come from the caller, so an application or an accreditation can
 * reuse it without this file learning who they are.
 *
 * ⚠ `rows` USED TO BE BUILT IN HERE, by importing the enquiry projection
 * directly — which made the "generic" dialog quietly enquiry-shaped. A contract
 * test caught it. The projection is the CALLER's knowledge: only they know
 * which fields their recipient can actually read.
 *
 * THREE WAYS OUT, on purpose:
 *   IT'S OK, SEND    send once, ask again next time
 *   DON'T ASK AGAIN  send, and stop showing this
 *   Cancel           go back — the reason the dialog exists at all
 *
 * A confirmation with no way back is not a confirmation, it is a speed bump.
 */
/**
 * @param {object} props
 * @param {Array<{key,label,value,present}>} props.rows
 *   What the recipient will see. Built by the caller, because only the caller
 *   knows which fields their recipient can read.
 */
export default function PreSendCheckSheet({
  profile,
  rows = [],
  subtitle,
  note,
  accent = '#00E5A0',
  accent2 = '#00B4D8',
  busy = false,
  onSend,
  onSendAndSuppress,
  onCancel,
}) {
  // Local so a slow write cannot be double-fired by an impatient second tap.
  const [choice, setChoice] = useState(null);
  const filled = rows.filter(r => r.present).length;
  const total = rows.length;
  const locked = busy || choice !== null;

  function pick(which, fn) {
    if (locked) return;
    setChoice(which);
    fn?.();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,.75)',
               display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={() => !locked && onCancel?.()}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto',
                 background: 'var(--card)', borderTopLeftRadius: 18, borderTopRightRadius: 18,
                 border: '1px solid var(--border)', borderBottom: 'none',
                 padding: '18px 16px calc(18px + var(--yp-safe-bottom))' }}
      >
        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1, marginBottom: 4 }}>
          CHECK YOUR INFO
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
          {subtitle || 'This is what they will see about you.'}
        </p>

        {/* ⭐ THE APP'S OWN CARD, not a bespoke row (owner, 2026-08-10: "use the
            artist cards here, these look different to the usual ones").
            Hand-rolling an identity row here meant this screen drifted from
            Discover, the dashboards and Messenger — and on a screen whose whole
            promise is "this is what they will see", showing an act in a shape
            that appears nowhere else is the wrong thing twice over.
            ⛔ `onClick` is a no-op: this is a preview of yourself, and
            navigating away mid-send would lose the note. */}
        <div style={{ marginBottom: 4 }}>
          <ProfileCard item={profile} onClick={() => {}} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', margin: '0 2px 12px' }}>
          {filled} of {total} details filled
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '8px 12px', marginBottom: note ? 10 : 14 }}>
          {rows.map(r => (
            <div key={r.key} style={{ display: 'flex', gap: 10, padding: '5px 0', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', width: 96, flexShrink: 0,
                             fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
                {r.label.toUpperCase()}
              </span>
              {/* An empty field is shown, dimmed, never hidden — you cannot fix
                  what you cannot see. */}
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, wordBreak: 'break-word',
                             color: r.present ? 'var(--text)' : 'var(--muted)',
                             fontStyle: r.present ? 'normal' : 'italic' }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>

        {/* The note is part of what is sent, so it is part of what is checked. */}
        {note && (
          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'Bebas Neue'",
                          letterSpacing: 1, marginBottom: 4 }}>YOUR MESSAGE</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note}</div>
          </div>
        )}

        <button
          type="button" disabled={locked} onClick={() => pick('send', onSend)}
          style={{ width: '100%', background: `linear-gradient(135deg,${accent},${accent2})`,
                   color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2,
                   padding: 15, border: 'none', borderRadius: 12, cursor: locked ? 'default' : 'pointer',
                   opacity: locked ? .6 : 1 }}
        >
          {choice === 'send' ? 'SENDING…' : "IT'S OK, SEND →"}
        </button>

        <button
          type="button" disabled={locked} onClick={() => pick('suppress', onSendAndSuppress)}
          style={{ width: '100%', marginTop: 8, background: 'transparent', color: 'var(--text)',
                   fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: 13,
                   border: '1px solid var(--border)', borderRadius: 12,
                   cursor: locked ? 'default' : 'pointer', opacity: locked ? .6 : 1 }}
        >
          {choice === 'suppress' ? 'SENDING…' : "DON'T ASK ME THIS AGAIN"}
        </button>

        {/* Quiet, but present. The whole point of a check is being able to stop. */}
        <button
          type="button" disabled={locked} onClick={() => !locked && onCancel?.()}
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none',
                   color: 'var(--muted)', fontSize: 13, padding: 8,
                   cursor: locked ? 'default' : 'pointer' }}
        >
          Cancel — let me fix something
        </button>
      </div>
    </div>
  );
}
