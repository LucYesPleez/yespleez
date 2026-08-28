import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventView, buildVenue, buildLineup, spreadEvenly, buildDetails, buildSources,
  readClock, readGenres, readDate, readEndDate, readTickets, readDateConfidence,
  relativeTime, buildCollectables,
} from './eventViewModel.js';

// The real row, trimmed. Every field below exists on event
// 37201beb-04fd-441b-a5b8-aaf9ebbcdbb4 — the page is tuned against a record
// that actually exists, not one we wish existed.
const CLITOVERSE = {
  id: '37201beb-04fd-441b-a5b8-aaf9ebbcdbb4',
  name: 'Back to the Clitoverse: The Prequel',
  status: 'live',
  external_ref: 'studio:batch_2026-08-01T21:31:39.344Z:e1',
  updated_at: '2026-08-01T21:38:21.372475+00:00',
  lat: null, lng: null,
  config: {
    bio: 'A retro-futuristic club night.',
    ampm: 'PM', date: '2026-08-22', time: '7:30',
    price: 'Free', state: 'NSW', venue: 'The Bellingen Brewing Co',
    genres: 'House', suburb: 'Bellingen',
    poster: 'https://example.invalid/poster.webp',
    date_confidence: 'inferred',
  },
};

const VENUE_PROFILE = {
  id: '4e77c0ae', type: 'venue', name: 'The Bellingen Brewing Co',
  location: '3/5 Church St', suburb: 'Bellingen', state: 'NSW',
  lat: -30.4598, lng: 152.8403, bio: 'An established live music venue.',
};

/* ── config readers ─────────────────────────────────────────────────── */

test('⚠ every generation of the date spelling is read', () => {
  assert.equal(readDate({ date: '2026-08-22' }), '2026-08-22');
  assert.equal(readDate({ start_date: '2026-08-22' }), '2026-08-22');
  assert.equal(readEndDate({ endDate: '2026-08-23' }), '2026-08-23');
  assert.equal(readEndDate({ end_date: '2026-08-23' }), '2026-08-23');
  assert.equal(readDate({}), null);
});

test('⚠ every generation of the ticket spelling is read', () => {
  assert.equal(readTickets({ ticketLink: 'a' }), 'a');
  assert.equal(readTickets({ ticket_url: 'b' }), 'b');
  assert.equal(readTickets({}), null);
});

test('⚠ a time with no meridiem is NOT rendered — 7:30 could be either', () => {
  assert.equal(readClock('7:30', 'PM'), '7:30pm');
  assert.equal(readClock('7:30', ''), null, 'ambiguous, so absent');
  assert.equal(readClock('7:30pm', ''), '7:30pm', 'unless it says so itself');
  assert.equal(readClock('', 'PM'), null);
  assert.equal(readClock(null, null), null);
});

test('genres split on either separator and never repeat a pill', () => {
  assert.deepEqual(readGenres('House'), ['House']);
  assert.deepEqual(readGenres('ELECTRONIC · Drum & Bass · House'), ['ELECTRONIC', 'Drum & Bass', 'House']);
  assert.deepEqual(readGenres('DJs, Live Bands'), ['DJs', 'Live Bands']);
  assert.deepEqual(readGenres('House · house'), ['House']);
  assert.deepEqual(readGenres(''), []);
  assert.deepEqual(readGenres(null), []);
});

test('⚠ silence about a date is confidence, doubt is not', () => {
  // R1 · nobody expressed doubt, so the date stands as stated.
  assert.equal(readDateConfidence({}), 'confirmed');
  // An importer that inferred a year says so, and the page must qualify it.
  assert.equal(readDateConfidence({ date_confidence: 'inferred' }), 'inferred');
});

/* ── the venue ──────────────────────────────────────────────────────── */

test('⚠ the venue PROFILE outranks the typed config string', () => {
  const v = buildVenue({
    event: CLITOVERSE,
    cfg: { ...CLITOVERSE.config, venue: 'Stale Typed Name' },
    venueProfile: VENUE_PROFILE,
  });
  assert.equal(v.name, 'The Bellingen Brewing Co');
  assert.equal(v.address, '3/5 Church St');
  assert.equal(v.locality, 'Bellingen');
});

