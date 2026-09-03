import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentVersion, agreedVersion, versionState, agreementState, agreementTurn,
  currentTerms, paymentState, requestedFeeAmount, formatFee, listTerms,
  diffVersions, agreementHistory, bookingNextStep,
} from './bookingAgreement.js';
import { acceptedNextStep } from './enquiryNextStep.js';

const ACT   = 'profile-act';
const VENUE = 'profile-venue';

/** The brief's own worked example: 450 → 200+bar → 900 → 750+bar → agreed. */
const NEGOTIATION = [
  { version: 1, proposed_by_profile_id: ACT,   fee: 450, currency: 'AUD', terms: {} },
  { version: 2, proposed_by_profile_id: VENUE, fee: 200, currency: 'AUD', terms: { bar_split: '10%' } },
  { version: 3, proposed_by_profile_id: ACT,   fee: 900, currency: 'AUD', terms: {} },
  { version: 4, proposed_by_profile_id: VENUE, fee: 750, currency: 'AUD', terms: { bar_split: '10%' } },
];
const AGREED = [
  ...NEGOTIATION.slice(0, 3),
  { ...NEGOTIATION[3], accepted_at: '2026-08-31T04:00:00Z', accepted_by_profile_id: ACT },
];

/* ── THE THREE FEES ──────────────────────────────────────────────────── */

test('the requested fee is read from the enquiry and never becomes the agreed fee', () => {
  assert.equal(requestedFeeAmount({ proposed_fee: '$450' }), 450);
  assert.equal(requestedFeeAmount({ proposed_fee: '450' }), 450);
  assert.equal(requestedFeeAmount({ proposed_fee: 450 }), 450);
  // The enquiry still says 450 after the parties agree 750 — nothing here writes it.
  assert.equal(currentTerms(AGREED).fee, 750);
  assert.equal(requestedFeeAmount({ proposed_fee: '$450' }), 450);
});

/* ⛔ "450 + 10% bar" IS NOT 450. A bare parseFloat would drop half the deal. */
test('a fee that is not simply an amount is null, not a truncated number', () => {
  assert.equal(requestedFeeAmount({ proposed_fee: '450 + 10% bar' }), null);
  assert.equal(requestedFeeAmount({ proposed_fee: 'door split' }), null);
  assert.equal(requestedFeeAmount({ proposed_fee: '' }), null);
  assert.equal(requestedFeeAmount({}), null);
});

/* ⛔⛔ AGREED IS NOT PAID. */
test('payment is pending even on a fully agreed booking', () => {
  assert.equal(agreementState(AGREED), 'agreed');
  assert.equal(paymentState(), 'pending');
});

test('a fee is never shown without its currency', () => {
  assert.equal(formatFee(750), '$750');
  assert.equal(formatFee(750.5), '$750.50');
  assert.equal(formatFee(750, 'GBP'), '750 GBP');
  assert.equal(formatFee(null), null);
  assert.equal(formatFee(''), null);
});

/* ── DERIVED STATE ───────────────────────────────────────────────────── */

test('the current version is the highest, whatever order they arrive in', () => {
  const shuffled = [NEGOTIATION[2], NEGOTIATION[0], NEGOTIATION[3], NEGOTIATION[1]];
  assert.equal(currentVersion(shuffled).version, 4);
});

test('superseded is derived from a higher version existing, never stored', () => {
  assert.equal(versionState(NEGOTIATION[0], NEGOTIATION), 'superseded');
  assert.equal(versionState(NEGOTIATION[3], NEGOTIATION), 'proposed');
});

/* ⚠ A settled version keeps its outcome even once later versions exist. */
test('an agreed version still reads as agreed after someone reopens terms', () => {
  const reopened = [...AGREED, { version: 5, proposed_by_profile_id: VENUE, fee: 800, terms: {} }];
  assert.equal(versionState(AGREED[3], reopened), 'agreed');
  assert.equal(agreedVersion(reopened).version, 4);
});

test('an enquiry with no versions reads as none, not as an error', () => {
  assert.equal(agreementState([]), 'none');
  assert.equal(agreementState(undefined), 'none');
  assert.equal(currentTerms([]), null);
});

/* ── WHOSE TURN ──────────────────────────────────────────────────────── */

