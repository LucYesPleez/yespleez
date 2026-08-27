/**
 * The time-axis rules — S3.
 *
 * ⚠⚠ THESE ARE THE LANDSCAPE PROJECTION'S SPEC (see schedulePortrait.js: the
 * portrait stack has no axis, deliberately). They test the RULES, ⛔ not any
 * markup — rendering is verified by driving the real interface, ⛔ never by a
 * source-text test.
 *
 * ⛔ THE PUBLIC-VISIBILITY TESTS MOVED OUT WITH THE RULE THEY COVERED.
 * Draft-reads-as-open, unconfirmed-reads-as-PENDING and only-confirmed-is-named
 * are SlotCard's, because SlotCard is the card every surface renders. ⛔ Do not
 * restate them here: two answers to one question is the defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchedule } from './scheduleModel.js';
import {timeAxis, timeKey, cellsForStage, offCentre, nearestCentred, mergedTimeAxis, slotGrid, stageGaps } from './schedulePortrait.js';

const slot = (o = {}) => ({
  id: o.id || `u${o.position ?? 0}-${o.day_index ?? 0}-${o.stage_id ?? 'x'}`,
  day_index: o.day_index ?? 0,
  day_name: o.day_name ?? 'SATURDAY',
  position: o.position ?? 0,
  time: o.time ?? '7:00',
  ampm: o.ampm ?? 'PM',
  dur_mins: 60,
  label: o.label ?? '',
  label_color: null,
  pinned: false,
  stage_id: 'stage_id' in o ? o.stage_id : null,
});

// ── The time axis ────────────────────────────────────────────────────────

test('⚠⚠ the axis follows POSITION, ⛔ never a numeric read of the clock', () => {
  // A festival night: 10 PM, 11:30 PM, then 1 AM. Sorting by the printed
  // number would put 1:00 AM first and rewrite the night.
  const r = resolveSchedule({
    slots: [
      slot({ position: 0, time: '10:00', ampm: 'PM' }),
      slot({ position: 1, time: '11:30', ampm: 'PM' }),
      slot({ position: 2, time: '1:00', ampm: 'AM' }),
    ],
  });
  assert.deepEqual(timeAxis(r.days[0]).map(c => c.key), ['10:00 PM', '11:30 PM', '1:00 AM']);
});

test('two stages starting at the same time SHARE one column', () => {
  const r = resolveSchedule({
    slots: [
      slot({ id: 'a1', stage_id: 'a', position: 0, time: '9:00' }),
      slot({ id: 'b1', stage_id: 'b', position: 0, time: '9:00' }),
      slot({ id: 'b2', stage_id: 'b', position: 1, time: '10:00' }),
    ],
    stages: [{ id: 'a', name: 'MAIN', position: 0 }, { id: 'b', name: 'SECOND', position: 1 }],
  });
  const axis = timeAxis(r.days[0]);
  assert.deepEqual(axis.map(c => c.key), ['9:00 PM', '10:00 PM']);
});

// ── Row alignment ────────────────────────────────────────────────────────

test('⭐ a stage with a hole gets an empty CELL, ⛔ its next act must not slide left', () => {
  const r = resolveSchedule({
    slots: [
      slot({ id: 'a1', stage_id: 'a', position: 0, time: '9:00' }),
      slot({ id: 'a2', stage_id: 'a', position: 1, time: '10:00' }),
      slot({ id: 'b2', stage_id: 'b', position: 1, time: '10:00' }),
    ],
    stages: [{ id: 'a', name: 'MAIN', position: 0 }, { id: 'b', name: 'SECOND', position: 1 }],
  });
  const day = r.days[0];
  const axis = timeAxis(day);
  const second = day.stages.find(st => st.name === 'SECOND');
  const cells = cellsForStage(second, axis);

  assert.equal(cells.length, axis.length, 'one cell per column, always');
  assert.equal(cells[0], null, 'nothing at 9:00 on this stage');
  assert.equal(cells[1].slot.id, 'b2', 'and its 10:00 act stays in the 10:00 column');
});

test('cellsForStage survives a stage with no slots at all', () => {
  const axis = [{ key: '9:00 PM', time: '9:00', ampm: 'PM' }];
  assert.deepEqual(cellsForStage({ slots: [] }, axis), [null]);
  assert.deepEqual(cellsForStage(null, axis), [null]);
});

test('timeKey is stable for a slot missing its ampm', () => {
  assert.equal(timeKey({ time: '9:00', ampm: 'PM' }), '9:00 PM');
  assert.equal(timeKey({ time: '9:00' }), '9:00');
  assert.equal(timeKey(null), '');
});

// ── The festival shape (landscape's case) ────────────────────────────────

test('⭐ the festival shape aligns three stages across a shared axis', () => {
  const stages = [
    { id: 'm', name: 'MAIN STAGE', position: 0 },
    { id: 's', name: 'SECOND STAGE', position: 1 },
    { id: 'c', name: 'CHILL ZONE', position: 2 },
  ];
  const slots = [];
  ['7:00', '8:00', '9:00', '10:00'].forEach((t, i) => {
    slots.push(slot({ id: `m${i}`, stage_id: 'm', position: i, time: t }));
    if (i < 3) slots.push(slot({ id: `s${i}`, stage_id: 's', position: i, time: t }));
    if (i === 0 || i === 2) slots.push(slot({ id: `c${i}`, stage_id: 'c', position: i, time: t }));
  });

  const r = resolveSchedule({ slots, stages });
  const day = r.days[0];
  const axis = timeAxis(day);
  assert.equal(axis.length, 4, 'four time columns');

  // Every stage row is the same width as the axis — that is what keeps a
  // grid readable when a stage stops early or starts late.
  for (const st of day.stages) {
    assert.equal(cellsForStage(st, axis).length, 4);
  }
  const chill = cellsForStage(day.stages.find(x => x.name === 'CHILL ZONE'), axis);
  assert.deepEqual(chill.map(c => (c ? c.slot.id : null)), ['c0', null, 'c2', null]);
});

/* ⭐ PAGER GEOMETRY. Pure measurement, so a fake element with a rect is enough
   — and that is the point of taking elements rather than selectors. */
