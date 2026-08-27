import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rowsToDays, daysToRows } from './eventEditorModel.js';

/**
 * THE CONVERTERS THAT KEEP BOOKINGS ALIVE THROUGH AN EDIT.
 *
 * `performances.slot_uuid` cascades ON DELETE. If a slot's UUID does not
 * survive a round trip through the editor, saving the form deletes the row and
 * re-inserts it under a new id — and every booking on it goes with it, on an
 * ordinary save from a form where the organiser only changed the poster.
 *
 * Fixtures are Solstice Soirée's real rows (2026-08-15).
 */

const rows = () => ([
  { id: '11111111-1111-4111-8111-111111111111', day_index: 0, day_name: 'SATURDAY', position: 1, time: '5:30', ampm: 'PM', dur_mins: 90, label: '', label_color: null, pinned: false },
  { id: '00000000-0000-4000-8000-000000000000', day_index: 0, day_name: 'SATURDAY', position: 0, time: '4:00', ampm: 'PM', dur_mins: 90, label: 'SUNSET SET 🔒', label_color: null, pinned: false },
  { id: '22222222-2222-4222-8222-222222222222', day_index: 1, day_name: 'SUNDAY',   position: 0, time: '10:00', ampm: 'AM', dur_mins: 90, label: '', label_color: null, pinned: false },
]);

test('⚠⚠ a slot’s UUID survives the round trip', () => {
  const back = daysToRows(rowsToDays(rows()));
  assert.deepEqual(
    back.map(r => r.id),
    ['00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    'losing these ids turns every save into a delete-and-reinsert, cascading the bookings away',
  );
});

test('the round trip preserves days, order, times and labels', () => {
  const days = rowsToDays(rows());
  assert.equal(days.length, 2);
  assert.equal(days[0].name, 'SATURDAY');
  assert.deepEqual(days[0].slots.map(s => s.hh), ['4', '5']);
  assert.equal(days[0].slots[0].label, 'SUNSET SET 🔒');

  const back = daysToRows(days);
  assert.deepEqual(back.map(r => [r.day_index, r.position]), [[0, 0], [0, 1], [1, 0]]);
  assert.equal(back[0].time, '4:00');
  assert.equal(back[0].dur_mins, 90);
  assert.equal(back[2].day_name, 'SUNDAY');
});

/**
 * ⚠ A NEW SLOT HAS NO ROW YET. `makeId()` mints 6-character keys, and all three
 * id generations already in production are short too (`sat_1`, `d0s3`,
 * `ehkh62`) — so "looks like a uuid" is the only honest test.
 */
test('a slot added in the form emits no id, and lets the database mint one', () => {
  const out = daysToRows([{ name: '', slots: [
    { id: 'abc123', hh: '8', mm: '00', ampm: 'PM', dur: 60, label: '' },
    { id: 'sat_1',  hh: '9', mm: '30', ampm: 'PM', dur: 90, label: '' },
    { id: '00000000-0000-4000-8000-000000000000', hh: '11', mm: '00', ampm: 'PM', dur: 60, label: '' },
  ] }]);
  assert.equal('id' in out[0], false, 'a makeId() key is not a row id');
  assert.equal('id' in out[1], false, 'nor is a legacy key');
  assert.equal(out[2].id, '00000000-0000-4000-8000-000000000000');
});

/**
 * ⚠ `dur_mins` IS NOT NULL. A cleared duration field must fall back, or the
 * whole save fails the constraint — and the five slots that stored the STRING
 * "1.5 hrs" are exactly the kind of value that reaches here.
 */
test('a missing or junk duration falls back rather than failing the save', () => {
  const out = daysToRows([{ name: '', slots: [
    { id: 'a', hh: '8', mm: '00', ampm: 'PM', dur: null,      label: '' },
    { id: 'b', hh: '8', mm: '00', ampm: 'PM', dur: '',        label: '' },
    { id: 'c', hh: '8', mm: '00', ampm: 'PM', dur: '1.5 hrs', label: '' },
    { id: 'd', hh: '8', mm: '00', ampm: 'PM', dur: 0,         label: '' },
  ] }]);
  assert.deepEqual(out.map(r => r.dur_mins), [60, 60, 60, 60]);
  out.forEach(r => assert.notEqual(r.dur_mins, null));
});

test('labelColor and pinned round-trip, and stay absent when they never existed', () => {
  const days = rowsToDays([
    { id: '33333333-3333-4333-8333-333333333333', day_index: 0, position: 0, time: '9:00', ampm: 'PM', dur_mins: 60, label: 'X', label_color: '#f0f', pinned: true },
    { id: '44444444-4444-4444-8444-444444444444', day_index: 0, position: 1, time: '10:00', ampm: 'PM', dur_mins: 60, label: '', label_color: null, pinned: false },
  ]);
  assert.equal(days[0].slots[0].labelColor, '#f0f');
  assert.equal(days[0].slots[0].pinned, true);
  // ⛔ Absent, not null — `carryUnedited` distinguishes the two, and every slot
  // in production today has NEITHER key.
  assert.equal('labelColor' in days[0].slots[1], false);
  assert.equal('pinned' in days[0].slots[1], false);

  const back = daysToRows(days);
  assert.equal(back[0].label_color, '#f0f');
  assert.equal(back[1].label_color, null);
  assert.equal(back[1].pinned, false);
});

test('empty input is empty output, not a phantom day', () => {
  assert.deepEqual(rowsToDays([]), []);
  assert.deepEqual(rowsToDays(null), []);
  assert.deepEqual(daysToRows([]), []);
  assert.deepEqual(daysToRows([{ name: '', slots: [] }]), []);
});

/* ⭐⭐ THE STAGE AXIS (S2e, 2026-08-27). A stage is an entity; a slot points at
   one. ⛔ An event with no stages keeps NULL, which is the implicit stage. */
test('a slot carries its stage in both directions', () => {
  const rows = [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', day_index: 0, position: 0,
    time: '8:00', ampm: 'PM', dur_mins: 60, stage_id: 'stage-uuid-1' }];
  const days = rowsToDays(rows);
  assert.equal(days[0].slots[0].stageId, 'stage-uuid-1');
  assert.equal(daysToRows(days)[0].stage_id, 'stage-uuid-1', 'and it survives the round trip');
});

test('⛔ a single-stage event keeps NULL — that IS the implicit stage', () => {
  const days = rowsToDays([{ day_index: 0, position: 0, time: '8:00', ampm: 'PM', dur_mins: 60 }]);
  assert.equal('stageId' in days[0].slots[0], false, 'no key at all rather than an empty one');
  assert.equal(daysToRows(days)[0].stage_id, null);
});

test('⚠ two stages inside one day both survive, with their own slots', () => {
  const rows = [
    { day_index: 0, position: 0, time: '3:00', ampm: 'PM', dur_mins: 60, stage_id: 'A' },
    { day_index: 0, position: 1, time: '3:00', ampm: 'PM', dur_mins: 60, stage_id: 'B' },
  ];
  const out = daysToRows(rowsToDays(rows));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.stage_id), ['A', 'B']);
  assert.deepEqual(out.map(r => r.day_index), [0, 0], 'one DAY, two STAGES');
});
