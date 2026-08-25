import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanding, formatDateRange, formatDate, parseDateOnly } from './landingModel.js';

const event = (over = {}) => ({
  id: 'ev-1', name: 'Deliverance Festival 2026', applications_open: true,
  lat: null, lng: null, ...over,
});
const profile = (over = {}) => ({
  id: 'pf-1', name: 'Deliverance Festival', tagline: 'Three days in the valley',
  bio: 'The story.', location: 'Bellingen, NSW', website: 'https://example.com', ...over,
});

test('parseDateOnly builds a LOCAL date — the calendar day never shifts', () => {
  const d = parseDateOnly('2026-09-30');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 30);   // would be 29 or 30 depending on TZ if parsed as UTC
  assert.equal(parseDateOnly(null), null);
  assert.equal(parseDateOnly('not a date'), null);
});

test('formatDateRange collapses a same-month range and returns null for nothing', () => {
  assert.equal(formatDateRange('2027-01-16', '2027-01-19'), '16 – 19 January 2027');
  assert.match(formatDateRange('2026-12-30', '2027-01-02'), /December 2026.*January 2027/);
  assert.equal(formatDateRange('2027-01-16', null), '16 January 2027');
  assert.equal(formatDateRange(null, null), null);
  assert.equal(formatDate('2026-09-30'), '30 September 2026');
});

test('categories shown = open on the event ∩ applyable in the registry', () => {
  const vm = buildLanding({
    event: event(),
    profile: profile(),
    settings: { starts_on: '2026-11-13', ends_on: '2026-11-15' },
    categories: [
      { key: 'music', state: 'open', closes_at: '2026-09-30' },
      { key: 'volunteer', state: 'open', closes_at: null },
      // Open but no profile type can apply — must NOT reach the public page.
      { key: 'market_stall', state: 'open', closes_at: null },
    ],
    departments: [{ name: 'Kitchen' }, { name: 'Gate' }],
  });
  assert.deepEqual(vm.apply.map(c => c.key), ['music', 'volunteer']);
  assert.equal(vm.apply[0].closesOn, '30 September 2026');
  assert.equal(vm.apply[1].closesOn, null);
  // Departments reach only the category that asks for them, by name.
  assert.deepEqual(vm.apply[0].departments, []);
  assert.deepEqual(vm.apply[1].departments, ['Kitchen', 'Gate']);
  assert.equal(vm.applicationsOpen, true);
  assert.equal(vm.dates, '13 – 15 November 2026');
});

test('the master switch and the categories must BOTH be true', () => {
  const cats = [{ key: 'music', state: 'open', closes_at: null }];
  // Switch off, category open.
  assert.equal(
    buildLanding({ event: event({ applications_open: false }), profile: profile(), settings: null, categories: cats }).applicationsOpen,
    false,
  );
  // Switch on, nothing applyable open.
  assert.equal(
    buildLanding({
      event: event(), profile: profile(), settings: null,
      categories: [{ key: 'market_stall', state: 'open', closes_at: null }],
    }).applicationsOpen,
    false,
  );
});

test('absent optional fields come through as null, never a placeholder', () => {
  const vm = buildLanding({
    event: event({ name: '' }),
    profile: profile({ tagline: null, bio: null, location: null, website: null }),
    settings: null,
    categories: [],
  });
  assert.equal(vm.title, 'Deliverance Festival');   // falls back to the organisation
  assert.equal(vm.tagline, null);
  assert.equal(vm.about, null);
  assert.equal(vm.location, null);
  assert.equal(vm.dates, null);
  assert.equal(vm.mapsUrl, null);
  assert.equal(vm.applicationsOpen, false);
});

test('the maps link prefers coordinates, falls back to the stated location', () => {
  assert.equal(
    buildLanding({ event: event({ lat: -30.45, lng: 152.9 }), profile: profile(), settings: null, categories: [] }).mapsUrl,
    'https://maps.google.com/?q=-30.45,152.9',
  );
  // Postgres numerics may arrive as strings.
  assert.equal(
    buildLanding({ event: event({ lat: '-30.45', lng: '152.9' }), profile: profile(), settings: null, categories: [] }).mapsUrl,
    'https://maps.google.com/?q=-30.45,152.9',
  );
  assert.equal(
    buildLanding({ event: event(), profile: profile(), settings: null, categories: [] }).mapsUrl,
    'https://maps.google.com/?q=Bellingen%2C%20NSW',
  );
});