const el = (left, width) => ({ getBoundingClientRect: () => ({ left, width }) });

test('offCentre is 0 when the cell is centred in the scroller', () => {
  assert.equal(offCentre(el(0, 400), el(150, 100)), 0);
});

test('offCentre is negative when the cell sits LEFT of centre', () => {
  assert.ok(offCentre(el(0, 400), el(0, 100)) < 0);
  assert.ok(offCentre(el(0, 400), el(300, 100)) > 0);
});

test('offCentre survives a missing element rather than throwing', () => {
  assert.equal(offCentre(null, el(0, 10)), 0);
  assert.equal(offCentre(el(0, 10), null), 0);
});

test('⭐ nearestCentred picks the page closest to the middle', () => {
  const scroller = el(0, 400);
  //            page 0 far left    page 1 centred     page 2 far right
  const cells = [el(-300, 100), el(150, 100), el(600, 100)];
  assert.equal(nearestCentred(scroller, cells), 1);
});

test('⚠ nearestCentred answers 0 for an empty list, never undefined', () => {
  assert.equal(nearestCentred(el(0, 400), []), 0);
  assert.equal(nearestCentred(el(0, 400), null), 0);
});

test('nearestCentred breaks a tie toward the EARLIER page, deterministically', () => {
  const scroller = el(0, 400);
  const cells = [el(100, 100), el(200, 100)];   // both 50px off centre
  assert.equal(nearestCentred(scroller, cells), 0);
});

/* ⭐⭐ THE MERGED AXIS — stages that do not run in parallel. */
const st = (name, times) => ({ name, slots: times.map(([time, ampm]) => ({ slot: { time, ampm } })) });