test('the four events with no linked venue still name their venue', () => {
  const v = buildVenue({ event: CLITOVERSE, cfg: CLITOVERSE.config, venueProfile: null });
  assert.equal(v.name, 'The Bellingen Brewing Co');
  assert.equal(v.locality, 'Bellingen');
  assert.equal(v.state, 'NSW');
});

test('⚠ coordinates come from the venue — events.lat/lng are empty on ALL 50 rows', () => {
  const v = buildVenue({ event: CLITOVERSE, cfg: CLITOVERSE.config, venueProfile: VENUE_PROFILE });
  assert.equal(v.lat, -30.4598);
  assert.equal(v.lng, 152.8403);
  assert.equal(CLITOVERSE.lat, null, 'the event itself has none, which is the point');
});

test('⚠ a withheld location NEVER carries a map url out of this layer', () => {
  const v = buildVenue({
    event: {}, cfg: { locationWithheld: true, venue: 'Secret', suburb: 'Bellingen' },
    venueProfile: VENUE_PROFILE,
  });
  assert.equal(v.withheld, true);
  assert.equal(v.mapUrl, null);
});

test('⚠ a withheld venue is not named in the Identity line', () => {
  const view = buildEventView({
    event: { ...CLITOVERSE, config: { ...CLITOVERSE.config, locationWithheld: true } },
    venueProfile: VENUE_PROFILE,
  });
  assert.equal(view.identity.where.venue, null, 'the name would undo the withholding');
  assert.equal(view.identity.where.locality, 'Bellingen', 'the area still shows — withheld announces itself');
  assert.equal(view.presentedBy.venue, null, 'nor may the presenter card name it');
});

/* ── the bill ───────────────────────────────────────────────────────── */

test('⚠ an imported member renders with its profile — the join this was built on', () => {
  const members = [{ id: 'm1', artist_name: 'Fr3aky', artist_profile_id: 'p1', artist_id: null }];
  const profiles = { m1: { id: 'p1', name: 'Fr3aky', location: 'Bellingen', type: 'artist' } };
  const { artists } = buildLineup({ lineupMembers: members, memberProfiles: profiles });
  assert.equal(artists.length, 1);
  assert.equal(artists[0].id, 'p1', 'the profile id, so the card can be opened');
  assert.equal(artists[0].location, 'Bellingen');
});

test('a member with no profile still appears — a name is a bill entry', () => {
  const { artists } = buildLineup({ lineupMembers: [{ id: 'm3', artist_name: 'Just A Name' }] });
  assert.equal(artists.length, 1);
  assert.equal(artists[0].name, 'Just A Name');
  assert.equal(artists[0].location, null, 'absent, not invented');
});

test('⚠ an empty bill is ABSENT; only the flag makes it WITHHELD', () => {
  // R1, the rule the whole contract turns on.
  assert.equal(buildLineup({ lineupMembers: [] }).withheld, false);
  assert.equal(buildLineup({ lineupMembers: [], cfg: { lineupWithheld: true } }).withheld, true);
  // A bill that exists is never "withheld", whatever the flag says.
  const both = buildLineup({ lineupMembers: [{ id: 'm', artist_name: 'X' }], cfg: { lineupWithheld: true } });
  assert.equal(both.withheld, false);
});

/* ── Event Details ──────────────────────────────────────────────────── */

test('⚠ a missing age row is ABSENT — never "All ages"', () => {
  // That would be a licensing claim made on the organiser's behalf.
  const rows = buildDetails({ price: 'Free' });
  assert.deepEqual(rows.map(r => r.key), ['price']);
  assert.equal(rows.find(r => r.key === 'age'), undefined);
});

test('Event Details carries no date and no tickets', () => {
  // Layout spec § 9 — both are stated above, and repeating them makes the
  // page argue with itself when they disagree.
  const rows = buildDetails({ ...CLITOVERSE.config, ticketLink: 'https://x.invalid' });
  const keys = rows.map(r => r.key);
  assert.equal(keys.includes('date'), false);
  assert.equal(keys.includes('tickets'), false);
});

