import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHostLineup, memberState, totalOnBill, billCapacity, billFullMessage, isBooked, bookedMembers, bookedUnscheduled, isScheduled, bookedMemberRows } from './hostLineup.js';

/**
 * BASS HEAVY IS THE REGRESSION CASE (owner, 2026-08-15).
 *
 * "It is an event, and it must appear in the Host LINEUP event selector because
 * it is the host's event / contains lineup data, regardless of whether it has
 * accepted applications."
 *
 * The shipped section grouped `applications where status='accepted'` by event,
 * so an event with none simply did not exist to the UI. Bass Heavy has four
 * members on its bill and zero accepted applications.
 */

const bassHeavy = { id: 'ev-bass', name: 'Bass Heavy', status: 'draft', config: {} };
const solstice  = { id: 'ev-sol',  name: 'Solstice Soirée', status: 'live', config: {} };
const emptyNight = { id: 'ev-new', name: 'Brand New Night', status: 'draft', config: {} };

const bassMembers = () => ([
  { id: 'm1', event_id: 'ev-bass', artist_name: 'Daddy Longlegs', artist_id: 'u-1', artist_profile_id: 'p-1' },
  { id: 'm2', event_id: 'ev-bass', artist_name: 'Gus Heavy',      artist_id: 'u-2', artist_profile_id: 'p-2' },
  { id: 'm3', event_id: 'ev-bass', artist_name: 'Tumble',         artist_id: null,  artist_profile_id: null },
  { id: 'm4', event_id: 'ev-bass', artist_name: 'Wyldcard',       artist_id: 'u-4', artist_profile_id: 'p-4' },
]);

test('⚠⚠ an event with a bill and ZERO accepted applications still appears', () => {
  const groups = buildHostLineup({
    events: [bassHeavy],
    members: bassMembers(),
    performances: [],
  });

  assert.equal(groups.length, 1, 'the regression: this was 0');
  assert.equal(groups[0].event.name, 'Bass Heavy');
  assert.equal(groups[0].members.length, 4);
});

/**
 * ⭐ THE RATIFIED INVARIANT, asserted as a guarantee rather than an
 * implementation detail: applications cannot decide which events appear.
 */
test('⛔ EVERY owned event comes back, whatever the bill looks like', () => {
  /**
   * ⚠ THE INVARIANT, stated so it cannot be satisfied by accident: the events
   * OUT are exactly the events IN. Any filtering — by accepted applications, by
   * having members, by status — shows up here as a missing id.
   *
   * ⭐ Asserted as a guarantee, not as arity. The first draft of this test
   * checked `buildHostLineup.length === 1` to "prove" there was no applications
   * parameter; that pinned the implementation, passed for the wrong reason, and
   * broke on a default value.
   */
  const events = [bassHeavy, solstice, emptyNight];
  const cases = {
    'no members at all':        { events, members: [] },
    'members on one event':     { events, members: bassMembers() },
    'members and performances': { events, members: bassMembers(), performances: [{ lineup_member_id: 'm1', slot_uuid: 's1', status: 'accepted' }] },
  };
  for (const [label, input] of Object.entries(cases)) {
    assert.deepEqual(
      buildHostLineup(input).map(g => g.event.id),
      ['ev-bass', 'ev-sol', 'ev-new'],
      `${label}: an owned event must never drop out of the selector`,
    );
  }
});

test('an owned event with an EMPTY bill still appears, with an honest zero', () => {
  const groups = buildHostLineup({ events: [emptyNight], members: [], performances: [] });
  assert.equal(groups.length, 1, 'the workspace for building a bill is most needed when there is none');
  assert.equal(groups[0].onBill, 0);
  assert.equal(groups[0].members.length, 0);
});

test('groups keep the order the events were given in', () => {
  const groups = buildHostLineup({ events: [solstice, bassHeavy, emptyNight], members: bassMembers() });
  assert.deepEqual(groups.map(g => g.event.id), ['ev-sol', 'ev-bass', 'ev-new']);
});

/**
 * ⚠ 123 OF 152 MEMBERS HAVE NO PERFORMANCE. "On the bill, no set time" is the
 * dominant state, not an edge case — it is what separating Lineup from Set
 * Times is FOR.
 */
