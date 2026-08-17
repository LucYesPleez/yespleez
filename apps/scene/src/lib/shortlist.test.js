import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shortlistEntries, shortlistEntriesFromGroups, sameArtist } from './shortlist.js';

const LEGACY   = { id: 'e1', booking_model: 'legacy' };
const IMPORTED = { id: 'e2', booking_model: 'imported' };
const MANAGED  = { id: 'e3', booking_model: 'managed' };

const short = (id, over = {}) => ({ id, status: 'shortlisted', artist_profile_id: null, artist_id: null, artist_name: null, ...over });
const onBill = (id, over = {}) => ({ id, status: 'on_bill', artist_profile_id: null, artist_id: null, artist_name: null, ...over });

const ids = entries => entries.map(e => e.id);

/* ── A · THE GATE IS SET TIMES, ON EVERY CONTRACT ──────────────────────────── */

/**
 * ⛔⛔ THE TEST THE WHOLE PHASE TURNS ON, AND IT IS THE MEASURED ONE. 121 of 145
 * `on_bill` members hold no slot; 120 of those are on set-times-OFF events where
 * the LINEUP tab already lists them. If this goes green-to-red, 36 shortlists
 * that are empty today just filled up with rows that already exist elsewhere.
 */
test('A · set times OFF · a booked unscheduled member is NOT injected (legacy)', () => {
  const entries = shortlistEntries({
    event: LEGACY, usesSetTimes: false,
    shortlistMembers: [short('s1', { artist_profile_id: 'p1' })],
    billMembers: [onBill('b1', { artist_profile_id: 'p2' }), onBill('b2', { artist_profile_id: 'p3' })],
  });
  assert.deepEqual(ids(entries), ['s1']);
});

test('B · set times OFF · same for imported and managed', () => {
  for (const event of [IMPORTED, MANAGED]) {
    const entries = shortlistEntries({
      event, usesSetTimes: false,
      billMembers: [onBill('b1', { artist_profile_id: 'p2' })],
      perfsByMember: { b1: [{ status: 'accepted' }] },
    });
    assert.deepEqual(ids(entries), [], `injected on ${event.booking_model}`);
  }
});

/**
 * ⭐⭐ BASS HEAVY, THE CANONICAL CASE (owner, 2026-08-17). 5 on_bill, 4 holding
 * slots, `luc` holding none, set times ON. ⛔ luc was reachable from NO host
 * surface before this rule.
 */
test('C · set times ON · legacy · only the UNSCHEDULED booked member is injected', () => {
  const entries = shortlistEntries({
    event: LEGACY, usesSetTimes: true,
    shortlistMembers: [short('s1', { artist_profile_id: 'p1' })],
    billMembers: [
      onBill('elbow',   { artist_profile_id: 'pe' }),
      onBill('lucious', { artist_profile_id: 'pl' }),
      onBill('madds',   { artist_profile_id: 'pm' }),
      onBill('fewrf',   { artist_name: 'fewrf' }),
      onBill('luc',     { artist_name: 'luc' }),
    ],
    perfsByMember: {
      elbow:   [{ status: 'offered',  slot_uuid: 'sl1' }],
      lucious: [{ status: 'draft',    slot_uuid: 'sl2' }],
      madds:   [{ status: 'offered',  slot_uuid: 'sl3' }],
      fewrf:   [{ status: 'accepted', slot_uuid: 'sl5' }],
      luc:     [],
    },
  });
  assert.deepEqual(ids(entries), ['luc', 's1']);
  assert.equal(entries[0].booked, true);
  assert.equal(entries[0].needsSetTime, true);
  assert.equal(entries[1].needsSetTime, false);
});

/**
 * ⛔⛔ A NULL `booking_model` IS THE COMMON CASE — 88 of 88 events read it. The
 * gate must work there too, ⛔ it is not a managed-only feature.
 */
test('D · set times ON · a grandfathered event with no booking_model injects too', () => {
  const entries = shortlistEntries({
    event: { id: 'e0' }, usesSetTimes: true,
    billMembers: [onBill('b1', { artist_id: 'a2' })],
  });
  assert.deepEqual(ids(entries), ['b1']);
  assert.equal(entries[0].booked, true);
});

