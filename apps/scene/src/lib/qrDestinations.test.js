import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** The module's executable text. Comments are stripped so the drift guards
 *  below test what the file DOES, not what it says about itself — the header
 *  names `window.location.origin` and `supabase` precisely to forbid them. */
function moduleCode() {
  return fs.readFileSync(new URL('./qrDestinations.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

import {
  DESTINATIONS, DESTINATION_KEYS, PUBLIC_ORIGIN,
  qrUrl, qrPath, qrUrlWithSource, resolveDestination, isDestinationType,
  destinationsForOwner, destinationAccent,
} from './qrDestinations.js';

/**
 * WHAT THESE TESTS DEFEND.
 *
 * A printed QR cannot be corrected. So the invariants here are not "the code
 * works" — they are "the code that is already on a wall keeps working":
 *
 *   1. the `/q/{type}/{id}` shape never drifts
 *   2. the printed origin is never the dev server
 *   3. resolution never depends on a saved row
 *   4. the menu never offers somebody a destination that is not theirs
 */

/* ── 1 · the printed address ─────────────────────────────────────────────── */

const EVENT = '55512cb8-72e8-446c-9fff-f195d7e002c3';
const VENUE = '94a88288-43aa-445b-abb8-7dc895804b51';

test('⭐⭐ the encoded address is origin + hash + /q/{type}/{id}', () => {
  assert.equal(qrUrl('event', EVENT), `https://yespleez.com/#/q/event/${EVENT}`);
  assert.equal(qrUrl('set-times', EVENT), `https://yespleez.com/#/q/set-times/${EVENT}`);
  assert.equal(qrUrl('whats-on', VENUE), `https://yespleez.com/#/q/whats-on/${VENUE}`);
});

/**
 * ⚠⚠ THE ONE THAT WOULD REACH A PRINTER.
 *
 * If this constant ever becomes `window.location.origin`, every poster
 * generated from a dev server encodes `http://localhost:5173` and the mistake
 * is invisible on screen — the preview looks perfect and scans fine on the
 * machine that made it.
 */
test('⛔ the printed origin is production, never the current page', () => {
  assert.equal(PUBLIC_ORIGIN, 'https://yespleez.com');
  assert.ok(!/window\.location/.test(moduleCode()),
    'qrDestinations must never read the live origin — a printed code is always production');
});

test('an unknown type produces nothing rather than a broken address', () => {
  assert.equal(qrUrl('stage', EVENT), null);
  assert.equal(qrPath('event', ''), null);
  assert.equal(isDestinationType('stage'), false);
});

/* ── 2 · resolution ──────────────────────────────────────────────────────── */

test('every available destination resolves to a real in-app path', () => {
  assert.equal(resolveDestination('event', EVENT), `/event/${EVENT}`);
  assert.equal(resolveDestination('set-times', EVENT), `/event/${EVENT}/set-times`);
  assert.equal(resolveDestination('venue', VENUE), `/profile/${VENUE}`);
  assert.equal(resolveDestination('whats-on', VENUE), `/profile/${VENUE}?focus=whats-on`);
  assert.equal(resolveDestination('artist', VENUE), `/profile/${VENUE}`);
});

/**
 * ⭐⭐ THE SEPARATION THE BRIEF INSISTS ON. Event and Set Times are two
 * destinations, not one with a scroll position. If these ever collapse to the
 * same path the Set Times QR has silently become a second Event QR.
 */
test('⛔ Event and Set Times are different destinations', () => {
  assert.notEqual(resolveDestination('event', EVENT), resolveDestination('set-times', EVENT));
  assert.notEqual(qrUrl('event', EVENT), qrUrl('set-times', EVENT));
});

/**
 * The venue's permanent code. `?focus=whats-on` is a hint; a scanner that
 * drops query strings must still land on the right venue.
 */
test("What's On survives a scanner that strips the query string", () => {
  const path = resolveDestination('whats-on', VENUE);
  assert.ok(path.startsWith(`/profile/${VENUE}`), 'identity must be in the path, never the query');
});

test('Festival is architected and not offered', () => {
  assert.ok(DESTINATIONS.festival, 'the type must exist for the architecture to be honest');
  assert.equal(DESTINATIONS.festival.available, false);
  assert.equal(qrUrl('festival', VENUE), `https://yespleez.com/#/q/festival/${VENUE}`,
    'the address a future festival QR carries is already decided');
});

/* ── 3 · nothing depends on a saved row ──────────────────────────────────── */

test('⭐⭐ resolution takes a type and an id, and nothing else', () => {
  // If a lookup ever became necessary, this call would need a database.
  assert.equal(typeof resolveDestination('event', EVENT), 'string');
  assert.ok(!/supabase/i.test(moduleCode()),
    'the destination model must not reach the database: a deleted saved QR cannot break a printed one');
});

test('the analytics source parameter is additive and off by default', () => {
  assert.ok(!qrUrl('event', EVENT).includes('?s='), 'V1 exports must carry no tracking parameter');
  assert.equal(qrUrlWithSource('event', EVENT, 'qr-1'),
    `https://yespleez.com/#/q/event/${EVENT}?s=qr-1`);
  assert.equal(qrUrlWithSource('event', EVENT, null), qrUrl('event', EVENT));
});

/* ── 4 · the menu ────────────────────────────────────────────────────────── */

const venueProfile  = { id: 'p-venue', type: 'venue',  name: 'The Federal Hotel' };
const hostProfile   = { id: 'p-host',  type: 'host',   name: 'Disco Pig' };
const artistProfile = { id: 'p-art',   type: 'artist', name: 'LUCIOUS' };

const keysFor = (ctx) => destinationsForOwner(ctx).map(d => d.key);

test('a venue with events is offered the venue set', () => {
  assert.deepEqual(
    keysFor({ ownedProfiles: [venueProfile], manageableEventCount: 4, bookedArtistCount: 6 }),
    ['event', 'set-times', 'venue', 'whats-on', 'artist'],
  );
});

test('a host is offered their set, and ⛔ never Venue', () => {
  const keys = keysFor({ ownedProfiles: [hostProfile], manageableEventCount: 2, bookedArtistCount: 3 });
  assert.deepEqual(keys, ['event', 'set-times', 'whats-on', 'artist']);
  assert.ok(!keys.includes('venue'), 'a promoter does not own a venue page to point at');
});

test('⛔ an account with nothing is offered nothing', () => {
  assert.deepEqual(keysFor({ ownedProfiles: [], manageableEventCount: 0, bookedArtistCount: 0 }), []);
});

test('⛔ no events means no Event or Set Times QR, however many profiles you hold', () => {
  const keys = keysFor({ ownedProfiles: [venueProfile, hostProfile], manageableEventCount: 0 });
  assert.ok(!keys.includes('event'));
  assert.ok(!keys.includes('set-times'));
  assert.deepEqual(keys, ['venue', 'whats-on']);
});

/**
 * ⭐ The two ways an Artist QR is legitimate, kept separate so neither can be
 * removed by accident: you ARE the artist, or you BOOKED them.
 */
test('Artist is offered to a performer with no bookings', () => {
  assert.ok(keysFor({ ownedProfiles: [artistProfile], bookedArtistCount: 0 }).includes('artist'));
});

test('Artist is offered to a venue purely because acts are on its bills', () => {
  assert.ok(keysFor({ ownedProfiles: [venueProfile], bookedArtistCount: 1 }).includes('artist'));
  assert.ok(!keysFor({ ownedProfiles: [venueProfile], bookedArtistCount: 0 }).includes('artist'));
});

test('Festival is never in the menu, whatever you own', () => {
  const everything = { ownedProfiles: [venueProfile, hostProfile, artistProfile, { id: 'f', type: 'festival', name: 'F' }], manageableEventCount: 9, bookedArtistCount: 9 };
  assert.ok(!keysFor(everything).includes('festival'));
});

/* ── registry hygiene ────────────────────────────────────────────────────── */

test('every destination declares the full contract', () => {
  for (const key of DESTINATION_KEYS) {
    const d = DESTINATIONS[key];
    assert.equal(d.key, key, 'key must match its registry slot — it is the printed path segment');
    assert.equal(typeof d.label, 'string');
    assert.equal(typeof d.scanLabel, 'string');
    assert.equal(typeof d.route, 'function');
    assert.equal(typeof d.available, 'boolean');
    if (d.subject === 'profile') assert.ok(Array.isArray(d.profileTypes) && d.profileTypes.length);
  }
});

test('⛔ no em dashes in anything printed or shown', () => {
  for (const key of DESTINATION_KEYS) {
    const d = DESTINATIONS[key];
    for (const s of [d.label, d.scanLabel, d.blurb]) {
      assert.ok(!s.includes('—') && !s.includes('–'), `${key}: "${s}"`);
    }
  }
});

test('every destination has an accent from the profile taxonomy', () => {
  for (const key of DESTINATION_KEYS) {
    assert.match(destinationAccent(key), /^#[0-9A-Fa-f]{6}$/);
  }
});
