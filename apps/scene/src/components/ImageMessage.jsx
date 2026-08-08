import { useState, useEffect, useRef } from 'react';
import {
  signedUrlFor, downloadOriginalUrl,
  hasExpired, formatRemaining, formatBytes, describeOriginal,
} from '../lib/messageImages';

/**
 * A PHOTO IN THE THREAD (M11, extended by M13).
 *
 * Built on `VoiceMessage`'s model, because a photo has the same two-source
 * problem: a sent one lives in a private bucket and needs a signed url, and one
 * still in flight — or one that failed — exists only as a blob in this tab.
 *
 * ── THREE SIZES, AND EACH IS USED IN EXACTLY ONE PLACE ───────────────
 *
 *   thumbnail (720)  the bubble. Small, because a bubble is at most 76% of a
 *                    phone and never needs more.
 *   optimised (2560) the full-screen viewer, and the bubble's FALLBACK for any
 *                    photo sent before M13 — those have no thumbnail and never
 *                    will, exactly as a pre-v2 Voicey keeps its old waveform.
 *   original         never displayed. Download only, and only while its window
 *                    is open.
 *
 * ── THE BOX IS RESERVED BEFORE THE PIXELS ARRIVE ─────────────────────
 *
 * `width` and `height` are stored in the payload at send time, so this renders
 * at the correct aspect ratio immediately and the picture fades into a box that
 * was already the right shape. Without them the bubble would be zero-high until
 * the image decoded and then shove the whole conversation down.
 */

/**
 * THE THUMBNAIL'S HEIGHT IN THE THREAD. Every photo draws at this height, and
 * its width follows from its own aspect ratio.
 *
 * ── ⚠ THIS IS A LAYOUT FIX, NOT A SIZE PREFERENCE ────────────────────
 *
 * The bubble used to be `width: 100%` with an `aspectRatio`, and it JUMPED
 * every time a thread was reopened. `.yp-msg-frame` shrink-wraps — it is a flex
 * item with `max-width: 76%` — and a percentage width inside a shrink-to-fit
 * container resolves against the container's own content width, which is
 * nothing until the image has decoded. So each photo rendered collapsed, then
 * snapped to its natural size as it loaded, shoving everything below it.
 * Reserving the aspect ratio could not help: the box had no width to apply a
 * ratio to.
 *
 * Deriving PIXEL dimensions from the payload's stored size removes the
 * dependency entirely. The box is correct before the network is touched, so a
 * reopened conversation lays out once and never moves.
 *
 * 190 is chosen to sit comfortably under `MAX_W` for ordinary phone photos, so
 * a portrait shot and a landscape shot occupy visibly different, honest shapes
 * rather than being cropped to a uniform tile.
 */
const THUMB_H = 190;

/** Never wider than a bubble may be on the narrowest handset in scope. */
const MAX_W = 240;

/* HOLD_MS / HOLD_SLOP_PX lived here while a HOLD opened the photo. Hold now
   belongs to the message frame's long press (the reaction bar), and opening
   moved to a single tap — so the disambiguation moved with it, into
   DOUBLE_TAP_MS below. Removed rather than left dormant: two hold constants
   that nothing reads are an invitation to wire up a second, competing gesture. */

/**
 * How often the countdown redraws.
 *
 * 30s, not 1s. The window is measured in days and the smallest unit ever shown
 * is a minute, so a per-second tick would re-render every open viewer sixty
 * times for each visible change.
 */
const TICK_MS = 30_000;

