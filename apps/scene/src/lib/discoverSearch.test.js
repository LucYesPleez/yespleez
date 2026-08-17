import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenise, scoreTokens, eventHaystack, profileHaystack,
  timeBucket, compareByTime, rankEvents, rankProfiles, profileOrFilter,
  TIME_UPCOMING, TIME_PAST, TIME_UNDATED,
} from './discoverSearch.js';

const TODAY = '2026-08-17';

const ev = (id, name, cfg = {}, extra = {}) => ({ id, name, config: cfg, ...extra });

/* ── tokenising ─────────────────────────────────────────────────────── */

test('a multi-word query becomes a bag of words', () => {
  assert.deepEqual(tokenise('drum and bass bellingen'), ['drum', 'bass', 'bellingen']);
  assert.deepEqual(tokenise('techno at mem hall'), ['techno', 'mem', 'hall']);
});

test('⚠ genre words that LOOK like noise are kept — dropping them would break the commonest searches', () => {
  for (const w of ['house', 'bass', 'live', 'night', 'club']) {
    assert.deepEqual(tokenise(w), [w], `${w} must survive tokenising`);
  }
});

test('two-letter words survive so "dj" is searchable', () => {
  assert.deepEqual(tokenise('dj bellingen'), ['dj', 'bellingen']);
});

test('punctuation splits, and duplicates collapse', () => {
  assert.deepEqual(tokenise("Neverland '26"), ['neverland', '26']);
  assert.deepEqual(tokenise('techno TECHNO Techno'), ['techno']);
});

test("⚠ tokens are strictly [a-z0-9] — a comma or percent must never reach a PostgREST or() filter", () => {
  for (const t of tokenise('a,b%c techno')) assert.match(t, /^[a-z0-9]+$/);
});

test('⚠ a query of pure stopwords falls back to itself, never to "everything"', () => {
  assert.deepEqual(tokenise('the'), ['the']);
  assert.notDeepEqual(tokenise('the'), []);
});

test('an empty query yields no tokens', () => {
  assert.deepEqual(tokenise(''), []);
  assert.deepEqual(tokenise(null), []);
});

/* ── the privacy guarantee ──────────────────────────────────────────── */

test('⭐⭐ a WITHHELD venue is NOT searchable by name or address', () => {
  const secret = ev('e1', 'Bush Doof', {
    locationWithheld: true,
    venue: 'The Secret Warehouse',
    address: '12 Hidden Lane',
    suburb: 'Bellingen',
  });
  const hay = eventHaystack(secret);
  assert.ok(!hay.includes('secret warehouse'), 'the venue name must not be indexed');
  assert.ok(!hay.includes('hidden lane'), 'the address must not be indexed');
  assert.equal(scoreTokens(hay, tokenise('secret warehouse')), 0);
});

test('⭐ a withheld venue still names its AREA — the search hides the building, not the town', () => {
  const secret = ev('e1', 'Bush Doof', {
    locationWithheld: true, venue: 'The Secret Warehouse', suburb: 'Bellingen',
  });
  assert.ok(eventHaystack(secret).includes('bellingen'));
});

test('a venue that is NOT withheld is fully searchable', () => {
  const open = ev('e2', 'Hoot-E-Nanny', { venue: 'Bellingen Brewing Co' });
  assert.ok(eventHaystack(open).includes('bellingen brewing co'));
});

test('the linked venue profile is searchable, which is the "Brewing finds its gigs" case', () => {
  const linked = ev('e3', 'Tech-Now', {}, {
    venue: { name: 'The Federal Hotel', suburb: 'Bellingen', state: 'NSW' },
  });
  const hay = eventHaystack(linked);
  assert.ok(hay.includes('federal hotel'));
  assert.ok(hay.includes('bellingen'));
});

test('lineup artists are searchable', () => {
  const hay = eventHaystack(ev('e4', 'Neverland'), { artistNames: ['MADSPiN BABY', 'INSECT'] });
  assert.equal(scoreTokens(hay, tokenise('madspin')), 1);
  assert.equal(scoreTokens(hay, tokenise('insect')), 1);
});

test('event genres are searchable, including & spelled as "and"', () => {
  const hay = eventHaystack(ev('e5', 'Warehouse', { genres: 'ELECTRONIC · Drum & Bass' }));
  assert.equal(scoreTokens(hay, tokenise('drum and bass')), 2);
});

/* ── time ordering ──────────────────────────────────────────────────── */

test('buckets: upcoming, past, undated', () => {
  assert.equal(timeBucket('2026-08-20', TODAY), TIME_UPCOMING);
  assert.equal(timeBucket(TODAY,        TODAY), TIME_UPCOMING, 'today is still upcoming');
  assert.equal(timeBucket('2022-01-01', TODAY), TIME_PAST);
  assert.equal(timeBucket(null,         TODAY), TIME_UNDATED);
});

