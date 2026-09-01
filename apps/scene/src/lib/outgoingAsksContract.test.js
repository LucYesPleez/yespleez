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
/* ⚠ `OutgoingEnquiryRow` WAS ABSORBED into EnquiryCard (2026-09-01) — ONE card
   for every enquiry, every surface. `ROW` is that card now. */
const ROW  = read('../components/EnquiryCard.jsx');

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
 * ⚠ THE MAPPING MOVED, THE INVARIANT DID NOT (owner, 2026-08-14).
 *
 * This test used to pin `applicantLabel` — the artist's own four buckets
 * (SUBMITTED / BEING CONSIDERED / BOOKED / NOT SELECTED). It now pins
 * `normaliseStatus`, which is what the venue and host surfaces already used,
 * because the owner's requirement is that every profile's ENQUIRIES read the
 * same: same sub-headings, same colours, same chrome.
 *
 * The invariant under test is unchanged and is the one that matters: BOTH
 * SOURCES GO THROUGH ONE FUNCTION. An application's `pending` and an enquiry's
 * `pending` must land in the same bucket, whichever function that is. If the
 * sub-tabs ever special-case one source, that is the regression.
 *
 * ⚠⚠ SUPERSEDED 2026-09-01 — `applicantLabel` NO LONGER WORDS THE BADGES.
 * "A badge is commentary on one row" was the reasoning, and it produced a row
 * filed under ACCEPTED wearing a BOOKED sticker. See the badge test below.
 */
