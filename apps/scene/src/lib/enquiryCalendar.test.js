import { test } from 'node:test';
import assert from 'node:assert/strict';

import { datesCovered, indexByDate, buildMarkers, summariseDate, statusesPresent, dotColour } from './enquiryCalendar.js';
import { STATUS_TAB_COLOR } from './enquiryUtils.js';

/**
 * THE CALENDAR'S ONE HARD RULE: a booking belongs to every day it covers.
 *
 * The failure this guards is silent and expensive — a three-day event marked
 * only on its first day leaves the middle days looking free, and the organiser
 * double-books an act who is already committed. It is invisible in the list
 * view, which only ever shows one date per row.
 */

test('⚠ a multi-day booking marks EVERY day, not just the first', () => {
  const days = datesCovered({ date_requested: '2026-08-20', date_requested_end: '2026-08-22' });
  assert.deepEqual(days, ['2026-08-20', '2026-08-21', '2026-08-22']);
  assert.ok(days.includes('2026-08-21'), 'the middle day is the one that gets lost');
});

test('a single-day booking is one day', () => {
  assert.deepEqual(datesCovered({ date_requested: '2026-10-03' }), ['2026-10-03']);
});

test('⚠ an absent end date means ONE day, not an open range', () => {
  // venue_enquiries has a single `date_requested` column and cannot express a
  // range. Reading the absence as "ongoing" would smear every such enquiry
  // across the whole month.
  assert.deepEqual(datesCovered({ date_requested: '2026-10-03', date_requested_end: null }), ['2026-10-03']);
  assert.deepEqual(datesCovered({ date_requested: '2026-10-03', date_requested_end: '' }), ['2026-10-03']);
});

test('an end BEFORE the start collapses to the start rather than returning nothing', () => {
  // Bad data must still put the booking somewhere visible. Silently dropping it
  // means an application that exists nowhere on the calendar.
  assert.deepEqual(datesCovered({ date_requested: '2026-08-20', date_requested_end: '2026-08-18' }), ['2026-08-20']);
});

test('⚠ dates do not drift a day west of Greenwich', () => {
  // `new Date('2026-08-20')` parses as UTC midnight and renders as the 19th in
  // any timezone behind it. The range is built at noon so no offset can move it.
  const days = datesCovered({ date_requested: '2026-08-20', date_requested_end: '2026-08-21' });
  assert.equal(days[0], '2026-08-20', 'the first day must be the day that was asked for');
  assert.equal(days[1], '2026-08-21');
});

test('a month boundary is crossed correctly', () => {
  assert.deepEqual(
    datesCovered({ date_requested: '2026-08-30', date_requested_end: '2026-09-02' }),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'],
  );
});

test('a leap day is not skipped', () => {
  assert.deepEqual(
    datesCovered({ date_requested: '2028-02-28', date_requested_end: '2028-03-01' }),
    ['2028-02-28', '2028-02-29', '2028-03-01'],
  );
});

test('⛔ a runaway range is capped rather than looping forever', () => {
  const days = datesCovered({ date_requested: '2026-01-01', date_requested_end: '2099-01-01' }, 60);
  assert.equal(days.length, 60);
});

test('an enquiry with no date contributes nothing', () => {
  assert.deepEqual(datesCovered({}), []);
  assert.deepEqual(datesCovered(null), []);
  assert.deepEqual(datesCovered({ date_requested: null }), []);
});

test('the legacy `preferred_date` spelling is still read', () => {
  assert.deepEqual(datesCovered({ preferred_date: '2026-08-20' }), ['2026-08-20']);
});

/* ── grouping ─────────────────────────────────────────────────────── */

test('⚠ one multi-day enquiry appears under each of its dates', () => {
  const enq = { id: 1, date_requested: '2026-08-20', date_requested_end: '2026-08-22' };
  const map = indexByDate([enq]);

  assert.deepEqual(Object.keys(map).sort(), ['2026-08-20', '2026-08-21', '2026-08-22']);
  for (const ds of Object.keys(map)) {
    assert.equal(map[ds].length, 1);
    assert.equal(map[ds][0].id, 1, 'the SAME record, counted once per day it covers');
  }
});

test('several enquiries on one date stack up, which is what makes multiple dots', () => {
  const map = indexByDate([
    { id: 1, date_requested: '2026-08-20' },
    { id: 2, date_requested: '2026-08-20' },
    { id: 3, date_requested: '2026-08-21' },
  ]);
  assert.equal(map['2026-08-20'].length, 2);
  assert.equal(map['2026-08-21'].length, 1);
});

