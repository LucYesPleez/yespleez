/**
 * LOCALS — the rotating slice of the local scene.
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * Every failure mode here is silent. A rotation that does not actually rotate
 * looks exactly like a working section — you would only catch it by opening
 * the app on two different days and remembering the faces. A ladder that
 * ignores its first rung shows plausible strangers instead of the local
 * scene, and nothing throws. Owning a profile and seeing it recommended back
 * to you reads as a bug in the recommender rather than a missing filter. So:
 *
 *   1. ROTATION MOVES, and moves by a full window — the same day is stable,
 *      the next day is different. This is the whole feature.
 *   2. Rotation WRAPS and eventually covers the pool, so nobody is permanently
 *      invisible just for sorting last.
 *   3. The ladder order — nearby before elsewhere before unplaceable.
 *   4. Unknown ≠ far: a profile with no location is ranked last, never dropped.
 *   5. Owned profiles never appear, by id OR user_id.
 *   6. `punter` is not part of the public scene, and there is no festival type.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocals, localsDayIndex, LOCALS_TYPES } from './locals.js';

/** Distance stub. ⚠ It receives the COORDS profileCoords() returned, not the
 *  profile row — so it must decide from lat/lng alone. (An earlier version of
 *  this stub read a flag off the row, which is not what it is handed; every
 *  profile silently landed on the "elsewhere" rung and the ladder test caught
 *  it.) Near fixtures sit at NEAR_LAT, far ones far away. Keeps these tests
 *  about SELECTION, not haversine — geo.test.js owns that. */
const NEAR_LAT = -30.4;
const withinRadius = (origin, c) => c.lat === NEAR_LAT;
const ORIGIN = { lat: -30.45, lng: 152.9 };

function p(id, extra = {}) {
  return { id, user_id: 'u' + id, type: 'artist', updated_at: '2026-01-01', ...extra };
}
/** Placeable fixture — `near` picks which latitude, which is what the stub reads. */
function placed(id, near, extra = {}) {
  return p(id, { lat: near ? NEAR_LAT : -12.5, lng: 152.9, ...extra });
}

const opts = { originCoords: ORIGIN, radiusKm: 20, withinRadius, isoDate: '2026-08-02' };

/* ─── 1. Rotation actually rotates ─────────────────────────────────── */

test('the same day always yields the same faces', () => {
  const profiles = Array.from({ length: 30 }, (_, i) => placed('p' + i, false));
  const a = buildLocals({ profiles, ...opts, limit: 10 });
  const b = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(a.items.map(x => x.id), b.items.map(x => x.id),
    'two renders on one day must not disagree — that is what banning Math.random buys');
});

test('the next day yields a DIFFERENT set — the feature itself', () => {
  const profiles = Array.from({ length: 30 }, (_, i) => placed('p' + i, false));
  const today    = buildLocals({ profiles, ...opts, isoDate: '2026-08-02', limit: 10 });
  const tomorrow = buildLocals({ profiles, ...opts, isoDate: '2026-08-03', limit: 10 });
  assert.notDeepEqual(today.items.map(x => x.id), tomorrow.items.map(x => x.id));
  const overlap = today.items.filter(x => tomorrow.items.some(y => y.id === x.id));
  assert.equal(overlap.length, 0, 'a full-window step should share nobody with the day before');
});

test('rotation wraps, so sorting last does not mean never shown', () => {
  const profiles = Array.from({ length: 25 }, (_, i) => placed('p' + i, false));
  const seen = new Set();
  // 25 profiles / 10 a day — three days must cover everyone at least once.
  for (const isoDate of ['2026-08-02', '2026-08-03', '2026-08-04']) {
    buildLocals({ profiles, ...opts, isoDate, limit: 10 }).items.forEach(x => seen.add(x.id));
  }
  assert.equal(seen.size, 25, 'every local should surface within a full cycle');
});

test('a pool at or under the limit is shown in ladder order, not rotated', () => {
  const profiles = [placed('far', false), placed('near', true)];
  const r = buildLocals({ profiles, ...opts, isoDate: '2026-09-14', limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['near', 'far'],
    'rotating a short pool would only reshuffle the same faces and lose the ladder');
});

/* ─── 2. The ladder ────────────────────────────────────────────────── */

test('nearby outranks elsewhere, and both outrank unplaceable', () => {
  const profiles = [
    p('nowhere'),                                    // no lat/lng at all
    placed('elsewhere', false),
    placed('nearby',    true),
  ];
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['nearby', 'elsewhere', 'nowhere']);
});

test('within a rung, most recently active comes first', () => {
  const profiles = [
    placed('stale', true, { updated_at: '2025-01-01' }),
    placed('fresh', true, { updated_at: '2026-07-30' }),
  ];
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['fresh', 'stale']);
});

test('UNKNOWN IS NOT FAR — an unplaceable profile is ranked last, never dropped', () => {
  const profiles = [p('nowhere'), placed('near', true)];
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.equal(r.items.length, 2);
  assert.ok(r.items.some(x => x.id === 'nowhere'),
    'excluding it would hide real people wherever postcode coverage is thin');
});

test('with no known origin nothing is claimed to be near, and nobody is lost', () => {
  const profiles = [placed('a', true), placed('b', false), p('c')];
  const r = buildLocals({ profiles, originCoords: null, radiusKm: null, withinRadius, isoDate: '2026-08-02', limit: 10 });
  assert.equal(r.items.length, 3);
  assert.equal(r.nearby, 0, 'we do not guess the user location to manufacture a "near" rung');
});

/* ─── 3. Exclusions ────────────────────────────────────────────────── */

test('a profile the user owns is never shown back to them — by id or user_id', () => {
  const profiles = [placed('mine', true), placed('theirs', true), placed('legacy', true)];
  const r = buildLocals({ profiles, ...opts, excludeIds: ['mine', 'ulegacy'], limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['theirs'],
    'ownership is matched on either key — profiles are referenced both ways in this app');
});

test('punter profiles are not part of the public scene', () => {
  const profiles = [placed('person', true, { type: 'punter' }), placed('band', true, { type: 'band' })];
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['band']);
});

test('every real profile type is eligible, and there is no festival type', () => {
  assert.deepEqual(LOCALS_TYPES, ['artist', 'band', 'standup', 'venue', 'host']);
  const profiles = LOCALS_TYPES.map(t => placed(t, true, { type: t }));
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.equal(r.items.length, LOCALS_TYPES.length,
    'a festival organiser is a host — dropping unknown types would silently hide them');
});

test('an empty catalogue yields an empty section rather than throwing', () => {
  const r = buildLocals({ profiles: [], ...opts });
  assert.deepEqual(r.items, []);
  assert.equal(r.pool, 0);
});

/* ─── 4. The rotation clock ────────────────────────────────────────── */

test('the day index advances by exactly one per calendar day', () => {
  assert.equal(localsDayIndex('2026-08-03') - localsDayIndex('2026-08-02'), 1);
  assert.equal(localsDayIndex('2026-03-01') - localsDayIndex('2026-02-28'), 1);
});

test('a malformed or missing date does not throw or shuffle the pool', () => {
  assert.equal(localsDayIndex(''), 0);
  assert.equal(localsDayIndex(undefined), 0);
});
