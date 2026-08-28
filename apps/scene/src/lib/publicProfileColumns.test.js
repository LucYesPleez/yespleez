import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_PROFILE_COLUMNS,
  PRIVATE_PROFILE_COLUMNS,
  PUBLIC_PROFILE_SELECT,
} from './publicProfileColumns.js';

/**
 * ⛔⛔ ANONYMOUS VISITORS MUST NOT READ PERSONAL DETAILS FROM `profiles`.
 *
 * Measured 2026-08-29 with the publishable key and no session: `email` on 78
 * profiles, emergency contact name/phone/relationship on 19, `abn` on 12,
 * `age` on 17 — all in one request. The emergency contacts are next-of-kin
 * who never used YesPleez.
 *
 * ⭐ THE CAUSE IS STRUCTURAL, not a bad line: RLS filters ROWS, not COLUMNS,
 * and Supabase grants SELECT on the whole table to `anon`. The row policy is
 * correct — profiles ARE public — but nothing narrowed which columns that
 * covers.
 *
 * ⚠⚠ THESE ARE SOURCE-LEVEL ASSERTIONS. They prove the app stops ASKING for
 * private columns anonymously. They cannot prove the database stops ANSWERING —
 * that is the column revoke, and its evidence is an anonymous probe.
 */

const src = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ── The two lists cannot overlap ───────────────────────────────────────────
test('no private column appears in the public list', () => {
  const leaked = PRIVATE_PROFILE_COLUMNS.filter(c => PUBLIC_PROFILE_COLUMNS.includes(c));
  assert.deepEqual(leaked, [], `these would still be readable anonymously: ${leaked.join(', ')}`);
});

test('every personal field measured as exposed is in the private list', () => {
  // ⭐ Named individually rather than looped, so removing one from the private
  // list fails a test that says WHICH protection was dropped.
  for (const c of ['email', 'phone', 'emergency_name', 'emergency_phone',
                   'emergency_rel', 'abn', 'has_abn', 'gst_registered', 'age']) {
    assert.ok(PRIVATE_PROFILE_COLUMNS.includes(c), `${c} must never be anon-readable`);
  }
});

// ── What must STAY public ──────────────────────────────────────────────────
test('⚠ contact_email stays PUBLIC — it is a published booking address', () => {
  // ProfileScreen renders it as a mailto link beside the social icons. ⛔ Do
  // not confuse it with `email`, the account address nobody chose to publish.
  assert.ok(PUBLIC_PROFILE_COLUMNS.includes('contact_email'));
  assert.ok(!PRIVATE_PROFILE_COLUMNS.includes('contact_email'));
});

test('the public list still carries what a profile page renders', () => {
  for (const c of ['id', 'name', 'type', 'avatar', 'bio', 'location', 'sound',
                   'genre_string', 'tagline', 'website', 'instagram']) {
    assert.ok(PUBLIC_PROFILE_COLUMNS.includes(c), `a public page renders ${c}`);
  }
});

/**
 * ⛔⛔ A COLUMN THAT DOES NOT EXIST BREAKS THE WHOLE SELECT.
 *
 * The first version of this list carried `studio_local_id`, invented by
 * extracting column names with a regex over a `select=*` response — which also
 * matched keys inside jsonb values. PostgREST answers such a select with 42703,
 * so BOTH branches of `resolveProfileRoute` failed and every public profile
 * page on production read "Profile not found".
 *
 * ⚠ This test cannot reach the database, so it pins the count and the known
 * phantom instead. ⭐ The real guard is the anonymous probe after deploying.
 */
test('⛔ the invented column is gone and the count matches the table', () => {
  assert.ok(!PUBLIC_PROFILE_COLUMNS.includes('studio_local_id'),
    'studio_local_id is not a column on profiles — it came from a jsonb value');
  assert.equal(
    PUBLIC_PROFILE_COLUMNS.length + PRIVATE_PROFILE_COLUMNS.length, 83,
    'profiles has 83 columns; public + private must account for all of them',
  );
});

test('the select string is a comma list PostgREST can take', () => {
  assert.equal(PUBLIC_PROFILE_SELECT.split(', ').length, PUBLIC_PROFILE_COLUMNS.length);
  assert.doesNotMatch(PUBLIC_PROFILE_SELECT, /\*/, 'a star would defeat the whole point');
});

// ── The one anonymous caller ───────────────────────────────────────────────
/**
 * ⚠⚠ `select('*')` DOES NOT DEGRADE GRACEFULLY. Postgres errors when one
 * selected column is denied rather than omitting it, so an anonymous `*` after
 * the revoke is a broken public profile page, not a quieter one. This test is
 * what stops it being reintroduced as a convenience.
 */
test('profileResolution never selects * from profiles', () => {
  const RESOLUTION = src('./profileResolution.js');
  assert.doesNotMatch(
    RESOLUTION,
    /from\('profiles'\)\.select\('\*'\)/,
    "⛔ the only anonymous whole-row read must use the explicit public column list",
  );
  assert.match(RESOLUTION, /PUBLIC_PROFILE_SELECT/);
});
