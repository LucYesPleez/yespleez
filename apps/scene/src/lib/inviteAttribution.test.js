import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠ AN INVITE MUST CARRY THE PROFILE IT INVITED.
 *
 * `InviteSheet` used to derive both profile ids with
 * `resolveProfileId(user_id, type)`, which returns null when the account is
 * unknown — and an UNCLAIMED artist has no `user_id`, which is what unclaimed
 * MEANS. So inviting exactly the acts a venue is most likely to discover wrote
 * a row with no applicant profile on it: invisible on the artist's dashboard
 * (which reads by `applicant_profile_id`), and impossible to deduplicate once
 * uniqueness moves to profile identity.
 *
 * The callers always held the answer. This guards that they keep passing it.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHEET   = read('../components/InviteSheet.jsx');
const PROFILE = read('../screens/ProfileScreen.jsx');
const VENUE   = read('../screens/VenueDashboard.jsx');

test('the applicant profile comes from the artist row, not an account lookup', () => {
  assert.match(SHEET, /artist\?\.id\s*\?\s*Promise\.resolve\(artist\.id\)/,
    'the invited profile is still derived from user_id + type');
});

test('the venue profile is accepted as a prop', () => {
  assert.match(SHEET, /venueProfileId\s*=\s*null/, 'InviteSheet does not accept venueProfileId');
  assert.match(SHEET, /venueProfileId \? Promise\.resolve\(venueProfileId\)/);
});

test('both callers pass the venue profile id they already hold', () => {
  assert.match(PROFILE, /venueProfileId=\{venueCtx\.id\}/,
    'ProfileScreen knows its venue profile but does not pass it');
  assert.match(VENUE, /venueProfileId=\{profile\?\.id/,
    'VenueDashboard knows its venue profile but does not pass it');
});

/**
 * ⛔ REFUSE RATHER THAN WRITE AN UNATTRIBUTED ROW. Before P9 makes the column
 * NOT NULL this is the only thing standing between an unclaimed artist and a
 * row nobody can see; after P9 it is the difference between a clear sentence
 * and a raw 23502.
 */
test('a missing applicant profile stops the send and says why', () => {
  const send = SHEET.slice(SHEET.indexOf('async function handleSend'));
  const guard = send.indexOf('if (!applicantProfileId)');
  const insert = send.indexOf("from('venue_enquiries').insert");
  assert.ok(guard > 0, 'nothing stops an invite with no applicant profile');
  assert.ok(guard < insert, 'the guard runs after the insert');
  assert.match(send.slice(guard, guard + 600), /setError\(/,
    'the refusal is silent');
});

test('the payload writes the resolved ids, not the raw props', () => {
  assert.match(SHEET, /venue_profile_id:\s*venueProfileIdFinal/);
  assert.match(SHEET, /applicant_profile_id:\s*applicantProfileId/);
});

/**
 * The notification names the venue that is inviting. It must use the same
 * resolved id as the row, or the row and the notice disagree about who acted.
 */
test('the notification and the row name the same venue profile', () => {
  assert.match(SHEET, /aboutProfileId:\s*venueProfileIdFinal/);
});
