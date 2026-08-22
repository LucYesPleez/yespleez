// The status pill's condition.
//
// Spec: docs/event-page-layout-spec.md § 2
//
// ⚠ This deliberately does NOT read `events.status`.
//
// In this codebase `status: 'live'` means PUBLISHED, not happening now — it is
// the other half of the DRAFT/LIVE toggle in the host's manage panel. The
// existing event screen renders it as "LIVE NOW", which is a mislabel: an event
// published three months early reads as though it is on right now.
//
// A punter cannot see drafts at all, so publication state carries no
// information for them. What they need is TEMPORAL state, which comes from the
// dates. That is what this returns.
//
// Date granularity only. Times exist on well under half of events, so deriving
// an hour-accurate "on now" would be a guess dressed up as a fact for most of
// them — and R1 says unknown is not the same as absent.

const DAY = 'T00:00:00';

/**
 * @returns 'past' | 'on-now' | null   (null = upcoming; the date says it,
 *                                      so no pill — R3, no placeholders)
 */
export function deriveEventStatus({ date, endDate, startTime } = {}, now = new Date()) {
  if (!date) return null;

  const start = parseDay(date);
  if (!start) return null;

  const end = parseDay(endDate) || start;
  const today = startOfDay(now);

  if (end < today)   return 'past';
  if (start > today) return null;

  /**
   * ⭐⭐ THE HOUR BEFORE THE DOORS (owner, 2026-08-22). Inside it the pill is
   * PINK and reads STARTING SOON; from the start time it turns green and reads
   * ON NOW, exactly as before.
   *
   * ⚠⚠ ONLY WHERE A START TIME IS ACTUALLY KNOWN. The whole reason this module
   * was date-granular is stated at the top: times exist on well under half of
   * events, and an hour-accurate claim without one is a guess dressed as a
   * fact. So a timeless event keeps the old behaviour — ON NOW for its whole
   * day — and ⛔ never shows STARTING SOON, because nobody knows when.
   *
   * ⚠ The window is measured on the FIRST day only. On a three-day festival
   * "starting soon" means the festival opens within the hour, ⛔ not that
   * something starts at 7pm on the Sunday.
   */
  const minutes = parseClock(startTime);
  if (minutes != null && startOfDay(now).getTime() === start.getTime()) {
    const startsAt = new Date(start);
    startsAt.setHours(0, minutes, 0, 0);
    const minutesUntil = (startsAt - now) / 60000;
    if (minutesUntil > SOON_WINDOW_MINS) return null;   // still just upcoming — no pill
    if (minutesUntil > 0)                return 'starting-soon';
  }

  return 'on-now';
}

/* One hour, the owner's number. ⛔ Not a "sensible" 30 or 90 later on: this is
   the promise the pill makes to a reader deciding whether to leave the house. */
const SOON_WINDOW_MINS = 60;

/**
 * "7:30pm" / "7:30 PM" / "19:30" → minutes past local midnight, or null.
 *
 * ⛔ NULL RATHER THAN A GUESS on anything it does not fully understand — a
 * misread meridiem would put STARTING SOON on a page twelve hours early, which
 * is worse than the pill this module already declines to show.
 */
export function parseClock(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let h = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (mins > 59) return null;

  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + mins;
}

export const STATUS_LABEL = {
  'past':          'PAST EVENT',
  'on-now':        'ON NOW',
  'starting-soon': 'STARTING SOON',
};

function parseDay(v) {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10) + DAY);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
