/**
 * PERSISTING THE EDITOR'S SCHEDULE TO `event_slots`.
 *
 * ⭐ THE SPLIT. `@yespleez/event-editor` owns the slot SHAPE and gives us two
 * pure converters (`rowsToDays` / `daysToRows`); this file owns the TABLE. The
 * package must never learn what a Supabase client is — Festival Companion
 * renders the same editor with no slot table at all, and persists through
 * `toConfig()` exactly as it did before.
 *
 * ── ⚠⚠ WHY THIS IS A DIFF AND NOT A DELETE-THEN-INSERT ──────────────────────
 *
 * `performances.slot_uuid` references `event_slots(id)` **ON DELETE CASCADE**.
 * Clearing the schedule and re-inserting it would therefore destroy every
 * booking on the event — silently, and on an ordinary "save my event" from a
 * form where the organiser changed the poster. The slot's UUID round-trips
 * through the editor for exactly this reason, so an unchanged slot is UPDATEd
 * in place and its performances are never touched.
 *
 * ⛔ A slot the organiser genuinely REMOVED is still deleted, and its
 * performances still cascade. That is the ratified model — removing a slot
 * returns the act to the Lineup, it does not drop them from the event, because
 * `lineup_members` is untouched by any of this. But the caller is TOLD how many
 * bookings that cost, because a number nobody is shown is a number nobody can
 * object to.
 */
import { daysToRows } from '@yespleez/event-editor';

/** The rows for one event, ordered — feed straight to `rowsToDays`. */
export async function loadEventSlots(db, eventId) {
  if (!eventId) return [];
  const { data, error } = await db
    .from('event_slots')
    .select('id, event_id, day_index, day_name, position, legacy_key, time, ampm, dur_mins, label, label_color, pinned')
    .eq('event_id', eventId)
    .order('day_index')
    .order('position');
  if (error) {
    // ⛔ Surfaced, never swallowed into an empty array. An empty schedule and an
    // unreadable one look identical to the form, and the form's next save would
    // then delete every slot it could not see.
    throw new Error(`Could not read the running order: ${error.message}`);
  }
  return data || [];
}

/**
 * Reconcile the editor's days against what is stored.
 *
 * @returns {{created:number, updated:number, deleted:number, droppedPerformances:number}}
 */
export async function saveEventSlots(db, eventId, days, { setTimesNeeded = true } = {}) {
  if (!eventId) throw new Error('saveEventSlots needs an event id');

  // ⚠ READ IMMEDIATELY BEFORE THE WRITE. The organiser may have edited set
  // times on the event page while this form sat open; diffing against rows we
  // loaded ten minutes ago would delete whatever they added since. Same rule
  // the config merge in CreateEventScreen already follows, for the same reason.
  const existing = await loadEventSlots(db, eventId);
  const existingById = new Map(existing.map(r => [r.id, r]));

  /**
   * ⛔⛔ TURNING SET TIMES OFF NO LONGER DELETES THE SCHEDULE (2026-08-17).
   *
   * ⚠⚠ It used to: `wanted` became `[]`, so every existing row fell into
   * `remove` and the whole running order was destroyed — along with, via the
   * ON DELETE CASCADE on `performances.slot_uuid`, every booking sitting on
   * those slots. The old note called that "a legitimate answer". It is not:
   * ⛔ the flag now controls whether the scheduling WORKSPACE is shown, ⛔ not
   * whether the work survives.
   *
   * ⭐ So disabling is REVERSIBLE. Switch it back on and the running order is
   * exactly where it was left. ⚠ That is also what makes the toggle safe to
   * put in front of a host who is only trying to tidy their tabs.
   *
   * ⛔ RETURNS EARLY. ⛔ Do not fall through to the diff with an empty `wanted`
   * and merely skip the delete — `keep`/`create` would then rewrite rows this
   * save has no opinion about.
   */
  if (!setTimesNeeded) {
    return { created: 0, updated: 0, deleted: 0, droppedPerformances: 0, preserved: existing.length };
  }

  const wanted = daysToRows(days);

  const keep    = wanted.filter(r => r.id && existingById.has(r.id));
  const create  = wanted.filter(r => !r.id || !existingById.has(r.id));
  const keepIds = new Set(keep.map(r => r.id));
  const remove  = existing.filter(r => !keepIds.has(r.id));

  /**
   * What the deletions will cost, counted BEFORE they happen.
   *
   * ⚠ `head: true` with an exact count — the rows themselves are not wanted,
   * only how many there are, and the organiser's bill can be long.
   */
  let droppedPerformances = 0;
  if (remove.length) {
    const { count } = await db
      .from('performances')
      .select('id', { count: 'exact', head: true })
      .in('slot_uuid', remove.map(r => r.id));
    droppedPerformances = count || 0;
  }

  // Order matters: update and insert BEFORE deleting, so a failure part-way
  // through leaves too many slots rather than too few. An extra empty slot is
  // an annoyance; a missing one takes bookings with it.
  for (const row of keep) {
    const { id, ...fields } = row;
    const { error } = await db.from('event_slots')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`Could not update a slot: ${error.message}`);
  }

  if (create.length) {
    const { error } = await db.from('event_slots')
      .insert(create.map(({ id: _drop, ...r }) => ({ ...r, event_id: eventId })));
    if (error) throw new Error(`Could not add a slot: ${error.message}`);
  }

  if (remove.length) {
    const { error } = await db.from('event_slots').delete().in('id', remove.map(r => r.id));
    if (error) throw new Error(`Could not remove a slot: ${error.message}`);
  }

  return {
    created: create.length,
    updated: keep.length,
    deleted: remove.length,
    droppedPerformances,
  };
}
