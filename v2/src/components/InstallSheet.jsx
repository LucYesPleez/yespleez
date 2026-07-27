import { useEffect, useState } from 'react';
import { promptInstall } from '../lib/installPrompt';

/**
 * THE INSTALL SCREEN — the owner's artwork, full screen, sliding down from the
 * top. One component, two platforms, two quite different jobs:
 *
 *   ANDROID  install-android.png. Its painted "Install Web App" pill sits over
 *            a TRANSPARENT hotspot that fires the real PWA install dialog.
 *   iOS      install-ios.png. A four-step guide, and nothing to tap. Safari
 *            exposes no install API at any version, so there is no button to
 *            put behind anything — the picture IS the whole feature.
 *
 * ⚠ THE ARTWORK IS THE UI. Every word and control is baked into the PNG; there
 * is no text layer to restyle. On Android the only interactive element is an
 * invisible rectangle positioned in percentages so it tracks the image at any
 * width.
 *
 * ⚠ IF AN ARTWORK IS REPLACED, ITS HOTSPOT MOVES WITH IT. The button is
 * invisible, so a mismatch does not look broken — it silently stops working,
 * or becomes tappable where nothing is drawn. Re-measure the pill as a
 * percentage of the image whenever the Android PNG changes.
 */

// Both artworks are 1024x1536. Reserved before the image arrives so a 1.5MB
// PNG landing does not resize the panel underneath the user.
const ARTWORK_RATIO = '1024 / 1536';

/** Over the painted "Install Web App" pill. Android artwork only. */
const ANDROID_HOTSPOT = { left: '17.3%', top: '87.2%', width: '65.4%', height: '8.3%' };

export default function InstallSheet({ open, onClose, platform }) {
  const [note, setNote] = useState('');
  const isAndroid = platform === 'android';

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

    // Reachable only if the deferred event expired between the button
    // appearing and the tap — rare, but silence there would look broken.
    setNote('That didn’t open. Try the browser menu ⋮ → Install app.');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add YesPleez to your home screen"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        // ⚠ Slides from the TOP, per the owner: "full screen slide down".
        // transform + opacity only — both compositor properties, so the
        // animation never lays out a 1.5MB image mid-flight.
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
        {/* Rendered only while open: at ~1.5MB neither artwork may be part of
            the app's initial cost, and only one of the two is ever fetched. */}
        {open && (
          <img
            src={isAndroid ? '/install-android.png' : '/install-ios.png'}
            alt={isAndroid
              ? 'Save YesPleez to your phone — install it like a native app'
              : 'How to add YesPleez to your iPhone home screen: tap More, then Add to Home Screen, then Add'}
            style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: ARTWORK_RATIO }}
          />
        )}

        {/* ⚠ ANDROID ONLY. On iOS there is deliberately NOTHING to press —
            adding a dead button over a picture of instructions would invite
            taps that cannot do anything, which is worse than no button. */}
        {isAndroid && (
          <button
            type="button"
            onClick={handleInstall}
            aria-label="Install YesPleez"
            style={{
              position: 'absolute', ...ANDROID_HOTSPOT,
              border: 0, borderRadius: 999, background: 'transparent',
              opacity: 0, cursor: 'pointer',
              outlineOffset: 2,   // keyboard users get a visible target
            }}
          />
        )}

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
