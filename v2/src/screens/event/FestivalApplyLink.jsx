import { festivalApplyUrl } from '../../lib/festivalPortal';
import s from '../EventScreen.module.css';

/**
 * APPLY, FOR AN EVENT A FESTIVAL RUNS — the hand-off to the Festival app.
 *
 * ⛔ THIS DELIBERATELY REPLACES ApplyButton RATHER THAN SITTING BESIDE IT. Two
 * apply affordances on one event is the exact defect this exists to remove:
 * Scene's writes `applications`, the Portal reads `festival_applications`, and
 * an applicant who picked the wrong one would vanish with no error anywhere —
 * not in the console, not in the organiser's dashboard, nowhere. Silent loss of
 * someone's application is about the worst failure this product has.
 *
 * ⭐ It reuses `s.applyBtn`, the same class ApplyButton uses. The applicant is
 * not being told about repository boundaries — they press APPLY and arrive
 * where applying happens. Scene discovers; the Festival app takes applications.
 *
 * No dialogue, no note field, no requirements check. All of that belongs to
 * whichever categories the festival has opened, which Scene cannot know and
 * must not guess at.
 */
export default function FestivalApplyLink({ eventId, festivalName }) {
  const href = festivalApplyUrl(eventId);
  if (!href) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <a
        className={s.applyBtn}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
      >
        APPLY
      </a>
      {/* Says where the button goes BEFORE it is pressed. A new tab that lands
          on a differently-branded page is disorienting when unannounced, and
          this is the one moment the two apps are visibly two. */}
      <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
        Applications for {festivalName || 'this festival'} are handled in the
        Festival app.
      </p>
    </div>
  );
}
