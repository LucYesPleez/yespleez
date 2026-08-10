import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P6 — CONTRACT TESTS OVER THE SCREENS THAT PERSIST AND GATE.
 *
 * Source-level, like claimDelivery / messageKindContract / notificationReaders
 * before them, and for the same reason: these screens cannot be rendered (no
 * DOM stack in this monorepo), but the invariants they carry are the ones that
 * break silently.
 *
 * ⚠ What each of these catches is a WRITE THAT LOOKS FINE. A column dropped
 * from a `select` returns `undefined` and reads as "no requirements"; a field
 * missing from an upsert payload saves successfully and silently discards what
 * the owner just ticked. Nothing throws in either case.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const VENUE   = read('../screens/VenueProfileScreen.jsx');
const HOST    = read('../screens/HostProfileScreen.jsx');
const PROFILE = read('../screens/ProfileScreen.jsx');
const INVITE  = read('../components/InviteSheet.jsx');

// ── Venue persistence ───────────────────────────────────────────────────

test('venue editor SELECTS required_items', () => {
  assert.match(VENUE, /\.select\([^)]*required_items/s,
    'the venue editor never reads its own requirements, so every save starts from empty');
});

test('venue editor WRITES required_items in the upsert payload', () => {
  assert.match(VENUE, /required_items:\s*requiredItems/,
    'ticks are collected and then dropped on save');
});

test('venue editor renders the SHARED checklist, not a second copy', () => {
  assert.match(VENUE, /from '@yespleez\/requirements\/checklist'/);
  assert.match(VENUE, /<RequirementChecklist/);
});

// ── Host persistence ────────────────────────────────────────────────────

test('host editor WRITES required_items in the upsert payload', () => {
  assert.match(HOST, /required_items:\s*requiredItems/);
});

