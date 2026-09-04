import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getRecentSearches, addRecentSearch, clearRecentSearches, RECENT_LIMIT } from './recentSearches.js';

/* ⚠ A REAL STORE, not a mock of the module under test — these tests exercise
   the JSON round-trip and the throw-handling, which a stubbed getter would
   skip entirely. */
function installStorage(impl) {
  globalThis.localStorage = impl ?? (() => {
    let data = {};
    return {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; },
    };
  })();
}

beforeEach(() => installStorage());

test('an empty store yields an empty list, never null', () => {
  assert.deepEqual(getRecentSearches(), []);
});

test('the newest search comes first', () => {
  addRecentSearch('techno');
  addRecentSearch('drum and bass');
  assert.deepEqual(getRecentSearches(), ['drum and bass', 'techno']);
});

/**
 * ⭐ Searching something again MOVES it, ⛔ it does not duplicate it — and the
 * casing the person typed is what they see back.
 */
test('re-searching moves the term to the top and keeps its casing', () => {
  addRecentSearch('Drum & Bass');
  addRecentSearch('techno');
  addRecentSearch('drum & bass');
  const list = getRecentSearches();
  assert.equal(list.length, 2, 'a case difference created a second entry');
  assert.equal(list[0], 'drum & bass', 'the most recent spelling wins');
});

test(`only ${RECENT_LIMIT} are kept`, () => {
  for (const t of ['one', 'two', 'three', 'four', 'five', 'six']) addRecentSearch(t);
  const list = getRecentSearches();
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], 'six');
  assert.ok(!list.includes('one'), 'the oldest term should have fallen off');
});

/**
 * ⛔⛔ THE SEARCH RUNS AS YOU TYPE, so every letter on the way to a word is a
 * search. Without this the list is "d", "dr", "dru" and the thing you actually
 * looked for is gone.
 */
test('single characters are not recorded', () => {
  addRecentSearch('d');
  assert.deepEqual(getRecentSearches(), []);
  addRecentSearch('dj');
  assert.deepEqual(getRecentSearches(), ['dj']);
});

test('whitespace is trimmed and collapsed, and blanks are ignored', () => {
  addRecentSearch('   ');
  assert.deepEqual(getRecentSearches(), []);
  addRecentSearch('  deep   house  ');
  assert.deepEqual(getRecentSearches(), ['deep house']);
});

test('clearing forgets everything', () => {
  addRecentSearch('techno');
  assert.deepEqual(clearRecentSearches(), []);
  assert.deepEqual(getRecentSearches(), []);
});

/**
 * ⛔⛔ THE ACCESSOR ITSELF THROWS in a private window or with site data
 * blocked. A history is a convenience; search must keep working without it.
 */
test('a storage that throws yields no history and no crash', () => {
  installStorage({
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  });
  assert.deepEqual(getRecentSearches(), []);
  assert.deepEqual(addRecentSearch('techno'), []);
  assert.deepEqual(clearRecentSearches(), []);
});

test('a corrupt stored value is treated as empty, not fatal', () => {
  installStorage();
  localStorage.setItem('yp_recent_searches', '{"not":"an array"}');
  assert.deepEqual(getRecentSearches(), []);
  localStorage.setItem('yp_recent_searches', 'not json at all');
  assert.deepEqual(getRecentSearches(), []);
});
