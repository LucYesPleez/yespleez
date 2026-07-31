/**
 * SCENE FLOOR — the catalogue slice that keeps My Scene alive.
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * The floor's whole promise is "never empty, never fake". Its failure modes
 * are all silent: a ladder that skips a rung shows a punter nothing and looks
 * like a quiet week; a count computed anywhere other than the filter drifts
 * from the list it labels; an unplaceable event silently dropped hides real
 * supply. None of these throw. So the tests pin:
 *
 *   1. The ladder ORDER — radius expands first (genres intact), genres relax
 *      second (back at the requested radius). Reversing the two changes what
 *      a user sees with no error anywhere.
 *   2. The requested radius is remembered while a wider one is borrowed.
 *   3. count === the filtered set the items were cut from, cap or no cap.
 *   4. Unknown ≠ far: unplaceable events are excluded by km radii, included
 *      by Anywhere, and always eligible for the non-geo sections.
 *   5. Dedupe is against what is ON SCREEN, and personal/past events never
 *      reach the floor at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSceneFloor, eventMatchesGenres, SCENE_RADIUS_STEPS, SCENE_GENRES,
  SCENE_CATEGORIES, expandGenreSelection, toggleSceneGenre, isValidSceneToken,
} = await import('./sceneFloor.js');
const { postcodeCoords, haversineKm } = await import('./geo.js');

// Origin: Bellingen, the first venue client's postcode.
const BELL = postcodeCoords('2454');

let seq = 0;
/** Event fixture. kmNorth places it that many km from the origin via its own
 *  lat/lng (the venue-independent path of eventCoords). unplaceable = no
 *  coordinates and no postcode anywhere. */
function ev({ date = '2026-01-10', kmNorth = null, genres = '', created = '2025-12-28T00:00:00Z', unplaceable = false } = {}) {
  const id = `ev-${++seq}`;
  return {
    id, name: id, created_at: created,
    config: { date, genres },
    venue_profile_id: null, venue: null,
    postcode: null, state: null,
    ...(unplaceable || kmNorth === null ? {} : { lat: BELL.lat + kmNorth / 111, lng: BELL.lng }),
  };
}

const BASE = {
  todayIso: '2026-01-01',
  weekendFrom: '2026-01-02',
  weekendTo: '2026-01-04',
  newSinceIso: '2025-12-25T00:00:00Z',
  originCoords: BELL,
  originPostcode: '2454',
};

// Sanity: the fixture geometry must actually mean what the tests assume.
test('fixture: kmNorth places an event at that straight-line distance', () => {
  const e = ev({ kmNorth: 30 });
  const km = haversineKm(BELL.lat, BELL.lng, e.lat, e.lng);
  assert.ok(Math.abs(km - 30) < 1, `expected ~30km, got ${km}`);
});

// ── 1 · THE LADDER ───────────────────────────────────────────────────

test('a satisfied radius is used as requested', () => {
  const near = ev({ kmNorth: 7 });
  const { aroundYou } = buildSceneFloor({ ...BASE, events: [near], radiusKm: 10 });
  assert.equal(aroundYou.usedRadius, 10);
  assert.equal(aroundYou.requestedRadius, 10);
  assert.deepEqual(aroundYou.items.map(e => e.id), [near.id]);
});

test('an empty radius expands to the next rung and reports both radii', () => {
  const far = ev({ kmNorth: 30 }); // beyond 20, inside 50
  const { aroundYou } = buildSceneFloor({ ...BASE, events: [far], radiusKm: 10 });
  assert.equal(aroundYou.requestedRadius, 10, 'the selection is remembered');
  assert.equal(aroundYou.usedRadius, 50, 'the list borrows the first non-empty rung');
  assert.deepEqual(aroundYou.items.map(e => e.id), [far.id]);
});

test('the radius expands BEFORE genres relax — a wrong-genre event nearby never outranks a right-genre event further out', () => {
  const nearWrong = ev({ kmNorth: 7, genres: 'House' });
  const farRight = ev({ kmNorth: 30, genres: 'Techno' });
  const { aroundYou } = buildSceneFloor({
    ...BASE, events: [nearWrong, farRight], radiusKm: 10, genres: ['Techno'],
  });
  assert.equal(aroundYou.genresRelaxed, false);
  assert.equal(aroundYou.usedRadius, 50);
  assert.deepEqual(aroundYou.items.map(e => e.id), [farRight.id]);
});

