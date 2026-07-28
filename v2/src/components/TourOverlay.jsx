import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { activeSteps, PLANNED_TOTAL } from '../lib/tourSteps';
import useBreath from '../hooks/useBreath';
/**
 * ⚠ THE TOUR IMPORTS A TIMING CONSTANT FROM THE INSTALL COACH, and that is a
 * known seam, not an accident. `BREATH_MS` is how long one breath lasts, and
 * both systems must agree or the same glow reads as two different kinds of
 * light. The architecture review flagged this module as the place the shared
 * timing should eventually live once the install spotlight is folded into the
 * tour as a step; until that refactor, importing the single source of truth
 * beats redeclaring 3600 in a second file and letting them drift.
 */
import { BREATH_MS } from '../lib/installCoach';
import s from './TourOverlay.module.css';

/**
 * THE TOUR ENGINE.
 *
 * ⚠⚠ NOTHING IN THIS FILE NAMES A SCREEN. It reads a step from tourSteps.js,
 * asks that step where to point, lights the rect it gets back, and renders the
 * words it was given. Adding page 4 means adding an object to that array.
 * If a future step ever seems to need a special case in here, the step
 * vocabulary is what should grow — not this component.
 *
 * ⚠⚠ PORTALLED TO document.body, AND IT IS NOT OPTIONAL. This is mounted from
 * GlobalHeader, and `.header` carries `transform: translateX(-50%)`. A
 * transformed ancestor becomes the containing block for `position: fixed`
 * descendants, so `inset: 0` would resolve against the header's own 680×54
 * box instead of the viewport — a full-screen overlay clipped to a strip
 * along the top. The install sheet documents the same trap; it is easier to
 * fall into here because this component MEASURES elements in the header.
 *
 * ⚠ THE APP UNDERNEATH IS LIVE BUT NOT TAPPABLE. The brief asks for the real
 * interface, visible and recognisable — not for it to be operable mid-tour. A
 * stray tap that navigated away would strand the overlay on a screen its
 * current step knows nothing about.
 */

/** How long the lamp takes to travel between two steps' targets. */
const MOVE_MS = 500;

/**
 * The pulse cadence for a step that declares `pulse: true` — one breath every
 * 8s, matching the install coach's spotlight rhythm so the two never feel
 * like different features. The 800ms opener lets the lamp finish travelling
 * before the first breath, otherwise the glow arrives while the light is
 * still moving and reads as a wobble.
 */
const PULSE_FIRST_MS = 800;
const PULSE_EVERY_MS = 8000;
const EASE = 'cubic-bezier(.22, .9, .3, 1)';

