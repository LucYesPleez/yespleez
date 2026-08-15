/**
 * UPCOMING · DRAFT · ARCHIVE — the one definition of where an event sits.
 *
 * ⭐⭐ ONE RULE, because there were THREE and they disagreed:
 *
 *   HostDashboard:377   `new Date().toISOString().split('T')[0]`, compared to
 *                       `config.date` as a string. UTC, and blind to endDate.
 *   EventsSection:6     the same UTC expression again, driving the FINISHED
 *                       badge through a different comparison.
 *   eventStatus.js      `deriveEventStatus`, which parses LOCAL midnight and
 *                       DOES honour endDate — the only correct one of the three.
 *
 * ⛔⛔ `toISOString().slice(0,10)` IS NOT TODAY. It is the UTC date, so in AEST
 * it reads as YESTERDAY every morning until 10am (11 in daylight saving) — and
 * both instances above sit on the line that decides whether an event has
 * happened. An event on TODAY files as ARCHIVE before 10am. `today()` in
 * lib/dates.js has existed for exactly this since the My Scene fix; these call
 * sites simply never used it.
 *
 * ── THE ORDER MATTERS, AND IT IS DELIBERATE ─────────────────────────────────
 *
 *   1. past      → ARCHIVE   ⭐ owner, 2026-08-15: "make any events that are
 *                              past go into an archive". Past beats draft: an
 *                              unpublished event that has already happened is
 *                              not work waiting to be done.
 *   2. draft     → DRAFT
 *   3. otherwise → UPCOMING
 *
 * ⚠ THE OLD RULE PUT DRAFT FIRST, so a past draft stayed in DRAFTS forever.
 * No event in production is currently a past draft, so this changes nothing
 * today — it changes what happens the day one exists.
 *
 * ── ⛔ AN UNDATED EVENT IS NOT A PAST EVENT ─────────────────────────────────
 *
 * The old comparison was `(config.date || '') < todayStr`, and `'' < anything`
 * is TRUE — so every event with no date was silently filed as PAST. Two
 * production events (Echo Valley 2026 and 2027) have no date at all. Unknown is
 * not absent and it is certainly not past; they fall through to their real
 * status instead. This is the rendering contract applied to time.
 */
import { today as localToday } from './dates';
import { deriveEventStatus } from '../screens/event/eventStatus';

export const UPCOMING = 'UPCOMING';
export const DRAFT    = 'DRAFT';
export const ARCHIVE  = 'ARCHIVE';

/** The bucket order the UI shows them in. */
export const BUCKETS = [UPCOMING, DRAFT, ARCHIVE];

/**
 * The last day an event occupies.
 *
 * ⚠ `endDate` FIRST. A festival running Fri–Sun is not over on Saturday, and
 * the two rules this replaces both compared `config.date` alone. Solstice
 * Soirée (20–21 June) is the production row that has one.
 */
export function effectiveDate(event) {
  const cfg = event?.config || {};
  const d = cfg.endDate || cfg.date || '';
  return typeof d === 'string' ? d.slice(0, 10) : '';
}

/**
 * @param event      an `events` row
 * @param todayStr   YYYY-MM-DD in the VIEWER'S timezone. Injected so this stays
 *                   pure and so a test can freeze the clock — the defect this
 *                   file replaces was invisible precisely because nothing could.
 */
export function eventBucket(event, todayStr = localToday()) {
  if (!event) return UPCOMING;

  /**
   * ⭐⭐ "IS THIS PAST" IS ASKED OF `deriveEventStatus`, NOT RE-DERIVED HERE.
   *
   * That function already parses LOCAL midnight, already honours `endDate`, and
   * already returns null for an undated event — it was the ONLY one of the four
   * temporal rules on these screens that was correct. Writing a fourth
   * comparison here, even a correct one, would recreate exactly the divergence
   * this file exists to end: the event page's status pill and the dashboard's
   * ARCHIVE tab would be two implementations of one sentence, free to drift.
   *
   * ⚠ `lib/` importing from `screens/event/` is backwards as layering. The
   * alternative was a second copy of the rule, and a duplicated rule is worse
   * than an awkward import. ⭐ If `eventStatus.js` is ever moved to `lib/`,
   * this import follows it and nothing else changes.
   *
   * ⚠ THE CLOCK IS PASSED THROUGH as a Date built from the injected day string,
   * so a frozen test clock reaches the shared function rather than being
   * silently replaced by the real one.
   */
  const cfg = event.config || {};
  const status = deriveEventStatus(
    { date: cfg.date, endDate: cfg.endDate },
    new Date(`${todayStr}T00:00:00`),
  );
  if (status === 'past') return ARCHIVE;

  // An explicitly completed event is archived whatever its date says.
  if (event.status === 'completed') return ARCHIVE;
  if (event.status === 'draft') return DRAFT;
  return UPCOMING;
}

/** @returns { UPCOMING: [...], DRAFT: [...], ARCHIVE: [...] } — order preserved. */
export function bucketEvents(events = [], todayStr = localToday()) {
  const out = { [UPCOMING]: [], [DRAFT]: [], [ARCHIVE]: [] };
  for (const ev of events || []) out[eventBucket(ev, todayStr)].push(ev);
  return out;
}

/**
 * Which bucket to open on: the first one with anything in it.
 *
 * ⚠ Opening on an empty UPCOMING is the state this whole change exists to fix.
 * The host in production has 0 upcoming, 4 drafts and 11 archived, so a fixed
 * default would land them on an empty screen while their real work sat one tab
 * away — the same "wall of nothing" the chip rail was.
 */
export function defaultBucket(buckets) {
  return BUCKETS.find(b => (buckets?.[b] || []).length > 0) || UPCOMING;
}

/** Archived, for a FINISHED badge. Same rule, so the badge cannot disagree. */
export function isArchived(event, todayStr = localToday()) {
  return eventBucket(event, todayStr) === ARCHIVE;
}
