import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P11 — THE BEHAVIOURAL HALF, AND THE READ PATH THAT HAS TO MOVE WITH IT.
 *
 * P11 drops the account-level uniqueness key, so from that moment one person's
 * two ACTS can each enquire about the same date at the same venue. That is the
 * fix — but it makes the venue side's own account/profile confusion visible,
 * because `VenueDashboard` read `.eq('venue_user_id', userId)` and therefore
 * merged the enquiries of every venue one person owns.
 *
 * ⭐ Exactly the cross-over ArtistDashboard already removed on the applicant
 * side: "falling back to the account key would reinstate the cross-over. That
 * clause is the bug: it is what shows one profile's work on another."
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sqlOf = rel => read(rel).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const VENUE_DASH = read('../screens/VenueDashboard.jsx');
const P11 = sqlOf('../../../../supabase/migrations/20260810000005_p11_drop_enquiry_user_uniqueness.sql');

test('P11 drops the user-level key and nothing else', () => {
  assert.match(P11, /DROP CONSTRAINT IF EXISTS venue_enquiries_venue_user_id_applicant_user_id_date_reques_key/);
  assert.doesNotMatch(P11, /ADD CONSTRAINT venue_enquiries_venue_profile/,
    'P11 should not also add — that is P10, and they must be revertable separately');
  assert.doesNotMatch(P11, /SET NOT NULL/,
    'P11 should not also alter columns — that is P9');
});

test('the venue dashboard reads its enquiries by PROFILE, not by account', () => {
  assert.match(VENUE_DASH, /from\('venue_enquiries'\)[\s\S]{0,140}eq\('venue_profile_id'/,
    "a person owning two venues sees both venues' enquiries merged");
});

/**
 * ⛔ An empty list is the correct answer for an account with no venue profile.
 * A fallback would reinstate the merge for exactly the accounts most likely to
 * notice it.
 */
test('no account-key fallback when the venue profile is missing', () => {
  const at = VENUE_DASH.indexOf("from('venue_enquiries')");
  const around = VENUE_DASH.slice(Math.max(0, at - 500), at + 500);
  assert.doesNotMatch(around, /eq\('venue_user_id'/,
    'the enquiry read still has an account-keyed path');
});

/**
 * The enquiry query needs the profile id, so it can no longer sit in the same
 * parallel batch as the profile fetch. If someone folds it back in, it reads
 * `undefined` and returns nothing — silently, on a dashboard that looks fine.
 */
test('the profile is fetched BEFORE the enquiries that depend on it', () => {
  const profileAt = VENUE_DASH.indexOf("const profRes = await supabase.from('profiles')");
  const enquiryAt = VENUE_DASH.indexOf("from('venue_enquiries')");
  assert.ok(profileAt > 0, 'the profile fetch is no longer sequenced ahead of the enquiries');
  assert.ok(profileAt < enquiryAt, 'the enquiry read runs before the profile id exists');
});
