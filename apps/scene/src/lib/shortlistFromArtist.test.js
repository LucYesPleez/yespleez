import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planAddArtistToShortlist, addArtistToShortlist, findArtistOnEvent } from './shortlistFromArtist.js';

/**
 * THE SECOND ENTRY POINT — an artist who never applied.
 *
 * ⚠⚠ The guard tested hardest here is idempotency. `lineup_members` has NO
 * uniqueness constraint, and the last time a write path lacked a working guard
 * it put eight junk rows into production.
 */

const EV = 'ev-1';
const madds = { id: 'p-madds', user_id: 'u-madds', name: 'Madds', sound: 'Techno', genre_string: 'Techno · Industrial' };
const nobody = { id: null, user_id: null, name: 'Typed Name' };

const onBill      = { id: 'm-1', event_id: EV, artist_profile_id: 'p-madds', artist_id: 'u-madds', status: 'on_bill' };
const shortlisted = { id: 'm-2', event_id: EV, artist_profile_id: 'p-madds', artist_id: 'u-madds', status: 'shortlisted' };
const removed     = { id: 'm-3', event_id: EV, artist_profile_id: 'p-madds', artist_id: 'u-madds', status: 'removed' };
const legacyOnly  = { id: 'm-4', event_id: EV, artist_profile_id: null,      artist_id: 'u-madds', status: 'on_bill' };

test('a found artist becomes a SHORTLISTED member, ⛔ never an application', () => {
  const plan = planAddArtistToShortlist(madds, EV, []);
  assert.equal(plan.ok, true);
  assert.equal(plan.member.status, 'shortlisted', '⛔ on_bill here would book somebody you are only considering');
  assert.equal(plan.member.artist_profile_id, 'p-madds');
  assert.equal(plan.member.event_id, EV);
});

test('⛔⛔ ALREADY ON THE BILL — refused, and says so', () => {
  const plan = planAddArtistToShortlist(madds, EV, [onBill]);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already on the lineup/i);
  assert.equal(plan.existing.id, 'm-1');
});

test('⛔⛔ ALREADY SHORTLISTED — refused, the double-tap case', () => {
  const plan = planAddArtistToShortlist(madds, EV, [shortlisted]);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already on the shortlist/i);
});

test('⛔ PREVIOUSLY REMOVED still counts — ⛔ no second row', () => {
  const plan = planAddArtistToShortlist(madds, EV, [removed]);
  assert.equal(plan.ok, false, 'lineup_members has no uniqueness constraint; this guard is the only one');
  assert.match(plan.reason, /removed/i);
});

test('matched on the ACCOUNT when the member predates profile ids', () => {
  assert.ok(findArtistOnEvent(madds, [legacyOnly]), 'artist_id is the legacy key and must still match');
});

test('⛔ a pick with no profile is refused rather than coerced', () => {
  const plan = planAddArtistToShortlist(nobody, EV, []);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /no profile/i);
});

test('⛔ NOTHING BUT lineup_members IS WRITTEN — no application, no performance', async () => {
  const calls = [];
  const db = { from: (name) => ({
    insert: () => ({ select: () => ({ single: async () => { calls.push(name); return { data: { id: 'new' }, error: null }; } }) }),
  }) };
  const res = await addArtistToShortlist(db, planAddArtistToShortlist(madds, EV, []));
  assert.equal(res.ok, true);
  assert.deepEqual(calls, ['lineup_members'],
    '⛔ an applications row would put words in the artist’s mouth; a performance would book them');
});

test('a refused plan writes nothing at all', async () => {
  let touched = false;
  const db = { from: () => { touched = true; return {}; } };
  const res = await addArtistToShortlist(db, planAddArtistToShortlist(madds, EV, [onBill]));
  assert.equal(res.ok, false);
  assert.equal(touched, false, '⛔ the guard must stop the write, not merely report on it');
});
