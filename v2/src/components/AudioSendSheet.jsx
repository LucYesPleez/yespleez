import { useEffect, useState } from 'react';
import { formatBytes, formatToken } from '../lib/messageFiles';

/**
 * CONFIRM AN AUDIO SEND (M12).
 *
 * ── WHY AUDIO ASKS AND A DOCUMENT DOES NOT ───────────────────────────
 *
 * Sending a master is a rare, considered act with a genuine decision attached:
 * may the recipient keep this, or only hear it? Sending a rider is frequent and
 * carries no such question. The photo path already proved that charging every
 * send an extra tap to serve a minority is the wrong trade — so only the send
 * that has something to decide is interrupted.
 */
export default function AudioSendSheet({ file, hd, onSend, onCancel }) {
  const [downloadable, setDownloadable] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !sending) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, sending]);

  function send() {
    if (sending) return;
    setSending(true);
    onSend({ downloadable });
  }

  return (
    /* ⚠ THE BOTTOM NAV IS SACRED — stops at var(--yp-nav-height), never inset:0. */
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send audio"
      onClick={() => { if (!sending) onCancel(); }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        bottom: 'var(--yp-nav-height)',
        background: 'rgba(6,6,10,.82)',
        backdropFilter: 'blur(10px)',
        zIndex: 70,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(180deg, rgba(26,24,33,.98) 0%, rgba(16,15,21,.99) 100%)',
          borderTop: '1px solid rgba(255,255,255,.12)',
          borderRadius: '20px 20px 0 0',
          padding: 16,
          boxShadow: '0 -18px 48px -20px rgba(0,0,0,.95)',
        }}
      >
        <div style={{ fontSize: 14.5, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file?.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>
          {hd && <span className="yp-hd-chip">HD</span>}
          <span>{[formatToken(file?.name, file?.type), formatBytes(file?.size)].filter(Boolean).join(' · ')}</span>
        </div>

        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 11,
            padding: '11px 12px', borderRadius: 13,
            background: downloadable ? 'rgba(255,255,255,.045)' : 'rgba(201,169,97,.10)',
            border: `1px solid ${downloadable ? 'rgba(255,255,255,.09)' : 'rgba(201,169,97,.30)'}`,
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={downloadable}
            onChange={e => setDownloadable(e.target.checked)}
            style={{ width: 17, height: 17, marginTop: 1, accentColor: '#BF5FFF', flexShrink: 0 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14 }}>Allow download</span>
            {/* ⚠ THIS COPY IS LOAD-BEARING AND MUST NOT BE "TIDIED" INTO A
                PROMISE. Turning it off removes the download button, and cannot
                do more than that: playing the file streams the whole thing to
                the listener's device, and every participant may read the
                bucket. Real prevention needs a separate low-quality preview
                asset — transcoding — which is frozen until after launch. Copy
                claiming protection would be a lie the system cannot keep. */}
            <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45 }}>
              {downloadable
                ? 'They can save the file.'
                : 'Hides the download button. It stays playable, so a determined listener can still capture it.'}
            </span>
          </span>
        </label>

        <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            style={{
              flex: '0 0 auto', padding: '12px 18px', borderRadius: 13,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'transparent', color: 'var(--muted)',
              fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            autoFocus
            style={{
              flex: 1, padding: '12px 18px', borderRadius: 13, border: 'none',
              background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
              color: '#0a0a0f', fontSize: 14.5, fontWeight: 600,
              fontFamily: 'inherit', cursor: sending ? 'default' : 'pointer',
              opacity: sending ? .7 : 1,
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
