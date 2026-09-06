/**
 * "APPLIED 13 AUG" ON SOMETHING APPLIED FOR ON THE 14TH.
 *
 * ⛔⛔ `formatDisplayDate(row.created_at.slice(0, 10))`. It reads correctly —
 * trim the time off, format the date — and it is wrong, because the first ten
 * characters of an instant are its UTC day. An application made at 9am on
 * 14 Aug in Sydney is stored `2026-08-13T23:00:00Z`, so every application
 * submitted between local midnight and 10am AEST was captioned as the day
 * before.
 *
 * ⚠⚠ THE DISTINCTION IS THE INPUT, NOT THE OPERATION. `config.date` is a bare
 * calendar date in the venue's own reality and slicing it is correct and
 * deliberate — `discoverSearch` says in as many words not to "fix" it into a
 * Date. `created_at` is a `timestamptz`. Same code, opposite outcome, which is
 * why the helper is named after the COLUMN TYPE it takes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTimestampDate, formatDisplayDate, localDateStr } from './dates.js';

/** Minutes east of UTC at a given instant. Sydney is +600 / +660. */
const offsetAt = iso => -new Date(iso).getTimezoneOffset();

test('⛔⛔ a morning timestamp is captioned with the day it happened HERE', () => {
  /* An instant whose UTC day and local day differ. ⚠ Built from the runner's
     own offset so it straddles wherever the suite runs, rather than assuming
     Sydney — the assertion below proves the fixture actually straddles before
     it proves anything about the helper. */
  const local = new Date(2026, 7, 14, 9, 0, 0);          // 9am on 14 Aug, local
  if (offsetAt(local) === 0) return;                      // in UTC there is nothing to disagree about
  const iso = local.toISOString();

  assert.notEqual(iso.slice(0, 10), '2026-08-14',
    'the fixture must straddle midnight UTC, or it proves nothing');

  assert.equal(formatTimestampDate(iso), formatDisplayDate('2026-08-14'),
    'the caption must name the local day');
  assert.notEqual(formatTimestampDate(iso), formatDisplayDate(iso.slice(0, 10)),
    'and must NOT agree with the old slice, which is the whole point');
});

test('⛔ the old slice really was a day early — the defect, stated', () => {
  const local = new Date(2026, 7, 14, 9, 0, 0);
  if (offsetAt(local) <= 0) return;                       // only east of UTC does it read EARLY
  const iso = local.toISOString();
  assert.equal(iso.slice(0, 10), '2026-08-13');
  assert.equal(localDateStr(new Date(iso)), '2026-08-14');
});

test('⭐ an afternoon timestamp was never affected, and still is not', () => {
  const local = new Date(2026, 7, 14, 15, 0, 0);
  assert.equal(formatTimestampDate(local.toISOString()), formatDisplayDate('2026-08-14'));
});

test('⚠ absent is absent — no caption is invented for a row with no timestamp', () => {
  for (const v of [null, undefined, '']) assert.equal(formatTimestampDate(v), '');
});

test('⚠ an unparseable timestamp yields nothing, not "Invalid Date"', () => {
  /* ⛔ `new Date('nonsense')` is a Date whose getFullYear() is NaN, and the old
     composition would have rendered "NaN-NaN-NaN" straight into the card. */
  assert.equal(formatTimestampDate('not a timestamp'), '');
});

test('⭐ it accepts a Date as readily as the string PostgREST returns', () => {
  const d = new Date(2026, 7, 14, 9, 0, 0);
  assert.equal(formatTimestampDate(d), formatDisplayDate('2026-08-14'));
});

test('⛔⛔ the caller uses the helper, not the slice it replaces', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../screens/ArtistDashboard.jsx', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /formatTimestampDate\(app\.created_at\)/);
  assert.ok(!/created_at\.slice\(/.test(code), 'the slice must not come back');
});