test('a member with no performance is ON BILL, and counted as unscheduled', () => {
  const groups = buildHostLineup({ events: [bassHeavy], members: bassMembers(), performances: [] });
  assert.equal(groups[0].unscheduled, 4);
  groups[0].members.forEach(m => assert.equal(m.state, 'ON BILL'));
});

test('member states read from the performance, best first', () => {
  const m = { id: 'm1', artist_id: 'u-1' };
  assert.equal(memberState(m, []), 'ON BILL');
  assert.equal(memberState(m, [{ status: 'draft' }]), 'DRAFT');
  assert.equal(memberState(m, [{ status: 'offered' }]), 'AWAITING');
  assert.equal(memberState(m, [{ status: 'accepted' }]), 'CONFIRMED');
  assert.equal(memberState(m, [{ status: 'declined' }]), 'DECLINED');
  // An acceptance anywhere outranks a decline elsewhere.
  assert.equal(memberState(m, [{ status: 'declined' }, { status: 'accepted' }]), 'CONFIRMED');
});

test('a hand-entered act is confirmed by being given a slot', () => {
  const typed = { id: 'm3', artist_id: null };
  assert.equal(memberState(typed, [{ status: 'offered' }]), 'CONFIRMED',
    'there is nobody to send an offer to, so awaiting a reply is a lie');
});

/**
 * ⚠ A SLOT IS FILLED WHEN SOMEBODY AGREED TO PLAY IT — the same rule slotTally
 * already enforces. Counting "not declined" told an organiser with two
 * unanswered offers that their night was booked.
 */
test('filled counts acceptances, not offers', () => {
  const slotsByEvent = { 'ev-bass': [{ name: '', slots: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }] };
  const performances = [
    { lineup_member_id: 'm1', slot_uuid: 's1', status: 'accepted' },
    { lineup_member_id: 'm2', slot_uuid: 's2', status: 'offered'  },
    { lineup_member_id: 'm4', slot_uuid: 's3', status: 'draft'    },
  ];
  const g = buildHostLineup({ events: [bassHeavy], members: bassMembers(), performances, slotsByEvent })[0];
  assert.equal(g.totalSlots, 3);
  assert.equal(g.filledSlots, 1, 'two of those three are questions, not answers');
  assert.equal(g.unscheduled, 1, 'm3 holds no slot at all');
});

/**
 * ⚠⚠ THE DASHBOARD AND THE EVENT PAGE MUST AGREE.
 *
 * `slotTally` (event page) counts a claim whose status is 'confirmed', and
 * `toClaim` has already promoted a hand-entered act to confirmed before it gets
 * there. A raw `status === 'accepted'` test here would report the same night as
 * less full on one screen than the other.
 */
test('a hand-entered act’s slot counts as filled, same as the event page', () => {
  const slotsByEvent = { 'ev-bass': [{ name: '', slots: [{ id: 's1' }, { id: 's2' }] }] };
  const performances = [
    // m3 has artist_id null — nobody to accept, so `offered` is as good as it gets.
    { lineup_member_id: 'm3', slot_uuid: 's1', status: 'offered' },
    // m2 has an account and has not replied. Genuinely not filled.
    { lineup_member_id: 'm2', slot_uuid: 's2', status: 'offered' },
  ];
  const g = buildHostLineup({ events: [bassHeavy], members: bassMembers(), performances, slotsByEvent })[0];
  assert.equal(g.filledSlots, 1, 'the typed-in act is booked; the unanswered offer is not');
});

test('one act can hold two slots without being counted twice on the bill', () => {
  const performances = [
    { lineup_member_id: 'm1', slot_uuid: 's1', status: 'accepted' },
    { lineup_member_id: 'm1', slot_uuid: 's2', status: 'accepted' },
  ];
  const g = buildHostLineup({ events: [bassHeavy], members: bassMembers(), performances })[0];
  assert.equal(g.onBill, 4);
  assert.equal(g.members.find(m => m.id === 'm1').slotCount, 2);
});

test('the header count is the bill, across every event', () => {
  const groups = buildHostLineup({ events: [bassHeavy, emptyNight], members: bassMembers() });
  assert.equal(totalOnBill(groups), 4, 'was count(applications accepted), which was 3 in the whole database');
  assert.equal(totalOnBill([]), 0);
});

