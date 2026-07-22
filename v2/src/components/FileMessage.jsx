import { useState, useRef, useEffect } from 'react';
import {
  downloadUrlFor, playbackUrlFor, isPlayableAudio,
  formatBytes, formatToken,
} from '../lib/messageFiles';
import { claimPlayback, releasePlayback } from '../lib/voicePlayback';

/**
 * A DOCUMENT IN THE THREAD (M12) — and, when it is audio, a PLAYER.
 *
 * ── IT IS A ROW, NOT A PREVIEW ───────────────────────────────────────
 *
 * A photo shows itself, so `ImageMessage` renders the thing. A document cannot
 * be shown without rendering it — which for HTML or a PDF means executing
 * someone else's content inside the conversation — so this deliberately shows
 * only what is safe to show: an icon, the name, the size.
 *
 * Audio is the exception, because audio CAN be experienced safely inline: an
 * `<audio>` element decodes sound and nothing else. A WAV streams straight from
 * its signed url — the browser range-requests through it, so a 30MB master
 * starts sounding long before it has arrived. No compressed copy exists or is
 * needed for playback; generating one would take a WASM encoder for a problem
 * bandwidth does not have at this scale.
 *
 * ── TAP NEVER DOWNLOADS ANY MORE ─────────────────────────────────────
 *
 * The row used to fire the download directly, which pulled 30MB onto a phone
 * for what was often meant as a press of the play button. Downloading is now
 * behind an explicit confirm (`DownloadSheet`), which names the file, its
 * format and its size before any bytes move.
 *
 * ── THE URL IS MINTED ON TAP, NOT ON MOUNT ───────────────────────────
 *
 * A row is complete before any network call. Signing on mount would mean one
 * storage request per attachment every time the thread is scrolled past.
 */

/** Set only while a send is in flight or has failed — there is no path yet. */
function isPending(message) {
  return !message?.payload?.path;
}

