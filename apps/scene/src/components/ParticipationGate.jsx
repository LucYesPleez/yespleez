/**
 * PARTICIPATION GATE — "you can see this; an account is what lets you DO it."
 *
 * The contextual conversion sheet (O2, ratified 2026-08-12). A signed-out
 * visitor taps a participation control — a heart, a follow — and this sheet
 * rises over the content they were looking at, names the ACTION and what an
 * account enables, and offers the way in. The content stays visible behind
 * it; dismissal costs nothing.
 *
 * ⛔ THIS IS NOT AccessRequiredScreen AND MUST NEVER MERGE WITH IT. That
 * screen says "you cannot access this resource — the owner must grant it";
 * this one says "you can see this; participating needs an account." Withheld
 * and needs-an-account are different words in this app's law, and collapsing
 * them makes one surface mean two things (ratified with O2's brief).
 *
 * ⛔ NEVER "Sign in required." Every action's copy says what the account
 * ENABLES — the ratified example: "Keep this in your scene / Create a free
 * account and we'll save this event for you."
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────
 *
 * `useParticipation()` hands any control `request(action, { context,
 * display })`. The provider writes the returnIntent (route from the live
 * location, ids-only context) and opens the sheet. CREATE ACCOUNT / SIGN IN
 * navigate to /auth — the O1 surface, no second auth UI — which consumes the
 * intent after the session lands. NOT NOW clears the intent and closes;
 * an abandoned gate must not ambush a later, unrelated sign-in.
 *
 * Portalled to body: the header and several ancestors carry transforms, and
 * a transformed ancestor is the containing block for position:fixed — the
 * standing rule. Docked above the nav via --yp-safe-bottom: ⛔ nothing ever
 * renders over the bottom nav.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { captureIntent, clearIntent } from '../lib/returnIntent';
import { track, EVENTS } from '../lib/analytics';
import AccountInviteSheet from './AccountInviteSheet';

const Ctx = createContext(null);

/**
 * The copy table — per action, per subject. `display` is presentation only
 * (a name, a type); it never enters the stored intent.
 */
const FOLLOW_SUBJECT = {
  artist: 'this artist', band: 'this artist', standup: 'this artist',
  venue: 'this venue', host: 'this host',
};

/**
 * ⛔ THE BODY NEVER SAYS "CREATE A FREE ACCOUNT" — the button directly beneath
 * it already does (owner, 2026-08-12). Saying it twice in four lines reads as
 * a form to fill in rather than an offer. The body's whole job is what you
 * GET; the button's is what it costs.
 */
const COPY = {
  save_event: () => ({
    title: 'KEEP THIS IN YOUR SCENE',
    body: "We'll save this event for you.",
  }),
  follow_profile: (display) => {
    const subject = FOLLOW_SUBJECT[display?.type] || 'them';
    return {
      title: `KEEP UP WITH ${subject.toUpperCase()}`,
      body: `Follow ${subject} and see them in your scene.`,
    };
  },
};

/** No-op fallback so a control outside the provider degrades to the old
 *  silent behaviour instead of crashing — returns false: nothing was shown. */
export function useParticipation() {
  return useContext(Ctx) ?? (() => false);
}

export function ParticipationProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [gate, setGate] = useState(null); // { action, display }

  const request = useCallback((action, { context, display } = {}) => {
    if (!COPY[action]) return false;
    // The route is wherever the person is standing right now — captured at
    // the moment of desire, which is what makes the return trip possible.
    captureIntent({ route: location.pathname + location.search, action, context });
    track(EVENTS.GATE_SHOWN, { action });
    setGate({ action, display });
    return true;
  }, [location.pathname, location.search]);

  function dismiss() {
    // An explicit "not now" withdraws the intent: a gate declined must not
    // replay its action after some later, unrelated sign-in.
    clearIntent();
    setGate(null);
  }

  function toAuth(mode) {
    // ⚠ The intent STAYS — this is the conversion path. /auth reads `mode`
    // to open on the right tab and consumes the intent when the session lands.
    setGate(null);
    navigate('/auth', { state: { mode } });
  }

  const copy = gate ? COPY[gate.action](gate.display) : null;

  return (
    <Ctx.Provider value={request}>
      {children}
      {/* ⚠ The sheet itself — dock, handle, rise — is AccountInviteSheet,
          which My Scene and Messages render too. This file owns WHEN the gate
          appears and WHAT it says; ⛔ it must not grow its own styling again,
          or the four surfaces drift back apart.
          Dismissible, because the content is still there behind it — the
          difference from a destination gate is spelled out in that file. */}
      {gate && (
        <AccountInviteSheet
          title={copy.title}
          body={copy.body}
          onCreateAccount={() => toAuth('signup')}
          onSignIn={() => toAuth('signin')}
          onDismiss={dismiss}
        />
      )}
    </Ctx.Provider>
  );
}