/* ── ⛔ THE BILL CANNOT OUTGROW THE RUNNING ORDER ──────────────────────────── */

test('⛔ a full bill refuses the next act', () => {
  assert.equal(billCapacity(5, 5).full, true);
  assert.equal(billCapacity(4, 5).full, false);
  assert.equal(billCapacity(4, 5).remaining, 1);
});

/**
 * ⛔⛔ NO SLOTS IS NOT A CAP OF ZERO. An event with "set times needed" switched
 * off has no `event_slots` rows on purpose, and reading that as "room for
 * nobody" would make the bill unusable on exactly the events that need the
 * least ceremony.
 */
test('⛔⛔ an event with no running order is NOT capped at zero', () => {
  const cap = billCapacity(9, 0);
  assert.equal(cap.capped, false);
  assert.equal(cap.full, false);
  assert.equal(billCapacity(9, null).full, false);
  assert.equal(billCapacity(9, undefined).full, false);
});

/**
 * ⚠ THE EXISTING 7/5 EVENTS STILL LOAD. The rule stops a new add; it cannot
 * retroactively unbook anybody, and `remaining` must not go negative and read
 * as "-2 places left" somewhere downstream.
 */
test('⚠ an already-over bill is full, and never reports negative room', () => {
  const cap = billCapacity(7, 5);
  assert.equal(cap.full, true);
  assert.equal(cap.remaining, 0);
});

test('the refusal names the number and says what to do about it', () => {
  const msg = billFullMessage(5);
  assert.match(msg, /5 set times/);
  assert.match(msg, /shortlist/i, 'a refusal with no way out is a dead end');
  assert.doesNotMatch(msg, /—/, 'no em dashes in user-facing copy');
  assert.match(billFullMessage(1), /1 set time\b/, 'singular, not "1 set times"');
});

/* ── ⭐⭐ P3 · IS THIS ARTIST ACTUALLY BOOKED? ─────────────────────────────── */

const LEGACY_EV   = { booking_model: 'legacy' };
const IMPORTED_EV = { booking_model: 'imported' };
const MANAGED_EV  = { booking_model: 'managed' };

const onBill = { id: 'm1', status: 'on_bill', artist_id: 'u1' };

/**
 * ⛔⛔ THE 90 EXISTING EVENTS MUST NOT MOVE. Their acts were booked before
 * mutual confirmation existed and are never asked to reconfirm.
 */
test('⛔⛔ a legacy or imported bill is authoritative with NO performance at all', () => {
  for (const ev of [LEGACY_EV, IMPORTED_EV, null, undefined, {}]) {
    assert.equal(isBooked(onBill, [], ev), true,
      'on_bill alone is the answer for a grandfathered event');
  }
});

test('⭐ a managed event needs the ARTIST to have accepted', () => {
  assert.equal(isBooked(onBill, [], MANAGED_EV), false, 'the host wanting them is not a booking');
  assert.equal(isBooked(onBill, [{ status: 'offered' }], MANAGED_EV), false, 'asked is not agreed');
  assert.equal(isBooked(onBill, [{ status: 'draft' }],   MANAGED_EV), false);
  assert.equal(isBooked(onBill, [{ status: 'declined' }], MANAGED_EV), false);
  assert.equal(isBooked(onBill, [{ status: 'accepted' }], MANAGED_EV), true);
});

/**
 * ⛔⛔ THE DISPLAY FICTION MUST NOT REACH THIS. `memberState` returns
 * 'CONFIRMED' for a hand-entered act with no account — right for pixels, ⛔
 * catastrophic here: it would book somebody who never agreed.
 */
test('⛔⛔ a hand-entered act is NOT booked on a managed event', () => {
  const typed = { id: 'm2', status: 'on_bill', artist_id: null };
  assert.equal(memberState(typed, [{ status: 'offered' }]), 'CONFIRMED', 'the display fiction');
  assert.equal(isBooked(typed, [{ status: 'offered' }], MANAGED_EV), false,
    'but the raw row says offered, and offered is not booked');
});

/* ⚠ `confirmed` belongs to the APPLICATIONS vocabulary. Mixing the two once
   left PIPELINE and SHORT LIST empty on every event. */
