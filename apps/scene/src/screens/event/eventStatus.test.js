import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveEventStatus, STATUS_LABEL } from './eventStatus.js';

const NOW = new Date('2026-08-01T14:00:00');

test('an upcoming event gets NO pill — the date already says it', () => {
  assert.equal(deriveEventStatus({ date: '2026-11-16' }, NOW), null);
});

test('a finished event is past', () => {
  assert.equal(deriveEventStatus({ date: '2026-07-30' }, NOW), 'past');
});

test('an event on today is on-now', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01' }, NOW), 'on-now');
});

test('a multi-day event is on-now on every one of its days', () => {
  const run = { date: '2026-07-31', endDate: '2026-08-03' };
  assert.equal(deriveEventStatus(run, NOW), 'on-now');
  assert.equal(deriveEventStatus(run, new Date('2026-08-03T23:00:00')), 'on-now');
  assert.equal(deriveEventStatus(run, new Date('2026-08-04T00:30:00')), 'past');
});

test('a multi-day event that has not started yet gets no pill', () => {
  assert.equal(deriveEventStatus({ date: '2026-09-01', endDate: '2026-09-03' }, NOW), null);
});

test('an event finishing later today is still on-now, not past', () => {
  // Date granularity is the point: a gig at 11pm must not read as PAST at 2pm.
  assert.equal(deriveEventStatus({ date: '2026-08-01' }, new Date('2026-08-01T02:00:00')), 'on-now');
  assert.equal(deriveEventStatus({ date: '2026-08-01' }, new Date('2026-08-01T23:59:00')), 'on-now');
});

test('no date means no pill, never a crash', () => {
  assert.equal(deriveEventStatus({}, NOW), null);
  assert.equal(deriveEventStatus(undefined, NOW), null);
  assert.equal(deriveEventStatus({ date: 'not-a-date' }, NOW), null);
});

test('⚠ publication state is NOT read — a published future event is not "on now"', () => {
  // `status: 'live'` means PUBLISHED in this codebase, and the old event screen
  // rendered it as "LIVE NOW". Passing it here must change nothing.
  assert.equal(deriveEventStatus({ date: '2026-11-16', status: 'live' }, NOW), null);
  assert.equal(deriveEventStatus({ date: '2026-07-30', status: 'draft' }, NOW), 'past');
});

test('⚠ every returned status has a label; null has none', () => {
  for (const s of ['past', 'on-now']) {
    assert.equal(typeof STATUS_LABEL[s], 'string', `${s} needs a label`);
    assert.ok(STATUS_LABEL[s].length, `${s}'s label must not be empty`);
  }
  assert.equal(STATUS_LABEL[null], undefined);
});

test('a timestamp date is read by its day, not its hour', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01T20:00:00+10:00' }, NOW), 'on-now');
});

/* ── THE HOUR BEFORE THE DOORS (owner, 2026-08-22) ──────────────────────────
 *
 * Pink STARTING SOON for the hour leading up to the start time, green ON NOW
 * from the start. ⛔ Only where a start time is actually known — the module's
 * founding rule is that an hour-accurate claim without one is a guess, and
 * most events have no time at all.
 */
const AT = h => new Date(`2026-08-01T${String(h).padStart(2, '0')}`);

test('inside the hour before the start, the pill says starting soon', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('18:45:00')), 'starting-soon');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('19:29:00')), 'starting-soon');
});

test('the window OPENS at exactly one hour out, and not a minute before', () => {
  // "1 hour leading up til the actual start time" — the hour includes its own
  // first instant, so T-60:00 is inside it and T-60:01 is not.
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('18:30:00')), 'starting-soon');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('18:29:00')), null);
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('12:00:00')), null);
});

test('from the start time it turns on-now, and stays on-now all night', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('19:30:00')), 'on-now');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '7:30pm' }, AT('23:59:00')), 'on-now');
});

test('⛔ an event with NO time keeps the old behaviour and never says starting soon', () => {
  // Times exist on well under half of events. Without one, nobody knows when
  // "soon" is, so the day-granular ON NOW is the honest answer.
  assert.equal(deriveEventStatus({ date: '2026-08-01' }, AT('09:00:00')), 'on-now');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '' }, AT('09:00:00')), 'on-now');
});

test('⛔ an unreadable time falls back rather than guessing', () => {
  // "7:30" with no meridiem is ambiguous; reading it as 07:30 would put
  // STARTING SOON on the page twelve hours early.
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: 'doors at eight' }, AT('09:00:00')), 'on-now');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '25:00' }, AT('09:00:00')), 'on-now');
});

test('⚠ the window is the FIRST day only — a festival is not "starting soon" on its Sunday', () => {
  const run = { date: '2026-07-31', endDate: '2026-08-03', startTime: '7:30pm' };
  assert.equal(deriveEventStatus(run, AT('18:45:00')), 'on-now', 'it started yesterday');
});

test('a past event is past whatever its start time says', () => {
  assert.equal(deriveEventStatus({ date: '2026-07-30', startTime: '7:30pm' }, AT('18:45:00')), 'past');
});

test('midnight and midday are read correctly', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '12:00am' }, AT('00:30:00')), 'on-now');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '12:00pm' }, AT('11:30:00')), 'starting-soon');
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '12:00pm' }, AT('12:30:00')), 'on-now');
});

test('24-hour times work too, since the importer writes both shapes', () => {
  assert.equal(deriveEventStatus({ date: '2026-08-01', startTime: '19:30' }, AT('18:45:00')), 'starting-soon');
});

test('every status has a label', () => {
  for (const k of ['past', 'on-now', 'starting-soon']) {
    assert.ok(STATUS_LABEL[k], `${k} needs a label or the pill renders empty`);
  }
  assert.equal(STATUS_LABEL['starting-soon'], 'STARTING SOON');
});