test('genres relax only after every radius fails, restarting at the requested radius', () => {
  const nearHouse = ev({ kmNorth: 7, genres: 'House' });
  const { aroundYou } = buildSceneFloor({
    ...BASE, events: [nearHouse], radiusKm: 10, genres: ['Techno'],
  });
  assert.equal(aroundYou.genresRelaxed, true);
  assert.equal(aroundYou.usedRadius, 10, 'relaxation returns to the requested rung, not Anywhere');
  assert.deepEqual(aroundYou.items.map(e => e.id), [nearHouse.id]);
});

test('a stored radius that is no longer a step snaps UP, never shrinking the request', () => {
  const e22 = ev({ kmNorth: 22 });
  const { aroundYou } = buildSceneFloor({ ...BASE, events: [e22], radiusKm: 25 });
  assert.equal(aroundYou.requestedRadius, 50, '25 is not a step; the next step up is 50');
  assert.deepEqual(aroundYou.items.map(e => e.id), [e22.id]);
  const { aroundYou: huge } = buildSceneFloor({ ...BASE, events: [e22], radiusKm: 9999 });
  assert.equal(huge.requestedRadius, null, 'beyond every step means Anywhere');
});

// ── 2 · UNKNOWN ≠ FAR ────────────────────────────────────────────────

test('an unplaceable event is excluded by a km radius but included by Anywhere', () => {
  const ghost = ev({ unplaceable: true, created: '2025-12-20T00:00:00Z' });
  const { aroundYou } = buildSceneFloor({ ...BASE, newSinceIso: '2025-12-24T00:00:00Z', events: [ghost], radiusKm: 10 });
  assert.equal(aroundYou.usedRadius, null, 'only the Anywhere rung can admit an unknown distance');
  assert.deepEqual(aroundYou.items.map(e => e.id), [ghost.id]);
});

test('with placed events in range, the unplaceable one still reaches the floor via Just Announced', () => {
  const near = ev({ kmNorth: 7 });
  const ghost = ev({ unplaceable: true, date: '2026-01-20', created: '2025-12-29T00:00:00Z' });
  const floor = buildSceneFloor({ ...BASE, events: [near, ghost], radiusKm: 10 });
  assert.deepEqual(floor.aroundYou.items.map(e => e.id), [near.id], 'a km radius cannot claim a distance it does not know');
  assert.ok(floor.justAnnounced.items.some(e => e.id === ghost.id), 'but the event is not silently dropped from the floor');
});

// ── 3 · THE COUNT IS THE LIST ────────────────────────────────────────

test('count comes from the same filtered set the items were cut from, past the display cap', () => {
  const events = Array.from({ length: 15 }, () => ev({ kmNorth: 7 }));
  const { aroundYou } = buildSceneFloor({ ...BASE, events, radiusKm: 10 });
  assert.equal(aroundYou.count, 15);
  assert.equal(aroundYou.items.length, 12);
});

// ── 4 · NO ORIGIN ────────────────────────────────────────────────────

test('no postcode: Around You steps aside but the other sections keep the page alive', () => {
  const fresh = ev({ date: '2026-01-20', created: '2025-12-29T00:00:00Z' });
  const weekend = ev({ date: '2026-01-03', created: '2025-11-01T00:00:00Z' });
  const floor = buildSceneFloor({ ...BASE, originCoords: null, originPostcode: null, events: [fresh, weekend], radiusKm: 50 });
  assert.equal(floor.aroundYou.noOrigin, true);
  assert.equal(floor.aroundYou.items.length, 0);
  assert.deepEqual(floor.justAnnounced.items.map(e => e.id), [fresh.id]);
  assert.deepEqual(floor.thisWeekend.items.map(e => e.id), [weekend.id]);
});

// ── 5 · WHAT NEVER REACHES THE FLOOR ─────────────────────────────────

