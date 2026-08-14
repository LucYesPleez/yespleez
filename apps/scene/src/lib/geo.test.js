/**
 * GEO — the shared location library.
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * A distance filter fails quietly in both directions. Too strict and results
 * vanish with no error; too loose and a Perth venue appears in a Bellingen
 * search. Neither looks like a bug — they look like "not much on this week".
 *
 * So the targets are the silent failures specifically:
 *
 *   1. The NZ/AU postcode collision. 21 NZ postcodes are ALSO real Australian
 *      ones, so an unguarded lookup relocates people by thousands of km with
 *      complete confidence.
 *   2. The resolution PRECEDENCE for events. If an event's own location ever
 *      outranks its venue's, the single source of truth is gone and nothing
 *      visibly breaks.
 *   3. Radius 0 meaning "same postcode" rather than "within 0km".
 *   4. Unplaceable records being excluded rather than guessed at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  haversineKm, postcodeCoords, profileCoords, eventCoords,
  sameArea, withinRadius, isKnownPostcode, RADIUS_STEPS, postcodeState,
} = await import('./geo.js');

// Real fixtures from AU_POSTCODES — Bellingen is the first venue client.
const BELLINGEN = '2454';
const COFFS     = '2450';
const SYDNEY    = '2000';

// ── 1 · DISTANCE ─────────────────────────────────────────────────────

test('haversine gives a real-world distance, not a flat-earth approximation', () => {
  const bell = postcodeCoords(BELLINGEN);
  const syd  = postcodeCoords(SYDNEY);
  const km   = haversineKm(bell.lat, bell.lng, syd.lat, syd.lng);
  // Bellingen → Sydney is ~440km as the crow flies.
  assert.ok(km > 380 && km < 500, `expected ~440km, got ${Math.round(km)}`);
});

test('Bellingen and Coffs are neighbours at 50km but not at 20km', () => {
  // ~44km apart by centroid. The exact figure matters less than which side of
  // the offered radius steps it falls on, which is what a user experiences.
  const a = postcodeCoords(BELLINGEN), b = postcodeCoords(COFFS);
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  assert.ok(km > 35 && km < 55, `expected ~44km, got ${Math.round(km)}`);
  assert.equal(withinRadius(a, b, 50, BELLINGEN, COFFS), true,  'the 50km step must reach Coffs');
  assert.equal(withinRadius(a, b, 20, BELLINGEN, COFFS), false, 'the 20km step must not');
});

// ── 2 · ⚠ THE NZ COLLISION ───────────────────────────────────────────
//
// The highest-value tests here. Without the guard these silently pass back an
// Australian point, and every downstream number is wrong in a way that looks
// completely normal.

test('⚠ a NZ postcode is refused, not answered with an Australian point', () => {
  // 6011 is Wellington NZ and ALSO a real Perth-area AU postcode.
  assert.notEqual(postcodeCoords('6011'), null, 'fixture must collide — 6011 must exist in AU_POSTCODES');
  assert.equal(
    postcodeCoords('6011', 'NZ'), null,
    'Wellington resolved to an Australian coordinate. A filter that relocates ' +
    'someone 5,000km is worse than one that admits it does not know, because ' +
    'nothing about the result looks wrong.',
  );
  assert.equal(postcodeCoords('8011', 'NZ'), null, 'Christchurch → Melbourne');
  assert.equal(postcodeCoords('3204', 'NZ'), null, 'Hamilton → Bentleigh VIC');
});

test('⚠ International is refused for the same reason', () => {
  assert.equal(postcodeCoords(SYDNEY, 'International'), null);
  assert.equal(isKnownPostcode(SYDNEY, 'International'), false);
});

test('the state guard is case- and whitespace-insensitive', () => {
  // STATE_OPTIONS stores 'NZ', but a hand-entered or imported row may not.
  for (const s of ['nz', ' NZ ', 'Nz', 'international']) {
    assert.equal(postcodeCoords('6011', s), null, `state '${s}' must be refused`);
  }
});

test('an Australian state still resolves normally', () => {
  assert.notEqual(postcodeCoords(BELLINGEN, 'NSW'), null);
  assert.equal(isKnownPostcode(BELLINGEN, 'NSW'), true);
});

// ── 3 · PROFILE COORDS ───────────────────────────────────────────────

test('stored coordinates beat the postcode centroid', () => {
  const exact = profileCoords({ lat: -30.4598, lng: 152.8977, postcode: SYDNEY });
  assert.equal(exact.lat, -30.4598, 'precise coords must win — a centroid is a fallback');
});

test('a profile with only a postcode falls back to its centroid', () => {
  const c = profileCoords({ postcode: BELLINGEN });
  assert.deepEqual(c, postcodeCoords(BELLINGEN));
});

test('a profile with no location resolves to null, never a guess', () => {
  // 32 of 53 live profiles are in this state. Guessing would place most of
  // the directory somewhere plausible and wrong.
  assert.equal(profileCoords({ name: 'no location' }), null);
  assert.equal(profileCoords(null), null);
});

// ── 4 · ⚠ EVENT PRECEDENCE — THE SINGLE SOURCE OF TRUTH ──────────────

test('⚠ a linked event takes its location from the VENUE, never its own columns', () => {
  const venue = { postcode: BELLINGEN };
  const event = { venue_profile_id: 'v1', postcode: SYDNEY };   // stale/duplicate data
  assert.deepEqual(
    eventCoords(event, venue), postcodeCoords(BELLINGEN),
    'the venue must win. If an event\'s own columns can outrank its venue, a ' +
    'venue correcting its postcode no longer corrects its events, and the ' +
    'two sources drift apart with nothing visibly breaking.',
  );
});

test('a venue-independent event uses its OWN location', () => {
  // The real case: "Dorrigo Showgrounds", "Multiple Venues" — live events with
  // no venue profile and no reason to have one.
  const doof = { venue_profile_id: null, postcode: BELLINGEN };
  assert.deepEqual(eventCoords(doof, null), postcodeCoords(BELLINGEN));
});

test('an event with no location at all resolves to null', () => {
  assert.equal(eventCoords({ venue_profile_id: null }, null), null);
  assert.equal(eventCoords(null, null), null);
});

test('a linked event whose venue could not be loaded falls back rather than lying', () => {
  // Venue row missing (deleted, or not fetched). Using the event's own
  // location here is better than reporting no location, and is still
  // unambiguous because the venue genuinely is not available.
  const e = { venue_profile_id: 'v1', postcode: COFFS };
  assert.deepEqual(eventCoords(e, null), postcodeCoords(COFFS));
});

// ── 5 · RADIUS SEMANTICS ─────────────────────────────────────────────

test('radius 0 means SAME POSTCODE, not within zero kilometres', () => {
  const a = postcodeCoords(BELLINGEN), b = postcodeCoords(COFFS);
  assert.equal(withinRadius(a, a, 0, BELLINGEN, BELLINGEN), true);
  assert.equal(withinRadius(a, b, 0, BELLINGEN, COFFS), false);
  assert.equal(RADIUS_STEPS[0], 0, 'the smallest step is the same-postcode step');
});

test('no radius means no filtering — everything passes', () => {
  assert.equal(withinRadius(null, null, null), true);
  assert.equal(withinRadius(null, null, undefined), true);
});

test('an unplaceable record fails the radius test rather than being placed', () => {
  const origin = postcodeCoords(BELLINGEN);
  assert.equal(withinRadius(origin, null, 50, BELLINGEN, null), false,
    'the caller must surface these separately — silently dropping them would ' +
    'hide most of the catalogue and read as an empty scene');
});

test('sameArea compares postcodes as strings, tolerating type drift', () => {
  assert.equal(sameArea(2454, '2454'), true, 'postcode arrives as both int and string');
  assert.equal(sameArea(' 2454 ', '2454'), true);
  assert.equal(sameArea(null, '2454'), false);
  assert.equal(sameArea('2454', null), false);
});

/**
 * ── postcodeState · A POSTCODE IMPLIES A STATE, NEVER A TOWN ─────────
 *
 * The editor back-fills the state from a typed postcode and deliberately does
 * NOT back-fill the town, because a postcode names one state and many towns.
 * These pin the boundaries, which are where a range table goes wrong: the
 * ACT enclaves sit INSIDE the NSW range, and getting either edge off by one
 * silently mislabels a whole town's events.
 */
