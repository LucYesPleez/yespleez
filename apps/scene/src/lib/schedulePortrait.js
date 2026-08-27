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

/* ═══════════════════════════════════════════════════════════════════════════
   PAGER GEOMETRY — measurement only.
   ═══════════════════════════════════════════════════════════════════════════
   ⭐⭐ POSITIONS ARE READ OFF THE SNAP TARGETS, ⛔ NEVER COMPUTED. Pages snap to
   CENTRE, so a page's resting scrollLeft is not `i * (column + gap)` — and at
   the two ends it is not even that, because the scroller clamps: the first page
   cannot centre, it sits against the start. Any formula therefore disagrees
   with the browser exactly where the disagreement is invisible, on the ends.

   ⚠⚠ MEASURED WITH `getBoundingClientRect`, ⛔ NEVER `offsetLeft`. `offsetLeft`
   is relative to the nearest POSITIONED ancestor, which is not the scroller —
   it read 152px too far in the public schedule, and scroll-snap silently
   corrected the landing afterwards, so the jump looked right while the number
   was wrong. A scroll-spy has no snap to save it and simply lights the wrong
   page.

   ⭐ These take ELEMENTS, not selectors or class names, so they carry no
   knowledge of either projection's stylesheet. That is the whole reason they
   can be shared: the host's editable pager and the public read-only one differ
   in every other respect.
*/

/** How far a cell's centre sits from the scroller's centre, in pixels. */
export function offCentre(scroller, cell) {
  if (!scroller || !cell) return 0;
  const box = scroller.getBoundingClientRect();
  const cb = cell.getBoundingClientRect();
  return (cb.left + cb.width / 2) - (box.left + box.width / 2);
}