test('nothing to state means no section at all', () => {
  assert.deepEqual(buildDetails({}), []);
});

/* ── Information Sources ────────────────────────────────────────────── */

test('⚠ CONFIDENCE IS NEVER CLAIMED — nothing computes it yet', () => {
  const s = buildSources({ event: CLITOVERSE, now: new Date('2026-08-01T23:38:21Z') });
  assert.equal(s.confidence, null);
  assert.deepEqual(s.contributors, [], 'the importer records no source pages, so it names none');
});

test('a Studio import declares its origin; a hand-made event has none', () => {
  assert.equal(buildSources({ event: CLITOVERSE, now: new Date('2026-08-01T23:38:21Z') }).origin, 'discovery');
  assert.equal(buildSources({ event: { id: 'x' } }).origin, 'manual');
  assert.equal(buildSources({ event: { external_ref: 'other:thing' } }).origin, 'manual');
});

test('relative time is coarse, and refuses to claim a stale check is recent', () => {
  const now = new Date('2026-08-02T00:00:00Z');
  assert.equal(relativeTime('2026-08-01T22:00:00Z', now), '2 hours ago');
  assert.equal(relativeTime('2026-08-01T23:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-08-01T00:00:00Z', now), 'yesterday');
  assert.equal(relativeTime('2026-07-31T00:00:00Z', now), '2 days ago');
  assert.equal(relativeTime('2026-01-01T00:00:00Z', now), null, 'older than a month is not "last checked"');
  assert.equal(relativeTime('2026-08-03T00:00:00Z', now), null, 'a future stamp is not a check');
  assert.equal(relativeTime(null, now), null);
});

/* ── the whole page, on the real row ────────────────────────────────── */

test('the live Clitoverse row builds the page it should', () => {
  const view = buildEventView({
    event: CLITOVERSE,
    venueProfile: VENUE_PROFILE,
    ownerProfile: { id: 'fa8dca43', name: 'Clitoverse', type: 'host', bio: null },
    lineupMembers: [
      { id: 'm1', artist_name: 'Fr3aky',  artist_profile_id: 'p1', artist_id: null },
      { id: 'm2', artist_name: 'K Dizzy', artist_profile_id: 'p2', artist_id: null },
    ],
    memberProfiles: { m1: { id: 'p1', name: 'Fr3aky' }, m2: { id: 'p2', name: 'K Dizzy' } },
    now: new Date('2026-08-01T23:38:21Z'),
  });

  assert.equal(view.identity.when.date, '2026-08-22');
  assert.equal(view.identity.when.startTime, '7:30pm');
  assert.equal(view.identity.when.confidence, 'inferred', 'the importer inferred the year and says so');
  assert.equal(view.identity.where.venue, 'The Bellingen Brewing Co');
  assert.deepEqual(view.identity.genres, ['House']);
  assert.equal(view.lineup.artists.length, 2);
  assert.equal(view.venue.address, '3/5 Church St');
  assert.deepEqual(view.details.map(r => r.key), ['price']);
  assert.equal(view.presentedBy.presenter.name, 'Clitoverse');
  assert.equal(view.sources.origin, 'discovery');
  assert.ok(view.hero.poster.url, 'the poster carries the hero');
  assert.ok(view.poster.url, 'and § 9 still renders the artwork whole');
});

test('⚠ absent end time, tickets and attendance stay absent', () => {
  const view = buildEventView({ event: CLITOVERSE, venueProfile: VENUE_PROFILE });
  assert.equal(view.identity.when.endTime, null);
  assert.equal(view.summary.ticketUrl, null);
  assert.equal(view.summary.attending, null, 'null hides; 0 would read as "nobody is going"');
});

test('⚠ no chosen crop is null, NOT zero', () => {
  // 0 is a valid position — the very top of the poster. Conflating "no choice
  // made" with "chose the top" would silently override the default band.
  assert.equal(buildEventView({ event: CLITOVERSE }).hero.posterCropY, null);
  const chosen = buildEventView({ event: { ...CLITOVERSE, config: { ...CLITOVERSE.config, posterCropY: 0 } } });
  assert.equal(chosen.hero.posterCropY, 0);
});

