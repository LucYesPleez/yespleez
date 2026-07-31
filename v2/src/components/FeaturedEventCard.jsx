import s from './FeaturedEventCard.module.css';
import DateBox from './DateBox';

/**
 * Props:
 *   event, onClick
 *   label        the badge text — in My Scene's Spotlight this is the REASON
 *                the card earned its place, so it varies per card
 *   badgeColor   overrides the badge's default violet, letting the reason's
 *                colour group the KIND of attention (your own involvement vs
 *                your favourites vs the catalogue's news)
 *   rail         size for a horizontal scroller instead of filling the column:
 *                the hero look is kept, the card just stops being the only one
 *   solo         a rail of ONE — take the full width rather than leaving a
 *                peek gap for a card that does not exist
 *   cornerAction JSX pinned BOTTOM-right (the save heart). Clicks inside must
 *                not open the event, so the wrapper stops propagation.
 *
 * ⚠ NO OPEN ARROW, and the date is a DateBox — owner, 2026-08-01: "the purple
 * arrows you click on to open the card are kinda [not] obvious. people will
 * naturally click on the card to open it", and "the way the date is at the
 * moment on the spotlight cards i cant even read the date."
 * The arrow duplicated the card's own click target, so it was decoration that
 * looked like the only way in. The date was 11px at 60% opacity laid over a
 * photo — the least legible text on the card, describing the one fact that
 * decides whether you care. It now uses the same black DateBox chip every
 * other card in the app uses, in the corner the arrow vacated's opposite.
 */
export default function FeaturedEventCard({ event, onClick, label = 'FEATURED', badgeColor, rail = false, solo = false, cornerAction = null }) {
  const cfg      = event.config || {};
  const poster   = cfg.poster || cfg.posterUrl || '';
  const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 4);
  const bg = cfg._bg || 'linear-gradient(135deg,#1a0533 0%,#2d1b69 45%,#0d3b2e 100%)';

  return (
    <div
      className={`${s.card}${rail ? ' ' + s.cardRail : ''}${rail && solo ? ' ' + s.cardRailSolo : ''}`}
      onClick={onClick}
      /* The arrow was the only FOCUSABLE way into this card, so removing it
         would have quietly cost keyboard and screen-reader users the event
         entirely. The card itself takes that role instead — same target the
         owner points out everyone already taps. */
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      aria-label={event.name}
      style={poster ? { backgroundImage: `url(${poster})` } : { background: bg }}
    >
      <div className={s.overlay} />
      <div className={s.badge} style={badgeColor ? { background: badgeColor } : undefined}>{label}</div>
      {/* Top-right, the corner the heart used to hold. */}
      {cfg.date && (
        <div className={s.dateBox}><DateBox date={cfg.date} size="md" /></div>
      )}
      {cornerAction && (
        <div className={s.corner} onClick={e => e.stopPropagation()}>{cornerAction}</div>
      )}
      <div className={s.content}>
        <div className={s.name}>{event.name}</div>
        {cfg.venue && (
          <div className={s.venue}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4, flexShrink: 0 }}>
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {cfg.venue}
          </div>
        )}
        {genreList.length > 0 && (
          <div className={s.tags}>
            {genreList.map(g => <span key={g} className={s.tag}>{g}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
