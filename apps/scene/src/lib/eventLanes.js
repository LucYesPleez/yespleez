/**
 * WHICH DATE SECTIONS AN EVENT BELONGS IN.
 *
 * ⭐⭐ EVERY SECTION ASKS "DOES THIS EVENT RUN ON THIS DATE?" — ⛔ never "has it
 * already appeared somewhere above?" (owner, 2026-08-29).
 *
 * ⚠⚠ THE RULE THIS REPLACES was lane PRECEDENCE: an event that ran today was
 * struck out of the weekend section, so on the Saturday of a Fri–Sun festival
 * Neverland sat in TONIGHT and vanished from SUNDAY — a day it is playing. The
 * reader looking at Sunday was told nothing was on.
 *
 * ⭐⭐ THE DUPLICATION THAT RULE EXISTED TO PREVENT IS A DIFFERENT THING, and
 * separating the two is the whole point of this module:
 *
 *     ONE event shown under each date it runs      ✅ correct — it IS on
 *                                                     Friday and Saturday
 *     SEVERAL event records for one festival       ⛔ duplication, and still
 *                                                     prevented — see
 *                                                     project_one_event_one_continuous_event
 *
 * A festival is ONE row with a multi-day span. Nothing here creates, splits or
 * clones a record; these are read-side predicates over the canonical span.
 *
 * ⛔ THE DATE MODEL IS NOT TOUCHED. `eventSpan` remains the one reader of an
 * event's first and last day, and every predicate below goes through
 * `eventRunsOn`/`eventDates` rather than comparing `config.date` itself.
 */
import { eventRunsOn, eventRunsOnAny, eventDates } from './eventDays';

/**
 * TONIGHT — on today. Includes a festival that opened days ago and is still
 * running, which is the case the old start-date comparison lost.
 */
export function runsToday(event, todayIso) {
  return eventRunsOn(event, todayIso);
}

/**
 * The weekend section — on any weekend day still to come.
 *
 * ⛔⛔ NO "AND NOT TODAY" CLAUSE. That was the suppression: it is exactly what
 * removed a running festival from the day it is playing tomorrow. An event on
 * both today and Sunday belongs in both sections, because it is on both days.
 */
export function runsOnDatesAhead(event, datesAhead) {
  return eventRunsOnAny(event, datesAhead);
}

/**
 * COMING UP — ⚠ NOT a date section, and that is why its rule is different: it
 * is the catch-all for what the dated sections above do not reach.
 *
 * ⭐ Asked as a DATE question all the same: does this event run on any day
 * BEYOND the last one already covered? A festival that runs Saturday through
 * Wednesday is genuinely still to come after the weekend, and belongs here as
 * well as in TONIGHT and SUNDAY. A Fri–Sun festival does not, because it has no
 * day left once the weekend is covered.
 *
 * ⛔ Not "has it appeared already" — that is the precedence this module exists
 * to remove.
 */
export function runsBeyond(event, lastCoveredIso) {
  if (!lastCoveredIso) return true;
  return eventDates(event).some(d => d > lastCoveredIso);
}

/**
 * The last date the dated sections above account for.
 *
 * ⚠ Strings compare correctly as `YYYY-MM-DD`; ⛔ no Date objects, and ⛔ no
 * `toISOString()` — that is UTC and reads as yesterday every Australian
 * morning.
 */
export function lastCoveredDate(todayIso, datesAhead) {
  let last = todayIso || '';
  for (const d of datesAhead || []) if (d > last) last = d;
  return last || null;
}
