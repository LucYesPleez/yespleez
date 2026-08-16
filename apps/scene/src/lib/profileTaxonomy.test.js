import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genreLabels, selectedArtistRoleLabels, GENRE_SEP } from './profileTaxonomy.js';

/**
 * ⛔⛔ ROLE KEYS LIVE INSIDE `genre_string`, BESIDE THE GENRES.
 *
 * ⚠ Found in production on the lineup card's GENRES row, 2026-08-16: an act's
 * genres rendered as "dj_prod · Drum & Bass · Breaks", leaking an internal
 * identifier into user-facing copy. The same string also feeds the card FACE
 * whenever the act has written no `sound` of their own, so the leak was one
 * empty field away from the front of the card.
 *
 * ⭐ These pin the DISPLAY rule. `selectedArtistRoleLabels` is the other half —
 * roles are not hidden, they are shown with their LABEL, somewhere else.
 */

test('a role key is never part of the genre list', () => {
  assert.deepEqual(
    genreLabels('dj_prod · Drum & Bass · Breaks'),
    ['Drum & Bass', 'Breaks'],
  );
});

test("a comedian's role key goes too, not just the artist ones", () => {
  assert.deepEqual(genreLabels('comedy · Observational'), ['Observational']);
});

test('⚠ comma-delimited profiles are split as well — My Scene writes those', () => {
  assert.deepEqual(genreLabels('dj_prod, Techno, House'), ['Techno', 'House']);
});

test('a genre list with no role in it is returned intact', () => {
  assert.deepEqual(genreLabels('Techno · House'), ['Techno', 'House']);
});

test('⛔ an act whose ONLY token is its role has no genres, not a stray key', () => {
  assert.deepEqual(genreLabels('dj_prod'), []);
});

test('empty, null and undefined are all the empty list, never a [""]', () => {
  for (const v of ['', null, undefined, '  ']) assert.deepEqual(genreLabels(v), []);
});

/**
 * ⭐ THE TWO HALVES MUST NOT BOTH DROP THE ROLE. If a future edit made
 * `genreLabels` the only reader of the column, the role would vanish from the
 * app entirely rather than moving — so this asserts the label is still
 * recoverable from the same string the genres were stripped from.
 */
test('the role survives as a LABEL even though it left the genre list', () => {
  const s = ['dj_prod', 'Drum & Bass'].join(GENRE_SEP);
  assert.deepEqual(genreLabels(s), ['Drum & Bass']);
  assert.deepEqual(selectedArtistRoleLabels(s), ['DJ / PROD.']);
});