test("⚠ 'confirmed' is not a performance status and does not book anybody", () => {
  assert.equal(isBooked(onBill, [{ status: 'confirmed' }], MANAGED_EV), false);
});

test('bookedMembers derives the bill from what the screens already load', () => {
  const groups = [
    { member: onBill, perfs: [{ status: 'accepted' }] },
    { member: { id: 'm3', status: 'on_bill' }, perfs: [{ status: 'offered' }] },
  ];
  assert.equal(bookedMembers(groups, MANAGED_EV).length, 1);
  assert.equal(bookedMembers(groups, LEGACY_EV).length, 2, 'legacy keeps both');
  assert.deepEqual(bookedMembers([], MANAGED_EV), []);
  assert.deepEqual(bookedMembers(null, MANAGED_EV), []);
});

/**
 * ⚠⚠ THIS IS WHY THE LINEUP TAB CAN DISAPPEAR. A booked artist with no set
 * time appears nowhere in a slot grid; they stay at the top of SHORTLIST.
 */
test('⚠⚠ booked with no set time is a real, findable state', () => {
  const groups = [
    { member: onBill, perfs: [{ status: 'accepted', slot_uuid: null }] },
    { member: { id: 'm4', status: 'on_bill' }, perfs: [{ status: 'accepted', slot_uuid: 's-1' }] },
  ];
  assert.equal(bookedUnscheduled(groups, MANAGED_EV).length, 1);
  assert.equal(bookedUnscheduled(groups, MANAGED_EV)[0].member.id, 'm1');
});

/* ⛔ A null-slot performance is the EVENT-LEVEL OFFER, ⛔ not a placement. */
test('⛔ a null slot_uuid is not a schedule', () => {
  assert.equal(isScheduled([{ slot_uuid: null }]), false);
  assert.equal(isScheduled([]), false);
  assert.equal(isScheduled([{ slot_uuid: 's-1' }]), true);
});

/* ── P5.1 · the flat-shape adapter ────────────────────────────────────────── */

/**
 * ⛔⛔ THE PROOF THAT PRODUCTION DOES NOT MOVE. All 90 events are `legacy`, and
 * the flat list the event page holds is ALREADY filtered to `on_bill` — so the
 * derivation must return that same list, unchanged and in order.
 */
test('⛔⛔ on a legacy event the derived LINEUP is the existing LINEUP', () => {
  const members = [
    { id: 'm1', status: 'on_bill' },
    { id: 'm2', status: 'on_bill' },
    { id: 'm3', status: 'on_bill' },
  ];
  const out = bookedMemberRows(members, {}, LEGACY_EV);
  assert.deepEqual(out, members, 'identical rows, identical order, nothing dropped');
  assert.deepEqual(bookedMemberRows(members, {}, IMPORTED_EV), members);
  assert.deepEqual(bookedMemberRows(members, {}, null), members, 'and for an unknown contract');
});

test('⭐ on a managed event only the artist’s acceptance counts', () => {
  const members = [{ id: 'm1', status: 'on_bill' }, { id: 'm2', status: 'on_bill' }];
  const perfsByMember = { m1: [{ status: 'accepted' }], m2: [{ status: 'offered' }] };
  const out = bookedMemberRows(members, perfsByMember, MANAGED_EV);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'm1');
});

/* ⚠ The two shapes must agree — that is the whole point of the adapter. */
test('⚠ the flat adapter and the group form give the same answer', () => {
  const members = [{ id: 'm1', status: 'on_bill' }, { id: 'm2', status: 'on_bill' }];
  const perfsByMember = { m1: [{ status: 'accepted' }], m2: [] };
  const groups = members.map(m => ({ member: m, perfs: perfsByMember[m.id] || [] }));
  for (const ev of [LEGACY_EV, MANAGED_EV, IMPORTED_EV]) {
    assert.deepEqual(
      bookedMemberRows(members, perfsByMember, ev).map(m => m.id),
      bookedMembers(groups, ev).map(g => g.member.id),
      'one rule, two shapes',
    );
  }
});

test('the adapter tolerates missing inputs', () => {
  assert.deepEqual(bookedMemberRows(null, null, MANAGED_EV), []);
  assert.deepEqual(bookedMemberRows([], {}, LEGACY_EV), []);
});
