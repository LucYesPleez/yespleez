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
 */

const DASH = readFileSync(fileURLToPath(new URL('../screens/ArtistDashboard.jsx', import.meta.url)), 'utf8');

test('the dashboard queries the enquiries the artist SENT', () => {
  assert.match(DASH, /eq\('applicant_profile_id', profileId\)\.eq\('initiated_by', 'applicant'\)/,
    "only venue-initiated offers are fetched — the artist's own enquiries are invisible");
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
  assert.match(DASH, /function OutgoingEnquiryRow/);
  const row = DASH.slice(DASH.indexOf('function OutgoingEnquiryRow'));
  const body = row.slice(0, row.indexOf('\n}'));
  assert.doesNotMatch(body, /<EventCard/, 'an enquiry is being rendered as an event');
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
  const row = DASH.slice(DASH.indexOf('function OutgoingEnquiryRow'));
  const body = row.slice(0, row.indexOf('\n}'));
  assert.match(body, /askCategoryLabel\(/, 'the chip does not consult the registry');
  assert.doesNotMatch(body, /'Music'|'Performance'|'Workshops'|'Volunteers'/,
    'category labels are hard-coded here instead of read from the registry');
});

test('the empty state no longer claims the artist has done nothing', () => {
  assert.doesNotMatch(DASH, /"You haven't applied to anything yet\."/,
    'someone who enquired with a venue is still told they have applied to nothing');
});
