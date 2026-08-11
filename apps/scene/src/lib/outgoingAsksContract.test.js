import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠⚠ AN ENQUIRY YOU SENT MUST BE VISIBLE TO YOU.
 *
 * Both existing `venue_enquiries` reads on the artist dashboard filtered to
 * `initiated_by: 'venue'` — those are OFFERS, a venue inviting you. There was no
 * query anywhere for `'applicant'`, so an artist could enquire with a venue and
 * then have no way to see that they had: not the date, not the status, not the
 * reply. The row was written correctly and the venue could see it; only the
 * sender could not.
 *
 * The OUTGOING tab read `applications` alone, which is why it said "You haven't
 * applied to anything yet" — literally true of EVENTS, and useless to someone
 * who had just enquired with a venue.
 *
 * Found 2026-08-10 by the owner, immediately after the enquiry flow started
 * working properly.
 *
 * ⚠ 2026-08-11: the query, the four buckets and the row moved into
 * `lib/outgoingPipeline.js` + `components/OutgoingEnquiryRow.jsx` when
 * HostDashboard grew the same list. The assertions below MOVED WITH THEM —
 * every rule they encode is unchanged, they simply now hold for both askers at
 * once, which is the point of the extraction.
 */

const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const DASH = read('../screens/ArtistDashboard.jsx');
const PIPE = read('./outgoingPipeline.js');
const ROW  = read('../components/OutgoingEnquiryRow.jsx');

test('the shared query asks for the enquiries the profile SENT', () => {
  assert.match(PIPE, /eq\('applicant_profile_id', profileId\)[\s\S]{0,40}eq\('initiated_by', 'applicant'\)/,
    "only venue-initiated offers are fetched — the sender's own enquiries are invisible");
});

/**
 * ⛔ Keyed on the PROFILE. `applicant_user_id` is the account, and one account
 * owns a host profile, a DJ act and a comedy act — keying on it puts all three
 * profiles' enquiries on each of their dashboards.
 */
test('the shared query never falls back to the account key', () => {
  // Filters only — the prose above the function names the column it must not
  // filter on, and forbidding the WORD would forbid explaining the rule.
  assert.doesNotMatch(PIPE, /eq\('applicant_user_id'|or\(/,
    'the outgoing list can cross over between one account\'s profiles');
});

test('a venue that did not resolve still yields its enquiry', () => {
  assert.match(PIPE, /venue: venuesById\[e\.venue_profile_id\] \|\| null/,
    'an enquiry disappears when its venue fails to load — absent is being treated as broken');
});

test('the artist dashboard uses the shared query, not a private copy', () => {
  assert.match(DASH, /fetchOutgoingEnquiries\(supabase, profileId\)/);
  assert.doesNotMatch(DASH, /eq\('initiated_by', 'applicant'\)/,
    'the artist dashboard has grown its own second copy of the outgoing query');
});

test('the offers queries still filter to venue-initiated', () => {
  // Two of them, and they must NOT start picking up the artist's own enquiries
  // — an enquiry you sent is not an offer you received.
  const venueInitiated = DASH.match(/eq\('initiated_by', 'venue'\)/g) || [];
  assert.equal(venueInitiated.length, 2, 'the incoming/offers queries changed shape');
});

test('applications and enquiries are merged into ONE outgoing list', () => {
  assert.match(DASH, /const outgoingItems = \[/);
  assert.match(DASH, /kind: 'application'/);
  assert.match(DASH, /kind: 'enquiry'/);
});

test('the merged list is sorted across both sources, not concatenated', () => {
  assert.match(DASH, /\.sort\(\(x, y\) => String\(y\.at \|\| ''\)\.localeCompare\(String\(x\.at \|\| ''\)\)\)/,
    'the list reads as two piles rather than one chronology');
});

/**
 * `applicantLabel` already maps both status vocabularies onto the same four
 * buckets — an enquiry's `pending` lands in SUBMITTED exactly as an
 * application's does. If the sub-tabs ever special-case one source, that shared
 * mapping has been broken.
 */
test('both sources share one status mapping', () => {
  assert.match(DASH, /filteredOut = outgoingItems\.filter\(it => \{[\s\S]{0,200}applicantLabel\(it\.row\.status\)/);
});

test('the tab counts and the stat tile count the same list the tab renders', () => {
  assert.match(DASH, /outgoingItems\.filter\(it => applicantLabel\(it\.row\.status\) === t\)\.length/,
    'the sub-tab counts still count applications only');
  assert.match(DASH, /cnt: outgoingItems\.length/,
    'the OUTGOING direction tab still counts applications only');
  assert.match(DASH, /value: loading \? '—' : outgoingItems\.length/,
    'the stat tile disagrees with the tab it opens');
});

/**
 * ⛔ An availability enquiry has no event — no name, lineup, poster or time.
 * Rendering it through EventCard would produce a card full of blanks, which the
 * Rendering Contract says must never happen (absent ≠ broken).
 */
test('an enquiry renders its own row, never an EventCard', () => {
  assert.doesNotMatch(ROW, /<EventCard/, 'an enquiry is being rendered as an event');
});

/**
 * ⛔ No local chip vocabulary.
 *
 * ⚠ This assertion CHANGED SHAPE when P12 landed, and deliberately: it used to
 * forbid any chip at all, because Ask Category was designed but not built and a
 * third copy of category labels was the risk. Now the chip exists — so what
 * must be forbidden is the LABELS being written here rather than looked up.
 * The constraint was never "no chip"; it was "no second vocabulary".
 */
test('the chip is read from the registry, never invented locally', () => {
  assert.match(ROW, /askCategoryLabel\(/, 'the chip does not consult the registry');
  assert.doesNotMatch(ROW, /askLabel = '|'Music'|'Performance'|'Workshops'|'Volunteers'/,
    'category labels are hard-coded here instead of read from the registry');
});

/**
 * ⛔ The row must not learn WHO is looking at it. The accent is passed in — cyan
 * for a DJ, magenta for a promoter — and a `type === 'host'` branch in here is
 * the consumer-identity finding, not a feature.
 */
test('the shared row knows nothing about who is asking', () => {
  assert.doesNotMatch(ROW, /=== 'host'|=== 'artist'|PROFILE_TYPES\./,
    'the shared row branches on the identity of its consumer');
  assert.doesNotMatch(PIPE, /=== 'host'|=== 'artist'/,
    'the shared pipeline branches on the identity of its consumer');
});

test('the empty state no longer claims the artist has done nothing', () => {
  assert.doesNotMatch(PIPE, /"You haven't applied to anything yet\."/,
    'someone who enquired with a venue is still told they have applied to nothing');
});