test('⭐⭐ DISJOINT STAGES INTERLEAVE BY CLOCK — the morning is not stranded below the evening', () => {
  // Neverland's Saturday: workshops 10:00 AM to 1:00 PM, live 2:00 PM on.
  const day = { stages: [
    st('LIVE', [['2:00', 'PM'], ['3:00', 'PM'], ['10:30', 'PM']]),
    st('WORKSHOPS', [['10:00', 'AM'], ['11:00', 'AM'], ['12:00', 'PM']]),
  ] };
  assert.deepEqual(mergedTimeAxis(day).map(c => `${c.time} ${c.ampm}`),
    ['10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '3:00 PM', '10:30 PM']);
});

test('⛔⛔ 12:00 AM STAYS LAST — a night crosses midnight, it does not restart', () => {
  const day = { stages: [st('DJ', [['10:30', 'PM'], ['12:00', 'AM']])] };
  assert.deepEqual(mergedTimeAxis(day).map(c => `${c.time} ${c.ampm}`),
    ['10:30 PM', '12:00 AM'], 'a naive clock sort would put midnight first and rewrite the night');
});

test('⚠ a stage that runs past midnight still merges after one that ends at 11', () => {
  const day = { stages: [
    st('DJ',   [['9:00', 'PM'], ['12:00', 'AM'], ['1:00', 'AM']]),
    st('LIVE', [['9:30', 'PM'], ['11:00', 'PM']]),
  ] };
  assert.deepEqual(mergedTimeAxis(day).map(c => `${c.time} ${c.ampm}`),
    ['9:00 PM', '9:30 PM', '11:00 PM', '12:00 AM', '1:00 AM']);
});

test('two stages starting at the same printed time share ONE column', () => {
  const day = { stages: [st('A', [['9:00', 'PM']]), st('B', [['9:00', 'PM']])] };
  assert.equal(mergedTimeAxis(day).length, 1);
});

test('12 PM is noon and 12 AM is midnight, not both zero', () => {
  const day = { stages: [st('A', [['11:00', 'AM'], ['12:00', 'PM'], ['1:00', 'PM']])] };
  assert.deepEqual(mergedTimeAxis(day).map(c => `${c.time} ${c.ampm}`),
    ['11:00 AM', '12:00 PM', '1:00 PM']);
});

test('an empty day yields an empty axis rather than throwing', () => {
  assert.deepEqual(mergedTimeAxis({ stages: [] }), []);
  assert.deepEqual(mergedTimeAxis(null), []);
  assert.deepEqual(mergedTimeAxis({ stages: [{ slots: [] }] }), []);
});

/* ⭐⭐ THE 15-MINUTE GRID. Length on the page is length in the room. */
const sg = (name, slots) => ({ name, slots: slots.map(([time, ampm, dur]) => ({ slot: { time, ampm, dur } })) });

test('⭐⭐ AN HOUR IS 4 INTERVALS AND 90 MINUTES IS 6', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60], ['6:00', 'PM', 90]])] };
  const g = slotGrid(day);
  assert.deepEqual(g.stages[0].map(c => c.span), [4, 6]);
  assert.deepEqual(g.stages[0].map(c => c.row), [1, 5], 'the 6pm set starts where the 5pm one ends');
});

test('⭐ a 30 minute set is 2 intervals, and the next act starts at row 3', () => {
  const day = { stages: [sg('LIVE', [['4:30', 'PM', 30], ['5:00', 'PM', 60]])] };
  const g = slotGrid(day);
  assert.deepEqual(g.stages[0].map(c => [c.row, c.span]), [[1, 2], [3, 4]]);
});

test('⭐⭐ STAGES SHARE ONE ORIGIN, so a later room starts further down', () => {
  // Workshops open at 10am; the live stage starts at 2pm, 16 intervals later.
  const day = { stages: [
    sg('WORKSHOPS', [['10:00', 'AM', 60]]),
    sg('LIVE', [['2:00', 'PM', 60]]),
  ] };
  const g = slotGrid(day);
  assert.equal(g.stages[0][0].row, 1);
  assert.equal(g.stages[1][0].row, 17);
  assert.equal(g.rows, 20, '10am to 3pm is five hours of intervals');
});

test('⛔⛔ A SET PAST MIDNIGHT GOES AFTER, not twenty two hours before', () => {
  const day = { stages: [sg('DJ', [['10:30', 'PM', 90], ['12:00', 'AM', 60]])] };
  const g = slotGrid(day);
  assert.deepEqual(g.stages[0].map(c => [c.row, c.span]), [[1, 6], [7, 4]]);
});