export default function TourOverlay({ open, startAt = 0, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [i, setI] = useState(startAt);
  const [rect, setRect] = useState(null);
  const [liftRect, setLiftRect] = useState(null);
  const [cardRect, setCardRect] = useState(null);
  const cardRef = useRef(null);

  const steps = activeSteps();
  const step = steps[i] || null;

  // ⚠ RESET KEY IS THE STEP ID, so moving between two pulsing steps restarts
  // the cadence rather than leaving the new one mid-cycle.
  const pulsing = useBreath(
    !!(open && step?.pulse && rect),
    PULSE_FIRST_MS, PULSE_EVERY_MS, step?.id,
  );
  // ⚠ COUNTS WHAT WILL RUN, not the array length — a conditional step that is
  // skipped must not leave a gap in "3 / 7". PLANNED_TOTAL is the scaffold
  // while steps 2-7 are still being written; delete it once they exist.
  const total = Math.max(steps.length, PLANNED_TOTAL);

  // Reset to the requested entry point every time the tour opens, so the Help
  // path can jump to a section and the auto-run always starts at the top.
  useEffect(() => { if (open) setI(startAt); }, [open, startAt]);

  /**
   * THE STEP DRIVES THE ROUTE, not the other way round. A step declares where
   * it makes sense; if the user is elsewhere, the engine takes them there
   * before lighting anything. Without this, step 3 would spotlight a Discover
   * rail that is not on screen.
   */
  useEffect(() => {
    if (!open || !step?.route) return;
    if (location.pathname !== step.route) navigate(step.route);
  }, [open, step, location.pathname, navigate]);

  /**
   * A STEP'S SIDE EFFECT — opening a surface the tour cannot navigate to.
   *
   * ⚠ KEYED ON THE STEP ID, NOT ON `step`. `activeSteps()` rebuilds its array
   * on every render; the objects inside are stable, but keying on anything
   * less specific than the id invites a dependency that changes each pass and
   * re-fires the effect — which for Industry means re-clicking the tab on
   * every measurement, toggling the panel it just opened.
   *
   * ⚠ RUNS AFTER THE ROUTE EFFECT ABOVE, deliberately. A step with both would
   * otherwise open a panel and then navigate out from under it.
   */
  useEffect(() => {
    if (!open || typeof step?.onEnter !== 'function') return;
    step.onEnter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step?.id]);

  /**
   * The page must not scroll under a lamp that stays put — that is exactly the
   * "interface moves" the brief rules out.
   */
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /** Escape skips, the same as the Skip button. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.('skipped');
      if (e.key === 'ArrowRight') setI(v => Math.min(v + 1, steps.length - 1));
      if (e.key === 'ArrowLeft')  setI(v => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, steps.length]);

  /**
   * WHERE TO POINT — measured, never assumed.
   *
   * ⚠ THE CARD'S RECT IS AN INPUT. Step 1 lights "the entire first viewport"
   * while the brief also says the card must not cover the highlighted
   * content; those only reconcile if the lit region ends where the card
   * begins, so the target function is handed the live card box.
   *
   * ⚠ MEASURED IN A LAYOUT EFFECT, not a passive one. The card and the lamp
   * must be positioned in the same frame the card first paints, or the first
   * step lights the fallback region and then visibly corrects itself.
   */
  useLayoutEffect(() => {
    if (!open || !step) return undefined;

    const measure = () => {
      const cr = cardRef.current?.getBoundingClientRect() || null;
      setCardRect(cr);
      const ctx = {
        cardRect: cr,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
      const r = typeof step.target === 'function' ? step.target(ctx) : null;
      if (r && r.width > 0 && r.height > 0) setRect(r);

      // ⚠ CLEARED WHEN A STEP DOES NOT DECLARE ONE. Without the else the
      // previous step's lift would persist into a step that never asked for
      // it — a patch of light sitting over nothing.
      const lr = typeof step.lift === 'function' ? step.lift(ctx) : null;
      setLiftRect(lr && lr.width > 0 && lr.height > 0 ? lr : null);
    };

    measure();
    // Fonts change the header's layout, which moves everything measured off
    // it; the app's own transitions settle over a few hundred ms.
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [open, step, i, location.pathname]);

  if (!open || !step) return null;

  const isFirst = i === 0;

  /**
   * ⚠ TWO DIFFERENT "LASTS", AND CONFLATING THEM MISLABELS THE BUTTON.
   *
   *   atEndOfWritten  the last step that EXISTS. Controls what Next does —
   *                   there is nothing after it to advance to.
   *   atEndOfTour     the last step the user was PROMISED, i.e. 7 of 7.
   *                   Controls what the button says.
   *
   * While pages 2-7 are still being written these disagree: step 1 is the
   * last written step but the card says "1 / 7", and a button reading "Start
   * Exploring" under a counter reading 1 / 7 is simply wrong on screen. The
   * label follows the count the user can see. Once all seven steps exist the
   * two collapse into one and this comment can go.
   */
  const atEndOfWritten = i >= steps.length - 1;
  const atEndOfTour    = i + 1 >= total;

  function next() {
    if (atEndOfWritten) { onClose?.('completed'); return; }
    setI(i + 1);
  }

  // Geometry for the four blur strips: they fence the lit rect exactly, with
  // top and bottom running full width so the corners are covered.
  const lit = rect || { top: 0, left: 0, width: 0, height: 0 };
  const litBottom = lit.top + lit.height;
  const litRight  = lit.left + lit.width;

  return createPortal((
    <div
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label={`App tour, step ${i + 1} of ${total}: ${step.title}`}
      style={{ '--move': `${MOVE_MS}ms`, '--ease': EASE, '--breath': `${BREATH_MS}ms` }}
    >
      {/* ⚠⚠ NOT RENDERED UNTIL MEASURED, AND THAT IS LOAD-BEARING.
          The lamp transitions its own width and height so it can GLIDE
          between steps — which means if it first paints at 0×0 and is then
          given a real rect, that transition runs on the way in and the
          spotlight visibly unfolds from the top-left corner of the screen.
          The brief asks for a 400ms FADE, nothing else.

          The card below always renders, because step 1's target is defined
          relative to it and it has to be measurable. One frame passes between
          the card painting and the lamp appearing; the fade covers it. */}
      {rect && (
        <>
          {/* The blur, everywhere the lamp is not. */}
          <div className={s.blur} style={{ top: 0, left: 0, right: 0, height: Math.max(0, lit.top) }} />
          <div className={s.blur} style={{ top: litBottom, left: 0, right: 0, bottom: 0 }} />
          <div className={s.blur} style={{ top: lit.top, height: lit.height, left: 0, width: Math.max(0, lit.left) }} />
          <div className={s.blur} style={{ top: lit.top, height: lit.height, left: litRight, right: 0 }} />

          {/* The lamp. Paints nothing; the darkness is its own shadow
              spreading outwards, which is why one element handles every shape
              a step asks for and travels between them with a plain CSS
              transition. */}
          <div
            className={s.hole}
            aria-hidden="true"
            style={{
              top: lit.top, left: lit.left, width: lit.width, height: lit.height,
              borderRadius: step.radius ?? 24,
            }}
          />

          {/* ⚠ AFTER THE LAMP IN THE DOM, DELIBERATELY. It brightens what the
              lamp's shadow has already darkened, so it has to be painted on
              top of that shadow — moved above it, the dim would land over the
              light and cancel it. */}
          {/* ⚠ KEYED ON THE BREATH so the animation genuinely restarts.
              Re-applying a class to a node the browser has already animated
              is a no-op — without a fresh node this would glow once on the
              first breath and then never again. */}
          {step.pulse && (
            <div
              key={pulsing ? 'pulse-on' : 'pulse-off'}
              className={`${s.pulse} ${pulsing ? s.breathing : ''}`}
              aria-hidden="true"
              style={{
                top: lit.top, left: lit.left, width: lit.width, height: lit.height,
                borderRadius: step.radius ?? 24,
              }}
            />
          )}

          {liftRect && (
            <div
              className={s.lift}
              aria-hidden="true"
              style={{
                top: liftRect.top, left: liftRect.left,
                width: liftRect.width, height: liftRect.height,
                borderRadius: step.liftRadius ?? 26,
              }}
            />
          )}
        </>
      )}

      <div
        className={s.card}
        ref={cardRef}
        style={step.card === 'top'
          ? { top: 'calc(var(--yp-header-height, 54px) + 16px)', bottom: 'auto' }
          : undefined}
      >
        <div className={s.topRow}>
          <button type="button" className={s.skip} onClick={() => onClose?.('skipped')}>
            Skip Tour
          </button>
          <span className={s.counter}>{i + 1} / {total}</span>
        </div>

        {/* ⚠ KEYED ON THE STEP so React replaces the node and the crossfade
            actually runs. Re-rendering the same element with new text applies
            no animation — the browser sees the same node it already
            animated. The card itself stays put; only its words move. */}
        <div key={step.id} className={s.copy}>
          <h2 className={s.title}>{step.title}</h2>
          {/* An entry may be a string (one paragraph) or an array of strings
              (one paragraph, line-broken). The grouped form exists so a run
              of short related lines costs one paragraph's margin instead of
              three — margin is what pushes the card down over the lit area. */}
          {step.body.map((para, k) => (
            <p key={k} className={s.body}>
              {Array.isArray(para)
                ? para.map((line, j) => (
                    <span key={j}>{j > 0 && <br />}{line}</span>
                  ))
                : para}
            </p>
          ))}
        </div>

        {/* ⚠ DOTS COUNT `total`, NOT the written steps, so the row does not
            grow from one dot to seven as pages land. Same reason the counter
            reads 1 / 7 on day one. */}
        <div className={s.dots} aria-hidden="true">
          {Array.from({ length: total }, (_, k) => (
            <span key={k} className={`${s.dot} ${k === i ? s.dotOn : ''}`} />
          ))}
        </div>

        <div className={s.actions}>
          {/* Previous appears from step 2, per the brief — absent on step 1
              rather than disabled. */}
          {!isFirst && (
            <button type="button" className={s.prev} onClick={() => setI(i - 1)}>
              ← Back
            </button>
          )}
          <button type="button" className={s.next} onClick={next} autoFocus>
            {step.cta || (atEndOfTour ? 'Start Exploring' : 'Next →')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
