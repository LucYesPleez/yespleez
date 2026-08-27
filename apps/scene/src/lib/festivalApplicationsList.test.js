/**
 * MY SCENE → APPLICATIONS — the grouping, pinned to the RPC's real shape.
 *
 * ⚠⚠ THE FAILURE THIS GUARDS AGAINST is the one the organiser's table already
 * suffered: a fixture that is kinder than the database. `my_festival_applications_all`
 * returns snake_case columns and a MASKED status, and an application may name
 * an event that no longer exists. Every case below is written from the SQL, not
 * from what would be convenient to render.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// festivalApplications.js imports supabase.js at module scope, which reads
// import.meta.env — a Vite construct with no meaning under plain Node. Same
// fix as the sibling test file.
mock.module('./supabase', { exports: { supabase: {} } });

const { groupApplications, applicationSection, categoryLabel } =
  await import('./festivalApplications.js');

const app = (over = {}) => ({
  eventId: 'e1', eventName: 'Echo Valley', eventDate: '2026-11-06',
  categoryKey: 'volunteer', status: 'submitted',
  outcomeReleasedAt: null, submittedAt: '2026-08-06T05:34:00Z',
  ...over,
});

test('an empty list produces NO sections, not empty ones', () => {
  assert.deepEqual(groupApplications([]), [],
    'My Scene is attention, never a directory — an ARTIST heading over nothing ' +
    'promises content that does not exist.');
});

test('only sections that actually hold something are returned', () => {
  const out = groupApplications([app()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'volly');
  assert.equal(out[0].label, 'VOLLYS');
});

test('sections come back in the ratified order, not insertion order', () => {
  // Deliberately supplied volly-first; artist must still lead.
  const out = groupApplications([app(), app({ categoryKey: 'music', eventId: 'e2' })]);
  assert.deepEqual(out.map(x => x.key), ['artist', 'volly']);
});

test('a category Scene has never heard of lands in OTHER and is NOT dropped', () => {
  // ⭐ Scene does not know about decor by design (role discovery scope). A
  // person can still hold the application, and hiding it is the same silence
  // this surface exists to end.
  const out = groupApplications([app({ categoryKey: 'decor' })]);
  assert.equal(out[0].key, 'other');
  assert.equal(applicationSection('decor'), 'other');
});

test('an unknown category still gets a readable label', () => {
  assert.equal(categoryLabel('theme_camp'), 'Theme camp');
  assert.equal(categoryLabel('volunteer'), 'Volunteer Crew',
    'The list label is the FULL name, not the tile word "Vollys".');
});

test('newest application sorts first inside a section', () => {
  const out = groupApplications([
    app({ eventId: 'old', submittedAt: '2026-01-01T00:00:00Z' }),
    app({ eventId: 'new', submittedAt: '2026-08-06T05:34:00Z' }),
  ]);
  assert.deepEqual(out[0].applications.map(a => a.eventId), ['new', 'old']);
});

test('a null submittedAt sorts last and does NOT throw', () => {
  // A draft has no submitted_at. One bad row must not scramble the list.
  const out = groupApplications([
    app({ eventId: 'draft', submittedAt: null }),
    app({ eventId: 'real' }),
  ]);
  assert.deepEqual(out[0].applications.map(a => a.eventId), ['real', 'draft']);
});

test('an application whose event was deleted survives the grouping', () => {
  // The SQL LEFT JOINs `events` on purpose — it is still the person's history.
  const out = groupApplications([app({ eventName: null, eventDate: null })]);
  assert.equal(out.length, 1,
    'A null event name must not remove the row; the UI renders the absence.');
});