export default function FileMessage({ message }) {
  const path  = message?.payload?.path ?? null;
  const name  = message?.payload?.name || message?.body || 'Attachment';
  const bytes = Number(message?.payload?.bytes ?? 0);
  const mime  = message?.payload?.mime ?? '';
  // Derived at send time from the FILE, never from which menu row was tapped.
  // See `sendFile`.
  const hd    = Boolean(message?.payload?.hd);

  const playable = isPlayableAudio(name, mime);

  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);
  const [asking,  setAsking]  = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const audioRef = useRef(null);
  const urlRef   = useRef(null);

  // The element outliving its component would keep sounding into a thread that
  // no longer shows it playing.
  useEffect(() => () => {
    const el = audioRef.current;
    if (el) { el.pause(); releasePlayback(el); }
  }, []);

  async function togglePlay(e) {
    e.stopPropagation();
    if (!path) return;

    const el = audioRef.current;
    if (!el) return;

    if (playing) { el.pause(); return; }

    if (!urlRef.current) {
      setLoading(true);
      setError(null);
      const { url, error: signError } = await playbackUrlFor(path);
      setLoading(false);
      if (signError || !url) { setError('Unavailable'); return; }
      urlRef.current = url;
      el.src = url;
    }

    // Silences any other audio first — a Voicey and a master both claim through
    // the same registry, so the two can never sound at once.
    claimPlayback(el);

    try {
      await el.play();
    } catch (err) {
      // AbortError is the user doing something ordinary — pausing during the
      // load, pressing twice. Only what remains is a real failure. Same
      // reasoning as VoiceMessage.
      if (err?.name !== 'AbortError') setError('Cannot play this right now');
    }
  }

  async function confirmDownload() {
    setAsking(false);
    setBusy(true);
    setError(null);
    const { url, error: signError } = await downloadUrlFor(path, name);
    setBusy(false);
    if (signError || !url) { setError('Unavailable'); return; }
    window.location.href = url;
  }

  function onRowTap(e) {
    // The bubble is double-tapped to give a Yes; a single deliberate action on
    // the row opens the confirm rather than moving bytes.
    e.stopPropagation();
    if (!path || busy) return;
    setAsking(true);
  }

  const pending = isPending(message);
  const meta = [formatToken(name, mime), formatBytes(bytes)].filter(Boolean).join(' · ');

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          width: '100%', minWidth: 0,
          padding: '10px 12px', borderRadius: 14,
          background: 'rgba(255,255,255,.05)',
          color: 'var(--text)',
          opacity: pending ? .6 : 1,
        }}
      >
        {playable ? (
          /* The play control replaces the file glyph for audio — the leftmost
             thing in the row is the thing you most likely came to press. */
          <button
            type="button"
            onClick={togglePlay}
            disabled={pending || loading}
            aria-label={playing ? `Pause ${name}` : `Play ${name}`}
            style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(191,95,255,.14)',
              border: '1px solid rgba(191,95,255,.28)',
              color: '#D9BFFF', cursor: pending ? 'default' : 'pointer', padding: 0,
            }}
          >
            {loading ? (
              <span style={{ fontSize: 11 }}>…</span>
            ) : playing ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="4" width="5" height="16" rx="1.2" /><rect x="14" y="4" width="5" height="16" rx="1.2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                <path d="M7 4.8v14.4c0 .9 1 1.5 1.8 1L20 13a1.2 1.2 0 0 0 0-2L8.8 3.7c-.8-.4-1.8.1-1.8 1.1z" />
              </svg>
            )}
          </button>
        ) : (
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
        )}

        <button
          type="button"
          onClick={onRowTap}
          disabled={pending || busy}
          aria-label={pending ? `Sending ${name}` : `Download ${name}`}
          style={{
            flex: 1, minWidth: 0, padding: 0, border: 'none',
            background: 'transparent', color: 'inherit', textAlign: 'left',
            cursor: pending || busy ? 'default' : 'pointer',
          }}
        >
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
            {hd && <span className="yp-hd-chip">HD</span>}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/* "WAV · 31.2 MB" answers "is this the master or the bounce"
                  without opening anything. */}
              {error ? error : busy ? 'Preparing…' : pending ? 'Sending…' : meta}
            </span>
          </span>
        </button>

        {!pending && !busy && !error && (
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}>
            <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
          </svg>
        )}

        {/* Mounted always so play() targets a stable element; src is set lazily. */}
        <audio
          ref={audioRef}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          style={{ display: 'none' }}
        />
      </div>

      {asking && (
        <DownloadSheet
          name={name}
          meta={meta}
          hd={hd}
          onConfirm={confirmDownload}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

/**
 * "Do you want this file?" — asked BEFORE 30MB moves to a phone.
 *
 * ⚠ THE COMPRESSED OPTION IS DIMMED, NOT MISSING. A 320 MP3 of a master cannot
 * be made today: browsers do not encode MP3/AAC, there is no server transcode,
 * and shipping a WASM encoder is a real dependency decision nobody has made.
 * Showing it dimmed says "this exists and is coming", which is true, and holds
 * the layout for the day it does — the same treatment the premium duration row
 * was given.
 */
function DownloadSheet({ name, meta, hd, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    /* ⚠ THE BOTTOM NAV IS SACRED — stops at var(--yp-nav-height), never inset:0. */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Download ${name}`}
      onClick={onCancel}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        bottom: 'var(--yp-nav-height)',
        background: 'rgba(6,6,10,.78)',
        backdropFilter: 'blur(8px)',
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
          {name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', marginBottom: 13 }}>
          {hd && <span className="yp-hd-chip">HD</span>}
          <span>{meta}</span>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 13, border: 'none',
            background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
            color: '#0a0a0f', fontSize: 14, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer', marginBottom: 8,
          }}
        >
          {hd ? 'Download lossless' : 'Download'}
        </button>

        {hd && (
          <button
            type="button"
            disabled
            title="Compressed download coming soon"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 13,
              border: '1px solid rgba(255,255,255,.10)',
              background: 'rgba(255,255,255,.04)',
              color: 'rgba(255,255,255,.34)', fontSize: 14,
              fontFamily: 'inherit', cursor: 'not-allowed', marginBottom: 8,
            }}
          >
            MP3 320 — coming soon
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          style={{
            width: '100%', padding: '11px 14px', borderRadius: 13,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'transparent', color: 'var(--muted)',
            fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
