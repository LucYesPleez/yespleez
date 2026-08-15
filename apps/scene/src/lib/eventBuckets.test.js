import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  eventBucket, bucketEvents, defaultBucket, effectiveDate, isArchived,
  UPCOMING, DRAFT, ARCHIVE,
} from './eventBuckets.js';

/**
 * WRITTEN AGAINST THE HOST'S REAL 15 EVENTS (measured 2026-08-15).
 *
 * 11 of them are 2023-2025 imports, which is why the LINEUP chip rail read as a
 * wall: eleven dead gigs ahead of the four that matter.
 */

const TODAY = '2026-08-15';
const ev = (name, status, date, endDate) => ({
  id: name, name, status,
  config: { ...(date ? { date } : {}), ...(endDate ? { endDate } : {}) },
});

const REAL = [
  ev('Echo Valley 2027', 'draft', null),              // ⛔ NO DATE
  ev('Echo Valley 2026', 'draft', null),              // ⛔ NO DATE
  ev('Copycatt', 'live', '2024-01-20'),
  ev('Kodiak Kid', 'live', '2023-12-02'),
  ev('House Sessions', 'live', '2025-01-24'),
  ev('New Years Eve', 'live', '2025-12-31'),
  ev('Bass Heavy', 'draft', '2026-10-03'),
  ev('Solstice Soirée', 'live', '2026-06-20', '2026-06-21'),
  ev('fds', 'draft', '2026-10-17'),
];

test('the real 15 split the way the screen needs them to', () => {
  const b = bucketEvents(REAL, TODAY);
  assert.deepEqual(b[ARCHIVE].map(e => e.name),
    ['Copycatt', 'Kodiak Kid', 'House Sessions', 'New Years Eve', 'Solstice Soirée']);
  assert.deepEqual(b[DRAFT].map(e => e.name),
    ['Echo Valley 2027', 'Echo Valley 2026', 'Bass Heavy', 'fds']);
  assert.deepEqual(b[UPCOMING], []);
});

/**
 * ⛔⛔ THE DEFECT THAT MADE THIS FILE NECESSARY.
 *
 * `(config.date || '') < todayStr` — and `'' < anything` is TRUE, so every
 * undated event was filed as PAST. Two production events have no date.
 */
test('⛔ an undated event is NOT past', () => {
  assert.equal(eventBucket(ev('Echo Valley 2027', 'draft', null), TODAY), DRAFT);
  assert.equal(eventBucket(ev('undated live', 'live', null), TODAY), UPCOMING);
  assert.equal(isArchived(ev('undated live', 'live', null), TODAY), false);
  // The old expression, preserved so the regression is legible:
  assert.equal('' < TODAY, true, 'this is why the old rule archived them');
});

/**
 * ⚠ A FESTIVAL IS NOT OVER ON ITS MIDDLE DAY. Both rules this replaces compared
 * `config.date` alone. Solstice Soirée (20-21 June) is the production row.
 */
test('endDate decides, not the start date', () => {
  const fest = ev('Fri to Sun', 'live', '2026-08-14', '2026-08-16');
  assert.equal(effectiveDate(fest), '2026-08-16');
  assert.equal(eventBucket(fest, TODAY), UPCOMING, 'still running on the 15th');
  assert.equal(eventBucket(fest, '2026-08-17'), ARCHIVE);
  // Start date alone would have archived it on the 15th.
  assert.equal(eventBucket(ev('start only', 'live', '2026-08-14'), TODAY), ARCHIVE);
});

test('an event happening TODAY is not archived', () => {
  assert.equal(eventBucket(ev('tonight', 'live', TODAY), TODAY), UPCOMING);
  assert.equal(eventBucket(ev('yesterday', 'live', '2026-08-14'), TODAY), ARCHIVE);
});

/**
 * ⛔⛔ THE UTC TRAP, PINNED. `toISOString().slice(0,10)` in AEST reads as
 * YESTERDAY every morning until 10am. An event ON TODAY would archive itself.
 * The clock is injected precisely so this can be asserted.
 */