test('both sources share one status mapping', () => {
  assert.match(DASH, /const outStatuses = outgoingItems[\s\S]{0,160}bucket: normaliseStatus\(/,
    'the two sources must be bucketed by one function before any filtering');
  assert.match(DASH, /filteredOut = outStatuses\.filter\(it => \{[\s\S]{0,120}it\.bucket !== outStatusTab/,
    'the filter must read the shared bucket, not a per-source status');
});

/**
 * ⭐⭐ THE BADGE IS THE TAB IT SITS IN (owner, 2026-09-01).
 *
 * ⛔⛔ "BOOKED" MEANS ONE THING ON THIS SCREEN: on a lineup, playing. The
 * top-level BOOKED tab counts real gigs (`upcomingGigs`). An accepted enquiry
 * holds no slot and creates no `lineup_member`, so badging it BOOKED asserted a
 * booking the same screen was correctly refusing to list.
 */
test('the row badge reads the canonical bucket, never a second vocabulary', () => {
  assert.match(DASH, /const badge = bucket\.toUpperCase\(\)/,
    'the badge must be the bucket the tab already filtered on');
  assert.doesNotMatch(DASH, /const badge = applicantLabel\(/,
    'a second status vocabulary has come back to the badges');
  assert.doesNotMatch(DASH, /APP_TAB_COLOR\[/,
    'the badge colour must come from STATUS_TAB_COLOR, keyed by the same word');
});

test('the tab counts and the stat tile count the same list the tab renders', () => {
  assert.match(DASH, /outCounts = Object\.fromEntries\([\s\S]{0,220}outStatuses\.filter\(it => it\.bucket === sub\.toLowerCase\(\)\)\.length/,
    'the sub-tab counts must come from the same bucketed list the tab renders');
  assert.match(DASH, /OUTGOING: outgoingItems\.length/,
    'the OUTGOING direction tab still counts applications only');
  assert.match(DASH, /value: loading \? '—' : outgoingItems\.length/,
    'the stat tile disagrees with the tab it opens');
});

/**
 * ⭐ THE CANONICAL SURFACE (owner, 2026-08-14: "the whole enquiries needs to
 * match host and venues on the front end").
 *
 * Five profile types, one set of tabs. This pins the artist dashboard to the
 * SHARED chrome rather than its own copy — the copy is what drifted into
 * different sub-headings and label-coloured pills.
 */
test('the performer surface renders the shared enquiry chrome, not its own copy', () => {
  assert.match(DASH, /EnquiryDirectionTabs/, 'the direction pills must be the shared control');
  assert.match(DASH, /EnquiryStatusTabs/,    'the sub-tabs must be the shared control');
  assert.match(DASH, /EnquirySearch/,        'the search field must be the shared control');
  assert.doesNotMatch(DASH, /const IN_TABS = \[/,
    'a local sub-heading vocabulary has come back — that is the drift this removed');
});

/**
 * ⭐⭐ CANCELLED IS NOT DECLINED (owner, 2026-08-14).
 *
 * "declined is only to show me applications that have been declined by the
 * places i applied to." A withdrawal is not a verdict; filing it as one makes
 * the rejections list useless for the thing it is for.
 */
/* ⚠ THE WRITE MOVED (2026-09-01) to lib/cancelEnquiry.js — HostDashboard needed
   the same decision and had been open-coding a broken one. The law is unchanged;
   only its address is. */
test('cancelling writes `cancelled` and hides the row — it never writes `declined`', () => {
  const CANCEL = read('./cancelEnquiry.js');
  assert.match(CANCEL, /status: 'cancelled'/, 'a withdrawal must not be filed as the venue\'s verdict');
  assert.doesNotMatch(CANCEL, /status: 'declined'/);
  assert.match(CANCEL, /applicant_cleared_at: new Date\(\)\.toISOString\(\)/,
    'cancelling must also remove the row from the asker\'s own list');
});

/**
 * ⭐⭐ ONE CANCEL, NOT ONE PER DASHBOARD.
 *
 * ⛔⛔ THIS IS THE DEFECT THAT MADE THE FIX NECESSARY. HostDashboard routed
 * every id through `allApps` — the APPLICATIONS list — so an outgoing enquiry
 * fell through `if (!app) return` and CANCEL ENQUIRY wrote nothing at all,
 * silently. EnquiryDossierSheet meanwhile wrote `declined`. Three surfaces,
 * three answers, one decision.
 */
test('no dashboard writes the cancel itself', () => {
  for (const f of ['../screens/ArtistDashboard.jsx', '../screens/HostDashboard.jsx']) {
    const SRC = read(f);
    assert.doesNotMatch(SRC, /status: 'cancelled'/,
      `${f} has re-implemented the cancel write instead of calling cancelEnquiry`);
    assert.match(SRC, /cancelEnquiry\(/, `${f} must call the shared cancel`);
  }
});

/**
 * ⭐ CANCEL AND ITS CONFIRMATION MUST AGREE ABOUT WHICH ROWS QUALIFY.
 * `accepted` became cancellable on 2026-09-01 (owner: plans fall through);
 * `declined` stays out — CLEAR is that row's control.
 */
test('every cancel control offers the same statuses', () => {
  const CARD  = read('../components/EnquiryCard.jsx');
  const SHEET = read('../components/EnquiryDossierSheet.jsx');
  /* ⭐ TWO SUBJECTS NOW, NOT THREE — the row and the card ARE one component,
     which is the strongest form this invariant has ever had: the dense and
     rich densities cannot disagree about which statuses may be cancelled,
     because they read the same `cancelBtn`. */
  for (const [name, src] of [['EnquiryCard', CARD], ['EnquiryDossierSheet', SHEET]]) {
    assert.match(src, /'accepted'/, `${name} must offer cancel on an accepted ask`);
  }
  /* ⛔ The sheet had NO gate at all and offered cancel on settled rows. */
  assert.match(SHEET, /const cancellable =/, 'the dossier sheet must gate its cancel button');
  /* ⚠ SCOPED TO THE CANCEL BUTTON. `respond('declined')` is CORRECT further
     down in the same file — that is the recipient's DECLINE on an incoming
     enquiry. Only the control LABELLED cancel must never write it. */
  const cancelBtn = SHEET.slice(SHEET.indexOf('label="CANCEL ENQUIRY"') - 200,
                                SHEET.indexOf('label="CANCEL ENQUIRY"') + 200);
  assert.match(cancelBtn, /respond\('cancelled'\)/,
    'the sheet is the asker\'s side — `declined` there is the venue\'s verdict');
});

/**
 * ⭐⭐ A VENUE MUST LEARN THAT AN ACCEPTED DATE FELL THROUGH (owner,
 * 2026-09-01: "they need to know to fill the spot after someone pulls out").
 *
 * ⛔ AND ONLY THEN. Withdrawing an ask nobody answered is not news.
 */
test('cancelling an accepted ask notifies the venue, and only then', () => {
  const CANCEL = read('./cancelEnquiry.js');
  assert.match(CANCEL, /if \(wasAccepted\) \{/, 'the notice must be gated on the prior status');
  assert.match(CANCEL, /wasAccepted = normaliseStatus\(/,
    'read the status BEFORE the write — afterwards every row is `cancelled`');
  assert.match(CANCEL, /type:\s*'booking_cancelled'/,
    'an unregistered type renders as an inert row with no icon and nowhere to go');
  assert.match(CANCEL, /toUserId:\s*enq\.venue_user_id/,
    'address from the row — profiles.user_id is not an identity');
  /* ⛔ Telling a venue an act pulled out of a booking that is still live is
     worse than the silence this replaced. */
  assert.match(CANCEL, /if \(error\) return \{ error \};[\s\S]*if \(wasAccepted\)/,
    'a failed write must not notify — the error return must come FIRST');
});

/**
 * ⛔⛔ ONE WITHDRAWAL, ONE NOTICE. Found in real testing 2026-09-01: cancel is
 * offered on BOTH the card and the sheet, and pressing it twice sent the venue
 * two "they pulled out" notices for a single enquiry — the second press read a
 * React prop that had not caught up with the database.
 */
test('cancelling twice notifies once', () => {
  const CANCEL = read('./cancelEnquiry.js');
  assert.match(CANCEL, /\.neq\('status', 'cancelled'\)/,
    'the guard must be in the WRITE — a client-side flag describes what the browser last heard');
  assert.match(CANCEL, /\.select\('id'\)/, 'the write must report what it actually changed');
  assert.match(CANCEL, /if \(!changed\?\.length\) return[^\n]*\n[\s\S]*?if \(wasAccepted\)/,
    'a no-op write must return BEFORE the notification');
});

test('a cancelled ask leaves the venue\'s NEW pile', () => {
  const UTILS = read('./enquiryUtils.js');
  assert.match(UTILS, /cancelled:\s*'declined'/,
    'without this the withdrawn ask falls to the default and sits in the venue\'s NEW bucket');
});

test('cleared rows are filtered in the QUERY, not the render', () => {
  const PIPE = read('./outgoingPipeline.js');
  assert.match(PIPE, /\.is\('applicant_cleared_at', null\)/,
    'a hidden row must not be counted by a tab or consume the row limit');
});

/**
 * ⚠ THE FADE IS DERIVED, THE CLEAR IS STORED. Two different kinds of fact:
 * "older than 30 days" needs no record and no job; "I tidied this away" is a
 * decision and must survive.
 */
test('declines fade on a clock, with no job and no writes', () => {
  // ⚠ It lives in enquiryUtils, not outgoingPipeline — it moved there when the
  // venue and host surfaces needed the same rule, and ONE clock is the point.
  const UTILS = read('./enquiryUtils.js');
  assert.match(UTILS, /export const DECLINE_FADE_DAYS = 30/);
  assert.match(UTILS, /export function isFadedDecline/);
  // Only settled declines fade — an ask still waiting stays, however long.
  assert.match(UTILS, /\['declined', 'rejected'\]\.includes\(st\)/);
  // The old home re-exports rather than reimplementing.
  const PIPE = read('./outgoingPipeline.js');
  assert.match(PIPE, /export \{ DECLINE_FADE_DAYS, isFadedDecline \} from '\.\/enquiryUtils'/);
  assert.doesNotMatch(PIPE, /export function isFadedDecline/, 'a second clock has appeared');
});

test('the shared panel fades and can sweep, so venue and host get both', () => {
  const PANEL = read('../components/EnquiryPanel.jsx');
  assert.match(PANEL, /const visible = useMemo\(\(\) => enquiries\.filter\(e => !isFadedDecline\(e\)\)/,
    'the fade must run once, ahead of the counts as well as the list');
  assert.doesNotMatch(PANEL, /out\[key\] = enquiries\.filter/,
    'a tab counting faded rows shows a number the list will not honour');
  assert.match(PANEL, /statusTab === 'DECLINED' && filtered\.length > 0/,
    'CLEAR ALL must appear only in DECLINED, and only with something to sweep');
});

test('the fade is applied before bucketing, so a tab cannot count what it will not show', () => {
  assert.match(DASH, /outgoingItems\s*\n?\s*\.filter\(it => !isFadedDecline\(it\.row\)\)/,
    'filtering after the counts is how a badge starts lying');
});

test('CLEAR ALL sweeps enquiries only — applications keep their own delete', () => {
  assert.match(DASH, /clearableDeclined = outStatuses\.filter\(it => it\.kind === 'enquiry' && it\.bucket === 'declined'\)/,
    'one button must not hide enquiries while destroying applications');
});

test('the enquiry calendar chip is present on the performer surface too', () => {
  assert.match(DASH, /CalendarIconBtn[\s\S]{0,160}Open the enquiry calendar/,
    'the chip existed on two surfaces out of five; it belongs on all of them');
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