/**
 * ⛔⛔ BOOKED **AND SCHEDULED** BELONGS TO SET TIMES ALONE. A slot grid answers
 * "when are they playing"; repeating them here would make SHORTLIST a second,
 * worse copy of the running order.
 */
test('E · set times ON · a booked member WITH a slot never appears', () => {
  const entries = shortlistEntries({
    event: LEGACY, usesSetTimes: true,
    billMembers: [onBill('b1', { artist_profile_id: 'p2' })],
    perfsByMember: { b1: [{ status: 'accepted', slot_uuid: 'sl1' }] },
  });
  assert.deepEqual(ids(entries), []);
});

/**
 * ⚠ A NULL-SLOT PERFORMANCE IS THE EVENT-LEVEL OFFER (P4), ⛔ NOT a placement.
 * Holding one does not make somebody scheduled, so they still need a set time.
 */
test('F · set times ON · a null-slot performance is not a placement', () => {
  const entries = shortlistEntries({
    event: LEGACY, usesSetTimes: true,
    billMembers: [onBill('b1', { artist_profile_id: 'p2' })],
    perfsByMember: { b1: [{ status: 'accepted', slot_uuid: null }] },
  });
  assert.deepEqual(ids(entries), ['b1']);
  assert.equal(entries[0].needsSetTime, true);
});

/**
 * ⛔⛔ OFFERED IS NOT BOOKED on a managed event — only the artist's acceptance
 * books them. ⚠ On a LEGACY event the same row IS booked, because `on_bill` is
 * the answer there. One rule, two right answers: `isBooked`.
 */
test('G · set times ON · managed needs acceptance where legacy needs only on_bill', () => {
  const args = {
    usesSetTimes: true,
    billMembers: [onBill('b1', { artist_profile_id: 'p2' })],
    perfsByMember: { b1: [{ status: 'offered', slot_uuid: null }] },
  };
  assert.deepEqual(ids(shortlistEntries({ ...args, event: MANAGED })), []);
  assert.deepEqual(ids(shortlistEntries({ ...args, event: LEGACY })),  ['b1']);
});

test('H · a booked member is a member kind, never relabelled shortlisted', () => {
  const [entry] = shortlistEntries({
    event: MANAGED, usesSetTimes: true,
    billMembers: [onBill('b1', { artist_id: 'a9' })],
    perfsByMember: { b1: [{ status: 'accepted' }] },
  });
  assert.equal(entry.kind, 'member');
  assert.equal(entry.row.status, 'on_bill');
});

/* ── C · de-duplication across the three populations ───────────────────────── */

test('I2 · an application already represented by a SHORTLIST member is excluded', () => {
  const entries = shortlistEntries({
    event: LEGACY,
    shortlistMembers: [short('s1', { artist_profile_id: 'p1' })],
    shortlistedApps: [{ id: 'app1', from_profile_id: 'p1' }],
  });
  assert.deepEqual(ids(entries), ['s1']);
});

/**
 * ⚠⚠ THE DRIFT THIS CLOSES. `HostDashboard` excluded against its shortlist
 * members and the bill via two separately assembled lists; the event page did
 * the same with different variables. One shared population makes the guarantee
 * structural on both.
 */
test('I · an application already on the BILL is excluded, on every contract', () => {
  for (const event of [LEGACY, IMPORTED, MANAGED]) {
    const entries = shortlistEntries({
      event,
      billMembers: [onBill('b1', { artist_profile_id: 'p1' })],
      shortlistedApps: [{ id: 'app1', from_profile_id: 'p1' }],
    });
    assert.equal(entries.some(e => e.id === 'app1'), false, `leaked on ${event.booking_model}`);
  }
});

/**
 * ⛔ Excluded against the WHOLE bill, not only its booked part. An applicant
 * awaiting their answer is already represented on the event.
 */
