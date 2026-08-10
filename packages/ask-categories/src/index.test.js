import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_CATEGORIES, ASK_CATEGORY_KEYS,
  askCategory, askCategoryLabel, activeAskCategories, isAskCategory,
} from './index.js';

/**
 * The registry's invariants. Small file, but the keys are STORED on
 * interaction rows — changing one silently orphans every ask that carries it.
 */

test('the nine ratified keys, exactly', () => {
  assert.deepEqual(ASK_CATEGORY_KEYS.slice().sort(), [
    'decor', 'food_vendor', 'market_stall', 'media', 'music',
    'performance_artist', 'theme_camp', 'volunteer', 'workshop',
  ]);
});

/**
 * ⛔ The three `register_interest` trades are NOT Ask Categories. Festival's
 * config: the trades are "procured, not auditioned … the durable thing for
 * them is the PROFILE, not the application". No queue, no decision ⇒ no ask.
 */
test('the register_interest trades are absent', () => {
  for (const key of ['sound_system', 'lighting', 'staging']) {
    assert.equal(isAskCategory(key), false, `${key} must not be an Ask Category`);
  }
});

test('every key is unique', () => {
  assert.equal(new Set(ASK_CATEGORY_KEYS).size, ASK_CATEGORY_KEYS.length);
});

test('every category has a non-empty label that is not its key', () => {
  for (const c of ASK_CATEGORIES) {
    assert.ok(c.label && c.label.trim(), `${c.key} has no label`);
    assert.notEqual(c.label, c.key, `${c.key} shows engine vocabulary on screen`);
    assert.doesNotMatch(c.label, /_/, `${c.key}'s label looks like a key: "${c.label}"`);
  }
});

/**
 * ⭐ The label need not equal the key — and this is the case that proves it.
 * `performance_artist` keeps Festival's key (so no migration) while displaying
 * "Performance", because Performers names the PEOPLE and Performance names what
 * is being requested.
 */
test('performance_artist displays as Performance, and keeps its key', () => {
  assert.equal(askCategoryLabel('performance_artist'), 'Performance');
  assert.ok(isAskCategory('performance_artist'));
  assert.equal(isAskCategory('performance'), false, 'the key was renamed — Festival data would orphan');
});

test('sort_order is unique and orders the active list', () => {
  const orders = ASK_CATEGORIES.map(c => c.sort_order);
  assert.equal(new Set(orders).size, orders.length, 'two categories share a sort_order');
  const sorted = activeAskCategories().map(c => c.sort_order);
  assert.deepEqual(sorted, sorted.slice().sort((a, b) => a - b));
});

/**
 * ⛔ Null, never a guess and never the raw key. Three different situations
 * arrive here as an unknown key — a historical row, an asker with no category,
 * a key dropped from the registry — and all three mean "render no chip".
 */
test('an unknown key yields null rather than borrowing an identity', () => {
  assert.equal(askCategory('NOT_A_KEY'), null);
  assert.equal(askCategoryLabel('NOT_A_KEY'), null);
  assert.equal(askCategoryLabel(null), null);
  assert.equal(askCategoryLabel(undefined), null);
});

test('the definition is returned whole, so callers never rebuild it', () => {
  assert.deepEqual(askCategory('music'), { key: 'music', label: 'Music', active: true, sort_order: 10 });
});
