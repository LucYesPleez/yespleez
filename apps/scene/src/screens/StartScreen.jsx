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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import HandIcon from '../components/HandIcon';
import { activateRole } from './RoleSelectorScreen';
import { START_ANSWERS, startAnswerDestination, startAnswerDesc } from '../lib/startAnswers';
import { START_ICONS, ArrowGlyph, StartIconDefs } from './startIcons';
import s from './StartScreen.module.css';

export default function StartScreen() {
  const navigate = useNavigate();
  const { session } = useSession() ?? {};
  /**
   * ⭐ O4 · WHICH ROLES THIS ACCOUNT ALREADY HOLDS. Reachable from Help now,
   * so the person answering may have answered before — and an answer they
   * have already acted on must open what they built, ⛔ never re-offer to set
   * it up. Same query and same purpose as RoleSelectorScreen's `setupTypes`;
   * the two surfaces ask one question and must not answer it differently.
   *
   * ⚠ Absent until it loads, which is the SAFE direction: the descriptions
   * read as first-time until proven otherwise, and a role you already have
   * still routes correctly the moment the row arrives.
   */
  const [haveTypes, setHaveTypes] = useState(() => new Set());

  /**
   * ⭐ "FIND THINGS HAPPENING" IS NOT A DEAD END, IT IS AN ANSWER (owner,
   * 2026-08-12). Everyone else's answer sends them somewhere to build
   * something; this one used to drop them back on What's On with nothing
   * said, which reads as the question having been ignored.
   *
   * So it replies. It tells them they are already in, names the two places to
   * look, and names the ONE gesture that makes My Scene fill up. That is the
   * product's central loop stated once, at the only moment someone has just
   * asked for it.
   *
   * ⚠ DECLARED WITH THE OTHER HOOKS, ABOVE THE SIGNED-OUT RETURN. It sat
   * below it for one revision, which is a rules-of-hooks violation: the hook
   * order changes the moment `session` flips, and React pairs state to the
   * WRONG hook. Lint caught it; the test suite could not.
   */
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    let cancelled = false;
    supabase.from('profiles').select('type').eq('user_id', uid)
      .then(({ data }) => {
        if (!cancelled && data) setHaveTypes(new Set(data.map(p => p.type)));
      });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Signed out, this screen has nothing to offer and nothing to act on. It is
  // only ever reached as the post-signup destination or from Help; typing the
  // URL as a guest lands on What's On, which is where browsing belongs.
  useEffect(() => {
    if (!session) navigate('/', { replace: true });
  }, [session, navigate]);
  if (!session) return null;

  function choose(answer) {
    if (answer.key === 'browse') { setBrowsing(true); return; }
    /**
     * ⚠ ACTIVATED EVEN WHEN THE PROFILE ALREADY EXISTS — activateRole appends
     * and never removes, so this is "make sure this role is switched on",
     * ⛔ never a swap. Someone who set an artist profile up months ago and
     * comes back through Help gets it re-activated, which is exactly the
     * "add/activate additional roles without replacing existing roles" the
     * brief asks for.
     */
    if (answer.role) activateRole(answer.role);
    // ⚠ `replace`, so BACK from a setup form returns to where the person was
    // before — never to this question. It has been answered; a history entry
    // that can re-present it is a question asked twice.
    navigate(startAnswerDestination(answer, haveTypes), { replace: true });
  }

  return (
    <div className={s.screen}>
      {/* The icon gradient's <defs>, declared once for every glyph below. */}
      <StartIconDefs />
      <div className={s.card}>
        {/* ⭐ BRAND TEXTURE, NOT A UI ELEMENT. The hand at ~7%, oversized and
            bled off the card, so it reads as the surface the content sits on.
            ⚠ aria-hidden and pointer-events:none — it must never be reachable
            or announced; HandIcon masks the real artwork's alpha so it cannot
            drift into a lookalike. */}
        <span className={s.watermark} aria-hidden="true">
          <HandIcon size={340} />
        </span>

        {browsing ? (
          <>
            {/* ⛔ NO EM DASHES. Owner rule, 2026-08-12 — full stops instead. */}
            <h1 className={s.title}>Great news! You&rsquo;re already in.</h1>
            <p className={s.sub}>
              Search the WHAT&rsquo;S ON guide or DISCOVER to find stuff nearby.
              When you find something you want to go to, save it by tapping the
              heart, or follow the artists and venues you like.
            </p>
            <p className={s.sub}>
              Everything you save is waiting for you in MY SCENE. You already
              have a profile, so you can start collecting your favourite venues,
              events, artists and promoters right now.
            </p>
            <button
              type="button"
              className={s.primary}
              onClick={() => navigate('/', { replace: true })}
            >
              START EXPLORING
            </button>
          </>
        ) : (
        <>
        {/* ⭐ THE HEADLINE IS THE PAGE. Two lines, one sentence: the question
            in white at reading size, then the name at display scale in the
            brand gradient. ⛔ No new font — the same Bebas the app titles
            with, just given the room to be the dominant element. */}
        {/* ⚠ BACK TO "WHAT BRINGS YOU TO YESPLEEZ?" (owner, 2026-08-12, after
            trying "WHAT ARE YOU HERE FOR?"). Two tiers: the white lead line
            at reading size, then the name at display scale in the brand
            gradient. */}
        <h1 className={s.headline}>
          <span className={s.headlineLead}>WHAT BRINGS YOU TO</span>
          <span className={s.headlineBrand}>YESPLEEZ</span>
        </h1>
        <p className={s.sub}>
          This just points you at the right part of the app. You can change it
          later, or skip it entirely.
        </p>

        <div className={s.options}>
          {START_ANSWERS.map(a => {
            const have = !!a.role && haveTypes.has(a.role);
            const Icon = START_ICONS[a.key];
            /* The thin accent edge, alternating pink/cyan down the list.
               ⛔ An EDGE, never a fill: the cards stay dark. */
            const cls = [
              s.option,
              a.accent === 'neon' ? s.edgeNeon : a.accent === 'neon2' ? s.edgeNeon2 : '',
            ].filter(Boolean).join(' ');
            return (
              <button key={a.key} type="button" className={cls} onClick={() => choose(a)}>
                <span className={s.optionIcon}>{Icon && <Icon />}</span>
                <span className={s.optionText}>
                  <span className={s.optionLabel}>
                    {a.label}
                    {/* ⚠ A TICK, NOT A DISABLED STATE. A role you already hold
                        is still a valid answer; it just opens what you built
                        instead of offering to build it again. Matches the tick
                        RoleSelectorScreen and IndustryPanel already show. */}
                    {have && <span className={s.optionHave}>✓ SET UP</span>}
                  </span>
                  <span className={s.optionDesc}>{startAnswerDesc(a, haveTypes)}</span>
                </span>
                <span className={s.optionArrow}><ArrowGlyph /></span>
              </button>
            );
          })}
        </div>

        {/* ⭐ SKIP IS AN ANSWER, NOT AN ESCAPE HATCH — it sits with the others
            rather than hiding as small print, because the universal account
            model means declining to say is a perfectly good outcome. */}
        <button type="button" className={s.skip} onClick={() => navigate('/', { replace: true })}>
          Skip for now
        </button>
        </>
        )}
      </div>
    </div>
  );
}