export default function ImageMessage({ message }) {
  const path     = message?.payload?.path ?? null;
  const localUrl = message?.payload?.localUrl ?? null;
  const width    = Number(message?.payload?.width  ?? 0);
  const height   = Number(message?.payload?.height ?? 0);
  const original = message?.payload?.original ?? null;

  // ⚠ FALLS BACK TO THE OPTIMISED PATH, PERMANENTLY. Photos sent before M13
  // carry no thumbnail and cannot acquire one — variants are produced once, at
  // send time. This branch is the permanent shape of the code.
  const thumbPath = message?.payload?.thumb_path ?? path;

  const [url,     setUrl]     = useState(localUrl);   // the bubble's picture
  const [fullUrl, setFullUrl] = useState(localUrl);   // the viewer's
  const [error,   setError]   = useState(null);
  const [open,    setOpen]    = useState(false);


  /**
   * ⚠ SINGLE TAP ENLARGES, DOUBLE TAP ACKNOWLEDGES, AND THEY MUST NOT CROSS
   * OVER (owner, 2026-07-26).
   *
   * They cannot simply be two handlers, because every double tap BEGINS as a
   * single one. Opening on the first tap put the viewer on screen before the
   * second tap could land, so the second went to the viewer and the
   * acknowledgement never happened — the exact crossover being ruled out.
   *
   * So the open WAITS OUT the double-tap window. A second tap inside it
   * cancels the pending open and does nothing else, letting the browser's own
   * `dblclick` reach the bubble, where the acknowledgement already lives.
   *
   * The cost is honest and unavoidable: a photo opens ~240ms after the tap
   * rather than instantly. That delay is what buys an unambiguous double tap;
   * the only way to remove it is to give up one of the two gestures.
   */
  const DOUBLE_TAP_MS = 240;
  const tapRef = useRef({ timer: null });

  function onTap() {
    if (tapRef.current.timer) {
      // Second tap inside the window — this is a double tap. Cancel the open
      // and get out of the way; the bubble's onDoubleClick does the rest.
      clearTimeout(tapRef.current.timer);
      tapRef.current.timer = null;
      return;
    }
    tapRef.current.timer = setTimeout(() => {
      tapRef.current.timer = null;
      if (url && !error) setOpen(true);
    }, DOUBLE_TAP_MS);
  }

  // A pending open must not fire into an unmounted component, and must not
  // survive the thread scrolling this row away.
  useEffect(() => () => clearTimeout(tapRef.current.timer), []);

  // A finger that travels is scrolling the thread, not tapping the photo — so
  // a pending open is abandoned. Without this, a scroll that begins on a photo
  // opens it a quarter-second later, under a thumb that has moved on.
  function cancelTapOnMove() {
    clearTimeout(tapRef.current.timer);
    tapRef.current.timer = null;
  }

  // The bubble's picture: the thumbnail where one exists.
  useEffect(() => {
    if (localUrl) { setUrl(localUrl); return; }
    if (!thumbPath) return;

    let cancelled = false;
    (async () => {
      const { url: signed, error: signError } = await signedUrlFor(thumbPath);
      if (cancelled) return;
      if (signError || !signed) { setError('Photo unavailable'); return; }
      setUrl(signed);
    })();
    return () => { cancelled = true; };
  }, [thumbPath, localUrl]);

  // The viewer's picture, signed only when the viewer is opened. Signing the
  // 2560 on mount would mean a storage request per photo scrolled past, for a
  // url that expires in an hour and is usually never used.
  useEffect(() => {
    if (!open || fullUrl || !path) return;

    let cancelled = false;
    (async () => {
      const { url: signed } = await signedUrlFor(path);
      if (!cancelled && signed) setFullUrl(signed);
    })();
    return () => { cancelled = true; };
  }, [open, fullUrl, path]);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * Sends the global header BEHIND the viewer while it is open — blurred into
   * the backdrop and inert. See `body.yp-viewer-open .yp-global-header`.
   *
   * A body class rather than a prop: the header sits far above this component
   * in the tree, and threading state up through every screen between them
   * would couple two components that otherwise know nothing about each other.
   *
   * ⚠ REMOVED IN CLEANUP, NOT ONLY ON CLOSE. A photo can be unmounted while
   * its viewer is open — the thread re-renders, or the conversation is
   * closed from underneath it — and a class left behind would leave the
   * header permanently blurred and unclickable with no way to recover it.
   */
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('yp-viewer-open');
    return () => document.body.classList.remove('yp-viewer-open');
  }, [open]);

  // ⚠ NO PICTURE, AND NOTHING IS WRONG. A RAW or a TIFF cannot be decoded by
  // any browser, so no optimised copy or thumbnail was ever made — but the
  // original is there, and it is the whole reason the photograph was sent.
  // Checked BEFORE the unavailable branch below, or the most deliberate HD send
  // in the app would report itself as broken.
  if (!path && !localUrl && original) {
    return <OriginalCard message={message} original={original} />;
  }

  if (!path && !localUrl) {
    // Still in flight: an undecodable original draws its card from the pending
    // payload, so the message does not flicker through an error state on its
    // way to existing.
    const pendingName = message?.payload?.name;
    if (pendingName) {
      return <OriginalCard message={message} original={null} pendingName={pendingName} />;
    }
    return (
      <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
        {message?.body || 'Photo'} — unavailable
      </div>
    );
  }

  // ⚠ PIXELS, COMPUTED FROM THE PAYLOAD — never a percentage, and never derived
  // from the loaded image. See THUMB_H. A photo whose payload carried no
  // dimensions falls back to 4:3, which is a stable wrong shape rather than an
  // unstable right one.
  const aspect = width > 0 && height > 0 ? width / height : 4 / 3;
  const thumbW = Math.min(MAX_W, Math.round(THUMB_H * aspect));
  const thumbH = Math.round(thumbW / aspect);
  const spent = original ? hasExpired(original) : false;

  return (
    <>
      {/* ⚠ SINGLE TAP OPENS THE VIEWER (owner, 2026-07-25). This reverses the
          previous rule, and the reversal is deliberate — the note that stood
          here said "taps belong to the Yes; opening is a HOLD", because
          tap-to-open had broken double-tap-to-Yes twice.

          What changed: HOLD now belongs to the reaction sheet, on every kind.
          Two gestures cannot both be a hold, so opening had to move to tap,
          and the double-tap Yes on a PHOTO is the cost. The Yes is still
          reachable there from the long-press sheet, which is why it is listed
          as an action rather than left to the double-tap alone.

          No stopPropagation: the hold must still reach the frame, or a photo
          would be the one kind you cannot react to. */}
      <button
        type="button"
        onClick={onTap}
        onPointerCancel={cancelTapOnMove}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (url && !error) setOpen(true);
        }}
        onContextMenu={e => e.preventDefault()}
        aria-label={error ? 'Photo unavailable' : 'Photo — hold to enlarge'}
        disabled={!url || Boolean(error)}
        style={{
          position: 'relative',
          display: 'block', padding: 0, border: 'none',
          background: 'rgba(255,255,255,.04)',
          borderRadius: 16, overflow: 'hidden',
          // Fixed, known before any network call. This is what stops the thread
          // reflowing when a conversation is reopened.
          width: thumbW, height: thumbH, flexShrink: 0,
          cursor: url && !error ? 'zoom-in' : 'default',
          userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          touchAction: 'pan-y',
        }}
      >
        {error ? (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic' }}>
            {error}
          </span>
        ) : url ? (
          <img
            src={url}
            alt={message?.body || 'Photo'}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setError('Photo unavailable')}
          />
        ) : (
          <span className="yp-img-loading" style={{ display: 'block', width: '100%', height: '100%' }} />
        )}

        {/* The chip, on the photo. Bottom-RIGHT: bottom-left is the Yes badge's
            corner, and the two must never contend for the same spot. */}
        {original && !spent && !error && (
          <span
            className="yp-hd-chip yp-hd-chip-onphoto"
            style={{ position: 'absolute', right: 7, bottom: 7 }}
            aria-label="Original available in higher quality"
          >
            HD
          </span>
        )}
      </button>

      {open && (
        /* ⚠ THE BOTTOM NAV IS SACRED. This stops at `--yp-nav-height` rather
           than using `inset: 0`. A photo viewer is exactly the kind of overlay
           that reaches for full-screen by reflex — it must not. */
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          style={{
            // ⚠ App-scoped: `left:0/right:0` fixed is DESKTOP-wide, not app-wide.
            // The viewer keeps a heavier dim than a dialog because a photograph
            // wants the surrounding surface gone.
            position: 'fixed', top: 0, left: 0, right: 0,
            bottom: 'var(--yp-nav-height)',
            background: 'rgba(6,6,10,.94)',
            backdropFilter: 'blur(8px)',
            zIndex: 60,
            display: 'flex', flexDirection: 'column',
            maxWidth: 'var(--yp-app-max, 680px)', margin: '0 auto',
          }}
        >
          {/* ⚠ PINCH IS THE BROWSER'S, NOT OURS. `touch-action: pinch-zoom` on a
              scrolling box hands the gesture to the engine — real momentum,
              real bounds, real two-finger panning for nothing.

              ⚠ IT IS ALSO WHY THE BACKDROP DOES NOT CLOSE ON TAP: a tap-to-close
              listener fires when a pinch ends slightly off the photo, shutting
              the viewer mid-gesture. Closing is the ✕, plus Escape. */}
          <div
            style={{
              flex: 1, minHeight: 0,
              overflow: 'auto',
              touchAction: 'pinch-zoom',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 16, boxSizing: 'border-box',
            }}
          >
            <img
              src={fullUrl || url}
              alt={message?.body || 'Photo'}
              // `contain` HERE, unlike the bubble: this box is the screen's
              // shape, not the picture's, so the whole photo has to fit inside
              // it before any zooming begins.
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
          </div>

          {original && <OriginalPanel original={original} name={message?.payload?.name || message?.body} />}

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close photo"
            style={{
              position: 'absolute', top: 12, right: 12,
              width: 40, height: 40, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Bare glyph — no disc, no border, no blur. The viewer's own
              // dim is what the ✕ reads against, so the chrome around it was
              // doing nothing except announcing itself over the photograph.
              //
              // ⚠ The 40×40 box is KEPT. It is invisible now, but it is the
              // tap target — shrinking to the glyph would leave an 18px
              // target, which is under half the ~44px minimum and would be
              // genuinely hard to hit on a phone.
              background: 'none',
              border: 'none',
              // Full white rather than .86: without a backing disc there is no
              // contrast to borrow, so the glyph has to hold its own against
              // whatever part of the photo sits behind it.
              color: '#fff', cursor: 'pointer', padding: 0,
              // The one thing kept from the old treatment: a shadow, so the
              // mark survives a bright or busy corner. drop-shadow follows the
              // stroke rather than boxing it.
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.9))',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

/**
 * A PHOTOGRAPH WITH NO VIEWABLE VERSION — a RAW, a TIFF.
 *
 * Deliberately shaped like `FileMessage` rather than like a broken photo: what
 * the recipient has is a file to download, so it should look like one. The
 * difference from an ordinary attachment is the countdown — this one goes away.
 *
 * ⚠ IT DOES NOT PRETEND TO A PREVIEW. No placeholder frame, no grey rectangle
 * standing in for a picture. Nothing was lost, so nothing should look missing.
 */
function OriginalCard({ message, original, pendingName = null }) {
  const [, setTick]       = useState(0);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  const name      = message?.payload?.name || message?.body || 'Original';
  const bytes     = original?.bytes ?? message?.payload?.pendingBytes ?? 0;
  const spent     = original ? hasExpired(original) : false;
  const remaining = original ? formatRemaining(original.expires_at) : null;
  const pending   = !original;

  useEffect(() => {
    if (pending || spent) return;
    const id = setInterval(() => setTick(t => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [pending, spent]);

  async function download(e) {
    e.stopPropagation();
    if (pending || spent || busy) return;
    setBusy(true);
    setError(null);
    const { url, error: dlError } = await downloadOriginalUrl(original);
    setBusy(false);
    if (dlError || !url) { setError(dlError?.message || 'Unavailable'); return; }
    window.location.href = url;
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={pending || spent || busy}
      aria-label={spent ? `${name} — expired` : `Download ${name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        width: '100%', minWidth: 0,
        padding: '10px 12px', border: 'none', borderRadius: 14,
        background: 'rgba(255,255,255,.05)',
        color: 'var(--text)', textAlign: 'left',
        cursor: pending || spent || busy ? 'default' : 'pointer',
        opacity: pending ? .6 : 1,
      }}
    >
      {/* An aperture, not a document: this IS a photograph, it simply has no
          form a browser can show. */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0, width: 34, height: 34, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: spent ? 'rgba(255,255,255,.06)' : 'rgba(201,169,97,.14)',
          border: `1px solid ${spent ? 'rgba(255,255,255,.12)' : 'rgba(201,169,97,.30)'}`,
          color: spent ? 'rgba(255,255,255,.34)' : '#E8D5A0',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v8M20.5 8.5 13 12M18 19l-5-7M6 19l6-7M3.5 8.5 12 12" />
        </svg>
      </span>

      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 14, lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {pendingName || name}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11.5, color: 'var(--muted)' }}>
          <span className={`yp-hd-chip${spent ? ' yp-hd-chip-spent' : ''}`}>HD</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error ? error
              : busy    ? 'Preparing…'
              : pending ? 'Uploading…'
              : spent   ? 'Expired'
              : [describeOriginal(original, name), bytes ? formatBytes(bytes) : null, remaining ? `${remaining} left` : null]
                  .filter(Boolean).join('   ·   ')}
          </span>
        </span>
      </span>

      {!pending && !spent && !busy && !error && (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--muted)' }}>
          <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
        </svg>
      )}
    </button>
  );
}

/**
 * WHAT IS AVAILABLE, AND FOR HOW MUCH LONGER.
 *
 * ⚠ THIS PANEL DESCRIBES; IT DOES NOT DECIDE. The countdown is drawn from
 * `expires_at` copied onto the message payload, which a determined client could
 * edit — and editing it would change these words and nothing else. What
 * actually ends the window is M13's storage policy joining `message_originals`,
 * so a doctored countdown reading "2d left" still cannot obtain a url.
 *
 * That separation is why this can be plain rendering with no guards in it.
 */
function OriginalPanel({ original, name = '' }) {
  const [, setTick]   = useState(0);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const spent     = hasExpired(original);
  const remaining = formatRemaining(original.expires_at);

  // Re-render so the countdown moves. Stopped once the window has closed —
  // there is nothing left to count, and an interval per expired photo in a long
  // thread is a timer that never stops for a number that never changes.
  useEffect(() => {
    if (spent) return;
    const id = setInterval(() => setTick(t => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [spent]);

  async function download() {
    setBusy(true);
    setError(null);
    const { url, error: dlError } = await downloadOriginalUrl(original);
    setBusy(false);
    if (dlError || !url) { setError(dlError?.message || 'Unavailable'); return; }
    window.location.href = url;
  }

  return (
    <div
      style={{
        flexShrink: 0,
        padding: '12px 16px 14px',
        borderTop: '1px solid rgba(255,255,255,.09)',
        background: 'rgba(12,12,17,.72)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <span className={`yp-hd-chip${spent ? ' yp-hd-chip-spent' : ''}`}>HD</span>
        <span style={{ fontSize: 13, color: spent ? 'var(--muted)' : 'var(--text)' }}>
          {spent ? 'Original expired' : 'Original available'}
        </span>
        {!spent && remaining && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {remaining} left
          </span>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: spent ? 0 : 10 }}>
        {spent
          ? 'The optimised version is still available above.'
          : [
              // Dimensions where they are known; the FILE TYPE where they are
              // not. A raw file's true resolution is unknown to us by design —
              // see `describeOriginal` — and "Nikon RAW (.NEF)" tells a
              // photographer more than a pixel count would anyway.
              describeOriginal(original, name),
              original.bytes ? formatBytes(original.bytes) : null,
            ].filter(Boolean).join('   ·   ')}
      </div>

      {!spent && (
        <button
          type="button"
          onClick={download}
          disabled={busy}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 12,
            border: '1px solid rgba(255,255,255,.14)',
            background: 'rgba(255,255,255,.07)',
            color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Preparing…' : error || 'Download original'}
        </button>
      )}
    </div>
  );
}
