import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineup, sortLineup, SORT_THRESHOLD, BILL, AZ } from './lineupDisplay.js';

const many = n => Array.from({ length: n }, (_, i) => ({ id: i, name: `Artist ${i}` }));

test('no artists and nothing withheld hides the section', () => {
  assert.equal(resolveLineup({ artists: [] }), null);
  assert.equal(resolveLineup({}), null);
  assert.equal(resolveLineup(), null);
});

test('⚠ withheld is NOT absent — it announces itself', () => {
  // R1, the rule the whole contract turns on. Hiding a withheld lineup spends
  // the organiser's reveal for them.
  const r = resolveLineup({ artists: [], withheld: true });
  assert.equal(r.mode, 'withheld');
  assert.notEqual(r, null);
});

test('one artist is a single card, never a rail', () => {
  const r = resolveLineup({ artists: many(1) });
  assert.equal(r.mode, 'single');
  assert.equal(r.artists.length, 1);
  assert.equal(r.sortable, undefined, 'a single card has nothing to sort');
});

test('two or more is a rail', () => {
  assert.equal(resolveLineup({ artists: many(2) }).mode, 'rail');
  assert.equal(resolveLineup({ artists: many(30) }).mode, 'rail');
});

test('⚠ the sort control appears only once it earns its place', () => {
  assert.equal(resolveLineup({ artists: many(SORT_THRESHOLD - 1) }).sortable, false);
  assert.equal(resolveLineup({ artists: many(SORT_THRESHOLD) }).sortable, true);
  assert.equal(resolveLineup({ artists: many(SORT_THRESHOLD + 20) }).sortable, true);
});

test('⚠ artists without a name are not artists', () => {
  const r = resolveLineup({ artists: [{ id: 1, name: 'Real' }, { id: 2 }, null, { name: '' }] });
  assert.equal(r.mode, 'single', 'only one usable entry remains');
  assert.equal(r.artists[0].name, 'Real');
});

test('⚠ a lineup of only unusable entries is absent, not an empty rail', () => {
  assert.equal(resolveLineup({ artists: [{ id: 1 }, null] }), null);
});

// ── ordering ─────────────────────────────────────────────────────────

test('⚠ BILL is the organiser\'s order and is left exactly alone', () => {
  // A–Z destroys what the running order means: who headlines, who opens.
  const bill = [{ name: 'Zara' }, { name: 'Ada' }, { name: 'Mo' }];
  assert.deepEqual(sortLineup(bill, BILL).map(a => a.name), ['Zara', 'Ada', 'Mo']);
  assert.equal(sortLineup(bill, BILL), bill, 'no copy needed when nothing changes');
});

test('A–Z sorts without mutating the original', () => {
  const bill = [{ name: 'Zara' }, { name: 'Ada' }, { name: 'Mo' }];
  const sorted = sortLineup(bill, AZ);
  assert.deepEqual(sorted.map(a => a.name), ['Ada', 'Mo', 'Zara']);
  assert.deepEqual(bill.map(a => a.name), ['Zara', 'Ada', 'Mo'], 'the bill order survives');
});

test('A–Z ignores case, so lowercase acts do not sort to the end', () => {
  const bill = [{ name: 'zara' }, { name: 'Ada' }, { name: 'mo' }];
  assert.deepEqual(sortLineup(bill, AZ).map(a => a.name), ['Ada', 'mo', 'zara']);
});

test('an unknown order is treated as BILL, never as a crash', () => {
  const bill = [{ name: 'Zara' }, { name: 'Ada' }];
  assert.deepEqual(sortLineup(bill, 'nonsense').map(a => a.name), ['Zara', 'Ada']);
});
