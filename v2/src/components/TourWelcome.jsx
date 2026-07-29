import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import HandIcon from './HandIcon';
import s from './TourWelcome.module.css';

/**
 * THE FIRST-RUN WELCOME — the invitation, not the tour.
 *
 * Shown once, about 1.2s after the app is usable. The delay is doing real
 * work: arriving the instant the splash clears means the user never sees the
 * app they are being welcomed into, and the modal reads as another loading
 * screen rather than as a door into something.
 *
 * ⚠ REPLAY IS NOW NAMED ON THE CARD ITSELF — a later, explicit reversal of an
 * earlier rule here that said the opposite. That rule was "don't mention
 * replaying the tour on this screen; say it in a toast on the way out
 * instead." Owner overruled it directly: put the toast's own words under
 * "Skip for now". Kept as a note because the reasoning for either approach is
 * not obvious from the code alone — if this moves again, that history is
 * worth knowing before repeating the same round trip.
 *
 * The toast (below) still exists for the OTHER two exits — skipping or
 * completing the tour itself, both far later — where this line is no longer
 * on screen to have been read.
 *
 * ⚠ PORTALLED TO document.body FOR THE USUAL REASON — this is mounted from
 * inside GlobalHeader, and `.header` carries `transform: translateX(-50%)`,
 * which makes it the containing block for any `position: fixed` descendant.
 * `inset: 0` would resolve against a 680×54 strip.
 */
export default function TourWelcome({ onStart, onSkip }) {
  /**
   * ⚠ ESCAPE SKIPS RATHER THAN DOING NOTHING. A modal that traps a keyboard
   * user is worse than one they can dismiss; and skipping is the safe
   * outcome — it costs them a tour they can still reach from the ⓘ.
   *
   * The page must not scroll underneath either: the app behind is meant to be
   * recognisable, not operable.
   */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onSkip?.(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onSkip]);

  return createPortal((
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="Welcome to YesPleez">
      <div className={s.card}>
        <div className={s.markWrap}>
          <span className={s.markGlow} aria-hidden="true" />
          {/* ⚠ 120px, and it is the REAL mark — HandIcon masks the artwork's
              own alpha, so this cannot drift into a lookalike. */}
          <HandIcon size={120} style={{ color: '#fff', position: 'relative' }} />
        </div>

        <p className={s.welcomeTo}>Welcome to</p>
        <p className={s.brand}>YESPLEEZ</p>

        <div className={s.rule} aria-hidden="true">
          {/* The brand's pulse — the one decorative mark on the card. */}
          <svg width="26" height="12" viewBox="0 0 26 12" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6h4.5l2-4.5 3 9 2.5-6 2 3H25" />
          </svg>
        </div>

        <p className={s.tagline}>The Scene. In Your Hands.</p>

        <p className={s.body}>
          YesPleez connects our local music community. Discover events, follow
          your scene, message friends and build opportunities.
        </p>

        <div className={s.ask}>
          <p className={s.askText}>
            Would you like a quick guided tour to see what YesPleez can do?
          </p>
          <p className={s.askNote}>It only takes about 30 seconds.</p>
        </div>

        <button type="button" className={s.start} onClick={onStart} autoFocus>
          Start Tour
        </button>
        <button type="button" className={s.skip} onClick={onSkip}>
          Skip for now
        </button>

        {/* ⚠ SAME COPY AS TourToast BELOW, ON PURPOSE — one sentence, one
            meaning, said in whichever place is showing at the time. Diverging
            wording between the two would read as two different features. */}
        <p className={s.replayNote}>
          Guided Tour available any time from the{' '}
          <InfoGlyph className={s.replayGlyph} />{' '}
          button.
        </p>
      </div>
    </div>
  ), document.body);
}

/**
 * The ⓘ, drawn rather than spelled — shared by the card's note and the toast
 * below so the two can never draw it differently. Sizing and colour are the
 * caller's job via `className`; only the shape lives here.
 */
export function InfoGlyph({ className }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8.01" />
      <polyline points="11 12 12 12 12 16" />
    </svg>
  );
}