test('a postcode names exactly one state, at every range boundary', () => {
  assert.equal(postcodeState('2454'), 'NSW', 'Bellingen');
  assert.equal(postcodeState('2450'), 'NSW', 'Coffs Harbour');
  assert.equal(postcodeState('3000'), 'VIC', 'Melbourne');
  assert.equal(postcodeState('4000'), 'QLD', 'Brisbane');
  assert.equal(postcodeState('5000'), 'SA');
  assert.equal(postcodeState('6000'), 'WA');
  assert.equal(postcodeState('7000'), 'TAS');
  assert.equal(postcodeState('0800'), 'NT', 'a leading zero is still four digits');

  // ⚠ THE ACT ENCLAVES. 2600–2618 and 2900–2920 are carved OUT of the NSW
  // range; a naive "2000–2999 is NSW" puts Canberra in the wrong state.
  assert.equal(postcodeState('2599'), 'NSW');
  assert.equal(postcodeState('2600'), 'ACT', 'Canberra, inside the NSW span');
  assert.equal(postcodeState('2618'), 'ACT');
  assert.equal(postcodeState('2619'), 'NSW', 'back out the other side');
  assert.equal(postcodeState('2899'), 'NSW');
  assert.equal(postcodeState('2900'), 'ACT');
  assert.equal(postcodeState('2921'), 'NSW');
});

test('an unplaceable postcode reads as UNKNOWN, never as a default', () => {
  // '' rather than a guess: the field is left for the organiser to answer, and
  // a wrong state is worse than a blank one because it looks decided.
  for (const bad of ['', null, undefined, 'abc', '12', '99999', '   ']) {
    assert.equal(postcodeState(bad), '', `${String(bad)} must not resolve`);
  }
});

test('postcodeState answers for codes the coordinate table has never heard of', () => {
  // The ranges are complete; AU_POSTCODES is a sample. A code that cannot be
  // PLACED can still be correctly ATTRIBUTED, and conflating the two would
  // blank the state on every postcode missing from the coordinate file.
  const unplaceable = ['2299', '3999', '6797'].filter(pc => !isKnownPostcode(pc));
  for (const pc of unplaceable) {
    assert.notEqual(postcodeState(pc), '',
      `${pc} is not in AU_POSTCODES but its state is still knowable`);
  }
});