test('excluded (personal-section) and past events never appear in any floor section', () => {
  const saved = ev({ kmNorth: 7, date: '2026-01-03', created: '2025-12-29T00:00:00Z' });
  const past = ev({ kmNorth: 7, date: '2025-12-30', created: '2025-12-29T00:00:00Z' });
  const keeper = ev({ kmNorth: 7 });
  const floor = buildSceneFloor({
    ...BASE, events: [saved, past, keeper], radiusKm: 10,
    excludeEventIds: new Set([saved.id]),
  });
  const everywhere = [...floor.aroundYou.items, ...floor.justAnnounced.items, ...floor.thisWeekend.items].map(e => e.id);
  assert.ok(!everywhere.includes(saved.id), 'an event already in a personal section is not re-pitched');
  assert.ok(!everywhere.includes(past.id), 'the floor only looks forward');
  assert.ok(everywhere.includes(keeper.id));
});

// ── 6 · DEDUPE IS AGAINST THE SCREEN ─────────────────────────────────

test('an event shown in Around You is not repeated below; a weekend event not shown above still appears', () => {
  const near = ev({ kmNorth: 7, date: '2026-01-03', created: '2025-12-29T00:00:00Z' }); // weekend + recent + near
  const weekendOnly = ev({ kmNorth: 80, date: '2026-01-03', created: '2025-11-01T00:00:00Z' });
  const floor = buildSceneFloor({ ...BASE, events: [near, weekendOnly], radiusKm: 10 });
  assert.deepEqual(floor.aroundYou.items.map(e => e.id), [near.id]);
  assert.ok(!floor.justAnnounced.items.some(e => e.id === near.id));
  assert.ok(!floor.thisWeekend.items.some(e => e.id === near.id));
  assert.deepEqual(floor.thisWeekend.items.map(e => e.id), [weekendOnly.id]);
});

test('Just Announced is newest-first and honours its cutoff', () => {
  // A near event keeps Around You occupied so the ladder never climbs to
  // Anywhere and swallows the far ones (which is correct — see the dedupe
  // test): the far events are then Just Announced material.
  const near = ev({ kmNorth: 7, created: '2025-11-01T00:00:00Z' });
  const older = ev({ kmNorth: 300, created: '2025-12-26T00:00:00Z' });
  const newer = ev({ kmNorth: 300, created: '2025-12-30T00:00:00Z' });
  const ancient = ev({ kmNorth: 300, created: '2025-11-01T00:00:00Z' });
  const floor = buildSceneFloor({ ...BASE, events: [near, older, newer, ancient], radiusKm: 10 });
  assert.deepEqual(floor.aroundYou.items.map(e => e.id), [near.id]);
  assert.deepEqual(floor.justAnnounced.items.map(e => e.id), [newer.id, older.id]);
});

// ── 7 · GENRE MATCHING ───────────────────────────────────────────────

test('genre matching: equality and containment, both musically true positives', () => {
  assert.ok(eventMatchesGenres({ config: { genres: 'Tech House, Breaks' } }, ['House']));
  assert.ok(eventMatchesGenres({ config: { genres: 'Psytrance' } }, ['Trance']));
  assert.ok(!eventMatchesGenres({ config: { genres: 'Hard Dance / Hardcore' } }, ['House']));
});

test('no selection matches everything; no genres on the event fails a genre filter', () => {
  assert.ok(eventMatchesGenres({ config: { genres: '' } }, []));
  assert.ok(!eventMatchesGenres({ config: { genres: '' } }, ['Techno']));
});

// ── 7b · PROGRESSIVE TUNE: CATEGORIES ────────────────────────────────

test('a category key expands to its whole bucket and matches through it', () => {
  assert.ok(expandGenreSelection(['ELECTRONIC']).includes('Techno'));
  assert.ok(!expandGenreSelection(['ELECTRONIC']).includes('Rock'));
  assert.ok(expandGenreSelection(['BANDS', 'Psytrance']).includes('Rock'));
  assert.ok(expandGenreSelection(['BANDS', 'Psytrance']).includes('Psytrance'));
  assert.ok(eventMatchesGenres({ config: { genres: 'Techno' } }, ['ELECTRONIC']));
  assert.ok(!eventMatchesGenres({ config: { genres: 'Stand-up Comedy' } }, ['ELECTRONIC']));
});

