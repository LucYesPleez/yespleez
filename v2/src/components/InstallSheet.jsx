import { useEffect, useState } from 'react';
import { promptInstall } from '../lib/installPrompt';

/**
 * THE INSTALL SCREEN — the owner's artwork, full screen, sliding down from the
 * top. One component, THREE platforms, and they are not variants of one thing:
 *
 *   android      install-android.png. Its painted "Install Web App" pill sits
 *                over a TRANSPARENT hotspot firing the real PWA install
 *                dialog. The only branch with anything to press.
 *   ios-chrome   install-ios-chrome.png. A four-step guide, nothing to tap —
 *                no iOS browser exposes an install API, so there is no button
 *                to put behind anything and the picture IS the feature.
 *   ios-safari   TEXT, not artwork. The supplied guide depicts Chrome's •••
 *                menu, which Safari does not have. See the block below.
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
  const isIosSafari = platform === 'ios-safari';

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
            the app's initial cost, and only one is ever fetched. */}
        {open && !isIosSafari && (
          <img
            src={isAndroid ? '/install-android.png' : '/install-ios-chrome.png'}
            alt={isAndroid
              ? 'Save YesPleez to your phone — install it like a native app'
              : 'How to add YesPleez to your home screen in Chrome: tap More, then Add to Home Screen, then Add'}
            style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: ARTWORK_RATIO }}
          />
        )}

        {/* ⚠ SAFARI GETS TEXT, NOT THE ARTWORK, AND THAT IS NOT A DOWNGRADE —
            IT IS THE ONLY CORRECT OPTION TODAY.
            The supplied iOS guide depicts CHROME: its step 2 menu shows New
            Incognito Tab / Reading List / Recent Tabs / Find in Page, and step
            1's toolbar has Chrome's extensions puzzle and tab counter. Safari
            has no ••• More button anywhere, so a Safari user following step 1
            hunts for a control that does not exist and concludes the app is
            broken. Showing beautiful wrong instructions is worse than plain
            right ones.
            Replace this whole block the moment Safari artwork exists — Safari
            is the DEFAULT browser on iOS, so this is the majority path, not
            the edge case. */}
        {open && isIosSafari && (
          <div style={{
            background: '#101018', border: '1px solid var(--border)', borderRadius: 18,
            padding: '26px 22px', lineHeight: 1.5,
          }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, letterSpacing: 2, color: '#fff', marginBottom: 6 }}>
              INSTALL YESPLEEZ
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              Add YesPleez to your home screen for quick access anytime — and so
              notifications can reach you.
            </div>
            {[
              ['1', <>Tap <strong style={{ color: '#fff' }}>Share</strong> in Safari’s toolbar — the square with an arrow pointing up.</>],
              ['2', <>Scroll down and tap <strong style={{ color: '#fff' }}>Add to Home Screen</strong>.</>],
              ['3', <>Tap <strong style={{ color: '#fff' }}>Add</strong>. YesPleez is now on your home screen.</>],
            ].map(([n, text]) => (
              <div key={n} style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, width: 24, height: 24, borderRadius: 999,
                  border: '1px solid #FF2D78', color: '#FF2D78',
                  display: 'grid', placeItems: 'center',
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700,
                }}>{n}</span>
                <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{text}</span>
              </div>
            ))}
          </div>
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