test('an event with nothing but a name and a date does not throw', () => {
  // R4 · broken ≠ sparse. The floor still builds a page.
  const view = buildEventView({ event: { id: 'x', name: 'Fen', config: { date: '2026-11-16' } } });
  assert.equal(view.identity.name, 'Fen');
  assert.equal(view.venue.name, null);
  assert.deepEqual(view.lineup.artists, []);
  assert.deepEqual(view.details, []);
  assert.equal(view.presentedBy.presenter, null);
  assert.equal(view.presentedBy.venue, null);
  assert.equal(view.hero.poster, null);
});

test('buildEventView survives an empty call', () => {
  const view = buildEventView();
  assert.equal(view.name, '');
  assert.deepEqual(view.lineup.artists, []);
});

/* ─── § 11 · Collectables ──────────────────────────────────────────────
 *
 * WHY THESE EARN THEIR KEEP. This shelf is public, and the failure modes are
 * both silent and asymmetric: a duplicate logo just looks sloppy, but the
 * ORDER and the DEDUPE are what stop a venue that hosts its own night from
 * appearing twice, and an empty tile is a hole on a page whose whole contract
 * (R1) says absent is absent. None of it throws.
 */

const LOGOS = {
  v1: [{ id: 'l1', url: 'https://cdn/v1.png', file_name: 'venue.png' }],
  h1: [{ id: 'l2', url: 'https://cdn/h1.png', file_name: 'host.png' }],
  a1: [{ id: 'l3', url: 'https://cdn/a1.png', file_name: 'act.png' }],
};

test('collectables run venue, then host, then the bill', () => {
  const items = buildCollectables({
    venueProfile: { id: 'v1', name: 'The Brewery' },
    ownerProfile: { id: 'h1', name: 'Loyal' },
    lineup: [{ id: 'a1', name: 'Cosmatik' }],
    logosByProfile: LOGOS,
  });
  assert.deepEqual(items.map(i => i.id), ['l1', 'l2', 'l3']);
  assert.equal(items[0].alt, 'The Brewery logo', 'alt names the owner — it is all that distinguishes one tile');
  assert.equal(items[0].filename, 'venue.png');
});

test('a venue hosting its own night is ONE logo, not two', () => {
  const self = { id: 'v1', name: 'The Brewery' };
  const items = buildCollectables({
    venueProfile: self, ownerProfile: self, lineup: [], logosByProfile: LOGOS,
  });
  assert.equal(items.length, 1);
});

test('a profile with no logo contributes nothing — never an empty tile', () => {
  const items = buildCollectables({
    venueProfile: { id: 'v1', name: 'V' },
    ownerProfile: { id: 'NOPE', name: 'No logo' },
    lineup: [{ id: 'also-none', name: 'X' }],
    logosByProfile: LOGOS,
  });
  assert.deepEqual(items.map(i => i.id), ['l1']);
});

test('a logo row with no url is dropped rather than rendered broken', () => {
  const items = buildCollectables({
    venueProfile: { id: 'v1', name: 'V' },
    logosByProfile: { v1: [{ id: 'x', url: '' }, { id: 'y', url: 'https://cdn/ok.png' }] },
  });
  assert.deepEqual(items.map(i => i.id), ['y']);
});

test('an event with nobody and nothing yields an empty shelf, not a throw', () => {
  assert.deepEqual(buildCollectables(), []);
});

/* ─── One entity, one card ─────────────────────────────────────────── */

test('a venue running its own night is presented ONCE, not twice', () => {
  // The Bellingen Brewing Co / Tigersnake: owner_profile_id === venue_profile_id.
  // § 7 already names the venue; "Presented by" the same profile drew the same
  // portrait a second time and read as two businesses with one name.
  const self = { id: 'v1', type: 'venue', name: 'The Bellingen Brewing Co' };
  const view = buildEventView({
    event: { name: 'Tigersnake', config: { venue: 'The Bellingen Brewing Co' } },
    ownerProfile: self,
    venueProfile: self,
  });
  assert.equal(view.presentedBy.presenter, null, 'the venue card in § 7 is the survivor');
});

