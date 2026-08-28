import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaBreakdown } from '../lib/areas.js';

const f = (props, over) => ({ name: 'filtered', device_id: 'd1', user_id: null, props, ...over });

test('applied and asked stay separate columns — an unmet ask is a coverage gap, not zero interest', () => {
  const out = areaBreakdown([
    f({ region: 'bellingen' }),
    f({ region: 'bellingen' }),
    f({ region_intent: 'bellingen' }),
  ], { population: 'public', segments: {} });
  const b = out.regions[0];
  assert.equal(b.region, 'bellingen');
  assert.equal(b.applied, 2);
  assert.equal(b.asked, 1);
});

test('unresolved places are counted, never named — the flag is all the row carries', () => {
  const out = areaBreakdown([f({ region_unresolved: true })], { population: 'public', segments: {} });
  assert.equal(out.unresolved, 1);
  assert.equal(out.regions.length, 0);
});

test('only filtered events read; the population filter uses THE classifier', () => {
  const seg = { users: { 'u-int': 'internal' }, devices: {} };
  const out = areaBreakdown([
    f({ region: 'coffs' }, { user_id: 'u-int' }),  // internal — out of public
    f({ region: 'coffs' }, { user_id: 'u-pub' }),
    { name: 'screen_view', device_id: 'd1', user_id: null, props: { region: 'not-a-filter' } },
  ], { population: 'public', segments: seg });
  assert.equal(out.regions[0].applied, 1);
  assert.equal(out.searches, 1);
});

test('devices count distinct browsers per region — demand breadth, not volume', () => {
  const out = areaBreakdown([
    f({ region: 'dorrigo' }, { device_id: 'a' }),
    f({ region: 'dorrigo' }, { device_id: 'a' }),
    f({ region: 'dorrigo' }, { device_id: 'b' }),
  ], { population: 'public', segments: {} });
  assert.equal(out.regions[0].applied, 3);
  assert.equal(out.regions[0].devices, 2);
});

test('state facets aggregate alongside, and searches_with_region counts region-carrying rows', () => {
  const out = areaBreakdown([
    f({ state: 'NSW', region: 'bellingen' }),
    f({ state: 'NSW' }),
    f({ has_query: true }),
  ], { population: 'public', segments: {} });
  assert.deepEqual(out.states, [{ state: 'NSW', count: 2 }]);
  assert.equal(out.searches, 3);
  assert.equal(out.searches_with_region, 1);
});
