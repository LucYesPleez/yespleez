import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* The module under test imports the real client for its default `db`. Node has
   no `import.meta.env`, so the client is stubbed the way writeNotification.test
   does it — the DEFAULT is never exercised here anyway: every call below passes
   its own `db`, which is the point of the injection seam. */
mock.module('./supabase', { exports: { supabase: null } });

const {
  saveQrCode, archiveQrCode, listQrCodes, selectableProfiles, selectableEvents, qrDisplayName,
} = await import('./qrCodes.js');

/**
 * A chainable PostgREST stub. Every builder method returns the same object and
 * records the call, so a test can assert on the QUERY as well as the result —
 * which is the only way to check things like "the event filter kept both
 * ownership arms".
 */
function fakeDb(responses = {}) {
  const calls = [];
  const builder = (table) => {
    const state = { table, filters: [], op: null, payload: null };
    calls.push(state);
    const self = {
      select(cols) { state.select = cols; return self; },
      insert(row) { state.op = 'insert'; state.payload = row; return self; },
      update(row) { state.op = 'update'; state.payload = row; return self; },
      eq(c, v) { state.filters.push(['eq', c, v]); return self; },
      in(c, v) { state.filters.push(['in', c, v]); return self; },
      not(c, o, v) { state.filters.push(['not', c, o, v]); return self; },
      or(f) { state.filters.push(['or', f]); return self; },
      order() { return self; },
      limit() { return self; },
      single() { return result(); },
      maybeSingle() { return result(); },
      then(res) { return Promise.resolve(result()).then(res); },
    };
    function result() {
      const key = `${state.table}:${state.op ?? 'select'}`;
      const r = responses[key] ?? responses[state.table] ?? { data: null, error: null };
      return typeof r === 'function' ? r(state) : r;
    }
    return self;
  };
  return { from: builder, calls };
}

const VENUE = 'p-federal';
const EVENT = 'ev-solstice';

/* ── saving is idempotent ────────────────────────────────────────────────── */

/**
 * ⭐⭐ THE BRIEF'S RULE, TESTED: "Do not force users to create a new QR every
 * time they need the same destination." A venue that opens the generator twice
 * for their What's On code must end up with ONE row, not two identical posters
 * in their library.
 */
test('⭐⭐ saving the same destination twice reuses the saved row', async () => {
  const existing = {
    id: 'qr-1', owner_profile_id: VENUE, destination_type: 'whats-on',
    destination_id: VENUE, label: 'The Federal Hotel', status: 'active', created_at: 't',
  };
  const db = fakeDb({ 'qr_codes:select': { data: existing, error: null } });

  const out = await saveQrCode({
    ownerProfileId: VENUE, destinationType: 'whats-on', destinationId: VENUE,
    label: 'The Federal Hotel', userId: 'u-1',
  }, db);

  assert.equal(out.ok, true);
  assert.equal(out.reused, true);
  assert.equal(out.row.id, 'qr-1');
  assert.ok(!db.calls.some(c => c.op === 'insert'), '⛔ a duplicate row was inserted');
});

test('a renamed destination refreshes the label on the SAME row', async () => {
  const existing = {
    id: 'qr-1', owner_profile_id: VENUE, destination_type: 'venue',
    destination_id: VENUE, label: 'Federal Hotel', status: 'active', created_at: 't',
  };
  const db = fakeDb({ 'qr_codes:select': { data: existing, error: null } });
  const out = await saveQrCode({
    ownerProfileId: VENUE, destinationType: 'venue', destinationId: VENUE, label: 'The Federal',
  }, db);

  assert.equal(out.row.id, 'qr-1');
  assert.equal(out.row.label, 'The Federal');
  assert.ok(db.calls.some(c => c.op === 'update' && c.payload.label === 'The Federal'));
});

test('a new destination is inserted, naming both the profile and the human', async () => {
  const db = fakeDb({
    'qr_codes:select': { data: null, error: null },
    'qr_codes:insert': (s) => ({ data: { id: 'qr-new', ...s.payload }, error: null }),
  });
  const out = await saveQrCode({
    ownerProfileId: VENUE, destinationType: 'set-times', destinationId: EVENT,
    label: 'Solstice', userId: 'u-1',
  }, db);

  assert.equal(out.ok, true);
  assert.equal(out.reused, false);
  const insert = db.calls.find(c => c.op === 'insert').payload;
  // ⭐ The identity contract: the row names its actor AND the human.
  assert.equal(insert.owner_profile_id, VENUE, 'attribution missing');
  assert.equal(insert.created_by_user_id, 'u-1', 'audit trail missing');
});

test('⛔ a save with no profile is refused before it reaches the database', async () => {
  const db = fakeDb();
  const out = await saveQrCode({ destinationType: 'venue', destinationId: VENUE }, db);
  assert.equal(out.ok, false);
  assert.equal(db.calls.length, 0, 'an unattributable write was attempted');
});

test('⛔ an unknown destination type never becomes a row', async () => {
  const db = fakeDb();
  const out = await saveQrCode({ ownerProfileId: VENUE, destinationType: 'stage', destinationId: EVENT }, db);
  assert.equal(out.ok, false);
  assert.equal(db.calls.length, 0);
});

/* ── retiring ────────────────────────────────────────────────────────────── */

/**
 * ⛔⛔ A PRINTED CODE CANNOT BE RECALLED. Deleting the record does not un-print
 * the hundred flyers it is on; it only removes the owner's ability to see where
 * that artefact points. Archive, always.
 */
