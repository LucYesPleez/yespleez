/**
 * /start — THE ONE QUESTION, ASKED ONCE, ANSWERABLE BY WALKING PAST IT.
 *
 * O3 (2026-08-12). The account is universal; the ROLE decides the experience
 * (the punter/contextual-roles model). This is the single moment the app asks
 * which experience someone came for — and it is a ROUTING decision, not a
 * profile field.
 *
 * ⛔ THIS IS NOT AN ONBOARDING WIZARD, AND MUST NEVER BECOME ONE (owner:
 * "don't onboard people into YesPleez, onboard them into the thing they came
 * to YesPleez to do"). One screen, one question, and SKIP is a first-class
 * answer sitting in plain sight. ⛔ No carousel, no progress dots, no second
 * step, nothing that must be completed before the app is usable.
 *
 * ⛔ AND IT NEVER INTERRUPTS AN INTENT. Someone who signed up mid-journey —
 * tapped a heart, hit the gate — is returned to that event with the save
 * completed and never sees this. postAuthDestination enforces the order.
 *
 * ── ⭐ WHY NOTHING IS STORED ─────────────────────────────────────────
 *
 * The answer is not written anywhere. "I'm an artist" is a stated intention;
 * the ARTIST PROFILE it routes to is the evidence, and this app's standing
 * rule is that a computed state is the only one that cannot lie (nobody marks
 * a person Ready). Storing the claim as well would create a second, weaker
 * answer to "is this person an artist?" that drifts from the profiles table
 * the moment someone changes their mind.
 *
 * So: pick → go there. Skip → What's On. The record of what happened next is
 * whatever they actually built.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../App';
import { activateRole } from './RoleSelectorScreen';
import s from './StartScreen.module.css';

/**
 * ⚠ `role` ACTIVATES AND ROUTES; the two role-less answers only route.
 * Reuses RoleSelectorScreen's own activateRole so `yp_active_roles` has ONE
 * writer — a second copy here would drift from the picker the first time its
 * storage shape changed.
 */
const ANSWERS = [
  {
    key: 'browse',
    label: 'FIND THINGS HAPPENING',
    desc: "See what's on around you.",
    to: '/',
  },
  {
    key: 'artist',
    label: "I'M AN ARTIST / PERFORMER",
    desc: 'Set up an artist profile so you can apply for gigs.',
    role: 'artist',
    to: '/industry/artist/setup',
  },
  {
    key: 'host',
    label: 'I HOST EVENTS',
    desc: 'Set up a host profile so you can run events and build lineups.',
    role: 'host',
    to: '/industry/host/setup',
  },
  {
    key: 'venue',
    label: "I'M A VENUE",
    desc: 'Set up a venue profile so acts can find your room.',
    role: 'venue',
    to: '/industry/venue/setup',
  },
  {
    key: 'other',
    label: 'SOMETHING ELSE',
    desc: 'Have a look around — you can set a profile up any time.',
    to: '/',
  },
];

export default function StartScreen() {
  const navigate = useNavigate();
  const { session } = useSession() ?? {};

  // Signed out, this screen has nothing to offer and nothing to act on. It is
  // only ever reached as the post-signup destination; typing the URL as a
  // guest lands on What's On, which is where browsing belongs.
  useEffect(() => {
    if (!session) navigate('/', { replace: true });
  }, [session, navigate]);
  if (!session) return null;

  function choose(answer) {
    if (answer.role) activateRole(answer.role);
    // ⚠ `replace`, so BACK from a setup form returns to where the person was
    // before signing up — never to this question. It has been answered; a
    // history entry that can re-present it is a question asked twice.
    navigate(answer.to, { replace: true });
  }

  return (
    <div className={s.screen}>
      <div className={s.inner}>
        <div className={s.logoTag}>YESPLEEZ</div>
        <h1 className={s.title}>WHAT BRINGS YOU<br />TO YESPLEEZ?</h1>
        <p className={s.sub}>
          This just points you at the right part of the app. You can change it
          later, or skip it entirely.
        </p>

        <div className={s.options}>
          {ANSWERS.map(a => (
            <button key={a.key} type="button" className={s.option} onClick={() => choose(a)}>
              <span className={s.optionLabel}>{a.label}</span>
              <span className={s.optionDesc}>{a.desc}</span>
            </button>
          ))}
        </div>

        {/* ⭐ SKIP IS AN ANSWER, NOT AN ESCAPE HATCH — it sits with the others
            rather than hiding as small print, because the universal account
            model means declining to say is a perfectly good outcome. */}
        <button type="button" className={s.skip} onClick={() => navigate('/', { replace: true })}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
