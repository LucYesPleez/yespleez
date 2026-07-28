import { useEffect, useState } from 'react';
import HandIcon from './HandIcon';

/**
 * ⏸ PARKED, NOT DELETED — owner, 2026-07-28: "we're going to hide this card
 * for now."
 *
 * The guided tour replaces what this was doing: a welcome popup explains the
 * app in prose, the tour teaches it by lighting the real interface, and two
 * things introducing YesPleez on first launch is one too many. The card would
 * also land on top of the tour's step 1, since both fire on the same screen.
 *
 * The copy is kept intact and current — it was rewritten and approved the same
 * day it was parked, so if any of it is wanted inside the tour it should be
 * lifted from here rather than reinvented. Flip this to `true` to bring the
 * card back; delete the file only once the tour has genuinely absorbed it.
 */
const ENABLED = false;

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
    // ⚠ GATED IN THE EFFECT, NOT AT THE TOP OF THE COMPONENT. An early return
    // before the hook would change the hook order between renders the moment
    // anyone flips ENABLED at runtime while debugging.
    if (!ENABLED) return undefined;
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
  // ⚠ "YesPleez." IS THE HEADING. It opens the card directly under the hand
  // mark — there is no "Here we go!" above it and no lead-in sentence before
  // it, both of which the owner cut. It is the only gradient mark up here, so
  // it carries the weight the old h2 was carrying; do not reintroduce a
  // heading above it.
  const brandName = { ...gradientText, margin: '0 0 2px', fontSize: 34, lineHeight: 1.1 };
  const emphasis = { ...gradientText, margin: '0 0 16px', fontSize: 15 };
  const body = { margin: '0 0 16px', color: 'var(--text)', fontSize: 14.5, lineHeight: 1.5 };

  return (
    <div className="yp-modal" onClick={dismiss}>
      <div
        className="yp-modal-card"
        style={{ maxWidth: 360, textAlign: 'center' }}
        onClick={e => e.stopPropagation()}
      >
        <HandIcon size={90} style={{ margin: '0 0 18px', color: '#fff' }} />

        <p style={{ ...brandName, marginBottom: 10 }}>YesPleez.</p>
        <p style={{ margin: '0 0 18px', color: '#fff', fontSize: 14.5, lineHeight: 1.4 }}>
          The Scene.<br />In Your Hands.
        </p>

        {/* Three promises, one per line, set airier than the prose around
            them. Run together as a paragraph they read as a list being
            recited; stacked, each one lands on its own. */}
        <p style={{ ...body, lineHeight: 1.85, marginBottom: 18 }}>
          Discover what’s happening.<br />
          Follow the artists and venues you love.<br />
          Connect with your local music scene.
        </p>

        <p style={body}>
          This is an early beta, and we’re building it with the community, not just for it.
        </p>

        <p style={emphasis}>
          Have a sticky beak around and if you find anything that sucks, or shreds, tell us by hitting that green BETA button up top.
        </p>

        {/* ⚠ THE SIGN-OFF IS QUIETER THAN EVERYTHING ABOVE IT, deliberately.
            It is a signature, not a line of copy — the card has already made
            its case by here, and a name set at body weight competes with the
            call to action directly above rather than closing it. Muted, and
            the name on its own line the way it is signed. */}
        <p style={{
          margin: '0 0 22px', color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.5,
        }}>
          Cheers legends!<br />Lucious
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
          Let’s go!
        </button>
      </div>
    </div>
  );
}