test('⭐ upcoming sorts soonest-first, the past sorts backwards from now', () => {
  const dates = ['2022-05-01', '2026-09-30', '2026-08-20', '2025-01-01', null];
  const sorted = dates.slice().sort((a, b) => compareByTime(a, b, TODAY));
  assert.deepEqual(sorted, [
    '2026-08-20',   // next up
    '2026-09-30',   // then later
    '2025-01-01',   // most recent past
    '2022-05-01',   // then further back
    null,           // undated last
  ]);
});

test('⚠ a legacy row storing a fuller date string still buckets correctly', () => {
  assert.equal(timeBucket('2026-08-20T21:00:00', TODAY), TIME_UPCOMING);
  assert.equal(timeBucket('2022-05-01T21:00:00', TODAY), TIME_PAST);
});

test('start_date is read when date is absent', () => {
  const rows = rankEvents([ev('a', 'Old', { start_date: '2020-01-01' }),
                           ev('b', 'Soon', { start_date: '2026-08-19' })],
                          [], { todayStr: TODAY });
  assert.deepEqual(rows.map(r => r.id), ['b', 'a']);
});

/* ── ranking ────────────────────────────────────────────────────────── */

test("⭐⭐ THE OWNER'S CASE: a one-word search is pure time order, so the 4-year-old party sinks", () => {
  const rows = rankEvents([
    ev('old',    'Neverland 22', { date: '2022-08-28', venue: 'Memorial Hall' }),
    ev('next',   'Neverland 26', { date: '2026-08-28', venue: 'Memorial Hall' }),
    ev('later',  'Neverland 27', { date: '2027-08-28', venue: 'Memorial Hall' }),
  ], tokenise('neverland'), { todayStr: TODAY });
  assert.deepEqual(rows.map(r => r.id), ['next', 'later', 'old']);
});

test('⭐ a better match outranks a nearer date — "techno at mem hall"', () => {
  const rows = rankEvents([
    ev('onlyhall', 'Quiz Night',   { date: '2026-08-18', venue: 'Mem Hall' }),
    ev('allthree', 'Techno Night', { date: '2026-09-20', venue: 'Mem Hall' }),
  ], tokenise('techno at mem hall'), { todayStr: TODAY });
  assert.deepEqual(rows.map(r => r.id), ['allthree', 'onlyhall'],
    'matching 3 words beats being sooner');
});

test('within an equal score, time decides', () => {
  const rows = rankEvents([
    ev('far',  'Techno Two', { date: '2026-12-01', venue: 'Mem Hall' }),
    ev('near', 'Techno One', { date: '2026-08-18', venue: 'Mem Hall' }),
  ], tokenise('techno mem hall'), { todayStr: TODAY });
  assert.deepEqual(rows.map(r => r.id), ['near', 'far']);
});

test('events matching nothing are dropped', () => {
  const rows = rankEvents([ev('a', 'Jazz Brunch', { date: '2026-08-20' })],
                          tokenise('techno'), { todayStr: TODAY });
  assert.deepEqual(rows, []);
});

test('⚠ with no query nothing is dropped — a filter-only search still lists everything, by time', () => {
  const rows = rankEvents([
    ev('past', 'Old',  { date: '2020-01-01' }),
    ev('soon', 'Next', { date: '2026-08-20' }),
  ], [], { todayStr: TODAY });
  assert.deepEqual(rows.map(r => r.id), ['soon', 'past']);
});

test('an artist search finds the gig they are on', () => {
  const rows = rankEvents([
    ev('a', 'Friday Mix Up', { date: '2026-09-04' }),
    ev('b', 'Jazz Brunch',   { date: '2026-08-19' }),
  ], tokenise('madspin'), {
    todayStr: TODAY, artistNamesByEvent: { a: ['MADSPiN BABY'] },
  });
  assert.deepEqual(rows.map(r => r.id), ['a']);
});

/* ── profiles ───────────────────────────────────────────────────────── */

test('profiles rank by how many words they match', () => {
  const rows = rankProfiles([
    { id: 'one', name: 'Someone', location: 'Bellingen', updated_at: '2026-08-16' },
    { id: 'two', name: 'Techno Tim', genre_string: 'techno', location: 'Bellingen', updated_at: '2020-01-01' },
  ], tokenise('techno bellingen'));
  assert.deepEqual(rows.map(r => r.id), ['two', 'one'], 'two words beats a recent update');
});

test('a non-matching profile is dropped', () => {
  const rows = rankProfiles([{ id: 'x', name: 'Jazz Cat' }], tokenise('techno'));
  assert.deepEqual(rows, []);
});

test('⚠ genre_string is MATCHED (it holds role keys) but never returned for display', () => {
  assert.ok(profileHaystack({ genre_string: 'dj_prod' }).includes('dj_prod'));
});

test('with no tokens every profile survives', () => {
  const all = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(rankProfiles(all, []).map(r => r.id), ['a', 'b']);
});

/* ── the database filter ────────────────────────────────────────────── */

test('the or() filter covers every word against every field', () => {
  assert.equal(
    profileOrFilter(['techno', 'bello'], ['name', 'sound']),
    'name.ilike.%techno%,sound.ilike.%techno%,name.ilike.%bello%,sound.ilike.%bello%',
  );
});