test('J · an application matching an UNBOOKED managed bill member is still excluded', () => {
  const entries = shortlistEntries({
    event: MANAGED,
    billMembers: [onBill('b1', { artist_profile_id: 'p1' })],
    perfsByMember: { b1: [{ status: 'offered' }] },
    shortlistedApps: [{ id: 'app1', from_profile_id: 'p1' }],
  });
  assert.deepEqual(ids(entries), []);
});

test('K · a hand-typed act matches by name only when neither side has an id', () => {
  const entries = shortlistEntries({
    event: LEGACY,
    shortlistMembers: [short('s1', { artist_name: '  Halo  ' })],
    shortlistedApps: [{ id: 'app1', artist_name: 'halo' }, { id: 'app2', artist_name: 'Someone Else' }],
  });
  assert.deepEqual(ids(entries), ['s1', 'app2']);
});

/**
 * ⛔⛔ TWO BLANK NAMES MUST NEVER MATCH — an all-NULL row would otherwise
 * "already be" every applicant. This is the 2026-08-15 incident's rule.
 */
test('L · a nameless member does not swallow a nameless application', () => {
  const entries = shortlistEntries({
    event: LEGACY,
    shortlistMembers: [short('s1')],
    shortlistedApps: [{ id: 'app1' }],
  });
  assert.deepEqual(ids(entries), ['s1', 'app1']);
});

/* ⚠ `usesSetTimes: true` or the booked row is never built and this asserts
   nothing — the collision it exists to catch could not occur. */
test('M · a shortlisted row wins over a booked row for the same artist', () => {
  const entries = shortlistEntries({
    event: MANAGED, usesSetTimes: true,
    shortlistMembers: [short('s1', { artist_profile_id: 'p1' })],
    billMembers: [onBill('b1', { artist_profile_id: 'p1' })],
    perfsByMember: { b1: [{ status: 'accepted' }] },
  });
  assert.deepEqual(ids(entries), ['s1']);
});

/* ── D · the dashboard adapter is the same rule ────────────────────────────── */

test('N · the groups adapter agrees with the flat form, row for row', () => {
  const bookedMember = onBill('b1', { artist_profile_id: 'p2' });
  const args = {
    event: MANAGED, usesSetTimes: true,
    shortlistMembers: [short('s1', { artist_profile_id: 'p1' })],
    shortlistedApps: [{ id: 'app1', from_profile_id: 'p9' }],
  };
  const flat = shortlistEntries({
    ...args, billMembers: [bookedMember], perfsByMember: { b1: [{ status: 'accepted' }] },
  });
  const grouped = shortlistEntriesFromGroups({
    ...args, billGroups: [{ member: bookedMember, perfs: [{ status: 'accepted' }] }],
  });
  assert.deepEqual(ids(grouped), ids(flat));
  assert.deepEqual(ids(grouped), ['b1', 's1', 'app1']);
});

test('O · empty input is an empty list, not a throw', () => {
  assert.deepEqual(shortlistEntries(), []);
  assert.deepEqual(shortlistEntriesFromGroups(), []);
  assert.deepEqual(shortlistEntries({ event: MANAGED, billMembers: [null], shortlistMembers: [null] }), []);
});

/* ── E · the identity helper itself ────────────────────────────────────────── */

test('P · sameArtist keeps findExistingMember\'s priority order', () => {
  assert.equal(sameArtist({ artist_profile_id: 'p1' }, { artist_profile_id: 'p1' }), true);
  assert.equal(sameArtist({ artist_id: 'a1' }, { artist_id: 'a1' }), true);
  // ⛔ An id on one side only is NOT a match, even when the names agree: the
  // name key exists for rows that have no id at all.
  assert.equal(sameArtist({ artist_id: 'a1', artist_name: 'Halo' }, { artist_name: 'Halo' }), false);
  assert.equal(sameArtist({ artist_profile_id: 'p1' }, { artist_profile_id: 'p2' }), false);
  assert.equal(sameArtist({ artist_name: '' }, { artist_name: '' }), false);
  assert.equal(sameArtist(null, { artist_id: 'a1' }), false);
});
