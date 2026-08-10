import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleRequirement } from './toggleRequirement.js';

/**
 * The one piece of behaviour the checklist has. Tested here rather than
 * through a render because this monorepo has no DOM test stack — which is
 * precisely why the logic was lifted out of the JSX in the first place.
 */

test('ticking adds the key', () => {
  assert.deepEqual(toggleRequirement([], 'BIO'), ['BIO']);
  assert.deepEqual(toggleRequirement(['DEMO_MIX'], 'BIO'), ['DEMO_MIX', 'BIO']);
});

test('ticking again removes it', () => {
  assert.deepEqual(toggleRequirement(['BIO'], 'BIO'), []);
  assert.deepEqual(toggleRequirement(['DEMO_MIX', 'BIO'], 'BIO'), ['DEMO_MIX']);
});

test('never mutates the array it was given', () => {
  const before = ['BIO'];
  const after = toggleRequirement(before, 'DEMO_MIX');
  assert.deepEqual(before, ['BIO'], 'input was mutated');
  assert.notEqual(after, before, 'returned the same reference');
});

/**
 * NULL and '{}' are both "no requirements declared" in the database, so both
 * arrive here as null or an empty array. A profile that has never set one must
 * be tickable, not a crash.
 */
test('treats null and undefined as empty', () => {
  assert.deepEqual(toggleRequirement(null, 'BIO'), ['BIO']);
  assert.deepEqual(toggleRequirement(undefined, 'BIO'), ['BIO']);
});

/**
 * ⛔ Deliberately NOT validated against the registry. The columns are
 * unconstrained for the same reason: an unknown key is surfaced by the engine
 * as non-blocking, and a toggle that silently refused one would produce a
 * tick-box that does nothing when the user clicks it.
 */
test('does not validate keys against the registry', () => {
  assert.deepEqual(toggleRequirement([], 'NOT_A_REAL_KEY'), ['NOT_A_REAL_KEY']);
});

test('removes only the key asked for, leaving duplicates of others alone', () => {
  assert.deepEqual(toggleRequirement(['BIO', 'DEMO_MIX', 'PRESS_KIT'], 'DEMO_MIX'), ['BIO', 'PRESS_KIT']);
});
