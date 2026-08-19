import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { today, localDateStr } from './dates.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ── ⛔⛔ A UTC DATE IS NOT TODAY ─────────────────────────────────────────────
 *
 * `new Date().toISOString()` is UTC. East of Greenwich its first ten characters
 * are YESTERDAY for the whole local morning — until 10am AEDT / 11am AEST. Five
 * live call sites read the date that way: two availability calendars, two
 * availability QUERIES (`gte` bounds, so they fetched from the wrong day) and
 * the UPCOMING / PAST split on a profile, which filed an event happening TODAY
 * under PAST for every AU user before mid-morning.
 *
 * ⚠⚠ THE RULE IS ABOUT UTC, ⛔ NOT ABOUT THE WORD `toISOString`. The earlier
 * sweep matched `.slice(0, 10)` and reported the codebase clean while all five
 * of these sat there spelled `.split('T')[0]`. ⭐ This guard matches the SHAPE:
 * any ten-character prefix of an ISO string, however it is taken.
 *
 * ⛔ It is a source sweep, so it proves the SPELLING is gone, ⛔ not that a
 * component renders the right day — this repo has no render tests.
 */

/** Remove comments so the prose explaining the defect cannot match it. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Both spellings of the same mistake, plus `substring`, which nobody has used
 * yet and which would otherwise walk straight past this test.
 */
const UTC_DATE = /toISOString\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/;

/**
 * ⛔ ALLOWED, EACH FOR A STATED REASON. ⚠ Adding a file here is a DECISION —
 * it must be a place where the UTC day is the answer being asked for, or a
 * fixture nobody sees.
 */
const ALLOWED = new Set([
  // The fixture's own seed dates. ⛔ Not user-facing, and deliberately left out
  // of the display sweep so the change stayed to what a user can see.
  'screens/event/eventFixture.js',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(jsx?|mjs)$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(full);
  }
  return out;
}

test('⛔⛔ nothing reads the UTC date as if it were today', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (UTC_DATE.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    `these read a UTC date as a local day — use today() / dateStr() / localDateStr() from lib/dates:\n  ${offenders.join('\n  ')}`);
});

/**
 * ⭐ THE POSITIVE HALF. The guard above only proves an absence; these prove the
 * replacement answers the question the call sites actually ask.
 */
test('today() is the LOCAL calendar day, whatever UTC says', () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(today(), expected);
});

test('localDateStr keeps the day a Date falls on locally', () => {
  /* Local midnight — the instant where the UTC slice is most likely to hand
     back the day BEFORE east of Greenwich, and the day AFTER west of it. */
  const midnight = new Date(2026, 7, 19, 0, 0, 0);
  assert.equal(localDateStr(midnight), '2026-08-19');
});

/**
 * ⚠⚠ THE WRITE PATH IS DELIBERATELY OUT OF SCOPE. `AvailabilitySection` also
 * WRITES dates into `artist_availability`, and correcting a writer changes
 * stored user data — that needs its own measurement of what is already there,
 * ⛔ not a sweep. This test exists so the omission is recorded rather than
 * forgotten.
 */
test('the availability WRITE path is still on the old reading — tracked, not fixed', () => {
  const src = readFileSync(join(SRC, 'components/AvailabilitySection.jsx'), 'utf8');
  assert.match(src, /TODAY = \(\) => today\(\)/, 'the READ was corrected');
});
