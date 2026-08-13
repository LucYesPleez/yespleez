/**
 * UNLISTED AND SECRET EVENT LOCATIONS
 *
 * ⭐⭐ THE ARCHITECTURAL RULE THIS FILE DEFENDS:
 *
 *   An event may reference a CANONICAL venue, or carry an UNLISTED
 *   event-specific location. An event-specific location must NEVER become a
 *   canonical venue, and must never be PRESENTED as one.
 *
 * Both halves are real events. A secret party, a private address, a paddock,
 * or a room nobody has made a profile for are not bad data — they are the
 * normal case for a scene that starts in sheds. What was wrong was the
 * PRESENTATION: an unlisted location drew a venue-badged portrait card with the
 * default venue photograph, so a place with no record looked exactly like a
 * business with one.
 *
 * ⚠ THE CREATION SIDE NEEDS NO GUARD AND HAS NONE. The app contains no
 * `profiles` insert anywhere, and that table's RLS is
 * `WITH CHECK (auth.uid() = user_id)` — a host cannot mint a record for someone
 * else's room even by trying. `venueNeverCreatesProfile` below asserts the
 * absence of such a call, so a future insert has to argue with a test.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildEventView } from './eventViewModel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(HERE, p), 'utf8');

/* A canonical venue: the room has its own profile row. */
const VENUE_PROFILE = {
  id: 'venue-1', name: 'The Bellingen Brewing Co', type: 'venue',
  suburb: 'Bellingen', state: 'NSW', postcode: '2454', bio: 'A brewery.',
};

const baseEvent = (config = {}) => ({
  id: 'ev-1', name: 'Bass Event', status: 'live', is_public: true,
  config: { date: '2026-12-01', ...config },
});

// ── 1 · A CANONICAL VENUE STILL WORKS EXACTLY AS BEFORE ────────────────────

test('a canonical venue keeps its profile, postcode and map identity', () => {
  const v = buildEventView({
    event: baseEvent({ venue: 'The Bellingen Brewing Co' }),
    venueProfile: VENUE_PROFILE,
  });

  assert.equal(v.venue.name, 'The Bellingen Brewing Co');
  assert.equal(v.venue.profile?.id, 'venue-1', 'the profile row reaches the page');
  assert.equal(v.venue.profileId, 'venue-1', 'and the card can link to it');
  assert.equal(v.venue.postcode, '2454', 'so the town map can be found');
  assert.equal(v.presentedBy.venue?.name, 'The Bellingen Brewing Co');
});

// ── 2 · AN UNLISTED LOCATION IS NAMED, BUT IS NOT A VENUE ──────────────────

test('⚠ an unlisted location carries NO venue profile', () => {
  const v = buildEventView({
    event: baseEvent({ venue: 'Coffs Hinterland', suburb: 'Coffs Harbour', state: 'NSW' }),
    venueProfile: null,          // exactly what `venue_profile_id = NULL` yields
  });

  assert.equal(v.venue.name, 'Coffs Hinterland', 'the location is still named');
  assert.equal(v.venue.profile, null, 'but there is no profile row');
  assert.equal(v.venue.profileId, null, 'and nothing to link to');
});

test('⛔ an unlisted location does not render as a canonical venue CARD', () => {
  /**
   * The decisive one. EventVenueCard spread `...(profile || {})` into a literal
   * `{ type: 'venue' }`, so a null profile still produced a venue accent, a
   * VENUE badge and the default venue photograph. The guard is the early return
   * on `!profile`; this asserts it exists rather than re-implementing React.
   */
  const src = read('./EventVenueCard.jsx');
  assert.match(src, /if\s*\(!profile\)\s*return null/,
    'EventVenueCard must yield entirely when there is no canonical profile');
});

test('⛔ nothing in the app creates a venue profile from typed text', () => {
  const picker = read('../../components/VenuePicker.jsx');
  const screen = read('../../screens/CreateEventScreen.jsx');
  for (const [name, src] of [['VenuePicker', picker], ['CreateEventScreen', screen]]) {
    assert.doesNotMatch(src, /from\(['"]profiles['"]\)[\s\S]{0,120}?\.insert\(/,
      `${name} inserts a profile — an event must never mint a canonical venue`);
  }
});

// ── 3 · A SECRET LOCATION EXPOSES NOTHING ──────────────────────────────────

test('⚠ locationWithheld removes the profile, coords, postcode AND town map', () => {
  const v = buildEventView({
    event: baseEvent({
      venue: 'The Bellingen Brewing Co', suburb: 'Bellingen', state: 'NSW',
      postcode: '2454', locationWithheld: true,
    }),
    venueProfile: VENUE_PROFILE,   // even a REAL venue must be withheld
  });

  assert.equal(v.venue.withheld, true);
  assert.equal(v.venue.profileId, null, 'no venue profile is exposed');
  assert.equal(v.venue.coords, null, 'no coordinates');
  assert.equal(v.venue.navCoords, null, 'nothing to navigate to');
  assert.equal(v.venue.postcode, null, 'and no postcode, so no town map either');
  assert.equal(v.presentedBy.venue, null, 'the venue is not presented at all');
});

test('⭐ a secret event MAY keep its town map, and nothing else', () => {
  /**
   * `showAreaMap` is opt-in and only meaningful while withheld. The map is one
   * image per POSTCODE, so it reveals a town, never a door — which is what
   * makes "bush doof, address on the day" listable at all.
   *
   * ⚠ THE EXCEPTION IS THE MAP ALONE. Everything that names a building or aims
   * navigation stays null, or "secret" would mean nothing.
   */
  const v = buildEventView({
    event: baseEvent({
      venue: 'A paddock', suburb: 'Bellingen', state: 'NSW', postcode: '2454',
      locationWithheld: true, showAreaMap: true,
    }),
    venueProfile: VENUE_PROFILE,
  });

  assert.equal(v.venue.withheld, true, 'still secret');
  assert.equal(v.venue.postcode, '2454', 'the TOWN map survives');
  assert.equal(v.venue.profileId, null, 'but no venue profile');
  assert.equal(v.venue.coords, null, 'no coordinates');
  assert.equal(v.venue.navCoords, null, 'and nothing to navigate to');
});

test('⛔ showAreaMap does nothing on a PUBLIC event, and cannot turn one secret', () => {
  const v = buildEventView({
    event: baseEvent({ venue: 'A paddock', postcode: '2454', showAreaMap: true }),
    venueProfile: null,
  });
  assert.equal(v.venue.withheld, false, 'the map flag is not a privacy switch');
  assert.equal(v.venue.postcode, '2454');
});

test('the snake_case spelling is honoured too, so older rows stay secret', () => {
  const v = buildEventView({
    event: baseEvent({ venue: 'Somewhere', location_withheld: true }),
    venueProfile: null,
  });
  assert.equal(v.venue.withheld, true);
  assert.equal(v.venue.postcode, null);
});

test('⛔ a withheld location is not merely hidden in the UI — the model nulls it', () => {
  /* The fields must be absent from the view model itself, not filtered by a
     component. A renderer that forgets is then unable to leak them. */
  const src = read('./eventViewModel.js');
  assert.match(src, /profileId:\s*withheld\s*\?\s*null/);
  assert.match(src, /postcode:\s*\(withheld && !showAreaMap\)\s*\?\s*null/,
    'the map is the ONE thing a secret event may opt back into');
});
