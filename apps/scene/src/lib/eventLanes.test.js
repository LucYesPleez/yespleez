/**
 * WHICH DATE SECTIONS AN EVENT BELONGS IN.
 *
 * ⭐⭐ THE RULE UNDER TEST: a dated section asks "does this event run on this
 * date", ⛔ never "has it already appeared above". The old precedence struck a
 * running festival out of every later section, so on the Saturday of
 * Neverland's Fri–Sun run it sat in TONIGHT and was missing from SUNDAY — a day
 * it is playing.
 *
 * ⚠ These are the OWNER'S OWN CASES, 2026-08-29, written out one per test so a
 * failure names which one broke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runsToday, runsOnDatesAhead, runsBeyond, lastCoveredDate } from './eventLanes.js';

/* Neverland Weekender's real configuration. */
const NEVERLAND = { config: { date: '2026-08-28', endDate: '2026-08-30' } };
const FRIDAY_ONLY = { config: { date: '2026-08-28' } };
const SAT_TO_WED  = { config: { date: '2026-08-29', endDate: '2026-09-02' } };

const FRI = '2026-08-28', SAT = '2026-08-29', SUN = '2026-08-30', MON = '2026-08-31';

test('Neverland runs on each of its three configured days', () => {
  assert.equal(runsToday(NEVERLAND, FRI), true, 'Friday');
  assert.equal(runsToday(NEVERLAND, SAT), true, 'Saturday');
  assert.equal(runsToday(NEVERLAND, SUN), true, 'Sunday');
});

test('⛔ and on no other day', () => {
  assert.equal(runsToday(NEVERLAND, '2026-08-27'), false, 'the Thursday before');
  assert.equal(runsToday(NEVERLAND, MON), false, 'the Monday after');
});

test('⭐⭐ on Saturday it appears in TONIGHT *and* in the Sunday section', () => {
  // The exact case that was broken. Both must be true at once.
  assert.equal(runsToday(NEVERLAND, SAT), true, 'TONIGHT');
  assert.equal(runsOnDatesAhead(NEVERLAND, new Set([SUN])), true, 'SUNDAY');
});

test('⭐ on Friday it appears in TONIGHT and in the weekend section ahead', () => {
  assert.equal(runsToday(NEVERLAND, FRI), true);
  assert.equal(runsOnDatesAhead(NEVERLAND, new Set([SAT, SUN])), true);
});

test('⛔ a Friday-only event does not appear on Saturday or Sunday', () => {
  assert.equal(runsToday(FRIDAY_ONLY, SAT), false);
  assert.equal(runsToday(FRIDAY_ONLY, SUN), false);
  assert.equal(runsOnDatesAhead(FRIDAY_ONLY, new Set([SAT, SUN])), false);
});

test('a single-day event appears only on its own date', () => {
  assert.equal(runsToday(FRIDAY_ONLY, FRI), true);
  assert.equal(runsToday(FRIDAY_ONLY, '2026-08-27'), false);
});

test('an event spanning today and future dates appears in today AND each future section', () => {
  // Saturday to Wednesday, read on the Saturday.
  assert.equal(runsToday(SAT_TO_WED, SAT), true, 'TONIGHT');
  assert.equal(runsOnDatesAhead(SAT_TO_WED, new Set([SUN])), true, 'SUNDAY');
  assert.equal(runsBeyond(SAT_TO_WED, SUN), true, 'COMING UP — it runs past the weekend');
});

test('⛔ COMING UP does not repeat an event with no day left beyond the sections above', () => {
  // Neverland ends on the Sunday, which the weekend section already covers.
  assert.equal(runsBeyond(NEVERLAND, SUN), false);
});

test('lastCoveredDate is the furthest day the dated sections reach', () => {
  assert.equal(lastCoveredDate(SAT, new Set([SUN])), SUN);
  assert.equal(lastCoveredDate(SAT, new Set()), SAT, 'no weekend days ahead — today is the edge');
  assert.equal(lastCoveredDate(SUN, new Set([SAT])), SUN, 'a past date never extends the edge');
});

test('⚠ dates compare as strings, and the comparison must survive a month roll', () => {
  const acrossMonths = { config: { date: '2026-08-31', endDate: '2026-09-02' } };
  assert.equal(runsToday(acrossMonths, '2026-09-01'), true);
  assert.equal(runsBeyond(acrossMonths, '2026-08-31'), true);
  assert.equal(runsBeyond(acrossMonths, '2026-09-02'), false);
});

test('⛔ nothing here creates or splits an event record', () => {
  // The predicates are read-only over one row. A festival is ONE event with a
  // multi-day span — the duplication the old precedence guarded against was
  // organisers making one event PER DAY, which is a different thing entirely
  // and is still prevented by the model, not by hiding cards.
  const before = JSON.stringify(NEVERLAND);
  runsToday(NEVERLAND, SAT);
  runsOnDatesAhead(NEVERLAND, new Set([SUN]));
  runsBeyond(NEVERLAND, SUN);
  assert.equal(JSON.stringify(NEVERLAND), before, 'the event row is untouched');
});
