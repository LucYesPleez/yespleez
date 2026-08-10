import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAskCategory, applicableAskCategories, needsAskCategoryChoice, resolveAskCategory } from './askCategoryResolver.js';
import { isAskCategory, askCategoryLabel } from '@yespleez/ask-categories';

/**
 * THE PROVENANCE CHAIN — role → category → stored key.
 *
 * ⭐ Resolution is from what the act DOES, not from its profile type. These
 * tests are written that way on purpose: `artist → music` would pass today by
 * accident, and would keep passing while the rule silently rotted.
 */

const artist  = roles => ({ type: 'artist',  genre_string: roles.join(' · ') });
const standup = roles => ({ type: 'standup', genre_string: roles.join(' · ') });

// ── The domain rule ──────────────────────────────────────────────────────

test('a DJ asks for MUSIC', () => {
  assert.equal(defaultAskCategory(artist(['dj_prod', 'Drum & Bass'])), 'music');
});

test('an MC asks for MUSIC', () => {
  assert.equal(defaultAskCategory(artist(['mc'])), 'music');
});

test('a band asks for MUSIC — the type IS the supply, it has no roles', () => {
  assert.equal(defaultAskCategory({ type: 'band', genre_string: 'Rock · Jazz' }), 'music');
});

test('a comedian asks for PERFORMANCE', () => {
  assert.equal(defaultAskCategory(standup(['comedy'])), 'performance_artist');
});

test('poetry asks for PERFORMANCE', () => {
  assert.equal(defaultAskCategory(standup(['poetry'])), 'performance_artist');
});

test('comedy AND poetry still resolve to one category, so no choice is needed', () => {
  const p = standup(['comedy', 'poetry']);
  assert.deepEqual(applicableAskCategories(p), ['performance_artist']);
  assert.equal(defaultAskCategory(p), 'performance_artist');
  assert.equal(needsAskCategoryChoice(p), false);
});

test('a punter volunteering asks for VOLUNTEER', () => {
  assert.equal(defaultAskCategory({ type: 'punter' }), 'volunteer');
});

// ── ⚠ The branch that fires today: NONE ──────────────────────────────────

/**
 * A promoter enquiring with a venue is asking to USE THE ROOM — no category
 * covers that, because all nine came from a festival recruiting suppliers.
 * ⛔ Inventing one would describe a flow the product does not support: neither
 * type even has a dashboard that shows enquiries.
 */
test('a host has NO category — null, not an invented one', () => {
  assert.equal(defaultAskCategory({ type: 'host', genre_string: 'ELECTRONIC · Breaks' }), null);
  assert.deepEqual(applicableAskCategories({ type: 'host' }), []);
});

test('a festival has NO category', () => {
  assert.equal(defaultAskCategory({ type: 'festival', name: 'Echo Valley' }), null);
});

test('a venue has no category either — it receives asks, it does not make them', () => {
  assert.equal(defaultAskCategory({ type: 'venue' }), null);
});

test('an artist who has selected no role yet resolves to null, not to music', () => {
  // The TYPE would say music. The ROLE says nothing, and the role is the rule.
  assert.equal(defaultAskCategory(artist(['Drum & Bass', 'Breaks'])), null);
});

test('null-ish input never throws and never guesses', () => {
  for (const p of [null, undefined, {}, { type: '' }, { genre_string: null }]) {
    assert.equal(defaultAskCategory(p), null);
    assert.deepEqual(applicableAskCategories(p), []);
  }
});

// ── The "several" branch: cannot fire today, must still be right ─────────

/**
 * ⛔ NOT "pick the first". The day a profile spans two categories, a resolver
 * that guessed would encode the wrong supply silently and permanently — the
 * exact failure the design exists to prevent.
 */
test('several applicable categories yields NULL and asks for a choice', () => {
  // Constructed by hand: no real profile can do this yet, which is the point.
  const spanning = { type: 'band', genre_string: 'comedy' };  // band → music, comedy → performance
  assert.deepEqual(applicableAskCategories(spanning).sort(), ['music', 'performance_artist']);
  assert.equal(defaultAskCategory(spanning), null, 'the resolver guessed instead of asking');
  assert.equal(needsAskCategoryChoice(spanning), true);
});

test('the two nulls are distinguishable — nothing applies vs a choice is needed', () => {
  assert.equal(needsAskCategoryChoice({ type: 'host' }), false);
  assert.equal(needsAskCategoryChoice({ type: 'band', genre_string: 'comedy' }), true);
});

// ── Everything it returns must exist in the registry ─────────────────────

test('every resolvable category is a real registry key with a label', () => {
  const profiles = [
    artist(['dj_prod']), artist(['mc']), standup(['comedy']), standup(['poetry']),
    { type: 'band' }, { type: 'punter' },
  ];
  for (const p of profiles) {
    const key = defaultAskCategory(p);
    assert.ok(isAskCategory(key), `${key} is not in the registry`);
    assert.ok(askCategoryLabel(key), `${key} has no label`);
  }
});

test('the resolver never returns an excluded trade', () => {
  const excluded = ['sound_system', 'lighting', 'staging'];
  for (const key of excluded) {
    assert.equal(isAskCategory(key), false, `${key} is register_interest and must not be an Ask Category`);
  }
});

// ── The caller contract: three states, never two ─────────────────────────

/**
 * ⛔ THE COLLAPSE THIS PREVENTS. `defaultAskCategory()` returns null for BOTH
 * "nothing applies" and "the asker must choose". A caller writing
 * `ask_category: defaultAskCategory(p)` would store null in the second case and
 * never learn a question went unasked — the resolver would be technically
 * correct while the UI silently treated it as "no category".
 */
test('resolveAskCategory keeps the three states distinct', () => {
  const none     = resolveAskCategory({ type: 'host' });
  const one      = resolveAskCategory({ type: 'artist', genre_string: 'dj_prod' });
  const several  = resolveAskCategory({ type: 'band', genre_string: 'comedy' });

  assert.deepEqual(none,    { category: null,    needsChoice: false, applicable: [] });
  assert.deepEqual(one,     { category: 'music', needsChoice: false, applicable: ['music'] });
  assert.equal(several.category, null);
  assert.equal(several.needsChoice, true);
  assert.deepEqual(several.applicable.slice().sort(), ['music', 'performance_artist']);

  // The whole point: both nulls, told apart.
  assert.equal(none.category, several.category);
  assert.notEqual(none.needsChoice, several.needsChoice);
});

test('a null category always comes with an explanation', () => {
  // Either there was nothing to choose, or a choice is owed. Never neither.
  for (const p of [null, {}, { type: 'host' }, { type: 'festival' },
                   { type: 'artist' }, { type: 'band', genre_string: 'comedy' }]) {
    const r = resolveAskCategory(p);
    if (r.category === null) {
      assert.equal(r.needsChoice, r.applicable.length > 1,
        'a null category with no matching explanation');
    } else {
      assert.equal(r.needsChoice, false);
      assert.deepEqual(r.applicable, [r.category]);
    }
  }
});

test('resolveAskCategory agrees with the primitives it replaces', () => {
  for (const p of [{ type: 'host' }, { type: 'artist', genre_string: 'mc' },
                   { type: 'standup', genre_string: 'comedy · poetry' },
                   { type: 'band', genre_string: 'comedy' }]) {
    const r = resolveAskCategory(p);
    assert.equal(r.category, defaultAskCategory(p));
    assert.equal(r.needsChoice, needsAskCategoryChoice(p));
    assert.deepEqual(r.applicable, applicableAskCategories(p));
  }
});
