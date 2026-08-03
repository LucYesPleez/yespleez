import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVenue, directionsQuery } from './venueDisplay.js';

const FULL = {
  name: 'The Federal Hotel',
  address: '77 Hyde St, Bellingen',
  locality: 'Bellingen',
  state: 'NSW',
  mapUrl: 'map://tile',
};

test('the full ladder, rung by rung', () => {
  assert.equal(resolveVenue(FULL).mode, 'map');
  assert.equal(resolveVenue({ ...FULL, mapUrl: null }).mode, 'address');
  assert.equal(resolveVenue({ ...FULL, mapUrl: null, address: null }).mode, 'locality');
  assert.equal(resolveVenue({ name: FULL.name }).mode, 'name');
  assert.equal(resolveVenue({}), null);
  assert.equal(resolveVenue(), null);
});

test('locality and state are joined into one area string', () => {
  assert.equal(resolveVenue(FULL).area, 'Bellingen NSW');
  assert.equal(resolveVenue({ locality: 'Bellingen' }).area, 'Bellingen');
  assert.equal(resolveVenue({ state: 'NSW' }).area, 'NSW');
});

// ── the rule this module exists for ──────────────────────────────────

test('⚠ WITHHELD NEVER RENDERS A MAP — even when coordinates exist', () => {
  // The trap: a secret-location event can carry coords from an import or a
  // geocode made before the organiser decided to hide it. Showing the map
  // because the data happens to be there would leak the decision.
  const r = resolveVenue({ ...FULL, withheld: true });
  assert.equal(r.mode, 'withheld');
  assert.equal(r.mapUrl, undefined, 'a withheld venue must not carry a map through');
  assert.equal(r.address, undefined, 'nor the street address');
});

test('⚠ a withheld venue still names its area — it announces, it does not vanish', () => {
  const r = resolveVenue({ locality: 'Mid North Coast', state: 'NSW', withheld: true });
  assert.equal(r.mode, 'withheld');
  assert.equal(r.area, 'Mid North Coast NSW');
});

test('a withheld venue with nothing at all to say is hidden, not an empty notice', () => {
  assert.equal(resolveVenue({ withheld: true }), null);
  assert.equal(resolveVenue({ mapUrl: 'map://tile', withheld: true }), null);
});

test('⚠ a map needs a renderable source, not merely coordinates', () => {
  // Until a tile provider is chosen the caller passes no mapUrl, and the ladder
  // falls to the address rather than showing an empty frame.
  assert.equal(resolveVenue({ name: 'X', address: '1 St', lat: -30.4, lng: 152.8 }).mode, 'address');
});

// ── directions ───────────────────────────────────────────────────────

test('directions prefer the address, fall back to the name', () => {
  assert.equal(directionsQuery({ name: 'The Federal Hotel', address: '77 Hyde St', area: 'Bellingen NSW' }),
    '77 Hyde St, Bellingen NSW');
  assert.equal(directionsQuery({ name: 'The Federal Hotel', area: 'Bellingen NSW' }),
    'The Federal Hotel, Bellingen NSW');
});

test('⚠ with nothing to point at, there is no directions query at all', () => {
  // A button that opens a map of the wrong town is worse than no button.
  assert.equal(directionsQuery({}), null);
  assert.equal(directionsQuery({ name: null, address: null, area: null }), null);
});

/* ─── The suburb must not print twice ──────────────────────────────── */

test('a formatted address that already contains the suburb drops the area line', () => {
  // Bellingen Memorial Hall's real stored location — geocoded, then had the
  // suburb/state/postcode appended again by whatever wrote it.
  const v = resolveVenue({
    name: 'Bellingen Memorial Hall',
    address: '32 Hyde St, Bellingen NSW 2454, Australia, Bellingen, NSW, 2454',
    locality: 'Bellingen',
    state: 'NSW',
  });
  assert.equal(v.mode, 'address');
  assert.equal(v.area, null, 'the address already says Bellingen NSW — do not say it a third time');
});

test('an address that does NOT contain the suburb keeps the area line', () => {
  const v = resolveVenue({ name: 'Elbows Rest', address: '12 Church St', locality: 'Thora', state: 'NSW' });
  assert.equal(v.area, 'Thora NSW', 'a street address alone still needs its town');
});

test('a withheld venue keeps its locality even when an address exists', () => {
  // Withheld never renders the address, so de-duplicating against it would
  // delete the only location the reader is allowed to see.
  const v = resolveVenue({
    name: 'Secret Doof',
    address: 'Somewhere near Bellingen NSW',
    locality: 'Bellingen', state: 'NSW', withheld: true,
  });
  assert.equal(v.mode, 'withheld');
  assert.equal(v.area, 'Bellingen NSW');
});

test('a locality-only venue is unaffected by the de-duplication', () => {
  const v = resolveVenue({ name: 'TBA', locality: 'Bellingen', state: 'NSW' });
  assert.equal(v.mode, 'locality');
  assert.equal(v.area, 'Bellingen NSW');
});
