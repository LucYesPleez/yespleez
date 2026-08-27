/**
 * The two PRODUCTION cases that prompted this, and the events that must NOT be
 * flagged. ⛔ Every finding is a warning; nothing here blocks a save.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRelatedEvents, namesLookRelated, normaliseEventName, REASON } from './duplicateEvents.js';

// Real rows, names and dates as they are in production.
const BEYOND_UMBRELLA = { id: 'u', name: 'Beyond Jazz Weekender', venue: 'Multiple Venues', startDate: '2026-08-14' };
const BEYOND_FRIDAY   = { id: 'f', name: 'Beyond Jazz Weekender 2026 – Friday: The Jazz Doof', venue: 'Bellingen Memorial Hall', startDate: '2026-08-14' };
const BEYOND_SATURDAY = { id: 's', name: 'Beyond Jazz Weekender 2026 – Saturday: The Jazz Social', venue: 'Bellingen Memorial Hall', startDate: '2026-08-15' };
const BEYOND_LAUNCH   = { id: 'l', name: "Beyond Jazz Weekender Launch Party - Pablo Blitzer's Manouche Trio", venue: 'The Bellingen Brewing Co', startDate: '2026-07-26' };

test('the YEAR is not part of a name — an annual event keeps its identity', () => {
  assert.equal(normaliseEventName('Beyond Jazz Weekender 2026'), 'beyond jazz weekender');
  assert.ok(namesLookRelated('Beyond Jazz Weekender', 'Beyond Jazz Weekender 2026'));
});

test('⭐⭐ THE UMBRELLA AND ITS OWN FRIDAY ARE FLAGGED, at different venues', () => {
  const hits = findRelatedEvents(BEYOND_FRIDAY, [BEYOND_UMBRELLA]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'u');
  assert.equal(hits[0].reason, REASON.SAME_NAME, 'a venue rule alone would MISS this');
});

test('⭐⭐ FRIDAY AND SATURDAY ARE FLAGGED — ADJACENT, not overlapping', () => {
  // This is the signature of one event per day, and an overlap-only rule misses
  // it entirely: the two ranges never touch.
  const hits = findRelatedEvents(BEYOND_SATURDAY, [BEYOND_FRIDAY]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, REASON.SAME_NAME);
});

test('⛔ THE LAUNCH PARTY IS NOT FLAGGED — 19 days earlier, genuinely separate', () => {
  assert.deepEqual(findRelatedEvents(BEYOND_LAUNCH, [BEYOND_UMBRELLA, BEYOND_FRIDAY, BEYOND_SATURDAY]), []);
});

test('same venue, overlapping dates, unrelated names — flagged as the venue rule', () => {
  const a = { name: 'Bass Heavy', venue: 'Elbows Rest', startDate: '2026-10-03' };
  const b = { id: 'x', name: 'Sunday Sessions', venue: 'Elbows Rest', startDate: '2026-10-03' };
  const hits = findRelatedEvents(a, [b]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, REASON.SAME_VENUE);
});

test('⛔ a WEEKLY residency is not flagged against last week', () => {
  const thisWeek = { name: 'Open Mic Comedy Night', venue: 'The Brewery', startDate: '2026-08-27' };
  const lastWeek = { id: 'p', name: 'Open Mic Comedy Night', venue: 'The Brewery', startDate: '2026-08-20' };
  assert.deepEqual(findRelatedEvents(thisWeek, [lastWeek]), [],
    'seven days apart: same name, same venue, and still obviously not a duplicate');
});

test('⛔ two different gigs at the same venue on different nights are left alone', () => {
  const a = { name: 'Bass Heavy', venue: 'Elbows Rest', startDate: '2026-10-03' };
  const b = { id: 'x', name: 'Gypsy Jazz Trio', venue: 'Elbows Rest', startDate: '2026-10-04' };
  assert.deepEqual(findRelatedEvents(a, [b]), []);
});

test('a multi-day festival overlaps a single night inside it, at the same venue', () => {
  const fest = { name: 'Neverland Weekender', venue: 'Memorial Hall', venueProfileId: 'v1', startDate: '2026-08-28', endDate: '2026-08-30' };
  const inside = { id: 'i', name: 'Saturday Doof', venue: 'Memorial Hall', venueProfileId: 'v1', startDate: '2026-08-29' };
  const hits = findRelatedEvents(fest, [inside]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, REASON.SAME_VENUE);
});

test('the venue PROFILE outranks the typed name', () => {
  const a = { name: 'One', venue: 'Memorial Hall', venueProfileId: 'v1', startDate: '2026-08-28' };
  const differentPlaceSameWords = { id: 'x', name: 'Two', venue: 'Memorial Hall', venueProfileId: 'v2', startDate: '2026-08-28' };
  assert.deepEqual(findRelatedEvents(a, [differentPlaceSameWords]), [],
    'two venues both called Memorial Hall are two venues');
});

test('⛔ the event being edited is never flagged against itself', () => {
  const me = { id: 'me', name: 'Neverland Weekender', venue: 'Memorial Hall', startDate: '2026-08-28', endDate: '2026-08-30' };
  assert.deepEqual(findRelatedEvents(me, [me]), []);
});

test('⚠ ONE shared token is not a match — "Jazz" must not flag every jazz gig', () => {
  assert.equal(namesLookRelated('Jazz', 'Jazz Social'), false);
  assert.equal(namesLookRelated('The Night', 'A Night'), false, 'stop words carry no signal');
});

test('a candidate with no date finds nothing rather than throwing', () => {
  assert.deepEqual(findRelatedEvents({ name: 'x', venue: 'y' }, [BEYOND_FRIDAY]), []);
  assert.deepEqual(findRelatedEvents(BEYOND_FRIDAY, [{ id: 'z', name: 'Beyond Jazz Weekender' }]), []);
  assert.deepEqual(findRelatedEvents(BEYOND_FRIDAY, null), []);
});

test('name matches rank above venue matches', () => {
  const cand = { name: 'Beyond Jazz Weekender Friday', venue: 'Memorial Hall', startDate: '2026-08-14' };
  const venueHit = { id: 'v', name: 'Trivia', venue: 'Memorial Hall', startDate: '2026-08-14' };
  const hits = findRelatedEvents(cand, [venueHit, BEYOND_UMBRELLA]);
  assert.equal(hits[0].reason, REASON.SAME_NAME);
  assert.equal(hits[1].reason, REASON.SAME_VENUE);
});