test('a real promoter at someone else\'s venue still presents', () => {
  const view = buildEventView({
    event: { name: 'Clitoverse', config: {} },
    ownerProfile: { id: 'h1', type: 'host', name: 'Clitoverse' },
    venueProfile: { id: 'v1', type: 'venue', name: 'The Bellingen Brewing Co' },
  });
  assert.equal(view.presentedBy.presenter.name, 'Clitoverse');
  assert.equal(view.presentedBy.presenter.type, 'host');
});

test('no owner at all still presents nobody', () => {
  const view = buildEventView({
    event: { name: "Neverland '26", config: {} },
    venueProfile: { id: 'v1', type: 'venue', name: 'Bellingen Memorial Hall' },
  });
  assert.equal(view.presentedBy.presenter, null);
});

// ── Cover vs Poster — spec §0: two objects, two slots ────────────────
// "The Cover sells the experience. The Poster preserves the artwork… The
// Poster never appears in the Hero carousel, and the Cover never appears in
// the Poster section." `hero.cover` was hardcoded null, which collapsed both
// into `config.poster` — one image cropped at the top and whole at the bottom,
// with no way to have a promo shot up top and the real flyer below.

test('a cover feeds the hero and NEVER the poster section', () => {
  const view = buildEventView({
    event: {
      name: 'Thelma Plum',
      config: { cover: 'https://x.invalid/promo.jpg', poster: 'https://x.invalid/tour-poster.jpg' },
    },
  });
  assert.equal(view.hero.cover.url, 'https://x.invalid/promo.jpg');
  assert.equal(view.hero.poster.url, 'https://x.invalid/tour-poster.jpg',
    'the poster stays available to the ladder — a cover supersedes it, it does not erase it');
  assert.equal(view.poster.url, 'https://x.invalid/tour-poster.jpg',
    '§11 shows the POSTER, never the cover');
});

test('no cover leaves every existing event exactly where it was', () => {
  // The whole safety argument for wiring this: nothing writes cfg.cover today.
  const view = buildEventView({
    event: { name: 'Clitoverse', config: { poster: 'https://x.invalid/p.jpg' } },
  });
  assert.equal(view.hero.cover, null, 'absent cover must stay null, not become an empty object');
  assert.equal(view.hero.poster.url, 'https://x.invalid/p.jpg', 'still lands on the poster rungs');
  assert.equal(view.poster.url, 'https://x.invalid/p.jpg');
});

test('an empty-string cover is absent, not a broken image', () => {
  const view = buildEventView({ event: { name: 'X', config: { cover: '', poster: 'https://x.invalid/p.jpg' } } });
  assert.equal(view.hero.cover, null);
});

// ── Gallery — rung 1, the carousel ───────────────────────────────────
test('gallery URLs become hero slides, behind the cover', () => {
  const view = buildEventView({
    event: { name: 'X', config: {
      cover: 'https://x.invalid/cover.jpg',
      gallery: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg'],
      poster: 'https://x.invalid/p.jpg',
    } },
  });
  assert.deepEqual(view.hero.gallery, [
    { url: 'https://x.invalid/a.jpg' },
    { url: 'https://x.invalid/b.jpg' },
  ]);
  assert.equal(view.poster.url, 'https://x.invalid/p.jpg', '§11 is still the poster, never a crop of it');
});

test('a junk gallery entry is dropped, not passed to the carousel', () => {
  // heroMedia's `usable` would reject these anyway — but silently, and a slide
  // missing from a carousel is much harder to spot than one that never loads.
  const view = buildEventView({
    event: { name: 'X', config: { gallery: ['https://x.invalid/a.jpg', '', '   ', null, 42, {}] } },
  });
  assert.deepEqual(view.hero.gallery, [{ url: 'https://x.invalid/a.jpg' }]);
});

test('a missing or non-array gallery is empty, never a crash', () => {
  for (const gallery of [undefined, null, 'nope', 7]) {
    const view = buildEventView({ event: { name: 'X', config: { gallery } } });
    assert.deepEqual(view.hero.gallery, []);
  }
});

