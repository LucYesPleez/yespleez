import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { InfoGlyph } from './TourWelcome';
import s from './TourInfoNotice.module.css';

/**
 * WHERE THE TOUR LIVES — shown only when "Skip Tour" is pressed before the
 * tour reaches its own last step.
 *
 * ⚠⚠ SKIP-ONLY, AND THAT IS A REVERSAL WORTH KEEPING THE HISTORY OF. This
 * fired after every tour exit once; the owner cut it, on the reasoning that
 * step 7 ("Anytime You Like") already spotlights the ⓘ and says the same
 * thing, so completing the tour and then seeing this too was one message
 * twice. Then the gap in that logic showed up: someone who skips at step 2
 * never sees step 7, and never hears where the tour went at all. This is
 * back for exactly that one case — see the branch in GlobalHeader.jsx's
 * close().
 *
 * ⚠ NOT A TOUR STEP. It shares the tour's spotlight MECHANISM (an empty div
 * whose box-shadow is the darkness) because that mechanism already solves
 * "soft feathered edges" correctly, but it is a separate component with its
 * own module — tourSteps.js has no idea this exists, and it must stay that
 * way. Mixing the two would make "7/7" lie the moment this fires instead of
 * a real step.
 *
 * ⚠ PORTALLED TO document.body FOR THE USUAL REASON — mounted from inside
 * GlobalHeader, whose `.header` carries a transform that would otherwise
 * hijack `position: fixed` for this overlay.
 */
export default function TourInfoNotice({ open, onClose }) {
  const [rect, setRect] = useState(null);

  /**
   * ⚠ THE SAME MEASUREMENT DANCE AS EVERY OTHER SPOTLIGHT HERE, for the same
   * reason: the header's fonts (Bebas Neue, DM Sans) are routinely still
   * loading on first render, so the ⓘ's real position is wrong until
   * document.fonts.ready resolves. Getting this wrong points the spotlight at
   * empty air, which looks deliberate rather than broken.
   */
  useLayoutEffect(() => {
    if (!open) return undefined;

    const measure = () => {
      const el = document.querySelector('[data-tour="info"]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    measure();
    const el = document.querySelector('[data-tour="info"]');
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Nothing renders until the ⓘ has actually been found — a spotlight on the
  // wrong spot teaches the wrong thing, which is worse than a beat of silence.
  if (!open || !rect) return null;

  const pad = 8;
  const lit = {
    top: rect.top - pad, left: rect.left - pad,
    width: rect.width + pad * 2, height: rect.height + pad * 2,
  };

  return createPortal((
    <div
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label="Where the tour lives"
      onClick={onClose}
    >
      <div className={s.veil} />
      <div
        className={s.hole}
        aria-hidden="true"
        style={{ top: lit.top, left: lit.left, width: lit.width, height: lit.height, borderRadius: 14 }}
      />

      <div className={s.card} onClick={(e) => e.stopPropagation()}>
        <p className={s.body}>
          The walkthroughs live under <InfoGlyph className={s.glyph} /> up top.
          <br />
          Take a closer look at any feature, whenever you like.
        </p>
        <button type="button" className={s.close} onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </div>
  ), document.body);
}