/** Which of these cells is nearest the scroller's centre. 0 when none are. */
export function nearestCentred(scroller, cells) {
  let best = 0;
  let bestGap = Infinity;
  (cells || []).forEach((c, i) => {
    const gap = Math.abs(offCentre(scroller, c));
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

/**
 * Centre `cell` in `scroller`.
 * ⚠ The browser clamps this at both ends by itself, which is what makes the
 * first and last page sit flush rather than overscroll. ⛔ Do not clamp here.
 */
export function centreOn(scroller, cell, behavior = 'smooth') {
  if (!scroller || !cell) return;
  scroller.scrollTo({ left: scroller.scrollLeft + offCentre(scroller, cell), behavior });
}

/**
 * ⭐⭐ THE MERGED TIME AXIS — for stages that do not run in parallel.
 *
 * ⚠⚠ WHY `timeAxis` IS NOT ENOUGH, and why it is still right. That function
 * takes its order from first-seen, which is correct when stages overlap: the
 * rooms progress together, so the first stage's ordering is the day's ordering.
 * ⛔ It cannot express DISJOINT stages. Neverland's Saturday runs workshops
 * 10:00 AM to 1:00 PM and the live stage 2:00 PM to 10:30 PM, so first-seen put
 * the whole evening above the morning and the column read 10:30 PM, 4:30 PM,
 * 7:30 PM down the page.
 *
 * ⛔⛔ IT STILL DOES NOT SORT THE CLOCK NAIVELY, for the reason `timeAxis`
 * states: a night crosses midnight and 1:00 AM must come LAST, not first.
 * Instead each stage is walked IN ITS OWN POSITION ORDER, and a time that goes
 * BACKWARDS within a stage is taken as midnight passing — so that stage's later
 * slots carry +24h. The stages are then merged on those absolute minutes.
 *
 * ⭐ So `position` remains the authority on what follows what, exactly as
 * before; this only decides how two stages interleave.
 */
function slotMinutes(slot) {
  const [h, m] = String(slot?.time || '').split(':');
  let hh = Number(h) % 12;
  if (String(slot?.ampm || '').toUpperCase() === 'PM') hh += 12;
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number(m) || 0);
}

export function mergedTimeAxis(day) {
  const found = new Map();   // key → { key, time, ampm, abs }
  for (const stage of day?.stages || []) {
    let rollover = 0;
    let prev = -1;
    for (const entry of stage.slots || []) {
      const slot = entry?.slot;
      if (!slot) continue;
      const mins = slotMinutes(slot);
      /* ⚠ STRICTLY backwards. Two slots at the same printed time are a data
         oddity, ⛔ not a second midnight. */
      if (prev >= 0 && mins < prev) rollover += 1440;
      prev = mins;
      const key = timeKey(slot);
      const abs = mins + rollover;
      /* ⚠ EARLIEST WINS on a shared label. If two stages disagree about which
         side of midnight a "12:00 AM" is on, placing it early keeps it beside
         the acts that share its label rather than orphaning a column. */
      if (!found.has(key) || abs < found.get(key).abs) {
        found.set(key, { key, time: slot.time, ampm: slot.ampm, abs });
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => a.abs - b.abs)
    .map(({ key, time, ampm }) => ({ key, time, ampm }));
}

/**
 * ⭐⭐ THE 15-MINUTE GRID. Every card occupies the intervals it actually runs
 * for, so a 1 hr set is 4 intervals, a 90 minute set is 6, and a schedule can
 * be read as a shape: length on the page IS length in the room.
 *
 * ⚠⚠ THIS REPLACES ROW-PER-START-TIME, and with it the "nothing on" filler. An
 * axis of distinct start times gave every act one row whatever its length, so a
 * 30 minute welcome and a 90 minute headline were the same height, and every
 * time another stage started at an hour this one did not, an empty cell had to
 * be invented to keep the columns aligned. On a continuous grid an empty
 * interval is simply empty — ⛔ nothing to render and nothing to explain.
 *
 * ⛔⛔ IT STILL DOES NOT SORT THE CLOCK NAIVELY. Absolute minutes are built the
 * same way `mergedTimeAxis` builds them: each stage walked in its own
 * `position` order, and a time that goes BACKWARDS within a stage taken as
 * midnight passing. So a 12:00 AM set lands after the 10:30 PM one, not twenty
 * two hours before it.
 *
 * @returns { rows, startMins, intervalMins, stages: [[{ entry, row, span }]] }
 *          `row` and `span` are 1-based CSS grid values for the slot area,
 *          ⛔ excluding any heading row the renderer adds itself.
 */
export function slotGrid(day, intervalMins = 15) {
  const step = intervalMins > 0 ? intervalMins : 15;
  const perStage = (day?.stages || []).map(stage => {
    let rollover = 0;
    let prev = -1;
    const out = [];
    for (const entry of stage?.slots || []) {
      const slot = entry?.slot;
      if (!slot) continue;
      const mins = slotMinutes(slot);
      if (prev >= 0 && mins < prev) rollover += 1440;
      prev = mins;
      /* ⚠ NEVER null and never zero — `dur_mins` is NOT NULL in the database,
         but a hand-edited 0 would collapse the card to no height at all. */
      const dur = Number(slot.dur) > 0 ? Number(slot.dur) : 60;
      out.push({ entry, start: mins + rollover, dur });
    }
    return out;
  });

  const all = perStage.flat();
  if (!all.length) {
    return { rows: 0, startMins: 0, intervalMins: step, stages: perStage.map(() => []) };
  }

  const startMins = Math.min(...all.map(x => x.start));
  const endMins = Math.max(...all.map(x => x.start + x.dur));
  const rows = Math.max(1, Math.ceil((endMins - startMins) / step));

  return {
    rows,
    startMins,
    intervalMins: step,
    stages: perStage.map(list => list.map(x => ({
      entry: x.entry,
      row: Math.floor((x.start - startMins) / step) + 1,
      /* ⚠ At least one interval. A set shorter than the interval still has to
         occupy a cell, or it would have no height and vanish. */
      span: Math.max(1, Math.round(x.dur / step)),
    }))),
  };
}

/**
 * ⭐ THE EMPTY RUNS of each stage — the stretches with nothing programmed.
 *
 * ⚠ ONE ELEMENT PER RUN, ⛔ not per interval. A quiet two hours is ONE empty
 * card, not eight stacked 15-minute ones: the schedule reads as "nothing here
 * until 8pm" rather than as a column of identical tiles.
 *
 * ⛔ It carries no time and no text. The times either side already say when the
 * gap is, and an empty card that labels itself is the "nothing on" filler this
 * grid was built to remove.
 *
 * @param grid  the return of `slotGrid`
 * @returns     per stage, `[{ row, span }]` in the same 1-based grid space
 */
export function stageGaps(grid, { includeTrailing = true } = {}) {
  const rows = grid?.rows || 0;
  return (grid?.stages || []).map(cells => {
    /* A row is taken if any cell covers it — a spanning card covers several. */
    const taken = new Array(rows + 1).fill(false);
    for (const c of cells || []) {
      for (let r = c.row; r < c.row + c.span && r <= rows; r++) taken[r] = true;
    }
    const runs = [];
    let start = null;
    for (let r = 1; r <= rows; r++) {
      if (!taken[r] && start === null) start = r;
      if ((taken[r] || r === rows) && start !== null) {
        const end = taken[r] ? r - 1 : r;
        runs.push({ row: start, span: end - start + 1 });
        start = null;
      }
    }
    /**
     * ⛔ NOTHING AFTER THE LAST ACT. Once a stage has closed there is nothing
     * more to say about it, and a blank card sitting under the stage close
     * reads as time still to fill.
     *
     * ⚠ A STAGE WITH NO PROGRAMME AT ALL KEEPS ITS RUN. That is not a stretch
     * after a close, it is a room that never opened, and the blank is exactly
     * what says so beside the stages that did run. ⛔ The `cells.length` test is
     * the whole difference; without it a quiet room silently disappears.
     */
    if (!includeTrailing && (cells || []).length && runs.length) {
      const last = runs[runs.length - 1];
      if (last.row + last.span - 1 >= rows) runs.pop();
    }
    return runs;
  });
}
