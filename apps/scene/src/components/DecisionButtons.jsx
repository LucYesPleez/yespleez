/**
 * THE DECISION CONTROLS — shortlist · accept · decline.
 *
 * ⭐ ONE DEFINITION, TWO SURFACES. These render on the enquiry card's expansion
 * AND in the dossier sheet, which are the triage view and the decide view of
 * the same three choices. They were built twice, drifted, and ended up with
 * different fills, different borders and different glyphs for what is
 * literally the same action — a host saw one treatment while scanning and
 * another while deciding.
 *
 * ⛔ The look lives in `index.css` (`.yp-decision`), not here. Hover and press
 * want real CSS states rather than a JS colour swap, and the note there
 * explains why Accept must never out-weigh Shortlist.
 *
 * ── ⚠ ICONOGRAPHY ────────────────────────────────────────────────────
 * Outline, 1.9 stroke, `currentColor`, no fills. They replace the text glyphs
 * `★ ✓ ✗` — three different typographic weights from three Unicode blocks,
 * sized by whatever font resolved them and never aligned to each other.
 * `currentColor` is the load-bearing part: the mark inherits the button's ink,
 * so label and icon read as one control rather than a label with a symbol
 * stuck after it.
 */
import { useState } from 'react';

const ICON = {
  width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
};

export const StarIcon  = () => <svg {...ICON}><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>;
export const CheckIcon = () => <svg {...ICON}><polyline points="20 6 9 17 4 12"/></svg>;
export const XIcon     = () => <svg {...ICON}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
export const ArrowIcon = () => <svg {...ICON}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>;

/** One of the three decisions. `tone` is 'shortlist' | 'accept' | 'decline'. */
export function DecisionBtn({ tone, icon: Icon, label, onClick, disabled }) {
  return (
    <button className={`yp-decision yp-decision--${tone}`} onClick={onClick} disabled={disabled}>
      <Icon />{label}
    </button>
  );
}

/**
 * The full-width "open the whole record" control.
 *
 * ⚠ SAME FAMILY, DIFFERENT JOB. It shares the glass and the edge technique so
 * the panel reads as one surface, but it is NAVIGATION, not a decision —
 * pressing it commits to nothing. It therefore carries the card's own accent
 * rather than any of the three decision hues, so it can never be mistaken for
 * a fourth option in the row beneath it.
 *
 * The accent arrives as a CSS custom property because it varies per profile
 * type, and a class cannot know that.
 */
export function DetailBtn({ accent, label = 'VIEW FULL DETAILS', onClick }) {
  return (
    <button className="yp-detail" style={{ '--yp-detail-accent': accent }} onClick={onClick}>
      {label}<ArrowIcon />
    </button>
  );
}

const CalendarGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <line x1="3" y1="9.5" x2="21" y2="9.5" />
    <line x1="8" y1="2.5" x2="8" y2="6.5" />
    <line x1="16" y1="2.5" x2="16" y2="6.5" />
  </svg>
);

/**
 * The small calendar-icon button beside a section heading (ENQUIRIES,
 * AVAILABLE DATES). Opens the shared availability calendar.
 *
 * ⚠ SAME TREATMENT AS `HoverProfileBtn`'s MORE INFO, DELIBERATELY. Both are
 * quiet controls sitting beside content rather than inside the primary action
 * rows — a neutral outline read as an afterthought next to it, and a second
 * pink was cheaper than inventing a third neutral language for one icon.
 * Same pink, same white icon, same hover brightening — one small-control
 * vocabulary rather than two.
 */
export function CalendarIconBtn({ onClick, label = 'Open the calendar' }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 8, cursor: 'pointer',
        transition: 'all .15s',
        background: hov ? 'rgba(255,51,153,.22)' : 'rgba(255,51,153,.1)',
        border: `1px solid ${hov ? '#FF69B4' : 'rgba(255,51,153,.35)'}`,
        color: '#fff',
      }}
    >
      <CalendarGlyph />
    </button>
  );
}
