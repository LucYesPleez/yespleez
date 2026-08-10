import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../requirements.js';
import { isMet, stateUi } from './verdictState.js';

/**
 * The verdict display's SEMANTICS, which are the part that can be wrong.
 *
 * The markup cannot be rendered here (no DOM stack, deliberately), but the
 * rule that decides what a reader sees is a pure predicate — so it is tested,
 * and every surface showing a verdict inherits the same answer.
 */

test('satisfied reads as met', () => {
  assert.equal(isMet('satisfied'), true);
});

/**
 * ⭐ 'N/A' is a real answer, not a gap — Rendering Contract R1. Someone who was
 * asked for a website and said they have none has ANSWERED. Showing that as a
 * missing item would demand they invent one to get through a gate.
 */
test('withheld reads as MET — declining is an answer', () => {
  assert.equal(isMet('withheld'), true);
});

test('absent and unknown do not read as met', () => {
  assert.equal(isMet('absent'), false);
  assert.equal(isMet('unknown'), false);
});

test('an unrecognised state is never silently treated as met', () => {
  assert.equal(isMet('something-new'), false);
  assert.equal(isMet(undefined), false);
  assert.equal(isMet(null), false);
});

/**
 * The count in the corner and the ticks in the rows must agree. They are
 * computed independently — `satisfiedCount` by the engine, the marks by
 * `isMet` per row — so a divergence would show "2/3" beside three ticks.
 */
test('the engine count and the per-row marks agree', () => {
  const evaluation = evaluate(['BIO', 'PROFILE_PHOTO', 'WEBSITE'], {
    profile: { bio: 'Loud rooms.', avatar: null, website: 'N/A' },
    assets: [],
  });
  const metRows = evaluation.items.filter(it => isMet(it.state)).length;
  assert.equal(metRows, evaluation.satisfiedCount,
    'the corner count disagrees with the ticks beside the rows');
});

/**
 * A stale key the registry no longer knows is surfaced as non-blocking, so it
 * must NOT be labelled NEEDED — the reader has no way to fix it. The display
 * keys that label on `it.blocking`, so this asserts the engine still supplies
 * the flag the display depends on.
 */
test('an unrecognised key is unmet but NOT blocking, so it is never labelled NEEDED', () => {
  const [item] = evaluate(['NO_SUCH_KEY'], { profile: {}, assets: [] }).items;
  assert.equal(isMet(item.state), false);
  assert.equal(item.blocking, false, 'a stale key would be labelled as the reader is able to fix it');
});

/**
 * The mark is looked up, never indexed directly — an unrecognised state must
 * render as unknown rather than crashing on `undefined.mark`.
 */
test('stateUi always returns a mark, even for a state it has never seen', () => {
  assert.equal(stateUi('satisfied').mark, '✓');
  assert.equal(stateUi('withheld').mark, '✓');
  assert.equal(stateUi('absent').mark, '○');
  assert.equal(stateUi('a-state-from-the-future').mark, '·');
  assert.ok(stateUi(undefined).color, 'no colour for an undefined state');
});
