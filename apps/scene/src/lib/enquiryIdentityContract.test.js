import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P9 + P10 — PREPARING THE ENQUIRY IDENTITY CHANGE, WITHOUT MAKING IT.
 *
 * An enquiry is THIS ACT asking THIS VENUE about THIS DATE. The baseline
 * constraint says this PERSON asking this ACCOUNT, so one person's DJ act
 * blocks their own band from enquiring.
 *
 * ⭐ The read paths already moved to profile identity for exactly this reason —
 * ArtistDashboard: `applicant_user_id` "counted every profile's offers on every
 * profile's dashboard". These two migrations lay the write-path groundwork and
 * ⛔ deliberately change NO behaviour; P11 is the one that does.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * ⚠ EXECUTABLE SQL ONLY. Every migration documents its own ROLLBACK in
 * comments, so a naive text search finds "DROP CONSTRAINT" in a file that
 * executes no such thing — an earlier version of this test failed on P10's
 * rollback note.
 */
const sqlOf = rel => read(rel).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const P9  = sqlOf('../../../../supabase/migrations/20260810000003_p9_enquiry_profile_ids_required.sql');
const P10 = sqlOf('../../../../supabase/migrations/20260810000004_p10_enquiry_profile_uniqueness.sql');

test('P9 makes BOTH profile columns required', () => {
  assert.match(P9, /ALTER COLUMN applicant_profile_id SET NOT NULL/);
  assert.match(P9, /ALTER COLUMN venue_profile_id\s+SET NOT NULL/);
});

/**
 * Without the guard, P9 would apply against dirty data and leave those rows
 * OUTSIDE P10's key — Postgres treats NULLs as distinct, so they would be
 * silently exempt from the very rule being added.
 */
test('P9 refuses to run if any NULL would be silently exempted', () => {
  assert.match(P9, /RAISE EXCEPTION/);
});

test('P10 ADDS the profile key without dropping the old one', () => {
  assert.match(P10, /ADD CONSTRAINT venue_enquiries_venue_profile_applicant_profile_date_key/);
  assert.doesNotMatch(P10, /DROP CONSTRAINT/,
    'P10 is meant to be purely additive and reversible — the drop is P11');
});

test('P10 keys on the two profile columns and the date', () => {
  assert.match(P10, /UNIQUE \(venue_profile_id, applicant_profile_id, date_requested\)/);
});

test('the applicant read path is already profile-keyed', () => {
  assert.match(read('../screens/ArtistDashboard.jsx'), /eq\('applicant_profile_id'/);
});

/**
 * The app reports duplicates by SQLSTATE, not by constraint name — so it keeps
 * working when the key underneath it changes. If this ever became name-based,
 * P11 would silently stop reporting duplicates.
 */
test('duplicate reporting does not depend on which constraint rejected the write', () => {
  const profile = read('../screens/ProfileScreen.jsx');
  assert.match(profile, /error\.code === '23505'/);
  assert.doesNotMatch(profile, /venue_enquiries_venue_user_id_applicant_user_id/,
    'the UI names a specific constraint and will break when it is dropped');
});
