/**
 * The portrait projection — S3.
 *
 * ⚠⚠ THESE TEST THE PROJECTION'S RULES, ⛔ not its markup. The rules are pure
 * functions exported from the component for exactly this reason: what the
 * public may see in a cell, how the time axis is ordered, and how a stage's
 * row aligns to it are decisions that must not change by accident. Rendering
 * is verified by driving the real interface, ⛔ never by a source-text test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchedule } from './scheduleModel.js';
import { portraitMode, timeAxis, timeKey, cellsForStage, publicCell } from './schedulePortrait.js';

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

const claim = (o = {}) => ({
  status: o.status ?? 'confirmed',
  name: o.name ?? 'MADSPiN BABY',
  profile_id: 'profile_id' in o ? o.profile_id : 'p1',
  profile: o.profile ?? { avatar_thumb: null },
});

// ── Which layout ─────────────────────────────────────────────────────────

test('single stage gets the timeline; multi stage gets the grid', () => {
  const one = resolveSchedule({ slots: [slot()] });
  assert.equal(portraitMode(one), 'timeline');

  const many = resolveSchedule({
    slots: [slot({ stage_id: 'a' }), slot({ stage_id: 'b' })],
    stages: [{ id: 'a', name: 'MAIN', position: 0 }, { id: 'b', name: 'SECOND', position: 1 }],
  });
  assert.equal(portraitMode(many), 'grid');
});

test('⛔ one NAMED stage still gets the timeline, not a one-column grid', () => {
  const r = resolveSchedule({
    slots: [slot({ stage_id: 'a' })],
    stages: [{ id: 'a', name: 'MAIN ROOM', position: 0 }],
  });
  assert.equal(portraitMode(r), 'timeline');
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

// ── ⛔⛔ WHAT THE PUBLIC MAY SEE ──────────────────────────────────────────

test('⛔⛔ a DRAFT placement is an OPEN slot to the public — the name never leaks', () => {
  const cell = publicCell({ slot: slot(), claim: claim({ status: 'draft', name: 'SECRET HEADLINER' }) });
  assert.equal(cell.kind, 'open');
  assert.equal(cell.claim, undefined, 'no claim on the cell means no name can reach the DOM');
});

test('⛔ an OFFERED act shows PENDING, ⛔ never its name — an offer is not an announcement', () => {
  const cell = publicCell({ slot: slot(), claim: claim({ status: 'offered', name: 'NOT YET' }) });
  assert.equal(cell.kind, 'pending');
  assert.equal(cell.claim, undefined);
});

test('a DECLINED placement reads as open, not as a person who said no', () => {
  assert.equal(publicCell({ slot: slot(), claim: claim({ status: 'declined' }) }).kind, 'open');
});

test('only a CONFIRMED act is named', () => {
  const cell = publicCell({ slot: slot(), claim: claim({ status: 'confirmed', name: 'ELBOW' }) });
  assert.equal(cell.kind, 'act');
  assert.equal(cell.claim.name, 'ELBOW');
});

test('an empty slot is open, and a missing entry is a GAP — ⛔ they are different', () => {
  assert.equal(publicCell({ slot: slot(), claim: null }).kind, 'open');
  assert.equal(publicCell(null).kind, 'gap');
});

// ── The production shape ─────────────────────────────────────────────────

test('⭐ Solstice Soirée resolves to a two-day single-stage timeline', () => {
  const sat = Array.from({ length: 8 }, (_, i) =>
    slot({ id: `sat_${i}`, day_index: 0, day_name: 'SATURDAY', position: i, time: `${i + 4}:00` }));
  const sun = Array.from({ length: 11 }, (_, i) =>
    slot({ id: `sun_${i}`, day_index: 1, day_name: 'SUNDAY', position: i, time: `${i + 10}:00` }));

  const r = resolveSchedule({
    slots: [...sat, ...sun],
    claims: { sat_0: claim({ name: 'SUNSET ACT' }) },
    eventDate: '2026-06-20',
  });

  assert.equal(portraitMode(r), 'timeline');
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].stages[0].slots.length, 8);
  assert.equal(r.days[1].stages[0].slots.length, 11);

  const first = publicCell(r.days[0].stages[0].slots[0]);
  assert.equal(first.kind, 'act');
  assert.equal(first.claim.name, 'SUNSET ACT');

  // Every other Saturday slot is unbooked and must read as open, not broken.
  const rest = r.days[0].stages[0].slots.slice(1).map(e => publicCell(e).kind);
  assert.ok(rest.every(k => k === 'open'), 'unbooked slots are open, ⛔ never absent');
});

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
  assert.equal(portraitMode(r), 'grid');

  const day = r.days[0];
  const axis = timeAxis(day);
  assert.equal(axis.length, 4, 'four time columns');

  // Every stage row is the same width as the axis — that is what keeps the
  // grid readable when a stage stops early or starts late.
  for (const st of day.stages) {
    assert.equal(cellsForStage(st, axis).length, 4);
  }
  const chill = cellsForStage(day.stages.find(x => x.name === 'CHILL ZONE'), axis);
  assert.deepEqual(chill.map(c => (c ? c.slot.id : null)), ['c0', null, 'c2', null]);
});
