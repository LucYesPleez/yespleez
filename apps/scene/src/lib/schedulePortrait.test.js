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
import { timeAxis, timeKey, cellsForStage } from './schedulePortrait.js';

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
