import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventView, buildVenue, buildLineup, buildDetails, buildSources,
  readClock, readGenres, readDate, readEndDate, readTickets, readDateConfidence,
  relativeTime,
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
