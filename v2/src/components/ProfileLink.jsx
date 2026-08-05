import { useNavigate } from 'react-router-dom';
import { profileUrl } from '../lib/profileResolution';

/**
 * A FACE THAT GOES TO ITS OWNER'S PROFILE.
 *
 * Owner, 2026-08-05: "when you click on someones profile pic, regardless of
 * where it is, it takes you to their profile."
 *
 * ⚠ IT WRAPS, IT DOES NOT REPLACE. Every surface draws its avatar differently
 * — the inbox row has a 46px gradient ring, the search result a 36px disc, the
 * dock a 20px initial — and rewriting each of them to share one avatar
 * component is a much larger change than the request. This adds the BEHAVIOUR
 * around whatever is already there, in one place.
 *
 * ⚠ `stopPropagation` IS THE POINT. These avatars sit inside rows that open a
 * conversation. Without it, tapping the face would fire both — navigating to
 * the profile while the conversation dock opened behind it.
 *
 * ⚠ A SPAN WITH `role="link"`, NOT A BUTTON OR AN ANCHOR. The inbox row is
 * itself a `<button>`, and interactive content nested inside a button is
 * invalid HTML — browsers recover unpredictably and the inner control can stop
 * receiving events entirely. A span carries no such restriction; the role and
 * the key handler restore what it would otherwise lose. Not free: a screen
 * reader announces a link inside a button, which is unusual. The alternative
 * was making every conversation row a div, which costs the row its own
 * keyboard access — a worse trade.
 *
 * ⛔ NOT USED ON THE CONTACTS RAIL. `MessengerContactsSection` states that
 * tapping there CONTINUES THE CONVERSATION and that going to the profile
 * "would be wrong" — that rail exists for talking to people. Owner chose to
 * keep that rule when the conflict was raised (2026-08-05). The rail is the
 * one place a face is not a link.
 *
 * ⛔ NOT USED ON YOUR OWN FACE either — ProfileMenu, the identity selector and
 * the Messenger identity screen all show YOU, and each already does something
 * more useful with a tap.
 *
 * Renders children bare when there is no profile to point at, so an unresolved
 * row shows a face rather than a control that goes nowhere.
 */
export default function ProfileLink({ profile, children, style, label }) {
  const navigate = useNavigate();
  const url = profile?.id ? profileUrl(profile) : null;

  if (!url) return children;

  const go = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(url);
  };

  return (
    <span
      role="link"
      tabIndex={0}
      aria-label={label ?? `View ${profile.name || 'this'} profile`}
      onClick={go}
      // ⚠ ALSO STOPS `mousedown`. Several rows in this app act on mousedown
      // rather than click (the menus close that way), so swallowing only the
      // click would let the row react before this ever ran.
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') go(e);
      }}
      style={{ display: 'inline-flex', flexShrink: 0, borderRadius: 999, cursor: 'pointer', ...style }}
    >
      {children}
    </span>
  );
}