// ── navCoords — a postcode centroid is not a destination ─────────────
// Reported live: GET DIRECTIONS at The Bellingen Brewing Co opened Kalang.
// Its profile stored lat/lng -30.4598,152.8403, which IS AU_POSTCODES['2454']
// — postcode 2454 reaches from Bellingen out past Kalang, so its centroid is
// bushland. `coords` may be that (it also picks the town picture); `navCoords`
// must not be.

test('a stored coordinate equal to the postcode centroid is not a destination', () => {
  const view = buildEventView({
    event: { name: 'NYE', config: {} },
    venueProfile: {
      id: 'v1', type: 'venue', name: 'The Bellingen Brewing Co',
      location: '3/5 Church St', suburb: 'Bellingen', state: 'NSW', postcode: '2454',
      lat: -30.4598, lng: 152.8403,          // the 2454 centroid, to the digit
    },
  });
  assert.ok(view.venue.coords, 'coords still exist — the town picture needs them');
  assert.equal(view.venue.navCoords, null, 'but directions must fall through to the address');
});

test('a real venue coordinate IS a destination', () => {
  const view = buildEventView({
    event: { name: 'NYE', config: {} },
    venueProfile: {
      id: 'v1', type: 'venue', name: 'The Bellingen Brewing Co',
      location: '3/5 Church St', suburb: 'Bellingen', state: 'NSW', postcode: '2454',
      lat: -30.4531, lng: 152.8987,          // the actual street, not the centroid
    },
  });
  assert.deepEqual(view.venue.navCoords, { lat: -30.4531, lng: 152.8987 });
});

test('no stored coordinate at all yields no destination coords', () => {
  // The centroid fallback fills `coords` for the picture; it must never be
  // promoted into navCoords by that route either.
  const view = buildEventView({
    event: { name: 'NYE', config: {} },
    venueProfile: { id: 'v1', type: 'venue', name: 'X', suburb: 'Bellingen', state: 'NSW', postcode: '2454' },
  });
  assert.equal(view.venue.navCoords, null);
});

test('a withheld venue gives up its navigation coords too', () => {
  const view = buildEventView({
    event: { name: 'Secret', config: { location_withheld: true } },
    venueProfile: { id: 'v1', type: 'venue', name: 'X', suburb: 'Bellingen', state: 'NSW', postcode: '2454', lat: -30.4531, lng: 152.8987 },
  });
  assert.equal(view.venue.navCoords, null);
});


/* ── ⭐⭐ WORKSHOPS ARE SPREAD THROUGH THE BILL ──────────────────────────
   ⚠⚠ This has been wrong in BOTH directions. The classes originally led the
   rail (BILL order is whatever order the rows arrived in); moving the block to
   the end produced the mirror image — a run of classes with no music in it,
   reading as an appendix rather than part of the bill. Spread evenly, they are
   what they are: part of the same weekend. */

test('spreadEvenly deals the extras through, opening and closing on main', () => {
  const main = ['a', 'b', 'c', 'd', 'e', 'f'];
  const out = spreadEvenly(main, ['X', 'Y']);
  assert.equal(out[0], 'a', '⛔ the rail must not open on an extra');
  assert.equal(out[out.length - 1], 'f', '⛔ nor close on one');
  assert.equal(out.length, 8, 'nothing is dropped');
  // Both groups keep their own order.
  assert.deepEqual(out.filter(v => v === 'X' || v === 'Y'), ['X', 'Y']);
  assert.deepEqual(out.filter(v => v !== 'X' && v !== 'Y'), main);
});

test("⛔ nobody is dropped when there are more extras than main", () => {
  const out = spreadEvenly(['a'], ['X', 'Y', 'Z']);
  assert.equal(out.length, 4, 'a card is never dropped to make the spacing tidy');
  assert.deepEqual(out.filter(v => v !== 'a'), ['X', 'Y', 'Z']);
});

test('spreadEvenly mutates neither input', () => {
  const main = ['a', 'b'], extras = ['X'];
  spreadEvenly(main, extras);
  assert.deepEqual(main, ['a', 'b']);
  assert.deepEqual(extras, ['X']);
});

