/**
 * THE OUTGOING TILE COUNTS WHAT THE SUB-TABS CAN SHOW.
 *
 * ⛔⛔ THE BUG THIS EXISTS TO KEEP CLOSED. The dashboard read OUTGOING 3 while
 * every sub-tab under it was empty. The three rows were declined enquiries aged
 * 33, 51 and 61 days, all past `DECLINE_FADE_DAYS`, so the fade removed them
 * from the list AND from the sub-tab badges but NOT from the top-level tile,
 * which counted the raw pile.
 *
 * ⚠ The comment in ArtistDashboard already named this failure — "a badge
 * counting rows the list will not show is the bug that makes people tap an
 * empty tab" — and the fade had been applied to two of the three readers. A
 * rule stated once and applied twice is how a third reader drifts.
 *
 * ⚠⚠ SOURCE-TEXT ASSERTIONS BELOW cannot prove the screen renders; lint and the
 * build cover that. The fade arithmetic is executed for real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isFadedDecline, DECLINE_FADE_DAYS, normaliseStatus } from './enquiryUtils.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const DASH = read('../screens/ArtistDashboard.jsx');

const daysAgo = n => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/* ── the real rows from the report ──────────────────────────────────────── */

const OWNERS_THREE = [
  { id: 'a', status: 'declined', created_at: daysAgo(33) },
  { id: 'b', status: 'declined', created_at: daysAgo(51) },
  { id: 'c', status: 'declined', created_at: daysAgo(61) },
];

test('⛔⛔ the reported case: three faded declines must count as ZERO', () => {
  // ⚠ explicit single arg. `rows.filter(isFadedDecline)` passes the INDEX as
  // `now`, which silently reports nothing as faded — it caught me while
  // diagnosing this, and it would make this test pass for the wrong reason.
  const kept = OWNERS_THREE.filter(r => !isFadedDecline(r));
  assert.equal(OWNERS_THREE.length, 3, 'three rows exist');
  assert.equal(kept.length, 0, 'and none of them can be listed');
});

test('⭐ a decline INSIDE the window still counts, so the fade is not a blanket', () => {
  // THE CONTROL. Without it, a fade that hid every row would pass the test above.
  const fresh = { id: 'd', status: 'declined', created_at: daysAgo(DECLINE_FADE_DAYS - 1) };
  assert.equal(isFadedDecline(fresh), false);
  assert.equal([fresh].filter(r => !isFadedDecline(r)).length, 1);
  assert.equal(normaliseStatus({ ...fresh, direction: 'outgoing' }), 'declined');
});

test('⭐ only declines ever fade — an old pending ask is not swept up', () => {
  const oldPending = { id: 'e', status: 'pending', created_at: daysAgo(400) };
  assert.equal(isFadedDecline(oldPending), false);
});

/* ── one filtered set feeds all three readers ───────────────────────────── */

test('⛔⛔ the tile counts outStatuses, NOT the raw outgoingItems', () => {
  assert.match(DASH, /OUTGOING: outStatuses\.length,/,
    'the tile must count the fade-filtered set');
  assert.ok(!/OUTGOING: outgoingItems\.length,/.test(DASH),
    'the raw count must not come back');
});

test('⭐ the sub-tab badges and the list read that same filtered set', () => {
  assert.match(DASH, /const outStatuses = outgoingItems\s*\n\s*\.filter\(it => !isFadedDecline\(it\.row\)\)/,
    'the fade is applied once, before any bucketing');
  assert.match(DASH, /const filteredOut = outStatuses\.filter/, 'the list reads it');
  assert.match(DASH, /outStatuses\.filter\(it => it\.bucket === sub\.toLowerCase\(\)\)\.length/,
    'the sub-tab badges read it');
});

test('⛔ the fade is applied with an explicit single argument', () => {
  // `.filter(isFadedDecline)` would hand the index in as `now` and disable it.
  assert.ok(!/filter\(isFadedDecline\)/.test(DASH), 'never point-free here');
});
