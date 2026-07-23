import { useEffect, useState } from 'react';
import HandIcon from './HandIcon';

const SEEN_KEY = 'yp_beta_welcome_seen';
// "A short time" in the app. Tune here — this is the only place that decides
// when the popup fires.
const DELAY_MS = 15000;

/**
 * The beta program's one-time welcome. Fires once, ever, per browser —
 * timed off app usage, not off pressing the Beta Feedback button (that one's
 * own first-open welcome lives inside the feedback tool itself).
 */
export default function BetaWelcomePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) return undefined;
    const timer = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    localStorage.setItem(SEEN_KEY, '1');
    setOpen(false);
  }

  if (!open) return null;

  const gradientText = {
    fontWeight: 700,
    background: 'linear-gradient(135deg,#55bbcf,#8c55e5 72%)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
  };
  // Only "YesPleez" itself is the big brand mark — bigger than the "Here we
  // go!" heading (24px). "The Scene / In Your Hands" is a normal-size white
  // subline underneath it, not part of the gradient treatment.
  const brandName = { ...gradientText, margin: '0 0 2px', fontSize: 34, lineHeight: 1.1 };
  const emphasis = { ...gradientText, margin: '0 0 16px', fontSize: 15 };

  return (
    <div className="yp-modal" onClick={dismiss}>
      <div
        className="yp-modal-card"
        style={{ maxWidth: 360, textAlign: 'center' }}
        onClick={e => e.stopPropagation()}
      >
        <HandIcon size={90} style={{ margin: '0 0 8px', color: '#fff' }} />
        <h2 style={{ margin: '0 0 18px', fontSize: 24, letterSpacing: '-0.6px' }}>Here we go!</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--text)', fontSize: 14.5, lineHeight: 1.5 }}>
          Built for tying the scene together, welcome to my latest special interest..
        </p>
        <p style={brandName}>YesPleez</p>
        <p style={{ margin: '0 0 16px', color: '#fff', fontSize: 14.5, lineHeight: 1.4 }}>
          The Scene<br />In Your Hands
        </p>
        <p style={{ margin: '0 0 16px', color: 'var(--text)', fontSize: 14.5, lineHeight: 1.5 }}>
          I’ve chosen you as one of my handful of original beta testers because I respect your opinion, your insight and most of all, your taste you stylish mofo's.
        </p>
        <p style={{ ...emphasis, marginBottom: 22 }}>
          Hit the Beta Feedback button at the top of the screen and get at me!
        </p>
        <button
          type="button"
          onClick={dismiss}
          autoFocus
          style={{
            width: '100%', padding: '13px 18px', borderRadius: 13, border: 'none',
            background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
            color: '#0a0a0f', fontSize: 15, fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Chz!
        </button>
      </div>
    </div>
  );
}
