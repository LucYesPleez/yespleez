/**
 * ── THE PORTRAIT PROJECTION'S RULES ─────────────────────────────────────────
 *
 * S3 · pure logic for the public portrait timetable. It reads the object
 * `resolveSchedule` returns and answers the four questions the view has to ask.
 * ⛔ It never reshapes the schedule — one scheduling model, many views.
 *
 * ⚠⚠ THESE LIVE IN A `.js` MODULE, ⛔ NOT INSIDE THE `.jsx` COMPONENT, and the
 * reason is testability: node's test runner cannot import JSX, so anything
 * declared beside the markup can only ever be checked by a source-text test —
 * and a source-text test never compiles or renders what it claims to verify.
 * Rules that must not change by accident belong where they can be executed.
 */

import { scheduleShape } from './scheduleModel';

/**
 * ⭐ WHICH PORTRAIT LAYOUT — read from the resolver's own shape, ⛔ never from
 * a second count taken here. `scheduleShape` is the one place that decides.
 *
 *   'timeline' — one stage: a chronological list, time down the left. That is
 *                the whole of a pub gig's schedule and it should look like it.
 *   'grid'     — many stages: time across the top, stages down the side,
 *                scrolling sideways through the evening.
 */
export function portraitMode(resolved) {
  return scheduleShape(resolved).showStages ? 'grid' : 'timeline';
}

/** The column key for a slot. ⚠ The printed label IS the identity of a column. */
export function timeKey(slot) {
  return `${slot?.time || ''} ${slot?.ampm || ''}`.trim();
}

/**
 * ⭐ THE TIME AXIS of one day: every distinct start time across every stage, in
 * the order the schedule actually runs.
 *
 * ⚠⚠ ORDER COMES FROM `position`, ⛔ NOT from parsing the clock. Times are free
 * text ("7:00" + "PM") and a night crosses midnight, so any numeric read puts
 * 1:00 AM before 4:00 PM and rewrites the evening. The organiser's own ordering
 * is the only thing that knows 1:00 AM comes last, and `position` is that
 * ordering — the resolver has already sorted by it, so first-seen is correct.
 *
 * ⚠ Columns are keyed by the LABEL, so two stages starting at 9:00 PM share one
 * column. That sharing is the entire point of the grid.
 */
export function timeAxis(day) {
  const seen = new Map();
  for (const stage of day?.stages || []) {
    for (const entry of stage.slots || []) {
      const key = timeKey(entry.slot);
      if (!seen.has(key)) seen.set(key, { key, time: entry.slot.time, ampm: entry.slot.ampm });
    }
  }
  return [...seen.values()];
}

/**
 * ⭐ One stage's row, aligned to the shared axis so the columns line up. A
 * stage with nothing at 9:00 PM gets an empty cell there rather than its next
 * act sliding left into somebody else's column.
 */
export function cellsForStage(stage, axis) {
  const byKey = new Map();
  for (const entry of stage?.slots || []) {
    const k = timeKey(entry.slot);
    /* ⚠ FIRST WINS on a duplicate. Two slots on one stage at the same printed
       time is a data oddity, not a layout case — showing the earlier is stable,
       where last-wins changes between page loads. */
    if (!byKey.has(k)) byKey.set(k, entry);
  }
  return (axis || []).map(col => byKey.get(col.key) || null);
}

/**
 * ⛔⛔ WHAT THE PUBLIC IS ALLOWED TO SEE IN A CELL — the existing rule, carried
 * over from `SlotCard` intact, ⛔ not reinvented:
 *
 *   · a DRAFT placement is an OPEN SLOT to the public. The host is still
 *     thinking, nobody has been told, and announcing it here would leak a
 *     decision that has not been made.
 *   · anything not CONFIRMED shows PENDING, ⛔ never the artist's name. An
 *     offer is not an announcement.
 *   · only a CONFIRMED act is named, and only a named act can be tapped.
 *
 * ⚠ The returned cell carries NO claim unless the act is confirmed, so a name
 * that must not be shown cannot reach the DOM by a later mistake in the markup.
 *
 * ⚠ `toClaim` already translates `accepted` → `confirmed`, and forces
 * `confirmed` for an act with no account behind it — a hand-typed name is not
 * waiting on anybody's answer.
 *
 * A missing entry is a GAP, ⛔ which is not an OPEN slot: nothing is scheduled
 * on that stage at that time, and an OPEN label would advertise a slot the
 * organiser never created.
 */
export function publicCell(entry) {
  if (!entry) return { kind: 'gap' };
  const claim = entry.claim;
  if (!claim || claim.status === 'draft' || claim.status === 'declined') {
    return { kind: 'open', slot: entry.slot };
  }
  if (claim.status !== 'confirmed') return { kind: 'pending', slot: entry.slot };
  return { kind: 'act', slot: entry.slot, claim };
}
