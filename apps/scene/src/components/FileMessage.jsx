import { useState, useRef, useEffect, useMemo } from 'react';
import {
  downloadUrlFor, playbackUrlFor, isPlayableAudio,
  formatBytes, formatToken,
} from '../lib/messageFiles';
import { claimAudio, finishAudio, releaseAudio, SHORT } from '../lib/mediaSession';
import { decodeWave, WAVE_MAX } from '../lib/voiceWave';
import { scrollWindow, barHeight } from '../lib/liveWaveform';

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

/**
 * How many bars the row draws.
 *
 * Fewer than a Voicey's, because this waveform shares its line with the format
 * and size rather than owning a row: at more than this the bars are sub-pixel
 * on a 360px handset and read as noise.
 */
const WAVE_BARS = 28;

/** Redraw cadence while playing. Matches the recording meter's own rate. */
const SAMPLE_MS = 58;

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
  // One stable object for this component's lifetime — see VoiceMessage. An
  // uploaded track is SHORT for the same reason a Voicey is: it arrived in a
  // conversation, so hearing it is communication rather than a listening
  // session, and whatever it interrupted should come back afterwards.
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = {
      kind: SHORT,
      pause: () => { try { audioRef.current?.pause(); } catch { /* gone from the DOM */ } },
    };
  }
  const urlRef   = useRef(null);
  const barsRef  = useRef([]);
  const waveTimerRef = useRef(null);

  /**
   * Peaks frozen at send time, at FULL resolution — never downsampled to
   * `WAVE_BARS`. This waveform does not show the whole track at once; it shows
   * a trailing window ending at the playhead, exactly like the recording meter
   * shows a trailing window ending at "now". Downsampling first would throw
   * away the detail the scroll exists to reveal as playback advances.
   *
   * Absent for documents, and for audio too large to have been decoded safely
   * on the sender's phone — see WAVE_CEILING_BYTES.
   *
   * ⚠ THE STORED WAVE IS A v2 ENVELOPE — {v, ms, d} with base64-packed
   * amplitudes. Decoded through the SAME function VoiceMessage uses,
   * deliberately: a second decoder would be a second thing to keep in step
   * with the format — which is exactly how this waveform went silently missing
   * once already, reading a `peaks` key that v2 never wrote.
   */
  const waveBytes = useMemo(() => decodeWave(message?.payload?.wave), [message?.payload?.wave]);
  const hasWave = Boolean(waveBytes?.length);

  /**
   * ── HIDDEN UNTIL PLAYING, THEN A REAL SCROLL ─────────────────────────
   *
   * Static, it competed with the filename/size for the one line this row owns.
   * Playing, it earns that space: a right-aligned trailing window of the
   * TRACK'S OWN recorded loudness, ending at the current playhead — the same
   * shape and the same utilities (`alignRight`, `barHeight`) as the composer's
   * live recording meter, so a played-back master visually rhymes with a
   * Voicey being spoken.
   *
   * ⚠ WRITTEN DIRECTLY TO THE DOM, NOT THROUGH REACT STATE — same reasoning as
   * `LiveWaveform`. This samples up to ~17 times a second; doing that through
   * `setState` would re-render the bubble, the row, and everything below it in
   * the thread that many times a second for as long as anything plays.
   *
   * The window is real audio data at every instant, never a decorative loop —
   * this codebase treats a waveform that would look identical whether or not
   * anything was actually happening as worse than no waveform at all.
   */
  useEffect(() => {
    clearInterval(waveTimerRef.current);
    if (!playing || !hasWave) return undefined;

    waveTimerRef.current = setInterval(() => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;

      const fraction = el.currentTime / el.duration;
      const windowed = scrollWindow(waveBytes, fraction, WAVE_BARS, WAVE_MAX);

      const nodes = barsRef.current;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        const v = windowed[i];
        if (v === undefined) {
          node.style.height = '0px';
          node.style.opacity = '0';
        } else {
          node.style.height = `${barHeight(v, 16, 0.6)}px`;
          node.style.opacity = '1';
        }
      }
    }, SAMPLE_MS);

    return () => clearInterval(waveTimerRef.current);
  }, [playing, hasWave, waveBytes]);

  // ⚠ ABSENT MEANS ALLOWED. Only a deliberate refusal is stored, so every file
  // sent before this existed stays downloadable rather than silently locking.
  const canDownload = message?.payload?.downloadable !== false;

  // The element outliving its component would keep sounding into a thread that
  // no longer shows it playing.
  useEffect(() => () => {
    const el = audioRef.current;
    if (el) { el.pause(); releaseAudio(sessionRef.current); }
    clearInterval(waveTimerRef.current);
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
    claimAudio(sessionRef.current);

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

        <span style={{ flex: 1, minWidth: 0 }}>
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
            <span style={{ flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/* "WAV · 31.2 MB" answers "is this the master or the bounce"
                  without opening anything. */}
              {error ? error : busy ? 'Preparing…' : pending ? 'Sending…' : meta}
            </span>

            {/* THE WAVEFORM FILLS WHAT IS LEFT of the metadata line rather than
                claiming a row of its own — the card stays one object, and on a
                narrow screen the wave simply has less room instead of pushing
                the size off the edge.

                ⚠ MOUNTED ONLY WHILE PLAYING. Static, it competed with the
                filename and size for one line; while playing it earns the
                space by showing something the size in bytes cannot. Absent for
                anything with no peaks: a document, or a file too large to have
                been decoded at send. */}
            {playing && hasWave && (
              <span
                aria-hidden="true"
                style={{
                  flex: 1, minWidth: 0, height: 16, marginLeft: 2,
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  overflow: 'hidden',
                }}
              >
                {Array.from({ length: WAVE_BARS }, (_, i) => (
                  <span
                    key={i}
                    ref={el => { barsRef.current[i] = el; }}
                    style={{
                      flex: '1 1 0', minWidth: 1,
                      height: 0, opacity: 0,
                      borderRadius: 1,
                      background: 'linear-gradient(180deg, #D8B4FE 0%, #A855F7 100%)',
                      transition: 'height .06s linear',
                    }}
                  />
                ))}
              </span>
            )}
          </span>
        </span>

        {/* ⚠ THE ARROW IS THE DOWNLOAD BUTTON. The whole row used to be, which
            meant a tap anywhere — including on the waveform someone was aiming
            at — began a 30MB transfer. Downloading is now the one control that
            looks like downloading. */}
        {!pending && canDownload && (
          <span style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); if (!busy) setAsking(v => !v); }}
              disabled={busy}
              aria-label={`Download ${name}`}
              aria-expanded={asking}
              style={{
                width: 30, height: 30, borderRadius: 999, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(255,255,255,.10)',
                background: asking ? 'rgba(255,255,255,.10)' : 'transparent',
                color: 'var(--muted)', cursor: busy ? 'default' : 'pointer',
              }}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
              </svg>
            </button>

            {asking && (
              <DownloadPopover
                name={name}
                meta={meta}
                hd={hd}
                onConfirm={confirmDownload}
                onClose={() => setAsking(false)}
              />
            )}
          </span>
        )}

        {/* The sender asked that this not be kept. The affordance goes; the
            file is still playable, which is the whole point of sending it. */}
        {!pending && !canDownload && (
          <span
            title="The sender shared this for listening only"
            aria-label="Download not offered"
            style={{ flexShrink: 0, display: 'flex', color: 'rgba(255,255,255,.20)' }}
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0" />
            </svg>
          </span>
        )}

        {/* Mounted always so play() targets a stable element; src is set lazily. */}
        <audio
          ref={audioRef}
          onPlay={() => setPlaying(true)}
          // ⚠ Guarded on `ended` — see VoiceMessage. Releasing on a natural
          // finish would clear the claim before finishAudio could resume what
          // this track interrupted.
          onPause={e => { if (!e.currentTarget.ended) releaseAudio(sessionRef.current); setPlaying(false); }}
          onEnded={() => { finishAudio(sessionRef.current); setPlaying(false); }}
          style={{ display: 'none' }}
        />
      </div>

    </>
  );
}

