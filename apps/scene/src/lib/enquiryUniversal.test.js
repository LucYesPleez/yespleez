import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ⭐ ENQUIRY IS UNIVERSAL · AVAILABILITY IS OPTIONAL PUBLIC INFORMATION
 * (ratified 2026-08-14).
 *
 * These are CONTRACT tests, in the repo's source-text style: each one pins a
 * clause of the ratified rule to the line of code or SQL that implements it,
 * so that a later edit which quietly reverts a clause fails a test that names
 * the rule rather than merely changing behaviour. They cannot prove RLS
 * semantics — only the database can — so each policy test asserts the policy
 * SAYS the right thing, and the migration files carry the verification SQL.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');

const S2 = read('../../../../supabase/migrations/20260814000001_s2_offer_insert_policy.sql');
const S3 = read('../../../../supabase/migrations/20260814000002_s3_availability_visibility.sql');
const PROFILE_SCREEN = read('../screens/ProfileScreen.jsx');
const AVAIL_SECTION = read('../components/AvailabilitySection.jsx');
const INVITE_SHEET = read('../components/InviteSheet.jsx');

// ── S2 · the offerer can write, the recipient can answer ────────────────

test('S2: an offerer INSERT leg exists, and it asks can_act_as of the FROM side', () => {
  const policy = S2.slice(S2.indexOf('CREATE POLICY "Venue profile owner can insert venue-initiated enquiries"'));
  assert.ok(policy.includes("initiated_by = 'venue'"),
    'the offer leg must be scoped to venue-initiated rows — unscoped, it would also admit asks');
  assert.ok(policy.includes('public.can_act_as(venue_profile_id)'),
    'the canonical question is "can this user act as the from side" — can_act_as, not a bare join');
});

test('S2: the recipient of an offer can respond — scoped so an asker cannot answer their own ask', () => {
  const updateLeg = S2.slice(S2.indexOf('CREATE POLICY "Applicant can respond to venue-initiated enquiries"'));
  assert.ok(updateLeg.includes('FOR UPDATE'));
  assert.ok(updateLeg.includes("initiated_by = 'venue'"),
    'unscoped, this leg would let the applicant accept a request they themselves sent');
  assert.ok(updateLeg.includes('public.can_act_as(applicant_profile_id)'));
});

test('S2: no applicant-only authorisation is REMOVED — offers are additive, asks keep their legs', () => {
  // The rule replaces applicant-only as the PERMANENT answer, not as the
  // asker's answer. Dropping either applicant leg here would break every
  // working ask-upward flow to make offers look tidier.
  assert.ok(!S2.match(/DROP POLICY[^;]*"Users can insert own enquiries"/));
  assert.ok(!S2.match(/DROP POLICY[^;]*"Applicant profile owner can insert own enquiries"/));
});

// ── S3 · the three availability states, enforced at the boundary ────────

test('S3: the visibility flag is one profile-level boolean, defaulted to today\'s behaviour', () => {
  assert.ok(S3.includes('ADD COLUMN IF NOT EXISTS availability_private boolean NOT NULL DEFAULT false'),
    'an opt-out cannot be derived from an empty table — it must be stored, and existing profiles stay public');
});

test('S3: the unconditional public read is REPLACED, not added beside — permissive policies OR together', () => {
  assert.ok(S3.includes('DROP POLICY IF EXISTS "Public read availability" ON public.artist_availability'),
    'leaving USING(true) in place would make the new policy decorative — the SEC-1 shape');
  assert.ok(S3.includes('availability_private = false'),
    'the SELECT leg must consult the flag: the boundary is RLS, never the UI');
});

test('S3: venue_availability gains its first public SELECT leg (calendars were owner-only, probed live)', () => {
  assert.ok(S3.includes('"Venue availability readable unless withheld"\n  ON public.venue_availability FOR SELECT')
    || /Venue availability readable unless withheld[\s\S]{0,200}FOR SELECT/.test(S3));
});

// ── ProfileScreen · ENQUIRE survives all three states ───────────────────

test('ProfileScreen: a private or unset venue calendar opens a pick-any-date sheet, not a dead end', () => {
  assert.ok(PROFILE_SCREEN.includes(
    "mode={(profile.availability_private || (availDates && availDates.size === 0)) ? 'edit' : 'view'}"),
    'private and not-set must switch to edit mode so the enquirer can name the date — ' +
    'a requested date can be supplied even when availability is private');
});

test('ProfileScreen: private and not-set say different things — withheld is not unknown', () => {
  assert.ok(PROFILE_SCREEN.includes("doesn't publish availability"), 'the private state names a choice');
  assert.ok(PROFILE_SCREEN.includes("isn't published yet"), 'the unset state names an absence');
  // Quoted or JSX-adjacent only: the PROHIBITION on rendering "booked out" is
  // itself stated in comments, which must not trip the check on the copy.
  assert.ok(!/["'>]\s*booked out/i.test(PROFILE_SCREEN),
    'no state may ever be rendered as "booked out" — that claim cannot be derived from a calendar');
});

test('ProfileScreen: the performer CTA does not require published dates when the viewer can offer', () => {
  // venueCtx alone keeps the button: no dates → straight to the enquiry sheet.
  // ⚠ THE FLAG OUTRANKS THE DATA in every branch. S3's RLS hides a private
  // calendar from everyone except its owner, so for the owner the flag and
  // the data disagree — and rendering from the data showed the owner a
  // published-state button nobody else sees (found live, 2026-08-14).
  assert.ok(PROFILE_SCREEN.includes('((!profile.availability_private && perfAvailDates && perfAvailDates.size > 0) || venueCtx)'));
  assert.ok(PROFILE_SCREEN.includes("(!profile.availability_private && perfAvailDates && perfAvailDates.size > 0) ? 'CHECK AVAILABILITY' : 'ENQUIRE'"),
    'with nothing to check, the label must not promise a checking step — and a private calendar has nothing to check even when the owner can see the rows');
});

test('ProfileScreen: a withheld performer calendar is announced to viewers with no enquiry path', () => {
  assert.ok(PROFILE_SCREEN.includes('!venueCtx && profile.availability_private'),
    'withheld must render as a stated fact, not as the same silence as unconfigured');
});

// ── The owner's switch ──────────────────────────────────────────────────

test('AvailabilitySection: the publish switch writes profiles.availability_private and renders only once read', () => {
  assert.ok(AVAIL_SECTION.includes(".update({ availability_private: next })"));
  assert.ok(AVAIL_SECTION.includes('availPrivate !== null &&'),
    'a database without the S3 column must produce no switch, not a broken one');
});

// ── What must NOT have changed ──────────────────────────────────────────

test('P12/P6/P7 intact: the offer path still writes initiated_by and touches no ask-category machinery', () => {
  assert.ok(INVITE_SHEET.includes("initiated_by:     'venue'"),
    'direction derivation depends on initiated_by being written by the offer path');
  // The offer is deliberately UNGATED by the recipient's requirements — the
  // sheet must not import the enquiry gate.
  assert.ok(!INVITE_SHEET.includes('canSendEnquiry'),
    'offers are ungated: a venue requiring its own checklist of an invitee could never invite anyone');
});

test('P12 intact: ask_category is still resolved and stored on the ask path, snapshot preserved', () => {
  assert.ok(PROFILE_SCREEN.includes('resolveAskCategory'), 'the P12 resolver still runs at creation');
  assert.ok(PROFILE_SCREEN.includes('requirements_snapshot') || PROFILE_SCREEN.includes('enquirySnapshot'),
    'the P6/P7 frozen snapshot still travels with the enquiry');
});
