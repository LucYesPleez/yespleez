/**
 * WHICH TOWN DOES THIS PROFILE SAY IT IS FROM?
 *
 * ⚠⚠ THE ANSWER IS SHARED BY A RENDERER AND A FILTER, which is the whole
 * reason it lives in one function. A card prints the town; LOCALS filters on
 * it. When they read the two fields in different orders, the section silently
 * dropped venues whose own cards said Bellingen — measured 2026-08-22: one
 * venue visible signed in, five signed out, same page, same data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocation, displayTown } from './formatLocation.js';

/* ── displayTown ────────────────────────────────────────────────────────────
 *
 * ⛔⛔ SUBURB WINS. A venue keeps its STREET ADDRESS in `location`, so the
 * opposite order reads "3/5 Church St" for a venue whose card says Bellingen.
 * LocalsRails had exactly that inverted and silently dropped every Bellingen
 * venue with an address from the LOCALS rail — signed in you saw one venue,
 * signed out you saw five.
 */
test('displayTown prefers suburb, because a venue stores its street in location', () => {
  assert.equal(
    displayTown({ suburb: 'Bellingen', location: '3/5 Church St' }),
    'Bellingen',
  );
  assert.equal(
    displayTown({ suburb: 'Bellingen', location: '1172 Waterfall Way, Bellingen, NSW, 2454' }),
    'Bellingen',
  );
});

test('displayTown falls back to location, which is where an ARTIST keeps its town', () => {
  assert.equal(displayTown({ location: 'Bellingen' }), 'Bellingen');
  assert.equal(displayTown({ suburb: null, location: 'Dorrigo' }), 'Dorrigo');
});

test('displayTown returns empty for nothing, N/A, or punctuation-only', () => {
  assert.equal(displayTown({}), '');
  assert.equal(displayTown({ suburb: 'N/A', location: '' }), '');
  assert.equal(displayTown({ suburb: ' , ' }), '');
});

test('the card and the filter cannot disagree — formatLocation uses the same town', () => {
  const venue = { suburb: 'Bellingen', location: '3/5 Church St', state: 'NSW', postcode: '2454' };
  assert.equal(displayTown(venue), 'Bellingen');
  assert.ok(formatLocation(venue).startsWith('Bellingen'),
    'if these two ever diverge, a filter drops cards that read as local');
});