/**
 * "Do you want this file?" — asked BEFORE 30MB moves to a phone.
 *
 * ⚠ A POPOVER, NOT A SHEET. This was a full-screen bottom sheet, which is the
 * right weight for a decision that changes something and far too much for one
 * that fetches a file you are already looking at. It now opens beside the arrow
 * that summoned it, so the message stays visible and the answer is one tap
 * away in either direction.
 *
 * ⚠ THE COMPRESSED OPTION IS DIMMED, NOT MISSING. A 320 of a master cannot be
 * made today: browsers do not encode MP3/AAC, there is no server transcode, and
 * a WASM encoder is a dependency decision nobody has taken. Dimmed says "coming",
 * which is true, and holds the layout for the day it arrives.
 */
function DownloadPopover({ name, meta, hd, onConfirm, onClose }) {
  useEffect(() => {
    const onKey  = e => { if (e.key === 'Escape') onClose(); };
    // Capture, so this closes before the arrow's own onClick can reopen it on
    // the very press meant to dismiss.
    const onDown = e => { if (!e.target.closest?.('[data-yp-dl]')) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  return (
    <div
      data-yp-dl
      role="dialog"
      aria-label={`Download ${name}`}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', right: 0, bottom: 'calc(100% + 8px)',
        width: 208, padding: 8, borderRadius: 14, zIndex: 40,
        background: 'linear-gradient(180deg, rgba(28,26,36,.98) 0%, rgba(18,17,24,.99) 100%)',
        border: '1px solid rgba(255,255,255,.13)',
        boxShadow: '0 16px 40px -16px rgba(0,0,0,.95)',
        backdropFilter: 'blur(20px)',
        textAlign: 'left',
      }}
    >
      <div style={{ padding: '2px 4px 8px', borderBottom: '1px solid rgba(255,255,255,.07)', marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 10.5, color: 'var(--muted)' }}>
          {hd && <span className="yp-hd-chip">HD</span>}
          <span>{meta}</span>
        </div>
      </div>

      <button type="button" onClick={onConfirm} className="yp-attach-row" style={{ width: '100%', fontSize: 13, border: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'inherit' }}>
        {hd ? 'Download lossless' : 'Download'}
      </button>

      {hd && (
        <button type="button" disabled title="Compressed download coming soon" className="yp-attach-row" style={{ width: '100%', fontSize: 13, border: 'none', background: 'transparent', color: 'rgba(255,255,255,.30)', fontFamily: 'inherit', cursor: 'not-allowed' }}>
          MP3 320 — soon
        </button>
      )}
    </div>
  );
}