test('overlapping ranges accumulate on the shared day', () => {
  const map = indexByDate([
    { id: 1, date_requested: '2026-08-20', date_requested_end: '2026-08-21' },
    { id: 2, date_requested: '2026-08-21', date_requested_end: '2026-08-22' },
  ]);
  assert.equal(map['2026-08-20'].length, 1);
  assert.equal(map['2026-08-21'].length, 2, 'both bookings are live on the 21st');
  assert.equal(map['2026-08-22'].length, 1);
});

test('undated enquiries never reach the calendar', () => {
  const map = indexByDate([{ id: 1 }, { id: 2, date_requested: '2026-08-20' }]);
  assert.deepEqual(Object.keys(map), ['2026-08-20']);
});

test('an empty or missing list is survivable', () => {
  assert.deepEqual(indexByDate([]), {});
  assert.deepEqual(indexByDate(undefined), {});
});

/* ── THE PRIVATE OVERLAY ──────────────────────────────────────────────
   Available Dates and Enquiries both build their dots from these, so the two
   entry points cannot disagree about what is on a date. That is the whole
   point: an owner must never mark a date free while the calendar quietly
   withholds that two acts have applied for it. */

test('⚠ every private entry point derives the SAME dots from the same rows', () => {
  // Not a tautology — it pins the contract that both callers use ONE
  // projection. The bug it guards is a second copy drifting, which is exactly
  // how the enquiry status colours ended up disagreeing with the tabs.
  const rows = [
    { id: 1, date_requested: '2026-08-14', status: 'pending' },
    { id: 2, date_requested: '2026-08-14', status: 'tentative' },
  ];
  assert.deepEqual(buildMarkers(rows), buildMarkers([...rows]));
  assert.equal(buildMarkers(rows)['2026-08-14'].length, 2, 'two applications, two dots');
});

test('⚠ dot colours come from the tab map, never a private palette', () => {
  // A separate calendar palette would let a date read green here and cyan in
  // the list for the same status.
  assert.equal(dotColour('accepted'), STATUS_TAB_COLOR.ACCEPTED);
  assert.equal(dotColour('shortlisted'), STATUS_TAB_COLOR.SHORTLISTED);
  assert.equal(dotColour('seen'), STATUS_TAB_COLOR.SEEN);
});

test('an unrecognised status still gets a dot rather than vanishing', () => {
  // ⛔ A row the colour map has never heard of must still mark its date. A
  // missing dot reads as "nothing is happening", which is the one thing the
  // owner must never be told wrongly.
  assert.equal(dotColour('some-future-status'), 'var(--muted)');
  assert.equal(buildMarkers([{ id: 1, date_requested: '2026-08-14', status: 'zzz' }])['2026-08-14'].length, 1);
});

test('⚠ a multi-day booking puts a dot on every day it covers', () => {
  const m = buildMarkers([{ id: 1, date_requested: '2026-08-20', date_requested_end: '2026-08-22', status: 'accepted' }]);
  assert.deepEqual(Object.keys(m).sort(), ['2026-08-20', '2026-08-21', '2026-08-22']);
  for (const ds of Object.keys(m)) assert.equal(m[ds].length, 1);
});

test('the date summary counts and orders by status', () => {
  const sum = summariseDate([
    { id: 1, status: 'pending' },
    { id: 2, status: 'pending' },
    { id: 3, status: 'tentative' },
  ]);
  assert.equal(sum.total, 3);
  // `new` before `shortlisted` — the canonical order, not arrival order.
  assert.deepEqual(sum.breakdown.map(b => b.status), ['new', 'shortlisted']);
  assert.equal(sum.breakdown[0].count, 2);
});

test('an empty day summarises to nothing rather than throwing', () => {
  assert.deepEqual(summariseDate([]), { total: 0, breakdown: [] });
  assert.deepEqual(summariseDate(undefined), { total: 0, breakdown: [] });
});

test('⚠ the key lists only statuses actually present', () => {
  // A fixed key would explain colours that are not on screen and imply
  // activity that does not exist.
  const byDate = indexByDate([
    { id: 1, date_requested: '2026-08-14', status: 'pending' },
    { id: 2, date_requested: '2026-08-20', status: 'accepted' },
  ]);
  assert.deepEqual(statusesPresent(byDate), ['new', 'accepted']);
  assert.deepEqual(statusesPresent({}), []);
});
