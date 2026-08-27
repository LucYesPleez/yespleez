/**
 * ⛔⛔ THE DEFECT THESE GUARD: a set-times card printed a pill reading literally
 * `dj_prod` — the role KEY, straight out of `genre_string`, because the card
 * split the column itself instead of asking `genreLabels()`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actPills } from './actPills.js';

test('⛔⛔ A ROLE KEY NEVER REACHES THE SCREEN', () => {
  assert.deepEqual(actPills({ genre: 'dj_prod', type: 'artist' }), []);
});

test('⭐⭐ NOTHING IS A REAL ANSWER, ⛔ not a gap to fill with the type', () => {
  // Owner, 2026-08-27: "happy to not have dj/prod or band etc written there".
  // A role and a profile type were both considered as a floor and rejected.
  assert.deepEqual(actPills({ type: 'band' }), []);
  assert.deepEqual(actPills({ type: 'artist', genre: 'dj_prod' }), []);
  assert.deepEqual(actPills({}), []);
  assert.deepEqual(actPills(null), []);
});

test('the ladder prefers what the act chose over how it sounds', () => {
  assert.deepEqual(actPills({ card_pills: ['Afrobeat'], sound: 'Roots', genre: 'Techno' }), ['Afrobeat']);
  assert.deepEqual(actPills({ sound: 'Roots', genre: 'Techno' }), ['Roots']);
});

test('⭐ real genres survive while role keys beside them are dropped', () => {
  assert.deepEqual(actPills({ genre: 'Techno · dj_prod · House' }), ['Techno', 'House']);
});

test('⚠ empty card_pills fall THROUGH rather than winning', () => {
  assert.deepEqual(actPills({ card_pills: [], sound: 'Blues' }), ['Blues']);
  assert.deepEqual(actPills({ card_pills: [null, ''], genre: 'Blues' }), ['Blues']);
});

test('⚠ whitespace is not a sound', () => {
  assert.deepEqual(actPills({ sound: '   ', genre: 'Blues' }), ['Blues']);
});
