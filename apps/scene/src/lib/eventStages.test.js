import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStageName, nextStageAccent, stageDeletionBlockers, STAGE_ACCENTS } from './eventStages.js';

test('an event with no stages is offered "Stage 1"', () => {
  assert.equal(nextStageName([]), 'Stage 1');
});

test('⚠ the offered name SKIPS one already taken — (event_id, name) is UNIQUE', () => {
  // Rename "Stage 1" to "Main Room", add another, and the naive count would
  // offer "Stage 2"; rename that to "Stage 3" and the count collides.
  assert.equal(nextStageName([{ name: 'Main Room' }, { name: 'Stage 3' }]), 'Stage 4');
  assert.equal(nextStageName([{ name: 'Stage 2' }]), 'Stage 3');
});

test('the name comparison ignores case and surrounding space', () => {
  assert.equal(nextStageName([{ name: '  stage 1 ' }]), 'Stage 2');
});

test('a base name can be supplied for a venue that calls them rooms', () => {
  assert.equal(nextStageName([], 'Room'), 'Room 1');
});

test('accents cycle so two stages are not the same colour', () => {
  assert.equal(nextStageAccent([]), STAGE_ACCENTS[0]);
  assert.equal(nextStageAccent([{}]), STAGE_ACCENTS[1]);
  assert.equal(nextStageAccent(new Array(STAGE_ACCENTS.length).fill({})), STAGE_ACCENTS[0],
    'wraps rather than running off the end');
});

test('⛔⛔ A STAGE HOLDING SLOTS CANNOT BE DELETED, and says how many', () => {
  // ON DELETE RESTRICT would refuse anyway. The point is that the host gets a
  // number and an instruction instead of a foreign-key violation.
  const slots = [
    { id: 's1', stage_id: 'A' }, { id: 's2', stage_id: 'A' }, { id: 's3', stage_id: 'B' },
  ];
  const blocked = stageDeletionBlockers('A', slots);
  assert.equal(blocked.slots, 2);
  assert.match(blocked.message, /2 slots/);
});

test('an empty stage deletes cleanly', () => {
  assert.equal(stageDeletionBlockers('C', [{ id: 's1', stage_id: 'A' }]), null);
  assert.equal(stageDeletionBlockers('C', []), null);
});

test('⚠ a slot with a NULL stage does not block any stage', () => {
  // Single-stage slots belong to the implicit stage, not to a named one.
  assert.equal(stageDeletionBlockers('A', [{ id: 's1', stage_id: null }]), null);
});

test('the message is singular for one slot', () => {
  assert.match(stageDeletionBlockers('A', [{ stage_id: 'A' }]).message, /1 slot\b/);
});
