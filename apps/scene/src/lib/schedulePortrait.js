/**
 * ── THE SCHEDULE'S TIME-AXIS RULES ──────────────────────────────────────────
 *
 * S3 · pure logic over the object `resolveSchedule` returns.
 * ⛔ Nothing here reshapes the schedule — one scheduling model, many views.
 *
 * ⭐ CONSUMED BY THE PORTRAIT MULTI-STAGE GRID (owner, 2026-08-20, second
 * ruling: "I want the set times to go sideways across the screen for
 * multi-stage") and, when it lands, by the LANDSCAPE projection (brief §6) —
 * both align stages to one shared time axis; they differ only in which axis
 * runs which way. ⚠ Single-stage portrait deliberately uses NONE of this: a
 * chronological stack of full-width cards needs no axis and no cell alignment.
 *
 * ⚠⚠ THESE LIVE IN A `.js` MODULE, ⛔ NOT INSIDE A `.jsx` COMPONENT: node's
 * test runner cannot import JSX, so anything declared beside markup can only
 * ever be checked by a source-text test — and a source-text test never
 * compiles or renders what it claims to verify.
 *
 * ⛔⛔ THERE IS NO `publicCell` HERE, AND THAT IS ALSO DELIBERATE. It used to
 * decide what a punter may see — draft reads as open, unconfirmed reads as
 * PENDING, only a confirmed act is named. Those rules are REAL and still hold,
 * but they live in `SlotCard`, the card every surface renders. Restating them
 * here gave one question two answers, and the day the two disagreed the page
 * would leak a name the card was hiding, or hide one it was showing.
 *
 * ⭐ The projection decides WHERE a card goes. The card decides WHAT it says.
 */

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
 * column. That sharing is the entire point of an axis.
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
