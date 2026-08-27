/**
 * ⭐⭐ ONE REAL EVENT = ONE CONTINUOUS EVENT. The date range and the running
 * order describe the same thing and must agree.
 *
 * The production row these guard: Neverland Weekender, `endDate` 28→30 August
 * (three days) holding two days of slots, saved with nothing objecting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spanDays, dayDate, dayDateLabel, dayRangeCheck, reconcileDays } from './eventEditorModel.js';

const daysOf = n => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: '', slots: [] }));

test('no end date is a ONE day event, never a zero-day one', () => {
  assert.equal(spanDays('2026-08-28', ''), 1);
  assert.equal(spanDays('2026-08-28', null), 1);
  assert.equal(spanDays('2026-08-28', '2026-08-28'), 1);
});

test('⭐⭐ Fri→Sun is THREE days, not two', () => {
  assert.equal(spanDays('2026-08-28', '2026-08-30'), 3);
});

test('⚠ a BACKWARDS end date is ignored, not obeyed', () => {
  // Obeying it would give a span of 0 or less and empty the running order.
  assert.equal(spanDays('2026-08-28', '2026-08-20'), 1);
});

test('with no start date at all the span is still 1', () => {
  assert.equal(spanDays('', '2026-08-30'), 1);
});

test('⚠ a span crossing the AU DST boundary counts every day exactly once', () => {
  // AEDT begins on the first Sunday of October; a midnight anchor loses a day.
  assert.equal(spanDays('2026-10-03', '2026-10-05'), 3);
});

test('a span crossing a month and a year boundary', () => {
  assert.equal(spanDays('2026-08-30', '2026-09-01'), 3);
  assert.equal(spanDays('2026-12-31', '2027-01-02'), 3);
});

test('dayDate gives each day its real calendar date', () => {
  assert.equal(dayDate('2026-08-28', 0), '2026-08-28');
  assert.equal(dayDate('2026-08-28', 1), '2026-08-29');
  assert.equal(dayDate('2026-08-28', 2), '2026-08-30');
  assert.equal(dayDate('2026-08-30', 2), '2026-09-01', 'crosses the month');
  assert.equal(dayDate('', 0), '');
});

test('⭐ a day card can name its own date, so DAY 2 stops being a guess', () => {
  assert.equal(dayDateLabel('2026-08-28', 0), 'FRI 28 AUG');
  assert.equal(dayDateLabel('2026-08-28', 2), 'SUN 30 AUG');
  assert.equal(dayDateLabel('', 0), '');
});

test('⭐⭐ THE NEVERLAND CASE: a 3-day range holding 2 days is a MISMATCH', () => {
  const c = dayRangeCheck(daysOf(2), '2026-08-28', '2026-08-30');
  assert.equal(c.span, 3);
  assert.equal(c.dayCount, 2);
  assert.equal(c.missing, 1);
  assert.equal(c.surplus, 0);
  assert.equal(c.matches, false);
});

test('a matching range and running order reports no work to do', () => {
  const c = dayRangeCheck(daysOf(3), '2026-08-28', '2026-08-30');
  assert.equal(c.matches, true);
  assert.equal(c.missing, 0);
  assert.equal(c.surplus, 0);
});

test('more days than the range reports SURPLUS — the shrunk-range case', () => {
  const c = dayRangeCheck(daysOf(3), '2026-08-28', '2026-08-29');
  assert.equal(c.span, 2);
  assert.equal(c.surplus, 1);
  assert.equal(c.missing, 0);
});

test('reconcileDays fills the gap and leaves existing days untouched', () => {
  const existing = [{ id: 'a', name: 'The Jazz Doof', slots: [{ id: 's1' }] }];
  const out = reconcileDays(existing, '2026-08-28', '2026-08-30');
  assert.equal(out.length, 3);
  assert.equal(out[0], existing[0], 'the existing day is the SAME object, not a copy');
  assert.equal(out[0].name, 'The Jazz Doof');
  assert.equal(out[0].slots.length, 1);
  assert.deepEqual(out[1].slots, []);
  assert.equal(typeof out[1].id, 'string');
  assert.notEqual(out[1].id, out[2].id, 'each added day gets its own id');
});

test('⛔⛔ reconcileDays NEVER DELETES — a shrunk range keeps every day and its slots', () => {
  // A day can hold a BOOKED artist. Dropping one silently would unbook a real
  // person. Surplus is reported by dayRangeCheck and the organiser decides.
  const booked = [
    { id: 'a', name: '', slots: [{ id: 's1' }] },
    { id: 'b', name: '', slots: [{ id: 's2' }] },
    { id: 'c', name: '', slots: [{ id: 's3' }] },
  ];
  const out = reconcileDays(booked, '2026-08-28', '2026-08-28');
  assert.equal(out.length, 3);
  assert.deepEqual(out, booked);
});

test('reconcileDays returns the same array when nothing needs adding', () => {
  const three = daysOf(3);
  assert.equal(reconcileDays(three, '2026-08-28', '2026-08-30'), three);
});

test('an empty running order with a 3-day range grows to three', () => {
  assert.equal(reconcileDays([], '2026-08-28', '2026-08-30').length, 3);
});
