/**
 * WHICH BOOKING CONTRACT DOES THIS EVENT LIVE UNDER?
 *
 * ⭐⭐ ONE READER OF `events.booking_model`. ⛔ No screen may decide this for
 * itself. The moment two surfaces answer it differently, one of them starts
 * requiring confirmation on a bill that was never going to get one, and 62
 * imported events with real acts on them quietly lose their lineups.
 *
 * ── THE THREE CONTRACTS (ratified 2026-08-17) ───────────────────────────────
 *
 *   legacy    Everything that existed on 2026-08-17. ⛔ Manually created AND
 *             imported alike — the value means GRANDFATHERED, ⛔ not "where it
 *             came from". Existing lineups are authoritative, ⛔ nothing is
 *             migrated, ⛔ nobody reconfirms.
 *   imported  A FUTURE Gig Importer event. The importer writes this itself at
 *             creation. An imported bill is authoritative by definition.
 *   managed   A FUTURE manually created event. The new two-sided model:
 *             SHORTLIST → offer the EVENT → artist accepts → LINEUP → set times.
 *
 * ⛔⛔ `external_ref` IS NOT THIS. It records the SOURCE (`studio:batch_…`, on
 * 62 rows today) and it keeps that job. `booking_model` records the CONTRACT.
 * ⛔ Do not infer one from the other: a future importer event must SAY it is
 * imported, because "starts with studio:" is a string test that would also
 * re-classify every grandfathered row the moment somebody ran it.
 */

export const LEGACY   = 'legacy';
export const IMPORTED = 'imported';
export const MANAGED  = 'managed';

export const BOOKING_MODELS = [LEGACY, IMPORTED, MANAGED];

/**
 * ⭐⭐ THE FAIL-SAFE DIRECTION IS `legacy`, AND IT IS DELIBERATE.
 *
 * ⚠⚠ A NULL or unrecognised value must NEVER read as `managed`. The two errors
 * are not symmetrical:
 *
 *   wrongly legacy   → an event keeps working the way it does today.
 *   wrongly managed  → a real, booked, publicly visible bill is downgraded
 *                      because nobody two-sided-confirmed a booking made
 *                      before the concept existed.
 *
 * ⛔ So the column is nullable with NO default, and everything unknown lands
 * here. That also means the app is SAFE between the migration and the day the
 * Gig Importer is updated: its events arrive NULL and are simply grandfathered.
 */
export function bookingModel(event) {
  const v = event?.booking_model;
  return BOOKING_MODELS.includes(v) ? v : LEGACY;
}

/**
 * ⭐ THE ONLY QUESTION MOST CALLERS SHOULD ASK.
 *
 * ⚠ Ask this rather than comparing to a string. A fourth contract added later
 * changes one function instead of every `=== 'managed'` in the codebase.
 */
export function requiresConfirmation(event) {
  return bookingModel(event) === MANAGED;
}

/**
 * Is the existing lineup authoritative as it stands?
 *
 * ⭐ True for both `legacy` and `imported`, for different reasons that reach
 * the same answer: one was booked before the model existed, the other was
 * booked somewhere else. ⛔ Neither may be downgraded.
 */
export function lineupIsAuthoritative(event) {
  return !requiresConfirmation(event);
}

/**
 * ⚠ WHERE IT CAME FROM, ⛔ not which rules apply. Kept because the importer
 * marker is genuinely useful for support and tracing — ⛔ but a booking rule
 * must never branch on it. See the note at the top.
 */
export function isImporterSourced(event) {
  return String(event?.external_ref || '').startsWith('studio:');
}
