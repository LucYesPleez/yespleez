/**
 * CLAIM SUGGESTIONS — "there is already one of you here".
 *
 * ⚠⚠ BOTH FAILURE DIRECTIONS ARE SILENT, AND THEY ARE NOT EQUALLY BAD.
 *
 *   MISSING a match is invisible: the person finishes the form, saves, and the
 *   scene now has two of them — with the gigs, history and followers on the
 *   row they do not own. Nothing logs it and nobody finds out for weeks.
 *
 *   OVER-MATCHING is visible but corrosive: a suggestion that is wrong often
 *   enough trains people to dismiss it unread, and then the one that mattered
 *   goes past unread too.
 *
 * So the tests pin the boundary from both sides: the name variations that MUST
 * match, and the near-misses that must NOT.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const { matchStrength, rank, norm, MIN_QUERY, MAX_SUGGESTIONS } =
  await import('./claimSuggest.js');

test('the same name matches, however it is punctuated or cased', () => {
  for (const written of ['Freedom Machine', 'freedom machine', 'FREEDOM MACHINE',
    'Freedom-Machine', 'freedom  machine', 'Freedom Machine!']) {
    assert.equal(matchStrength('Freedom Machine', written), 'exact',
      `"${written}" is the same promoter`);
  }
});

test('⭐ a leading article is not a different promoter', () => {
  assert.equal(matchStrength('Freedom Machine', 'The Freedom Machine'), 'exact');
  assert.equal(matchStrength('The Freedom Machine', 'Freedom Machine'), 'exact');
  // …and it is dropped only at the START. "Machine The Freedom" is not this.
  assert.equal(matchStrength('Freedom Machine', 'Machine The Freedom'), null);
});

test('a partial name still matches, and is ranked below an exact one', () => {
  assert.equal(matchStrength('Freedom', 'Freedom Machine'), 'contains');
  assert.equal(matchStrength('Freedom Machine Events', 'Freedom Machine'), 'contains');
});

test('⛔ a near-miss does NOT match — this is not fuzzy, deliberately', () => {
  // One letter apart and a completely different act. An edit-distance match
  // would surface both of these, and the false one is what teaches people to
  // stop reading the suggestion.
  assert.equal(matchStrength('Cream Machine', 'Dream Machine'), null);
  assert.equal(matchStrength('Freedom Machine', 'Freedom Fighters'), null);
  assert.equal(matchStrength('Disco Pig', 'Disco Stu'), null);
});

test('⛔ a query shorter than MIN_QUERY matches nothing at all', () => {
  // Two characters match half the catalogue; a suggestion drawn from that is
  // noise wearing the clothes of an answer.
  assert.equal(MIN_QUERY, 3);
  assert.equal(matchStrength('fr', 'Freedom Machine'), null);
  assert.equal(matchStrength('', 'Freedom Machine'), null);
  assert.equal(matchStrength('Freedom', ''), null);
});

test('exact matches rank first, then the least padded name', () => {
  const ranked = rank([
    { id: 'c', name: 'Freedom Machine Events', strength: 'contains' },
    { id: 'a', name: 'Freedom Machine', strength: 'exact' },
    { id: 'b', name: 'Freedom Mach', strength: 'contains' },
  ]);
  assert.deepEqual(ranked.map(r => r.id), ['a', 'b', 'c']);
});

test('ranking is deterministic — two identical names cannot swap between renders', () => {
  const one = rank([
    { id: 'y', name: 'Freedom Machine', strength: 'exact' },
    { id: 'x', name: 'Freedom Machine', strength: 'exact' },
  ]);
  const two = rank([
    { id: 'x', name: 'Freedom Machine', strength: 'exact' },
    { id: 'y', name: 'Freedom Machine', strength: 'exact' },
  ]);
  assert.deepEqual(one.map(r => r.id), two.map(r => r.id));
});

test('normalisation collapses everything that is not a letter or a digit', () => {
  assert.equal(norm('  The   Freedom-Machine!! '), 'the freedom machine');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});

test('⚠ the list is capped — a suggestion strip is not a search results page', () => {
  assert.equal(MAX_SUGGESTIONS, 3);
});
