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
  const profiles = Array.from({ length: 30 }, (_, i) => placed('p' + i, true));
  const a = buildLocals({ profiles, ...opts, limit: 10 });
  const b = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(a.items.map(x => x.id), b.items.map(x => x.id),
    'two renders on one day must not disagree — that is what banning Math.random buys');
});

test('the next day yields a DIFFERENT set — the feature itself', () => {
  const profiles = Array.from({ length: 30 }, (_, i) => placed('p' + i, true));
  const today    = buildLocals({ profiles, ...opts, isoDate: '2026-08-02', limit: 10 });
  const tomorrow = buildLocals({ profiles, ...opts, isoDate: '2026-08-03', limit: 10 });
  assert.notDeepEqual(today.items.map(x => x.id), tomorrow.items.map(x => x.id));
  const overlap = today.items.filter(x => tomorrow.items.some(y => y.id === x.id));
  assert.equal(overlap.length, 0, 'a full-window step should share nobody with the day before');
});

test('rotation wraps, so sorting last does not mean never shown', () => {
  const profiles = Array.from({ length: 25 }, (_, i) => placed('p' + i, true));
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
    'one local cannot fill a ten-card rail, so it reaches further — with the local one still first');
});

/* ─── 2. The ladder ────────────────────────────────────────────────── */

test('nearby leads, unplaceable follows, and a borrowed far profile comes last', () => {
  const profiles = [
    p('nowhere'),                                    // no lat/lng at all
    placed('elsewhere', false),
    placed('nearby',    true),
  ];
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(r.items.map(x => x.id), ['nearby', 'nowhere', 'elsewhere'],
    'the local scene leads; anything borrowed to fill the rail sits behind it');
  assert.equal(r.expanded, true, 'and the borrowing is declared, never silent');
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

/* ─── 5 · IT MAY REACH FURTHER, BUT IT MUST SAY SO ──────────────────
   The rail showed Daddy Longlegs, who is in Cairns — 1678 km from Bellingen
   (owner, 2026-08-03). The reach itself was wanted: "if there's no new gigs
   I'd rather it push out into nearby events, but it has to say that." What
   was missing was the saying. So these tests pin BOTH halves: local fills the
   rail alone wherever it can, and any widening is flagged so the section can
   declare it. A silent widening is the actual defect. */

test('local fills the rail on its own when there is enough of it', () => {
  const profiles = Array.from({ length: 12 }, (_, i) => placed('near' + i, true))
    .concat([placed('cairns', false)]);
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.equal(r.expanded, false, 'nothing was borrowed, so nothing is claimed');
  assert.ok(!r.items.some(x => x.id === 'cairns'),
    'with ten locals available, a profile 1678 km away has no business here');
});

test('a thin local scene reaches further AND flags that it did', () => {
  const profiles = [placed('near1', true), placed('near2', true)]
    .concat(Array.from({ length: 20 }, (_, i) => placed('far' + i, false)));
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.equal(r.expanded, true, 'it borrowed, so it must say so');
  assert.equal(r.localCount, 2, 'and it says how many were actually local');
  assert.ok(r.items.length > 2, 'the rail is filled rather than left nearly empty');
});

test('the far cards are identifiable, so the section can mark them', () => {
  const profiles = [placed('near1', true)]
    .concat(Array.from({ length: 15 }, (_, i) => placed('far' + i, false)));
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  const flagged = r.items.filter(x => r.farIds.has(x.id));
  assert.ok(flagged.length > 0, 'a disclosure with nothing to point at is decoration');
  assert.ok(!r.farIds.has('near1'), 'a local card is never marked as distant');
});

test('locals still lead the rail when it has been widened', () => {
  const profiles = [placed('near1', true), placed('near2', true)]
    .concat(Array.from({ length: 20 }, (_, i) => placed('far' + i, false)));
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.deepEqual(r.items.slice(0, 2).map(x => x.id), ['near1', 'near2'],
    'reaching further must not demote the local scene it exists to show');
});

test('unplaceable profiles count as local, not as a reach', () => {
  // Only 92 of 109 profiles carry a postcode. Treating the rest as distant
  // would hide most of a thin catalogue behind a disclosure it has not earned.
  const profiles = Array.from({ length: 10 }, (_, i) => p('nowhere' + i));
  const r = buildLocals({ profiles, ...opts, limit: 10 });
  assert.equal(r.expanded, false, 'unknown is not far, so nothing was borrowed');
  assert.equal(r.items.length, 10);
});

test('with no origin set there is no reach to declare', () => {
  const profiles = [placed('a', true), placed('b', false), p('c')];
  const r = buildLocals({ profiles, originCoords: null, radiusKm: null, withinRadius, isoDate: '2026-08-02', limit: 10 });
  assert.equal(r.items.length, 3);
  assert.equal(r.expanded, false, 'without a location nothing is KNOWN to be distant');
});
