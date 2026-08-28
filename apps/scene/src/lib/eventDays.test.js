/**
 * ⭐⭐ THE REGRESSION THESE GUARD: a Fri–Sun festival was listed on Friday and
 * VANISHED on Saturday, because What's On matched `config.date` — the start
 * date — in every lane. Organisers then created one event per day to stay
 * visible. Every test below is a day on which a real running event must still
 * be findable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSpan, eventRunsOn, eventRunsOnAny, isMultiDay, eventDates, MAX_SPAN_DAYS } from './eventDays.js';

const ev = (date, endDate) => ({ config: { ...(date ? { date } : {}), ...(endDate ? { endDate } : {}) } });

test('a single-day event runs on its own day and no other', () => {
  const e = ev('2026-08-28');
  assert.equal(eventRunsOn(e, '2026-08-28'), true);
  assert.equal(eventRunsOn(e, '2026-08-27'), false);
  assert.equal(eventRunsOn(e, '2026-08-29'), false);
  assert.equal(isMultiDay(e), false);
});

test('⭐⭐ A FRI–SUN FESTIVAL IS ON, ON THE SATURDAY — the whole point', () => {
  const neverland = ev('2026-08-28', '2026-08-30');
  assert.equal(eventRunsOn(neverland, '2026-08-28'), true);
  assert.equal(eventRunsOn(neverland, '2026-08-29'), true, 'Saturday — this is the day it used to disappear');
  assert.equal(eventRunsOn(neverland, '2026-08-30'), true, 'the last day is INCLUSIVE');
  assert.equal(isMultiDay(neverland), true);
});

test('the day before and the day after are not the event', () => {
  const e = ev('2026-08-28', '2026-08-30');
  assert.equal(eventRunsOn(e, '2026-08-27'), false);
  assert.equal(eventRunsOn(e, '2026-08-31'), false);
});

test('⚠ a BACKWARDS endDate is ignored, not obeyed — the event keeps its own day', () => {
  // A hand-edited row. Honouring it would make runsOn false for EVERY date,
  // including the start, so the event would vanish entirely.
  const e = ev('2026-08-28', '2026-08-20');
  assert.deepEqual(eventSpan(e), { start: '2026-08-28', end: '2026-08-28' });
  assert.equal(eventRunsOn(e, '2026-08-28'), true);
  assert.equal(isMultiDay(e), false);
});

test('an event with no date at all occupies nothing and never matches', () => {
  assert.equal(eventSpan(ev(null)), null);
  assert.equal(eventRunsOn(ev(null), '2026-08-28'), false);
  assert.equal(eventRunsOnAny(ev(null), new Set(['2026-08-28'])), false);
  assert.deepEqual(eventDates(ev(null)), []);
});

test('a full ISO timestamp in config.date is trimmed to its day', () => {
  const e = ev('2026-08-28T09:00:00+10:00', '2026-08-30T23:00:00+10:00');
  assert.deepEqual(eventSpan(e), { start: '2026-08-28', end: '2026-08-30' });
});

test('runsOnAny matches a weekend set the event only PARTLY overlaps', () => {
  // Thu-to-Fri: the weekend set is Fri/Sat/Sun, and Friday alone must match.
  const e = ev('2026-08-27', '2026-08-28');
  const weekend = new Set(['2026-08-28', '2026-08-29', '2026-08-30']);
  assert.equal(eventRunsOnAny(e, weekend), true);
});

test('runsOnAny is false when the event sits entirely between the dates asked about', () => {
  const e = ev('2026-08-26', '2026-08-27');
  assert.equal(eventRunsOnAny(e, new Set(['2026-08-28', '2026-08-30'])), false);
  assert.equal(eventRunsOnAny(e, new Set()), false);
});

test('eventDates lists every day the event occupies, in order', () => {
  assert.deepEqual(eventDates(ev('2026-08-28', '2026-08-30')),
    ['2026-08-28', '2026-08-29', '2026-08-30']);
  assert.deepEqual(eventDates(ev('2026-08-28')), ['2026-08-28']);
});

test('⚠ eventDates crosses a month boundary correctly', () => {
  assert.deepEqual(eventDates(ev('2026-08-30', '2026-09-01')),
    ['2026-08-30', '2026-08-31', '2026-09-01']);
});

test('⚠ eventDates crosses the AU DST boundary without dropping or doubling a day', () => {
  // AEDT starts on the first Sunday of October. A midnight anchor loses a day
  // here; the noon anchor this module uses does not.
  assert.deepEqual(eventDates(ev('2026-10-03', '2026-10-05')),
    ['2026-10-03', '2026-10-04', '2026-10-05']);
});

test('⛔ a runaway endDate is CAPPED rather than expanded into thousands of days', () => {
  const decade = eventDates(ev('2026-08-28', '2036-08-28'));
  assert.equal(decade.length, MAX_SPAN_DAYS);
  // Capping the LIST must not narrow the PREDICATE — the row is still wrong,
  // but it is not this module's job to hide it from a date inside the range.
  assert.equal(eventRunsOn(ev('2026-08-28', '2036-08-28'), '2030-01-01'), true);
});

/* ── ⭐⭐ THE LIST'S OWN RANGE FILTER ────────────────────────────────────
   ⚠⚠ `useEvents` compared `config.date` — the START day — against `fromDate`,
   so Neverland Weekender (28–30 Aug) was dropped at midnight on the 29th,
   BEFORE any eventRunsOn filter downstream could see it. TONIGHT and SUNDAY
   were empty of it while the featured carousel still carried it. A list cannot
   show what its source has already discarded. */

const inWindow = (ev, from, to) => {
  const span = eventSpan(ev);
  if (!span) return false;
  if (from && span.end < from) return false;
  if (to && span.start > to) return false;
  return true;
};

const FEST = { config: { date: '2026-08-28', endDate: '2026-08-30' } };
const ONE_NIGHT = { config: { date: '2026-08-28' } };

test('a running festival survives a window that opens after it started', () => {
  // The Saturday and the Sunday of a Fri–Sun festival.
  assert.equal(inWindow(FEST, '2026-08-29', '2026-12-31'), true);
  assert.equal(inWindow(FEST, '2026-08-30', '2026-12-31'), true);
});

test('⛔ it drops the day after it actually ends, not the day after it starts', () => {
  assert.equal(inWindow(FEST, '2026-08-31', '2026-12-31'), false);
});

test('a one-night gig is unchanged', () => {
  assert.equal(inWindow(ONE_NIGHT, '2026-08-28', '2026-12-31'), true);
  assert.equal(inWindow(ONE_NIGHT, '2026-08-29', '2026-12-31'), false);
});

test('an event beginning after the window shuts is excluded', () => {
  assert.equal(inWindow(FEST, '2026-01-01', '2026-08-27'), false);
  assert.equal(inWindow(FEST, '2026-01-01', '2026-08-28'), true);
});
