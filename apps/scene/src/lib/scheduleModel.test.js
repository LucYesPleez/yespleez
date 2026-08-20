/**
 * The schedule resolver — S3.
 *
 * ⭐ These tests are the specification of the canonical model in code. Each one
 * names a rule from the S2 decision note rather than a function's behaviour, so
 * a future change that breaks the ARCHITECTURE fails here loudly, not just a
 * change that breaks the implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchedule, scheduleShape, dayDate, INLINE_SLOT_MAX } from './scheduleModel.js';

const slot = (o = {}) => ({
  id: o.id || 'u-' + (o.position ?? 0) + '-' + (o.day_index ?? 0),
  event_id: 'e1',
  day_index: o.day_index ?? 0,
  day_name: o.day_name ?? 'SATURDAY',
  position: o.position ?? 0,
  legacy_key: o.legacy_key ?? null,
  time: o.time ?? '7:00',
  ampm: o.ampm ?? 'PM',
  dur_mins: o.dur_mins ?? 60,
  label: o.label ?? '',
  label_color: null,
  pinned: false,
  stage_id: 'stage_id' in o ? o.stage_id : null,
});

const stage = (id, name, position, accent = null) => ({ id, name, position, accent });

// ── The single-stage majority ────────────────────────────────────────────

test('no stages means ONE implicit stage, and it renders no identity', () => {
  const r = resolveSchedule({ slots: [slot({ position: 0 }), slot({ position: 1 })] });
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].stages.length, 1);
  const only = r.days[0].stages[0];
  assert.equal(only.id, null);
  assert.equal(only.implicit, true);
  assert.equal(only.name, '');
  assert.equal(only.slots.length, 2);
  assert.equal(r.isMultiStage, false);
  assert.equal(r.stageCount, 0);
});

test('⛔ ONE NAMED STAGE IS STILL SINGLE-STAGE — naming your room earns no festival chrome', () => {
  const r = resolveSchedule({
    slots: [slot({ stage_id: 's1' })],
    stages: [stage('s1', 'MAIN', 0)],
  });
  assert.equal(r.stageCount, 1);
  assert.equal(r.isMultiStage, false);
  assert.equal(scheduleShape(r).showStages, false);
});

// ── Ordering ─────────────────────────────────────────────────────────────

test('⚠ slots order by POSITION, not by the order the query returned them', () => {
  const r = resolveSchedule({
    slots: [slot({ position: 2, time: '9:00' }), slot({ position: 0, time: '7:00' }), slot({ position: 1, time: '8:00' })],
  });
  assert.deepEqual(r.days[0].stages[0].slots.map(s => s.slot.time), ['7:00', '8:00', '9:00']);
});

test('stages order by position, name only breaks a tie', () => {
  const r = resolveSchedule({
    slots: [slot({ stage_id: 'a' }), slot({ stage_id: 'b' }), slot({ stage_id: 'c' })],
    stages: [stage('c', 'CHILL', 2), stage('a', 'MAIN', 0), stage('b', 'SECOND', 1)],
  });
  assert.deepEqual(r.days[0].stages.map(s => s.name), ['MAIN', 'SECOND', 'CHILL']);
});

test('⛔ days are NOT renumbered to close gaps — the index is identity', () => {
  const r = resolveSchedule({
    slots: [slot({ day_index: 0 }), slot({ day_index: 2, day_name: 'MONDAY' })],
  });
  assert.deepEqual(r.days.map(d => d.dayIndex), [0, 2]);
  assert.equal(r.isMultiDay, true);
});

// ── The invalid state, rendered rather than dropped ──────────────────────

test('⚠⚠ a NULL-stage slot on a staged event is KEPT, bucketed first, and COUNTED', () => {
  const r = resolveSchedule({
    slots: [slot({ id: 'x', stage_id: null }), slot({ id: 'y', stage_id: 's1' })],
    stages: [stage('s1', 'MAIN', 0)],
  });
  const ids = r.days[0].stages.flatMap(s => s.slots.map(e => e.slot.id));
  assert.ok(ids.includes('x'), 'the orphan must not vanish from the schedule');
  assert.equal(r.unstagedOnStagedEvent, 1);
});

test('a slot pointing at a stage we were not given is also kept and counted', () => {
  const r = resolveSchedule({
    slots: [slot({ id: 'ghost', stage_id: 'deleted-stage' })],
    stages: [stage('s1', 'MAIN', 0)],
  });
  assert.equal(r.days[0].stages[0].slots.length, 1);
  assert.equal(r.unstagedOnStagedEvent, 1);
});

// ── Occupancy ────────────────────────────────────────────────────────────

test('claims attach by slot uuid, and an empty slot is null rather than absent', () => {
  const s1 = slot({ id: 'u1', position: 0 });
  const s2 = slot({ id: 'u2', position: 1 });
  const r = resolveSchedule({ slots: [s1, s2], claims: { u1: { name: 'MADSPiN BABY' } } });
  const [a, b] = r.days[0].stages[0].slots;
  assert.equal(a.claim.name, 'MADSPiN BABY');
  assert.equal(b.claim, null, 'an open slot is a slot with no claim, not a missing entry');
});

// ── Dates are derived, and derived LOCALLY ───────────────────────────────

test('⛔ day N is the event date plus N, in LOCAL time (never a UTC slice)', () => {
  assert.equal(dayDate('2026-06-20', 0), '2026-06-20');
  assert.equal(dayDate('2026-06-20', 1), '2026-06-21');
  // Across a month boundary, and across the DST changeover Sydney has in April.
  assert.equal(dayDate('2026-06-30', 1), '2026-07-01');
  assert.equal(dayDate('2026-04-04', 1), '2026-04-05');
});

test('an unparseable event date yields null rather than a guess', () => {
  assert.equal(dayDate('not a date', 0), null);
  assert.equal(dayDate(null, 0), null);
  assert.equal(dayDate(undefined, 1), null);
  const r = resolveSchedule({ slots: [slot()], eventDate: 'garbage' });
  assert.equal(r.days[0].date, null, 'a day with no resolvable date still renders');
});

// ── Absence ──────────────────────────────────────────────────────────────

test('no slots is an empty schedule, ⛔ not a broken one', () => {
  const r = resolveSchedule({});
  assert.deepEqual(r.days, []);
  assert.equal(r.slotCount, 0);
  assert.equal(scheduleShape(r).hasSchedule, false);
});

test('null and undefined rows are survived, not thrown on', () => {
  const r = resolveSchedule({ slots: [null, slot(), undefined] });
  assert.equal(r.slotCount, 1);
});

// ── The projection decision ──────────────────────────────────────────────

test('⭐ a short single-stage schedule embeds inline; a long one does not', () => {
  const short = resolveSchedule({ slots: Array.from({ length: INLINE_SLOT_MAX }, (_, i) => slot({ position: i })) });
  assert.equal(scheduleShape(short).embedInline, true);

  const long = resolveSchedule({ slots: Array.from({ length: INLINE_SLOT_MAX + 1 }, (_, i) => slot({ position: i })) });
  assert.equal(scheduleShape(long).embedInline, false, 'past the threshold it earns the full view');
});

test('⛔ a multi-stage schedule NEVER embeds inline, however short', () => {
  const r = resolveSchedule({
    slots: [slot({ stage_id: 'a' }), slot({ stage_id: 'b' })],
    stages: [stage('a', 'MAIN', 0), stage('b', 'SECOND', 1)],
  });
  assert.equal(r.isMultiStage, true);
  assert.equal(scheduleShape(r).embedInline, false);
});

test('the day picker appears exactly when there is more than one day', () => {
  const one = resolveSchedule({ slots: [slot({ day_index: 0 })] });
  assert.equal(scheduleShape(one).showDayPicker, false);
  const two = resolveSchedule({ slots: [slot({ day_index: 0 }), slot({ day_index: 1 })] });
  assert.equal(scheduleShape(two).showDayPicker, true);
});

// ── The real production shape ────────────────────────────────────────────

test('⭐ Solstice Soirée: 19 slots, 2 days, single-stage, multi-day, not inline', () => {
  const sat = Array.from({ length: 8 }, (_, i) => slot({ day_index: 0, day_name: 'SATURDAY', position: i }));
  const sun = Array.from({ length: 11 }, (_, i) => slot({ day_index: 1, day_name: 'SUNDAY', position: i }));
  const r = resolveSchedule({ slots: [...sun, ...sat], eventDate: '2026-06-20' });

  assert.equal(r.slotCount, 19);
  assert.deepEqual(r.days.map(d => d.name), ['SATURDAY', 'SUNDAY']);
  assert.deepEqual(r.days.map(d => d.date), ['2026-06-20', '2026-06-21']);
  assert.equal(r.days[0].stages.length, 1);
  assert.equal(r.days[0].stages[0].implicit, true);
  assert.equal(r.isMultiStage, false);
  assert.equal(r.isMultiDay, true);

  const shape = scheduleShape(r);
  assert.equal(shape.hasSchedule, true);
  assert.equal(shape.showStages, false);
  assert.equal(shape.showDayPicker, true);
  assert.equal(shape.embedInline, false);
});

test('⭐ the festival shape: 3 stages × 2 days keeps every stage on every day', () => {
  const stages = [stage('m', 'MAIN STAGE', 0), stage('s', 'SECOND STAGE', 1), stage('c', 'CHILL ZONE', 2)];
  const slots = [];
  for (const day of [0, 1]) {
    for (const [i, st] of ['m', 's', 'c'].entries()) {
      slots.push(slot({ id: `d${day}-${st}`, day_index: day, stage_id: st, position: i }));
    }
  }
  const r = resolveSchedule({ slots, stages, eventDate: '2026-09-04' });
  assert.equal(r.isMultiStage, true);
  assert.equal(r.days.length, 2);
  for (const d of r.days) {
    assert.deepEqual(d.stages.map(s => s.name), ['MAIN STAGE', 'SECOND STAGE', 'CHILL ZONE']);
    assert.ok(d.stages.every(s => s.slots.length === 1));
  }
  assert.deepEqual(r.days.map(d => d.date), ['2026-09-04', '2026-09-05']);
});

test('⚠ a stage with nothing on a given day still appears, as an empty column', () => {
  const r = resolveSchedule({
    slots: [slot({ day_index: 0, stage_id: 'm' })],
    stages: [stage('m', 'MAIN', 0), stage('s', 'SECOND', 1)],
  });
  const second = r.days[0].stages.find(s => s.name === 'SECOND');
  assert.ok(second, 'the column must exist so the grid stays aligned');
  assert.deepEqual(second.slots, [], 'empty, ⛔ not absent');
});
