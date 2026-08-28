import { today } from '../lib/dates';

// Communal black/monochrome date pill — day name + day number + month,
// stacked. Shared by EventCard and EnquiryCard so every "date on a card"
// looks the same across the app.
//
// ⭐⭐ A PAST EVENT SHOWS ITS YEAR IN PLACE OF THE WEEKDAY (owner, 2026-08-28).
// ONE pill, the same size as every other.
//
// ⚠⚠ THIS SUPERSEDES THE 2026-08-26 RULING, which gave the year its own pill
// beneath. That answered the ambiguity — "SAT 2 DEC" is genuinely unclear once
// a profile has a few years of history — but it did it by adding a second
// object under every past card, and the grid then read as cards of two
// different heights.
//
// ⭐ The weekday is what gives way, and it is the right thing to lose: which
// Saturday something was on stopped mattering the moment it was over, while
// WHICH YEAR is the whole question. An upcoming card keeps its weekday, where
// "are you free that Friday" is exactly what a reader is asking.
//
// ⛔ UPCOMING EVENTS ARE UNTOUCHED. A date in the future is unambiguous by
// context — nobody reads "SAT 2 DEC" on a what's-on card as two years away.
/**
 * @param endDate ⭐⭐ OPTIONAL, AND IT DECIDES "PAST" (owner, 2026-08-28: a
 *   multi-day event should read as ON while it is running).
 *
 *   ⚠⚠ MEASURED ON THE 29th: Neverland runs 28–30 August, and on the Saturday
 *   its card sat in TONIGHT wearing the PAST pill — "2026 · 28 · AUG" — beside
 *   an upcoming gig reading "SAT 29 AUG". The event was on that night.
 *
 *   ⭐ `eventBuckets` has said this since it was written: "endDate FIRST. A
 *   festival running Fri–Sun is not over on Saturday." This is the same rule,
 *   finally asked by the pill as well.
 *
 *   ⛔ The FACE still shows the START date. The pill answers "when does this
 *   begin"; the range belongs to the card's own date line, and putting three
 *   days inside a 35px box is not a thing this component can do.
 */
export default function DateBox({ date, endDate = null, size = 'md' }) {
  if (!date) return null;
  const d = new Date(date + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
  const dayNum  = d.getDate();
  const mon     = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();

  // ⛔ String comparison against the LOCAL today, never `toISOString()` — that
  // is the UTC date, which reads as yesterday every Australian morning and
  // would put a year pill on an event happening today.
  /* ⚠ The LAST day decides, not the first — see the `endDate` note above. An
     event with no end date is a one-day event and behaves exactly as before. */
  const isPast = (endDate || date) < today();
  /**
   * ⭐ THE FULL YEAR, ⛔ not "’26" (owner, 2026-08-28). It reads as a year at a
   * glance where an apostrophe-two-digit form reads as a fragment.
   *
   * ⚠ FOUR DIGITS IN A SLOT SIZED FOR THREE LETTERS, and the pill must not grow
   * — it is 35px wide at its narrowest, on a poster. The tracking that spaces
   * out "FRI" is what would push it over, so the year drops it. ⛔ Do not give
   * the year the weekday's `letterSpacing` back.
   */
  const yearText = String(d.getFullYear());

  /* ⚠ `portrait` reproduces ProfileScreen's own pill EXACTLY — sm's radius and
     width with md's type. It existed there as an inline near-copy of this
     component, which is why the year did not reach the past-gigs cards the
     first time. Kept to the pixel deliberately: the point was to remove a
     duplicate, ⛔ not to restyle a card nobody asked about. */
  const MD = { radius: 10, padding: '6px 10px', minWidth: 44, small: 11, big: 22, bg: 'rgba(0,0,0,.65)' };
  const dims = {
    sm:       { radius: 8, padding: '4px 8px',   minWidth: 36, small: 9,  big: 16, bg: 'rgba(0,0,0,.65)' },
    // ⚠ .82, not .65 — the darker fill is what the portrait card has always
    // used, and it earns it: these pills sit on a full-bleed poster rather
    // than on a card's own surface.
    portrait: { radius: 8, padding: '4.5px 8px', minWidth: 35, small: 11, big: 22, bg: 'rgba(0,0,0,.82)' },
    md:       MD,
  }[size] ?? MD;

  const surface = {
    background: dims.bg,
    backdropFilter: 'blur(4px)',
    borderRadius: dims.radius,
    textAlign: 'center',
    minWidth: dims.minWidth,
  };

  /**
   * ⭐ ONE PILL, ALWAYS. ⛔ No wrapper and no second element — every caller
   * positions this exact box, and a past card is now the same shape and the
   * same height as an upcoming one.
   *
   * ⚠ Only the TOP line differs: the year takes the weekday's place.
   */
  return (
    <div style={{ ...surface, padding: dims.padding }}>
      <div style={{
        fontFamily: "'Bebas Neue'",
        fontSize: dims.small,
        color: 'rgba(255,255,255,.7)',
        /* ⛔ No tracking on the year — see `yearText`. Four digits only fit
           because of this. */
        letterSpacing: isPast ? 0 : .5,
      }}>
        {isPast ? yearText : dayName}
      </div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.big, color: 'white', lineHeight: 1 }}>{dayNum}</div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{mon}</div>
    </div>
  );
}
