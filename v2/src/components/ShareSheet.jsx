import { useState } from 'react';

/**
 * SHARE SHEET — the generic presentation of whatever the current screen
 * declared via `useShareTarget`. It reads a payload; it knows nothing about
 * events, profiles or venues, and must stay that way.
 *
 * Three actions, per the navigation & sharing architecture:
 *
 *   Native share sheet   where the platform provides one
 *   Copy Link            always
 *   QR Code              DEFERRED — see below
 *
 * ── QR IS RESERVED, NOT BUILT ────────────────────────────────────────
 *
 * Generating a QR needs either a dependency or a hand-rolled encoder. This app
 * has eight dependencies and a zero-dependency test suite, so adding one is the
 * owner's call, and a hand-rolled QR encoder is exactly the kind of code that
 * is subtly wrong in ways that are hard to see. The slot is reserved and
 * visibly disabled rather than silently absent — the same treatment the Info
 * button was given, and for the same reason: a missing control reads as an
 * oversight, a disabled one reads as a decision.
 */
export default function ShareSheet({ target, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!target) return null;

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isPrivate = target.access === 'private';

  async function nativeShare() {
    try {
      await navigator.share({
        title: target.title,
        text:  target.preview || undefined,
        url:   target.url,
      });
      onClose?.();
    } catch {
      // A cancelled share sheet rejects. That is not an error worth surfacing.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(target.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '13px 16px', marginBottom: 8,
    color: 'var(--text)', fontSize: 14, cursor: 'pointer', textAlign: 'left',
  };

  return (
    <div
      role="dialog"
      aria-label="Share"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: 'var(--bg)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: 20, boxSizing: 'border-box' }}
      >
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2, color: 'var(--text)', marginBottom: 4 }}>
          SHARE
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.title}
        </div>

        {isPrivate && (
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            This is a private resource. Anyone without access will be asked to
            request it.
          </div>
        )}

        {canNativeShare && (
          <button type="button" style={rowStyle} onClick={nativeShare}>Share via…</button>
        )}

        <button type="button" style={rowStyle} onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>

        {/* Reserved, deliberately disabled — see the header note. */}
        <button
          type="button"
          disabled
          title="QR codes are not available yet"
          style={{ ...rowStyle, cursor: 'not-allowed', color: 'var(--muted)', opacity: 0.6 }}
        >
          QR code
          <span style={{ marginLeft: 'auto', fontSize: 11, letterSpacing: 1 }}>SOON</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{ ...rowStyle, justifyContent: 'center', marginTop: 8, marginBottom: 0, background: 'transparent', color: 'var(--muted)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