test('⛔ a UTC "today" would archive tonight’s event, a local one does not', () => {
  const tonight = ev('tonight', 'live', '2026-08-15');
  // What the old code computed at 08:00 AEST on the 15th: the UTC date is the 14th.
  assert.equal(eventBucket(tonight, '2026-08-14'), UPCOMING, 'sanity: a past "today" cannot archive a future event');
  // And the reverse, which is the real failure: an event on the 14th, viewed on
  // the 15th at 08:00 AEST where UTC still says the 14th.
  assert.equal(eventBucket(ev('last night', 'live', '2026-08-14'), '2026-08-14'), UPCOMING,
    'the UTC clock keeps a finished event in UPCOMING all morning');
  assert.equal(eventBucket(ev('last night', 'live', '2026-08-14'), '2026-08-15'), ARCHIVE,
    'the local clock files it correctly');
});

/** ⭐ Past beats draft (owner, 2026-08-15). */
test('a past draft is archived, not left in drafts forever', () => {
  assert.equal(eventBucket(ev('abandoned', 'draft', '2025-01-01'), TODAY), ARCHIVE);
  assert.equal(eventBucket(ev('planned', 'draft', '2027-01-01'), TODAY), DRAFT);
});

test('an explicitly completed event is archived whatever its date says', () => {
  assert.equal(eventBucket(ev('done early', 'completed', '2027-01-01'), TODAY), ARCHIVE);
});

/**
 * ⚠ The host has ZERO upcoming. A fixed default would open on an empty screen
 * with their real work one tab away - the same wall of nothing being fixed.
 */
test('the screen opens on the first bucket that has anything in it', () => {
  assert.equal(defaultBucket(bucketEvents(REAL, TODAY)), DRAFT);
  assert.equal(defaultBucket(bucketEvents([ev('soon', 'live', '2027-01-01')], TODAY)), UPCOMING);
  assert.equal(defaultBucket(bucketEvents([ev('old', 'live', '2020-01-01')], TODAY)), ARCHIVE);
  assert.equal(defaultBucket(bucketEvents([], TODAY)), UPCOMING, 'nothing at all still needs a tab');
});

test('every event lands in exactly one bucket, and none are lost', () => {
  const b = bucketEvents(REAL, TODAY);
  const total = b[UPCOMING].length + b[DRAFT].length + b[ARCHIVE].length;
  assert.equal(total, REAL.length);
  const ids = [...b[UPCOMING], ...b[DRAFT], ...b[ARCHIVE]].map(e => e.id);
  assert.equal(new Set(ids).size, REAL.length, 'no event counted twice');
});

/**
 * ⭐⭐ ONE TEMPORAL RULE, ASSERTED AS ONE.
 *
 * `eventBucket` delegates "is this past" to `deriveEventStatus` rather than
 * re-deriving it. This pins that they agree across the boundary cases, so if
 * anyone ever reintroduces a local comparison here it fails loudly instead of
 * drifting quietly - which is the whole failure mode this change removed.
 */
test('the bucket and the event page’s status pill cannot disagree', async () => {
  const { deriveEventStatus } = await import('../screens/event/eventStatus.js');
  const cases = [
    ['2026-08-14', null],          // yesterday
    ['2026-08-15', null],          // today
    ['2026-08-16', null],          // tomorrow
    ['2026-08-14', '2026-08-16'],  // spanning today
    ['2026-08-13', '2026-08-14'],  // finished yesterday
    [null, null],                  // undated
  ];
  for (const [date, endDate] of cases) {
    const e = ev('x', 'live', date, endDate);
    const pill = deriveEventStatus({ date, endDate }, new Date(`${TODAY}T00:00:00`));
    const archived = eventBucket(e, TODAY) === ARCHIVE;
    assert.equal(archived, pill === 'past',
      `date=${date} endDate=${endDate}: pill says ${pill}, bucket says ${archived ? 'ARCHIVE' : 'not archived'}`);
  }
});

test('malformed input does not throw', () => {
  assert.equal(eventBucket(null, TODAY), UPCOMING);
  assert.equal(eventBucket({}, TODAY), UPCOMING);
  assert.equal(effectiveDate({}), '');
  assert.deepEqual(bucketEvents(null, TODAY)[ARCHIVE], []);
});