test('host editor READS required_items back', () => {
  // Host selects '*', so the column arrives without naming it — what matters
  // is that the value reaches state rather than being ignored.
  assert.match(HOST, /setRequiredItems\(data\.required_items/);
});

test('host editor renders the SHARED checklist, not a second copy', () => {
  assert.match(HOST, /from '@yespleez\/requirements\/checklist'/);
  assert.match(HOST, /<RequirementChecklist/);
});

/**
 * HOST REQUIREMENTS ARE DORMANT. There is no artist → host enquiry flow, so
 * nothing may evaluate them yet. If a future change starts gating on a host's
 * requirements, it must be a deliberate decision with its own flow — not a
 * side effect of this one.
 */
test('nothing evaluates host requirements — they are stored and dormant', () => {
  assert.doesNotMatch(HOST, /canSendEnquiry|evaluate\(|snapshotEvaluation/,
    'the host editor has started gating something; there is no host enquiry flow to gate');
});

// ── The gate applies to ONE direction ───────────────────────────────────

test('the artist → venue enquiry is gated in the WRITE PATH, not only the button', () => {
  const send = PROFILE.slice(PROFILE.indexOf('async function sendEnquiry'));
  assert.match(send.slice(0, 1200), /if \(!canSendEnquiry\(/,
    'a disabled button is a suggestion; the guard is the rule');
});

test('the artist → venue enquiry stores a P7 snapshot', () => {
  assert.match(PROFILE, /requirements_snapshot:\s*enquirySnapshot\(/);
});

/**
 * ⚠ REGRESSION GUARD. `useState([])` here is the fail-open bug: it makes
 * "requirements not read yet" indistinguishable from "venue asks for nothing",
 * and an enquiry sent in that window skips the gate and stores a null
 * snapshot that can never be told apart from a venue with no requirements.
 */
test('venue requirements start as null (unknown), never as an empty list', () => {
  assert.match(PROFILE, /useState\(null\);?\s*$/m);
  assert.doesNotMatch(PROFILE, /setVenueRequired\]\s*=\s*useState\(\[\]\)/,
    'venueRequired initialises to [], so UNKNOWN reads as "asks for nothing"');
});

test('a failed requirements read does not collapse to "asks for nothing"', () => {
  // The `.then` must bail on error rather than writing `[]`, or a network
  // failure becomes permission.
  assert.match(PROFILE, /if \(cancelled \|\| error\) return;/);
});

test('the gate is told which act the verdict describes', () => {
  // Without the pair, a verdict left over from the previously selected profile
  // answers for the one about to send.
  assert.match(PROFILE, /evaluatedProfileId:\s*reqEvalFor/);
  assert.match(PROFILE, /actingProfileId:\s*enquiryProf\?\.id/);
});

/**
 * ⛔ THE DIRECTION RULE. When a venue invites an artist, the venue is doing the
 * asking. Gating that on the venue's own checklist would let a venue make
 * itself unable to invite anyone — and it would write a verdict onto an
 * `initiated_by: 'venue'` row, which P7's migration states must always be NULL.
 */
test('the venue-initiated invitation path is COMPLETELY ungated', () => {
  assert.doesNotMatch(INVITE, /canSendEnquiry|enquirySnapshot|requirements_snapshot|required_items/,
    'InviteSheet has learned about requirements — the gate is on the wrong direction');
});

test('InviteSheet still writes the venue direction, so the two paths stay distinguishable', () => {
  assert.match(INVITE, /initiated_by:\s*'venue'/);
});

// ── The extraction did not leave a second checklist behind ──────────────

test('no screen defines its own requirement checklist', () => {
  for (const [name, src] of [['VenueProfileScreen', VENUE], ['HostProfileScreen', HOST]]) {
    assert.doesNotMatch(src, /function RequirementChecklist/,
      `${name} defines a local checklist — the registry now has two places to drift from`);
  }
});

// ── One verdict display, two surfaces ───────────────────────────────────

const APPLY = read('../screens/event/ApplyButton.jsx');

/**
 * The read-only verdict (✓ / ○ / NEEDED, the n/total count) is rendered on two
 * screens: applying to an event, and enquiring with a venue. It was duplicated
 * for exactly one commit, which was one too many — the rules it encodes are
 * subtle enough to drift silently. `withheld` counting as MET, and NEEDED
 * keyed on `blocking` rather than `!met`, are both easy to get wrong in a copy
 * and impossible to notice from the screen.
 */
test('both surfaces render the SHARED verdict component', () => {
  for (const [name, src] of [['ApplyButton', APPLY], ['ProfileScreen', PROFILE]]) {
    assert.match(src, /RequirementsVerdict/, `${name} does not use the shared verdict display`);
    assert.match(src, /from '@yespleez\/requirements\/checklist'/, `${name} imports it from the wrong place`);
  }
});

test('neither surface re-implements requirement-state rendering', () => {
  for (const [name, src] of [['ApplyButton', APPLY], ['ProfileScreen', PROFILE]]) {
    assert.doesNotMatch(src, /function RequirementsChecklist|function RequirementsVerdict/,
      `${name} defines its own verdict display`);
    // The tell for a hand-rolled copy: deciding met-ness inline instead of
    // letting the shared component (and its tested `isMet`) decide.
    assert.doesNotMatch(src, /state === 'satisfied' \|\| .*state === 'withheld'/,
      `${name} re-implements the withheld-counts-as-met rule`);
    assert.doesNotMatch(src, /NEEDED/,
      `${name} renders its own NEEDED flag`);
  }
});

/**
 * The component is shown WHAT to call the asker, never asked to work it out.
 * A `mode`/`context` prop would be the boundary breaking — see the
 * consumer-identity rule.
 */
test('the verdict display is told its title by the caller, not by identity', () => {
  assert.match(APPLY, /title="WHAT THIS HOST ASKS FOR"/);
  assert.match(PROFILE, /title="WHAT THIS VENUE ASKS FOR"/);
});
