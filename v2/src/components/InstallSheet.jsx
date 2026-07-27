import { useEffect, useState } from 'react';
import { promptInstall } from '../lib/installPrompt';

/**
 * THE INSTALL SCREEN — the owner's artwork, full screen, sliding down from the
 * top. One component, THREE platforms, and they are not variants of one thing:
 *
 *   android      install-android.jpg. Its painted "Install Web App" pill sits
 *                over a TRANSPARENT hotspot firing the real PWA install
 *                dialog. The ONLY branch with anything to press.
 *   ios-chrome   install-ios-chrome.jpg. Four steps via Chrome's ••• menu.
 *   ios-safari   install-ios-safari.jpg. Four steps via Safari's Share button.
 *
 * ⚠ THE TWO iOS GUIDES ARE NOT INTERCHANGEABLE. Safari has no ••• button and
 * Chrome has no Share button in that position, so showing the wrong one sends
 * the user hunting for a control that does not exist — and since Safari is the
 * DEFAULT iOS browser, getting that backwards fails the majority. Neither has
 * anything to tap: no iOS browser exposes an install API at any version, so
 * there is no button to put behind anything and the picture IS the feature.
 *
 * ⚠ THE ARTWORK IS THE UI. Every word and control is baked into the image;
 * there is no text layer to restyle. On Android the only interactive element
 * is an invisible rectangle positioned in percentages so it tracks the image
 * at any width.
 *
 * ⚠ IF AN ARTWORK IS REPLACED, ITS HOTSPOT MOVES WITH IT. The button is
 * invisible, so a mismatch does not look broken — it silently stops working,
 * or becomes tappable where nothing is drawn. Re-measure the pill as a
 * percentage of the image whenever the Android PNG changes.
 */

/**
 * ⚠ THE THREE ARTWORKS ARE NOT THE SAME SHAPE, so the ratio is per-platform.
 * Android is 1024x1536 (0.667); both iOS guides are 1200x1687 (0.711). Reserved
 * before the image arrives, so the panel does not resize under the user as it
 * lands — and a single shared ratio would reserve the wrong box for two of the
 * three, producing exactly the jump this exists to prevent.
 */
const ART = {
  android:      { src: '/install-android.jpg',     ratio: '1024 / 1536' },
  'ios-chrome': { src: '/install-ios-chrome.jpg',  ratio: '1200 / 1687' },
  'ios-safari': { src: '/install-ios-safari.jpg',  ratio: '1200 / 1687' },
};

/** Over the painted "Install Web App" pill. Android artwork only. */
const ANDROID_HOTSPOT = { left: '17.3%', top: '87.2%', width: '65.4%', height: '8.3%' };

/**
 * ⚠ THE STEPS EXIST ONLY AS PIXELS, so alt text is not a formality here — it
 * is the only version of these instructions a screen reader can reach. Each
 * describes its own artwork's actual flow; Safari's and Chrome's differ, which
 * is the entire reason there are two.
 */
const ALT = {
  android: 'Save YesPleez to your phone — install it like a native app',
  'ios-chrome': 'Add YesPleez to your home screen in Chrome: tap the More (•••) button, tap Add to Home Screen, then tap Add',
  'ios-safari': 'Add YesPleez to your home screen in Safari: tap the Share button, tap Add to Home Screen, then tap Add',
};

export default function InstallSheet({ open, onClose, platform }) {
  const [note, setNote] = useState('');
  const isAndroid = platform === 'android';
  const art = ART[platform] || ART.android;

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
        {/* One artwork per platform, each already matched to the browser the
            user is actually in. Rendered only while open and only the one that
            applies — three guides must never all be fetched, and none of them
            belongs in the app's initial cost.
            ⚠ ALT TEXT CARRIES THE STEPS. The instructions exist only as pixels,
            so without this a screen-reader user gets a decorative image and no
            way to install at all. */}
        {open && (
          <img
            src={art.src}
            alt={ALT[platform] || 'How to add YesPleez to your home screen'}
            style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: art.ratio }}
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
