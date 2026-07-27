import { useEffect, useState } from 'react';
import { promptInstall } from '../lib/installPrompt';

/**
 * THE INSTALL SCREEN — the owner's artwork, full screen, sliding down from the
 * top, with the real install flow behind its painted button.
 *
 * ⚠ THE ARTWORK IS THE UI. Everything visible here — heading, body copy, the
 * "Install Web App" pill — is baked into one supplied PNG. There is no text
 * layer to restyle and no button to re-skin; the control is a TRANSPARENT
 * hotspot positioned over the painted pill. Coordinates come from the owner's
 * own component and are percentages, so they track the image at every width.
 *
 * ⚠ IF THE ARTWORK IS EVER REPLACED, THE HOTSPOT MOVES WITH IT. The button is
 * invisible, so a mismatch does not look broken — it just quietly stops
 * working, or worse, is tappable where nothing is drawn. Re-measure the pill's
 * position as a percentage of the image whenever the PNG changes.
 */
const HOTSPOT = { left: '17.3%', top: '87.2%', width: '65.4%', height: '8.3%' };

// 1024x1536. Held as a constant because the sheet reserves this ratio before
// the image loads — without it the panel would resize as a 1.6MB PNG arrives.
const ARTWORK_RATIO = '1024 / 1536';

export default function InstallSheet({ open, onClose }) {
  const [note, setNote] = useState('');

  // Escape closes, and the page behind must not scroll while a full-screen
  // overlay is up: on a phone that produces a sheet that scrolls the feed
  // underneath it instead of itself.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => { if (!open) setNote(''); }, [open]);

  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') { onClose?.(); return; }
    if (outcome === 'dismissed') return;   // they said no; the sheet stays, silently

    // ⚠ NO iOS BRANCH HERE, AND THERE SHOULD NOT BE ONE. This screen is
    // Android-only by the owner's decision — InstallButton does not render
    // unless a native install dialog is genuinely available, which Safari can
    // never make true. Separate iOS artwork is coming; it belongs in its own
    // component, not as a fallback bolted onto this one.
    //
    // Reachable only if the deferred event expired between the button
    // appearing and the tap — rare, but silence there would look broken.
    setNote('That didn’t open. Try the browser menu ⋮ → Install app.');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save YesPleez to your phone"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        // ⚠ Slides from the TOP, per the owner: "full screen slide down".
        // Driven by transform + opacity only — both compositor properties, so
        // the animation does not lay out a 1.6MB image mid-flight.
        transform: open ? 'translateY(0)' : 'translateY(-100%)',
        opacity: open ? 1 : 0,
        transition: 'transform .34s cubic-bezier(.22,.9,.3,1), opacity .22s ease',
        // Untappable while hidden — without this the offscreen sheet still
        // swallows taps meant for the header behind it.
        pointerEvents: open ? 'auto' : 'none',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: 'min(100%, 460px)', lineHeight: 0 }}
      >
        {/* Loaded lazily and only while open: at 1.6MB this must never be part
            of the app's initial cost. See the note to the owner about size. */}
        {open && (
          <img
            src="/install-artwork.png"
            alt="Save YesPleez to your phone — install it like a native app"
            style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: ARTWORK_RATIO }}
          />
        )}

        {/* The painted pill's hotspot. Transparent by design — the artwork
            already draws the button. */}
        <button
          type="button"
          onClick={handleInstall}
          aria-label="Install YesPleez"
          style={{
            position: 'absolute', ...HOTSPOT,
            border: 0, borderRadius: 999, background: 'transparent',
            opacity: 0, cursor: 'pointer',
            // Keyboard users get a visible target even though it is painted.
            outlineOffset: 2,
          }}
        />

        {/* Only ever appears after a tap that could not open a dialog, so the
            artwork stays exactly as designed until something needs saying. */}
        {note && (
          <div style={{
            position: 'absolute', left: '8%', right: '8%', top: '96%',
            fontFamily: "'DM Sans',sans-serif", fontSize: 12.5, lineHeight: 1.5,
            color: '#fff', textAlign: 'center', textShadow: '0 1px 6px rgba(0,0,0,.9)',
          }}>
            {note}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 34, height: 34, borderRadius: 999,
            background: 'rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,.25)',
            color: '#fff', fontSize: 17, lineHeight: 1, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