/* ⭐ The proposer is already agreed — the answer is always owed by the other. */
test('the turn belongs to whoever did not make the current proposal', () => {
  assert.equal(agreementTurn(NEGOTIATION, ACT), 'you');    // venue proposed v4
  assert.equal(agreementTurn(NEGOTIATION, VENUE), 'them');
  assert.equal(agreementTurn(NEGOTIATION.slice(0, 3), ACT), 'them');  // act proposed v3
  assert.equal(agreementTurn(NEGOTIATION.slice(0, 3), VENUE), 'you');
});

/* ⛔ NOT ROLE-BASED: a venue is the waiting party as readily as an act. */
test('the turn is decided by who moved last, not by profile type', () => {
  const venueLast = [{ version: 1, proposed_by_profile_id: VENUE, fee: 300, terms: {} }];
  const actLast   = [{ version: 1, proposed_by_profile_id: ACT,   fee: 300, terms: {} }];
  assert.equal(agreementTurn(venueLast, VENUE), 'them');
  assert.equal(agreementTurn(actLast, ACT), 'them');
});

test('nobody is told to act when the viewer has no identity', () => {
  assert.equal(agreementTurn(NEGOTIATION, null), null);
  assert.equal(bookingNextStep({ versions: [], viewerProfileId: null }).chip, null);
});

test('an agreed agreement leaves nobody a term to answer', () => {
  assert.equal(agreementTurn(AGREED, ACT), null);
  assert.equal(agreementTurn(AGREED, VENUE), null);
});

/* ── HISTORY / AUDIT ─────────────────────────────────────────────────── */

test('the history keeps every version and states what changed', () => {
  const history = agreementHistory(AGREED);
  assert.equal(history.length, 4);
  assert.deepEqual(history.map(h => h.version), [1, 2, 3, 4]);
  assert.deepEqual(history.map(h => h.state), ['superseded', 'superseded', 'superseded', 'agreed']);
  // v1 opened at 450; v2 cut it to 200 and added the bar split.
  assert.deepEqual(history[1].changes.map(c => c.label), ['FEE', 'BAR SPLIT']);
  assert.equal(history[1].changes[0].from, '$450');
  assert.equal(history[1].changes[0].to, '$200');
});

/* ⚠ Dropping a term is a material concession and must not read as no change. */
test('a term removed is recorded as a change', () => {
  const changes = diffVersions(
    { version: 1, fee: 200, terms: { bar_split: '10%' } },
    { version: 2, fee: 200, terms: {} },
  );
  assert.deepEqual(changes, [{ field: 'bar_split', label: 'BAR SPLIT', from: '10%', to: null }]);
});

test('the historical values survive a later agreement', () => {
  const history = agreementHistory(AGREED);
  assert.equal(history[0].fee, 450);   // what the artist first requested
  assert.equal(history[3].fee, 750);   // what was agreed
});

/* ⛔ Absent terms are omitted, never rendered as a blank row. */
test('only stated terms are listed', () => {
  assert.deepEqual(listTerms({ bar_split: '10%', door_split: '', set_time: null, load_in: '5pm' }),
    [{ key: 'bar_split', label: 'BAR SPLIT', value: '10%' },
     { key: 'load_in',   label: 'LOAD-IN',   value: '5pm' }]);
  assert.deepEqual(listTerms({}), []);
});

/* ── THE CARD'S ONE ANSWER ───────────────────────────────────────────── */

const VENUE_STEP = acceptedNextStep({ viewerType: 'venue', otherType: 'artist', hasEvent: false });
const ACT_STEP   = acceptedNextStep({ viewerType: 'artist', otherType: 'venue', hasEvent: false });

test('before terms are agreed, the event step is not offered to anyone', () => {
  const venue = bookingNextStep({ versions: NEGOTIATION, viewerProfileId: VENUE, eventStep: VENUE_STEP });
  assert.equal(venue.stage, 'agreement');
  assert.equal(venue.chip, 'WAITING ON THEM');
  assert.equal(venue.action, 'view-agreement');
  assert.notEqual(venue.action, 'create-event');
});

test('the party who must answer gets REVIEW AGREEMENT', () => {
  const act = bookingNextStep({ versions: NEGOTIATION, viewerProfileId: ACT, eventStep: ACT_STEP });
  assert.equal(act.chip, 'YOU NEED TO ACT');
  assert.equal(act.copy, 'Booking details need to be agreed.');
  assert.equal(act.action, 'review-agreement');
});

test('an accepted enquiry with no terms yet asks the reader to start them', () => {
  const step = bookingNextStep({ versions: [], viewerProfileId: VENUE, eventStep: VENUE_STEP });
  assert.equal(step.stage, 'agreement');
  assert.equal(step.chip, 'YOU NEED TO ACT');
  assert.equal(step.action, 'review-agreement');
});