const scheduleWith = (stageName, ...memberIds) => ({
  days: [{ stages: [
    { name: 'DJ STAGE', slots: [{ claim: { member_id: 'm-dj' } }] },
    { name: stageName,  slots: memberIds.map(id => ({ claim: { member_id: id } })) },
  ] }],
});

test('a workshop act is dealt into the bill, not parked at either end', () => {
  const members = [
    { id: 'w1', artist_name: 'Yoga' },
    { id: 'm1', artist_name: 'Band One' },
    { id: 'm2', artist_name: 'Band Two' },
    { id: 'm3', artist_name: 'Band Three' },
    { id: 'm4', artist_name: 'Band Four' },
  ];
  const { artists } = buildLineup({
    lineupMembers: members,
    schedule: scheduleWith('WORKSHOPS & GALLERY', 'w1'),
  });
  const names = artists.map(a => a.name);
  assert.equal(names[0], 'Band One', 'the bill opens on music');
  assert.equal(names[names.length - 1], 'Band Four', 'and closes on music');
  const at = names.indexOf('Yoga');
  assert.ok(at > 0 && at < names.length - 1, `Yoga should sit inside the bill, was ${at}`);
});

test('⛔ the music keeps its own order while the classes are dealt in', () => {
  const members = [
    { id: 'w1', artist_name: 'Yoga' },
    { id: 'm1', artist_name: 'Zzz Last Alphabetically' },
    { id: 'm2', artist_name: 'Aaa First Alphabetically' },
    { id: 'w2', artist_name: 'Qigong' },
  ];
  const { artists } = buildLineup({
    lineupMembers: members,
    schedule: scheduleWith('WORKSHOPS & GALLERY', 'w1', 'w2'),
  });
  const names = artists.map(a => a.name);
  assert.deepEqual(
    names.filter(n => !/Yoga|Qigong/.test(n)),
    ['Zzz Last Alphabetically', 'Aaa First Alphabetically'],
    'a spread is not a sort',
  );
  assert.deepEqual(names.filter(n => /Yoga|Qigong/.test(n)), ['Yoga', 'Qigong']);
});

test('⛔ no schedule reorders nobody', () => {
  const members = [{ id: 'a', artist_name: 'One' }, { id: 'b', artist_name: 'Two' }];
  assert.deepEqual(buildLineup({ lineupMembers: members }).artists.map(a => a.name), ['One', 'Two']);
  assert.deepEqual(
    buildLineup({ lineupMembers: members, schedule: { days: [] } }).artists.map(a => a.name),
    ['One', 'Two'],
  );
});

test('⛔ a workshop on the bill does not wear a DJ photograph', () => {
  // ⚠⚠ Measured live 2026-08-28: Yoga, Portal Cat, Qigong and Arnold Alskar all
  // rendered defaultdj.webp on the lineup rail. `type` is 'artist' for every act
  // with no profile, and PortraitCard draws that type's default — the same
  // defect already fixed on the set-times card, still live on this surface.
  const { artists } = buildLineup({
    lineupMembers: [
      { id: 'w1', artist_name: 'Yoga' },
      { id: 'm1', artist_name: 'Band One' },
      { id: 'm2', artist_name: 'Band Two' },
    ],
    schedule: scheduleWith('WORKSHOPS & GALLERY', 'w1'),
  });
  assert.equal(artists.find(a => a.name === 'Yoga').avatar, '/defaultworkshop.jpg');
  assert.equal(artists.find(a => a.name === 'Band One').avatar, null,
    '⛔ a band with no picture still resolves through its own type default');
});

test("⛔ an act's own picture always wins over the stage default", () => {
  const { artists } = buildLineup({
    lineupMembers: [{ id: 'w1', artist_name: 'Yoga' }, { id: 'm1', artist_name: 'Band' }],
    memberProfiles: { w1: { id: 'p1', avatar_thumb: '/real-face.webp' } },
    schedule: scheduleWith('WORKSHOPS & GALLERY', 'w1'),
  });
  assert.equal(artists.find(a => a.name === 'Yoga').avatar, '/real-face.webp');
});
