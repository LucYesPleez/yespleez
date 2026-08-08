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
