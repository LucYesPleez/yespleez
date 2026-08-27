/**
 * YesPleez Scene — WHICH DAYS DOES AN EVENT OCCUPY?
 * ---------------------------------------------------------------------------
 * ⭐⭐ ONE REAL EVENT REPRESENTS ONE CONTINUOUS EVENT (ratified 2026-08-27).
 * One day, three days or a week, it is ONE row, and its days live inside it.
 * This module is the ONE answer to "is this event on, on this date?".
 *
 * ⚠⚠ WHY IT EXISTS. What's On filtered on `ev.config.date` — the START DATE —
 * in every lane: TONIGHT, THIS WEEKEND, COMING UP and the day picker. `endDate`
 * appeared nowhere in that screen. So a festival running Friday to Sunday was
 * listed on Friday and then VANISHED from the gig guide on Saturday, while it
 * was still running.
 *
 * That is why organisers were creating one event per day. It was not sloppiness
 * — splitting was the only way to stay visible for the whole weekend, and the
 * cost landed on applications, lineups, set times and analytics, which then all
 * described a fragment of an event instead of the event. `lib/eventBuckets.js`
 * had honoured `endDate` correctly the whole time; this screen just never asked
 * it. Hence one shared module rather than a fix at each of the four call sites.
 *
 * ⛔ THE FIX IS NOT MERGING DUPLICATE EVENTS. It is removing the reason to make
 * them. Merging is the LAST step of that work, done deliberately, never
 * automatically — some rows that look like duplicates are genuinely separate.
 *
 * Every function is PURE and takes `todayIso`-style strings, so a test can
 * freeze the clock. ⛔ Never reach for `new Date()` here: a 10-char slice of a
 * UTC timestamp reads as YESTERDAY every Australian morning.
 */
import { effectiveDate } from './eventBuckets';

/** How far a single event may be expanded into individual days. A row whose
 *  `endDate` is a typo ("2026" for the year, a decade-long range) must not be
 *  able to push tens of thousands of strings into a Set that renders the day
 *  picker. A month is far beyond any real festival and cheap to hold. */
export const MAX_SPAN_DAYS = 31;

function iso(v) {
  return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '';
}

/**
 * The first and last day an event occupies, as YYYY-MM-DD.
 *
 * ⚠ AN `endDate` BEFORE THE START DATE IS IGNORED, not honoured and not an
 * error. Production holds rows edited by hand, and a backwards range would
 * otherwise make `runsOn` false for every date including the event's own start
 * — the event would vanish from the guide completely, which is the exact
 * failure this module exists to end.
 */
export function eventSpan(event) {
  const start = iso(event?.config?.date);
  if (!start) return null;
  const end = iso(effectiveDate(event));
  return { start, end: end && end > start ? end : start };
}

/** Is this event on, on `dateIso`? Inclusive of both the first and last day. */
export function eventRunsOn(event, dateIso) {
  const span = eventSpan(event);
  if (!span || !dateIso) return false;
  return dateIso >= span.start && dateIso <= span.end;
}

/** Is this event on, on ANY of these dates? `dates` is a Set of YYYY-MM-DD. */
export function eventRunsOnAny(event, dates) {
  const span = eventSpan(event);
  if (!span || !dates?.size) return false;
  for (const d of dates) {
    if (d >= span.start && d <= span.end) return true;
  }
  return false;
}

/** Is the event a multi-day one? Drives the FRI–SUN pill on its card. */
export function isMultiDay(event) {
  const span = eventSpan(event);
  return !!span && span.end > span.start;
}

/**
 * Every date the event occupies, in order. Used for the day picker's dots, so
 * a three-day festival marks three days rather than only its first.
 *
 * ⚠ Capped at MAX_SPAN_DAYS. A truncated range still marks a month of real
 * days; an uncapped one lets a single bad row hang the screen.
 */
export function eventDates(event) {
  const span = eventSpan(event);
  if (!span) return [];
  const out = [span.start];
  if (span.end === span.start) return out;
  // Local noon, never midnight: the anchor has to survive a DST boundary and a
  // UTC slice, and noon is the only hour that does both in every AU timezone.
  const cur = new Date(span.start + 'T12:00:00');
  for (let i = 1; i < MAX_SPAN_DAYS; i++) {
    cur.setDate(cur.getDate() + 1);
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const s = `${y}-${m}-${d}`;
    if (s > span.end) break;
    out.push(s);
  }
  return out;
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * "SAT 29 AUG" — the short label a day of a multi-day event wears on the
 * schedule, the day chips and the set-times grid.
 *
 * ⭐⭐ WHY A DAY MUST SHOW ITS DATE. A day was an ORDINAL: "DAY 2", with a
 * free-text name beside it. An artist reading a festival's running order could
 * not tell which calendar day their set was on without counting, and a host
 * could not tell either. `event_slots` has no date column and never will need
 * one — the day's date is DERIVED from the event's start date plus its
 * `day_index`, which is the only version that cannot drift out of step when the
 * organiser moves the event.
 *
 * ⚠ The editor package grows the same label from the same rule
 * (`eventEditorModel.dayDateLabel`). They are deliberately parallel rather than
 * shared: this one is for READING an event, that one for EDITING it, and the
 * editor must not be dragged into a display path. ⛔ If they ever disagree,
 * that is a defect in one of them, not a licence to add a third.
 */
export function dayDateLabel(dateIso) {
  const day = iso(dateIso);
  if (!day) return '';
  const d = new Date(day + 'T12:00:00');
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