test('once agreed, the venue is asked to create the event', () => {
  const step = bookingNextStep({ versions: AGREED, viewerProfileId: VENUE, eventStep: VENUE_STEP });
  assert.equal(step.stage, 'event');
  assert.equal(step.chip, 'YOU NEED TO ACT');
  assert.equal(step.action, 'create-event');
});

/* ⛔⛔ THE RULE THIS WHOLE WORKFLOW MUST NOT BREAK. */
test('a performer is NEVER offered create-event, at any stage', () => {
  const stages = [[], NEGOTIATION, AGREED];
  for (const versions of stages) {
    for (const otherType of ['venue', 'host']) {
      const eventStep = acceptedNextStep({ viewerType: 'artist', otherType, hasEvent: false });
      const step = bookingNextStep({ versions, viewerProfileId: ACT, eventStep });
      assert.notEqual(step.action, 'create-event');
      assert.notEqual(step.action, 'edit-event');
    }
  }
});

test('after agreement the performer waits on the organiser', () => {
  const step = bookingNextStep({ versions: AGREED, viewerProfileId: ACT, eventStep: ACT_STEP });
  assert.equal(step.stage, 'event');
  assert.equal(step.chip, 'WAITING ON THEM');
  assert.equal(step.copy, 'The venue will create the event.');
  assert.equal(step.action, 'view-agreement');
});

/* Promoter → Venue: the PROMOTER owns the event even though the venue accepts. */
test('a promoter owns event creation even when the venue accepted', () => {
  const venueStep = acceptedNextStep({ viewerType: 'venue', otherType: 'host', hasEvent: false });
  const step = bookingNextStep({ versions: AGREED, viewerProfileId: VENUE, eventStep: venueStep });
  assert.equal(step.chip, 'WAITING ON THEM');
  assert.equal(step.copy, 'The promoter will create the event.');
});

test('an existing event turns create into add/finish rather than a second event', () => {
  const step = bookingNextStep({
    versions: AGREED, viewerProfileId: VENUE,
    eventStep: acceptedNextStep({ viewerType: 'venue', otherType: 'artist', hasEvent: true }),
  });
  assert.equal(step.action, 'edit-event');
});

test('once the act holds a slot there is nothing left to instruct', () => {
  const step = bookingNextStep({ versions: AGREED, viewerProfileId: ACT, eventStep: ACT_STEP, hasSlot: true });
  assert.equal(step.stage, 'slot');
  assert.equal(step.chip, null);
  assert.equal(step.copy, '');
});

/* ⚠ An act enquiring of an act: no event step exists, and that is not a gap. */
test('two performers get an agreement and no event step at all', () => {
  const step = bookingNextStep({
    versions: AGREED, viewerProfileId: ACT,
    eventStep: acceptedNextStep({ viewerType: 'artist', otherType: 'band', hasEvent: false }),
  });
  assert.equal(step.stage, 'agreed');
  assert.equal(step.action, 'view-agreement');
  assert.equal(step.chip, null);
});

/* ⛔ Turned-down terms do not decline the ENQUIRY — either side may propose again. */
test('rejected terms leave the enquiry accepted and the door open', () => {
  const rejected = [{ version: 1, proposed_by_profile_id: ACT, fee: 450, terms: {}, rejected_at: '2026-08-31T05:00:00Z', rejected_by_profile_id: VENUE }];
  const step = bookingNextStep({ versions: rejected, viewerProfileId: VENUE, eventStep: VENUE_STEP });
  assert.equal(step.stage, 'agreement');
  assert.match(step.copy, /Propose new ones/);
  assert.equal(step.action, 'review-agreement');
});

/* ⭐ Every stage keeps a way to talk — the caller renders MESSAGE always, and
   no stage here may return an action that replaces it. */
test('no stage returns an action that could stand in for messaging', () => {
  const actions = new Set();
  for (const versions of [[], NEGOTIATION, AGREED]) {
    for (const viewer of [ACT, VENUE]) {
      actions.add(bookingNextStep({ versions, viewerProfileId: viewer, eventStep: VENUE_STEP }).action);
    }
  }
  for (const a of actions) {
    assert.ok(a === null || ['review-agreement', 'view-agreement', 'create-event', 'edit-event'].includes(a), String(a));
  }
});
