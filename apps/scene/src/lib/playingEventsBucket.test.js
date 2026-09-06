/**
 * A CONFIRMED GIG THAT DID NOT COUNT AS PLAYING.
 *
 * ⛔⛔ MySceneScreen built `playingEventIds` from
 * `apps.filter(a => a.status === 'accepted')` — the literal, not the bucket.
 * `confirmed` and `booked` mean the same thing and are written by the host
 * slot-offer flow, so an act whose application had been confirmed was simply
 * not counted as playing, and the night lost its PLAYING treatment in the
 * spotlight rail.
 *
 * ⚠ `outgoing`: these are the viewer's OWN applications (`artist_id = uid`),
 * so the viewer is the initiator. The accepted bucket covers the same three
 * spellings from either side, but the direction should say what is true.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const { normaliseStatus, rawStatusesFor } = await import('./enquiryUtils.js');

/** Exactly the predicate MySceneScreen now uses. */
const isPlaying = status =>
  normaliseStatus({ status, direction: 'outgoing' }) === 'accepted';

test('⛔⛔ accepted, confirmed AND booked all count as playing', () => {
  assert.equal(isPlaying('accepted'), true);
  // The two the literal missed — the defect, stated.
  assert.equal(isPlaying('confirmed'), true, 'confirmed is the same commitment');
  assert.equal(isPlaying('booked'), true, 'so is booked');
  assert.equal(['accepted'].includes('confirmed'), false, 'the old literal could not see it');
});

test('⭐ every raw spelling of the accepted bucket counts', () => {
  for (const s of rawStatusesFor('accepted', 'outgoing')) {
    assert.equal(isPlaying(s), true, `${s} normalises to accepted`);
  }
  assert.deepEqual(rawStatusesFor('accepted', 'outgoing').slice().sort(),
    ['accepted', 'booked', 'confirmed']);
});

test('⛔ an undecided or refused application is NOT playing', () => {
  for (const s of ['pending', 'new', 'seen', 'viewed', 'shortlisted', 'tentative',
                   'offered', 'declined', 'rejected', 'cancelled']) {
    assert.equal(isPlaying(s), false, `${s} is not a gig you are playing`);
  }
});

test('⚠ an unknown or absent status is NOT playing', () => {
  /* ⭐ The catch-all is `awaiting`, not `accepted` — so an unrecognised status
     cannot silently claim someone is on a bill. ⛔ This is the one place the
     catch-all must NOT be generous. */
  for (const s of [null, undefined, '', 'wat']) {
    assert.equal(isPlaying(s), false, `${JSON.stringify(s)} must not claim a gig`);
  }
});

test('⛔⛔ the screen uses the bucket, not the literal', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../screens/MySceneScreen.jsx', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code,
    /normaliseStatus\(\{ status: a\.status, direction: 'outgoing' \}\) === 'accepted'/,
    'playingEventIds must read the bucket');
  assert.ok(!/a\.status === 'accepted'/.test(code), 'the literal must not come back');
});
