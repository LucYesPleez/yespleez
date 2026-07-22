import { useState } from 'react';
import { downloadUrlFor, formatBytes } from '../lib/messageFiles';

/**
 * A DOCUMENT IN THE THREAD (M12).
 *
 * ── IT IS A ROW, NOT A PREVIEW ───────────────────────────────────────
 *
 * A photo shows itself, so `ImageMessage` renders the thing. A document cannot
 * be shown without rendering it — which for HTML or a PDF means executing
 * someone else's content inside the conversation — so this deliberately shows
 * only what is safe to show: an icon, the name, the size. Recognition comes
 * from the filename, which is why it is carried in the payload at all.
 *
 * ── THE URL IS MINTED ON TAP, NOT ON MOUNT ───────────────────────────
 *
 * Unlike a photo, which must resolve its url to draw anything, a document row
 * is complete before any network call. Signing on mount would mean one storage
 * request per attachment every time the thread is scrolled past — for urls that
 * expire in an hour and are mostly never used.
 */

/** Set only while a send is in flight or has failed — there is no path yet. */
function isPending(message) {
  return !message?.payload?.path;
}

export default function FileMessage({ message }) {
  const path  = message?.payload?.path ?? null;
  const name  = message?.payload?.name || message?.body || 'Attachment';
  const bytes = Number(message?.payload?.bytes ?? 0);
  // Set by the "Upload HD audio" row. A label on how it was sent — the storage
  // path is identical either way. See `sendFile`.
  const hd    = Boolean(message?.payload?.hd);

  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  async function open(e) {
    // The bubble is double-tapped to give a Yes. Downloading must not also
    // fire on the way there, so this is a deliberate single action on the row
    // and the event is left to bubble for the gesture.
    e.stopPropagation();
    if (!path || busy) return;

    setBusy(true);
    setError(null);
    const { url, error: signError } = await downloadUrlFor(path, name);
    setBusy(false);

    if (signError || !url) {
      // RLS refuses here, so this is a real case rather than a defensive
      // branch: someone removed from a conversation still has the message
      // rendered from local state.
      setError('Unavailable');
      return;
    }

    // A plain navigation, not an anchor with `download`: the attachment header
    // comes from the signed url itself, so the browser saves rather than
    // navigates, and nothing has to be appended to the document to do it.
    window.location.href = url;
  }

  const pending = isPending(message);

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending || busy}
      aria-label={pending ? `Sending ${name}` : `Download ${name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        width: '100%', minWidth: 0,
        padding: '10px 12px', border: 'none', borderRadius: 14,
        background: 'rgba(255,255,255,.05)',
        color: 'var(--text)', textAlign: 'left',
        cursor: pending || busy ? 'default' : 'pointer',
        opacity: pending ? .6 : 1,
      }}
    >
      {/* The icon says "file", never "PDF" or "Word". Mapping types to marks
          means a lookup table that is wrong for everything not in it, and a
          document nobody recognises is exactly when a generic mark is honest. */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0, width: 34, height: 34, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(191,95,255,.14)',
          border: '1px solid rgba(191,95,255,.28)',
          color: '#D9BFFF',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7z" />
          <path d="M14 2v5h5" />
        </svg>
      </span>

      <span style={{ minWidth: 0, flex: 1 }}>
        {/* ⚠ ONE LINE, ALWAYS. A long filename is attacker-controlled text in
            the recipient's thread — `safeName` caps its length, and this stops
            what remains from wrapping into a bubble several lines tall. */}
        <span style={{
          display: 'block', fontSize: 14, lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11.5, color: 'var(--muted)' }}>
          {/* The chip sits on the SIZE line, not beside the filename: a long
              name already truncates, and anything after it would be the first
              thing pushed off. */}
          {hd && <span className="yp-hd-chip">HD</span>}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error ? error
              : busy ? 'Opening…'
              : pending ? 'Sending…'
              : formatBytes(bytes)}
          </span>
        </span>
      </span>

      {!pending && !busy && !error && (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}>
          <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
        </svg>
      )}
    </button>
  );
}
