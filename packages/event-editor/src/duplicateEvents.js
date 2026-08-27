/**
 * IS THIS ALREADY AN EVENT?
 * ---------------------------------------------------------------------------
 * ⭐⭐ ONE REAL EVENT REPRESENTS ONE CONTINUOUS EVENT (ratified 2026-08-27).
 * A Friday-to-Sunday festival is ONE event with three days inside it. This
 * module notices when somebody is about to create a SECOND row describing an
 * event that already exists.
 *
 * ⛔⛔ IT WARNS. IT NEVER BLOCKS. Two genuinely different gigs at the same venue
 * on the same night are completely normal, and a venue running a residency has
 * one every week. A gate here would stop real events being created in order to
 * prevent a tidiness problem, which is a straight downgrade. Every finding is a
 * QUESTION put to the organiser, who knows the answer and the app does not.
 *
 * ⚠⚠ WHY NAME SIMILARITY ALONE IS NOT ENOUGH, and why venue alone is not either.
 * The two production cases that prompted this defeat one rule each:
 *
 *   Beyond Jazz Weekender          "Multiple Venues"          14 Aug
 *   …2026 – Friday: The Jazz Doof  "Bellingen Memorial Hall"  14 Aug
 *   …2026 – Saturday: The Jazz Social  "Bellingen Memorial Hall"  15 Aug
 *
 * The umbrella and its own days are at DIFFERENT venues, so a venue rule misses
 * them. And Friday and Saturday do not OVERLAP, they are ADJACENT — which is the
 * signature of the exact behaviour being prevented, one event per day. So:
 *
 *   RULE A · same venue + overlapping dates
 *   RULE B · similar name + dates overlapping OR touching (a gap of one day)
 *
 * Rule B's adjacency window is deliberately tight. The Beyond Jazz LAUNCH PARTY
 * is 19 days earlier at a third venue and is a genuinely separate event; it must
 * not be flagged, and it is not.
 *
 * Everything here is PURE. The caller fetches the candidates — ⛔ no database
 * knowledge travels with this module, exactly as with `rowsToDays`.
 */

/** Tokens too common to carry any signal on their own. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'at', 'of', 'in', 'on', 'with', 'to', 'for',
  'presents', 'pres', 'live', 'night', 'party', 'show', 'event', 'feat', 'ft',
]);

function iso(v) { return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : ''; }

/**
 * Lowercase, punctuation stripped, YEARS REMOVED.
 *
 * ⚠ The year has to go. "Beyond Jazz Weekender" and "Beyond Jazz Weekender
 * 2026" are the same festival, and an annual event is named with its year more
 * often than not — leaving it in makes the one comparison that matters fail.
 */
export function normaliseEventName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[‐-―]/g, ' ')      // dashes of every width
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')     // the year
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name) {
  return normaliseEventName(name).split(' ').filter(t => t && !STOP.has(t));
}

/**
 * Do these two names describe the same event?
 *
 * One name's significant tokens being wholly contained in the other's. That is
 * what "Beyond Jazz Weekender" vs "Beyond Jazz Weekender – Friday: The Jazz
 * Doof" looks like, and it is what splitting an event into days always looks
 * like: the parts keep the whole's name and add to it.
 *
 * ⚠⚠ CONTAINMENT IS NOT ENOUGH ON ITS OWN, and the production rows prove it:
 *
 *   "…Weekender – Friday: The Jazz Doof"    → beyond jazz weekender friday jazz doof
 *   "…Weekender – Saturday: The Jazz Social" → beyond jazz weekender saturday jazz social
 *
 * Neither contains the other, because each day added its OWN title. What they
 * share is a PREFIX. That is what one event split across days always looks
 * like: a common stem, then whatever tells the days apart. So a shared leading
 * run of significant tokens counts too.
 *
 * ⚠ TWO SIGNIFICANT TOKENS MINIMUM, either way. On one token, "Neverland" would
 * match any other event with "Neverland" in it, and a venue's "Jazz" night would
 * match every jazz gig in town.
 *
 * ⚠ A shared prefix is only safe because the CALLER pairs it with a tight date
 * window. "Sunday Sessions" every week shares a prefix with itself; seven days
 * apart, `findRelatedEvents` never asks.
 */
export function namesLookRelated(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const set = new Set(long);
  if (short.every(t => set.has(t))) return true;
  let shared = 0;
  while (shared < short.length && short[shared] === long[shared]) shared++;
  return shared >= 2;
}

/** A venue matches by its PROFILE first, and only then by its typed name. */
function sameVenue(a, b) {
  if (a.venueProfileId && b.venueProfileId) return a.venueProfileId === b.venueProfileId;
  const na = String(a.venue || '').trim().toLowerCase();
  const nb = String(b.venue || '').trim().toLowerCase();
  return !!na && na === nb;
}

function span(e) {
  const start = iso(e?.startDate);
  if (!start) return null;
  const end = iso(e?.endDate);
  return { start, end: end && end > start ? end : start };
}

/** Whole days between two spans. 0 when they overlap, 1 when back to back. */
function gapDays(x, y) {
  if (x.start <= y.end && y.start <= x.end) return 0;
  const [first, second] = x.end < y.start ? [x, y] : [y, x];
  const a = new Date(first.end + 'T12:00:00');
  const b = new Date(second.start + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

export const REASON = {
  SAME_VENUE: 'same_venue_overlapping_dates',
  SAME_NAME: 'similar_name_touching_dates',
};

/**
 * @param candidate  { id?, name, venue, venueProfileId?, startDate, endDate? }
 * @param existing   the same shape, for events already saved
 * @returns Array<{ id, name, startDate, endDate, reason }> — most likely first
 */
export function findRelatedEvents(candidate, existing = []) {
  const mine = span(candidate);
  if (!mine) return [];
  const out = [];
  for (const other of existing || []) {
    // ⛔ Never flag the event being edited against itself.
    if (!other || (candidate.id && other.id === candidate.id)) continue;
    const theirs = span(other);
    if (!theirs) continue;
    const gap = gapDays(mine, theirs);

    if (gap === 0 && sameVenue(candidate, other)) {
      out.push({ ...other, reason: REASON.SAME_VENUE });
      continue;
    }
    if (gap <= 1 && namesLookRelated(candidate.name, other.name)) {
      out.push({ ...other, reason: REASON.SAME_NAME });
    }
  }
  // A shared name is the stronger signal of "this is one event split up"; a
  // shared venue on one night is very often just two different gigs.
  const rank = r => (r === REASON.SAME_NAME ? 0 : 1);
  return out.sort((a, b) => rank(a.reason) - rank(b.reason)
    || String(a.startDate).localeCompare(String(b.startDate)));
}
