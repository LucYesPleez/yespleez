import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedNextStep, eventOwnerSide } from './enquiryNextStep.js';

/**
 * THE RATIFIED TABLE, 2026-08-31. Each row is read from BOTH sides, because
 * the whole point is that the two sides see different things: the party who
 * must act gets a verb, the party who waits gets an explanation.
 *
 *   Enquiry             Who accepts   Who creates the event
 *   Artist   → Venue    Venue         VENUE
 *   Promoter → Venue    Venue         PROMOTER
 *   Artist   → Promoter Promoter      PROMOTER
 *   Venue    → Artist   Artist        VENUE
 *   Promoter → Artist   Artist        PROMOTER
 */
const TABLE = [
  { pair: 'artist ↔ venue',   a: 'artist',  b: 'venue', creator: 'venue' },
  { pair: 'host ↔ venue',     a: 'host',    b: 'venue', creator: 'host'  },
  { pair: 'artist ↔ host',    a: 'artist',  b: 'host',  creator: 'host'  },
  { pair: 'band ↔ venue',     a: 'band',    b: 'venue', creator: 'venue' },
  { pair: 'standup ↔ host',   a: 'standup', b: 'host',  creator: 'host'  },
];

test('the creator of the event is the same party whichever side is reading', () => {
  for (const { pair, a, b, creator } of TABLE) {
    const fromA = eventOwnerSide(a, b);
    const fromB = eventOwnerSide(b, a);
    assert.equal(fromA, a === creator ? 'you' : 'them', `${pair} read from ${a}`);
    assert.equal(fromB, b === creator ? 'you' : 'them', `${pair} read from ${b}`);
  }
});

test('⭐ a promoter at a venue creates the event, even though the VENUE accepted', () => {
  // The case the owner called out: acceptance is permission, not ownership.
  const venueSees = acceptedNextStep({ viewerType: 'venue', otherType: 'host' });
  assert.equal(venueSees.chip, 'WAITING ON THEM');
  assert.equal(venueSees.copy, 'The promoter will create the event.');
  assert.equal(venueSees.action, null, 'the venue is being offered an action that is not theirs');

  const promoterSees = acceptedNextStep({ viewerType: 'host', otherType: 'venue' });
  assert.equal(promoterSees.chip, 'YOU NEED TO ACT');
  assert.equal(promoterSees.copy, 'Next: create the event and add this act.');
  assert.equal(promoterSees.action, 'create-event');
});

test('a venue that accepted an act creates the event', () => {
  const venue = acceptedNextStep({ viewerType: 'venue', otherType: 'artist' });
  assert.equal(venue.chip, 'YOU NEED TO ACT');
  assert.equal(venue.action, 'create-event');
  assert.match(venue.copy, /^Next: create the event/);
});

test('⛔⛔ a performer is ALWAYS the waiting party and is never given an action', () => {
  for (const performer of ['artist', 'band', 'standup']) {
    for (const other of ['venue', 'host']) {
      const seen = acceptedNextStep({ viewerType: performer, otherType: other });
      assert.equal(seen.owner, 'them', `${performer} was made the event owner against ${other}`);
      assert.equal(seen.action, null, `${performer} was offered a workflow action`);
      assert.equal(seen.chip, 'WAITING ON THEM');
      assert.doesNotMatch(seen.copy, /you (create|make)/i);
    }
  }
});

test('the waiting copy names the party who actually holds the move', () => {
  assert.equal(acceptedNextStep({ viewerType: 'artist', otherType: 'venue' }).copy,
    'The venue will create the event.');
  assert.equal(acceptedNextStep({ viewerType: 'artist', otherType: 'host' }).copy,
    'The promoter will create the event.');
});

/**
 * ⭐ THE STATE THAT WAS MISSING. An event that already exists needs adding to,
 * not creating — and the same reader sees a different verb for it.
 */
test('an enquiry that already names an event asks for the EVENT to be finished', () => {
  // Accepting created the draft and shortlisted the act, so what is left is
  // the event itself — telling them to add an act already added is how a
  // workflow loses trust.
  const owner = acceptedNextStep({ viewerType: 'venue', otherType: 'artist', hasEvent: true });
  assert.equal(owner.action, 'edit-event');
  assert.equal(owner.copy, 'Next: finish setting up the event.');

  const waiting = acceptedNextStep({ viewerType: 'artist', otherType: 'venue', hasEvent: true });
  assert.equal(waiting.action, null);
  assert.equal(waiting.copy, 'The venue will add you to the event.');
});

test('⚠ a pair with no possible event owner gets no chip and no action', () => {
  // Universal enquiry means an act may ask an act. Nothing in the event model
  // describes that, so it says nothing rather than guessing.
  const seen = acceptedNextStep({ viewerType: 'artist', otherType: 'band' });
  assert.deepEqual(seen, { owner: null, chip: null, copy: '', action: null });
  assert.equal(eventOwnerSide('artist', 'band'), null);
});

test('⚠ a festival waits — Scene gives it no surface on which to create', () => {
  assert.equal(eventOwnerSide('festival', 'artist'), null);
  assert.equal(acceptedNextStep({ viewerType: 'venue', otherType: 'festival' }).owner, 'you');
});

test('unknown or missing types never invent an owner', () => {
  assert.equal(eventOwnerSide(undefined, undefined), null);
  assert.equal(acceptedNextStep({}).action, null);
  assert.equal(acceptedNextStep().chip, null);
});
