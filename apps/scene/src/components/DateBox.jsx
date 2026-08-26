import { today } from '../lib/dates';

// Communal black/monochrome date pill — day name + day number + month,
// stacked. Shared by EventCard and EnquiryCard so every "date on a card"
// looks the same across the app.
//
// ⭐ A PAST EVENT ALSO GETS A YEAR, IN ITS OWN PILL BENEATH (owner,
// 2026-08-26). "SAT 2 DEC" on a past-gigs grid is genuinely ambiguous once a
// profile has a few years of history — last December, or the one before? The
// year answers it. ⛔ A SEPARATE pill, not a fourth line inside this one: the
// date box is one fact (the day) and the year is another, and stacking it
// inside would restate the box's shape as a taller rectangle everywhere.
//
// ⛔ UPCOMING EVENTS DO NOT GET ONE. A date in the future is unambiguous by
// context — nobody reads "SAT 2 DEC" on a what's-on card as two years away —
// and every card in the app would otherwise grow a pill it does not need.
export default function DateBox({ date, size = 'md' }) {
  if (!date) return null;
  const d = new Date(date + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
  const dayNum  = d.getDate();
  const mon     = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();

  // ⛔ String comparison against the LOCAL today, never `toISOString()` — that
  // is the UTC date, which reads as yesterday every Australian morning and
  // would put a year pill on an event happening today.
  const isPast = date < today();
  // "'25". Two digits because the pill is 36px wide at its smallest, and the
  // century is not in question for a gig listing.
  const shortYear = `’${String(d.getFullYear()).slice(-2)}`;

  /* ⚠ `portrait` reproduces ProfileScreen's own pill EXACTLY — sm's radius and
     width with md's type. It existed there as an inline near-copy of this
     component, which is why the year pill did not appear on the past-gigs
     cards the first time. Kept to the pixel deliberately: the point was to
     remove a duplicate, ⛔ not to restyle a card nobody asked about. */
  const MD = { radius: 10, padding: '6px 10px', minWidth: 44, small: 11, big: 22, yearPad: '3px 10px', bg: 'rgba(0,0,0,.65)' };
  const dims = {
    sm:       { radius: 8, padding: '4px 8px',   minWidth: 36, small: 9,  big: 16, yearPad: '2px 8px', bg: 'rgba(0,0,0,.65)' },
    // ⚠ .82, not .65 — the darker fill is what the portrait card has always
    // used, and it earns it: these pills sit on a full-bleed poster rather
    // than on a card's own surface.
    portrait: { radius: 8, padding: '4.5px 8px', minWidth: 35, small: 11, big: 22, yearPad: '2px 8px', bg: 'rgba(0,0,0,.82)' },
    md:       MD,
  }[size] ?? MD;

  // The two pills share every surface value, so they read as one object split
  // in two rather than as a date box with something else stuck under it.
  const surface = {
    background: dims.bg,
    backdropFilter: 'blur(4px)',
    borderRadius: dims.radius,
    textAlign: 'center',
    minWidth: dims.minWidth,
  };

  const dateBox = (
    <div style={{ ...surface, padding: dims.padding }}>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dayName}</div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.big, color: 'white', lineHeight: 1 }}>{dayNum}</div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{mon}</div>
    </div>
  );

  // ⚠ Returned BARE when there is no year to show, so every existing caller
  // gets exactly the element it has always positioned — no wrapper, no
  // change to the box's own metrics.
  if (!isPast) return dateBox;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
      {dateBox}
      <div style={{ ...surface, padding: dims.yearPad, fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5, lineHeight: 1.2 }}>
        {shortYear}
      </div>
    </div>
  );
}