test('⛔ retiring a QR archives it, and never deletes it', async () => {
  const db = fakeDb({ 'qr_codes:update': { data: null, error: null } });
  await archiveQrCode('qr-1', db);
  const call = db.calls[0];
  assert.equal(call.op, 'update');
  assert.equal(call.payload.status, 'archived');
  assert.ok(!db.calls.some(c => c.op === 'delete'));
});

test('the library hides archived rows unless asked', async () => {
  const db = fakeDb({ qr_codes: { data: [], error: null } });
  await listQrCodes([VENUE], { db });
  assert.ok(db.calls[0].filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'active'));

  const db2 = fakeDb({ qr_codes: { data: [], error: null } });
  await listQrCodes([VENUE], { includeArchived: true, db: db2 });
  assert.ok(!db2.calls[0].filters.some(f => f[1] === 'status'));
});

test('an empty profile list asks nothing at all', async () => {
  const db = fakeDb();
  assert.deepEqual(await listQrCodes([], { db }), []);
  assert.equal(db.calls.length, 0);
});

/* ── what you may point at ───────────────────────────────────────────────── */

/**
 * ⛔⛔ BOTH OWNERSHIP ARMS, OR THE VENUE SEES ALMOST NOTHING. `host_id` is NULL
 * on 82 of 92 events; an owner-only filter is not "stricter", it is wrong for
 * the ten it matches and blind to the rest. Same lesson as the ownership gate.
 */
test('⛔⛔ the event filter keeps every ownership arm', async () => {
  const db = fakeDb({ events: { data: [], error: null } });
  await selectableEvents({ userId: 'u-1', profileIds: [VENUE] }, db);
  const or = db.calls[0].filters.find(f => f[0] === 'or')[1];
  assert.ok(or.includes(`owner_profile_id.eq.${VENUE}`), 'ownership arm missing');
  assert.ok(or.includes('host_id.eq.u-1'), 'legacy authorship arm missing');
  assert.ok(or.includes(`venue_profile_id.eq.${VENUE}`), "the venue's own nights are missing");
});

test('no profiles and no account means no events, and no query', async () => {
  const db = fakeDb();
  assert.deepEqual(await selectableEvents({ profileIds: [] }, db), []);
  assert.equal(db.calls.length, 0);
});

const venueProfile = { id: VENUE, type: 'venue', name: 'The Federal Hotel' };
const myBand = { id: 'p-band', type: 'band', name: 'Elbows Rest' };

test('a venue destination offers only the venue profiles you own', async () => {
  const db = fakeDb();
  const out = await selectableProfiles('venue', { ownedProfiles: [venueProfile, myBand] }, db);
  assert.deepEqual(out.map(p => p.id), [VENUE]);
  assert.equal(db.calls.length, 0, 'owned profiles are already in hand — no query needed');
});

test("What's On accepts a host as well as a venue", async () => {
  const host = { id: 'p-host', type: 'host', name: 'Disco Pig' };
  const out = await selectableProfiles('whats-on', { ownedProfiles: [venueProfile, host] }, fakeDb());
  assert.deepEqual(out.map(p => p.id).sort(), [VENUE, 'p-host'].sort());
});

/**
 * ⭐ The Artist QR's second arm. A venue owns no artist profile, and still has
 * a legitimate reason to print one: the act is on their bill on Friday.
 */
test('⭐ Artist offers acts booked onto your events, not just your own', async () => {
  const db = fakeDb({
    lineup_members: { data: [{ artist_profile_id: 'p-luc' }, { artist_profile_id: 'p-luc' }], error: null },
    profiles: { data: [{ id: 'p-luc', name: 'LUCIOUS', type: 'artist' }], error: null },
  });
  const out = await selectableProfiles('artist', { ownedProfiles: [venueProfile], eventIds: [EVENT] }, db);
  assert.deepEqual(out.map(p => p.id), ['p-luc']);
});

test('a booked act that is also your own profile appears once', async () => {
  const db = fakeDb({
    lineup_members: { data: [{ artist_profile_id: 'p-band' }], error: null },
    profiles: { data: [], error: null },
  });
  const out = await selectableProfiles('artist', { ownedProfiles: [myBand], eventIds: [EVENT] }, db);
  assert.deepEqual(out.map(p => p.id), ['p-band']);
});

test('⛔ a venue with no events is offered no strangers', async () => {
  const out = await selectableProfiles('artist', { ownedProfiles: [venueProfile], eventIds: [] }, fakeDb());
  assert.deepEqual(out, []);
});

/* ── rendering contract ──────────────────────────────────────────────────── */

/**
 * ⚠ THREE STATES, THREE ANSWERS. A saved QR whose event was deleted is not
 * hidden and not blank: the owner may have it on a poster and has to be told it
 * now goes nowhere.
 */
test('a dead destination says so, and is never silently blank', () => {
  const row = { label: 'Solstice Gathering' };
  assert.deepEqual(qrDisplayName(row, undefined), { name: 'Solstice Gathering', state: 'unknown' });
  assert.deepEqual(qrDisplayName(row, null), { name: 'Solstice Gathering', state: 'missing' });
  assert.deepEqual(qrDisplayName(row, { name: 'Solstice 2026' }), { name: 'Solstice 2026', state: 'live' });
  assert.equal(qrDisplayName({ label: null }, null).name, 'Deleted destination');
});