test('⚠ a zero or missing duration falls back to an hour rather than collapsing', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 0], ['6:00', 'PM', undefined]])] };
  assert.deepEqual(slotGrid(day).stages[0].map(c => c.span), [4, 4]);
});

test('⚠ a set shorter than the interval still occupies one', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 5]])] };
  assert.equal(slotGrid(day).stages[0][0].span, 1);
});

test('an empty day has no rows and throws nothing', () => {
  assert.equal(slotGrid({ stages: [] }).rows, 0);
  assert.equal(slotGrid(null).rows, 0);
  assert.deepEqual(slotGrid({ stages: [{ slots: [] }] }).stages, [[]]);
});

test('the interval is configurable, and 30 minutes halves every span', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60]])] };
  assert.equal(slotGrid(day, 30).stages[0][0].span, 2);
});

/* ⭐ EMPTY RUNS — one card per stretch of nothing, ⛔ not one per interval. */
test('a gap between two sets is ONE run, not several intervals', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60], ['7:00', 'PM', 60]])] };
  const g = slotGrid(day);
  assert.deepEqual(stageGaps(g), [[{ row: 5, span: 4 }]], 'the quiet hour is one card');
});

test('back-to-back sets leave NO run at all', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60], ['6:00', 'PM', 60]])] };
  assert.deepEqual(stageGaps(slotGrid(day)), [[]]);
});

test('⭐⭐ A STAGE THAT RUNS LATER IS EMPTY UNTIL IT STARTS', () => {
  // Workshops 10am; the live stage opens at noon, 8 intervals later.
  const day = { stages: [
    sg('WORKSHOPS', [['10:00', 'AM', 60]]),
    sg('LIVE', [['12:00', 'PM', 60]]),
  ] };
  const gaps = stageGaps(slotGrid(day));
  assert.deepEqual(gaps[0], [{ row: 5, span: 8 }], 'workshops are quiet after 11');
  assert.deepEqual(gaps[1], [{ row: 1, span: 8 }], 'live is quiet before noon');
});

test('a stage with nothing at all is one run covering the day', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60]]), sg('DJ', [])] };
  const g = slotGrid(day);
  assert.deepEqual(stageGaps(g)[1], [{ row: 1, span: g.rows }]);
});

test('an empty day yields no runs rather than throwing', () => {
  assert.deepEqual(stageGaps(slotGrid({ stages: [] })), []);
  assert.deepEqual(stageGaps(null), []);
});

test('⛔ NO BLANK AFTER THE LAST ACT when trailing runs are off', () => {
  // A stage that closes at 6pm has nothing more to say; a blank under the
  // stage close reads as time still to fill.
  const day = { stages: [
    sg('LIVE', [['5:00', 'PM', 60]]),
    sg('DJ', [['5:00', 'PM', 120]]),
  ] };
  const g = slotGrid(day);
  assert.deepEqual(stageGaps(g, { includeTrailing: false })[0], [],
    'LIVE ends an hour early and gets NO trailing blank');
  assert.deepEqual(stageGaps(g)[0], [{ row: 5, span: 4 }], 'and the default still returns it');
});

test('⭐ THE BLANK BEFORE A STAGE OPENS SURVIVES', () => {
  const day = { stages: [
    sg('WORKSHOPS', [['10:00', 'AM', 60]]),
    sg('LIVE', [['11:00', 'AM', 60]]),
  ] };
  const gaps = stageGaps(slotGrid(day), { includeTrailing: false });
  assert.deepEqual(gaps[1], [{ row: 1, span: 4 }], 'LIVE is blank until it opens');
});

test('⚠⚠ A STAGE THAT NEVER RAN KEEPS ITS BLANK — it is not a trailing gap', () => {
  const day = { stages: [sg('LIVE', [['5:00', 'PM', 60]]), sg('DJ', [])] };
  const g = slotGrid(day);
  assert.deepEqual(stageGaps(g, { includeTrailing: false })[1], [{ row: 1, span: g.rows }]);
});