test('ALL and specific genres stay mutually exclusive per category', () => {
  // Picking the ALL chip clears that category's individual picks…
  let sel = ['Techno', 'House', 'Rock'];
  sel = toggleSceneGenre(sel, 'ELECTRONIC');
  assert.deepEqual(sel.sort(), ['ELECTRONIC', 'Rock'].sort(), 'Rock (BANDS) survives, electronic picks fold into the key');
  // …and picking a genre inside a bucket clears that bucket's ALL key.
  sel = toggleSceneGenre(sel, 'Psytrance', 'ELECTRONIC');
  assert.deepEqual(sel.sort(), ['Psytrance', 'Rock'].sort());
  // Plain toggle-off still works.
  assert.deepEqual(toggleSceneGenre(['Psytrance'], 'Psytrance'), []);
});

test('the stored-token validator admits keys and genres, rejects host-format leftovers', () => {
  assert.ok(isValidSceneToken('ELECTRONIC'));
  assert.ok(isValidSceneToken('Techno'));
  assert.ok(!isValidSceneToken('Peak Time'), 'subgenres are not scene tokens');
  assert.ok(!isValidSceneToken('Multi Genre'));
});

// ── 7c · FAVOURITES LEAD YOUR AREA ───────────────────────────────────

test('favourite venues/hosts list first; date order holds within each group', () => {
  const early     = ev({ kmNorth: 7, date: '2026-01-05' });
  const favLate   = { ...ev({ kmNorth: 7, date: '2026-01-20' }), venue_profile_id: 'vp-1', venue: null };
  const favByHost = { ...ev({ kmNorth: 7, date: '2026-01-22' }), host_id: 'user-9' };
  const late      = ev({ kmNorth: 7, date: '2026-01-25' });
  const { aroundYou } = buildSceneFloor({
    ...BASE, events: [late, favByHost, early, favLate], radiusKm: 10,
    favProfileIds: new Set(['vp-1']), favUserIds: new Set(['user-9']),
  });
  assert.deepEqual(
    aroundYou.items.map(e => e.id),
    [favLate.id, favByHost.id, early.id, late.id],
    'favourites lead (their own dates in order), then the rest chronologically',
  );
});

test('favourite matching also reaches owner_profile_id, and no favourites means pure date order', () => {
  const owned = { ...ev({ kmNorth: 7, date: '2026-01-20' }), owner_profile_id: 'op-1' };
  const first = ev({ kmNorth: 7, date: '2026-01-05' });
  const withFav = buildSceneFloor({ ...BASE, events: [first, owned], radiusKm: 10, favProfileIds: new Set(['op-1']) });
  assert.deepEqual(withFav.aroundYou.items.map(e => e.id), [owned.id, first.id]);
  const noFav = buildSceneFloor({ ...BASE, events: [first, owned], radiusKm: 10 });
  assert.deepEqual(noFav.aroundYou.items.map(e => e.id), [first.id, owned.id]);
});

// ── 8 · VOCABULARY ───────────────────────────────────────────────────

test('the three Tune categories carry the canonical labels and bucket sizes', () => {
  assert.deepEqual(SCENE_CATEGORIES.map(c => c.label), ['Electronic Music', 'Bands / Live Music', 'Comedy / Spoken Word']);
  for (const c of SCENE_CATEGORIES) {
    assert.ok(c.genres.length > 5, `${c.key} bucket looks implausibly small`);
    assert.ok(!c.genres.includes('Multi Genre') && !c.genres.includes('Other'));
  }
});

test('the chip vocabulary is the canonical taxonomy minus the non-preferences', () => {
  assert.ok(SCENE_GENRES.includes('Techno'));
  assert.ok(SCENE_GENRES.includes('Rock'));
  assert.ok(!SCENE_GENRES.includes('Multi Genre'));
  assert.ok(!SCENE_GENRES.includes('Other'));
});

test('the radius steps end at Anywhere and skip city-scale distances', () => {
  assert.equal(SCENE_RADIUS_STEPS[SCENE_RADIUS_STEPS.length - 1], null);
  assert.ok(!SCENE_RADIUS_STEPS.includes(2));
});
