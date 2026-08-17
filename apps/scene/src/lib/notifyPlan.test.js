import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  notifyState, notifyPlan, artistsNeedingNotice, notifiedPatch, placementsOf, needsNotice,
  NOTHING_TO_SAY, NEEDS_SET_TIME, NOT_SENT, NOT_RECORDED, CLEAN, TIME_CHANGED, REMOVAL_TO_TELL,
  NOTIFY_LABELS,
} from './notifyPlan.js';

const LEGACY   = { id: 'e-l', booking_model: 'legacy' };
const IMPORTED = { id: 'e-i', booking_model: 'imported' };
const MANAGED  = { id: 'e-m', booking_model: 'managed' };

/* An artist with an account, on the bill. `notified_*` default to NULL, exactly
   as the migration left all 153 existing rows. */
const booked = (over = {}) => ({
  id: 'm-1', status: 'on_bill', artist_id: 'u-1', artist_profile_id: 'p-1',
  notified_at: null, notified_slot_uuid: null, ...over,
});
const perf = (slot, over = {}) => ({ id: 'perf-' + (slot || 'null'), status: 'draft', slot_uuid: slot, ...over });
const TOLD = '2026-08-17T11:00:00.000Z';

/* ── 1 · booked, no set time ───────────────────────────────────────────────── */

test('an unscheduled booked artist has NO set-time notification state', () => {
  const s = notifyState(booked(), [], LEGACY);
  assert.equal(s.state, NEEDS_SET_TIME);
  assert.equal(s.needsNotice, false, 'there is nothing to tell them yet');
});

/* ⚠ The event-level offer (P4) carries no slot, so it is not a set time. */
test('a null-slot performance is not a set time to communicate', () => {
  const s = notifyState(booked(), [perf(null, { status: 'accepted' })], LEGACY);
  assert.equal(s.state, NEEDS_SET_TIME);
  assert.deepEqual(s.placements, []);
});

/* ── 2 · booked + set time + never notified ────────────────────────────────── */

/**
 * ⛔⛔ ASSIGNING A TIME DOES NOT NOTIFY. The host drafts freely; the artist is
 * told by an explicit act. What assigning DOES do is make the outstanding work
 * findable, which is the whole point: before this, a draft set time made after
 * publishing was invisible and unreachable.
 */
test('assigning a time notifies nobody, and IS detectable as not notified', () => {
  const s = notifyState(booked(), [perf('slot-10pm')], LEGACY);
  assert.equal(s.state, NOT_SENT);
  assert.equal(s.needsNotice, true);
  assert.equal(s.notifiedAt, null, 'nothing may write notified_at but the send itself');
  assert.equal(s.label, 'SET TIME NOT SENT');
});

/* ── 3 · notified, unchanged ───────────────────────────────────────────────── */

test('an explicit notification records the communicated slot, and reads clean', () => {
  const patch = notifiedPatch('slot-10pm', TOLD);
  assert.deepEqual(patch, { notified_at: TOLD, notified_slot_uuid: 'slot-10pm' });
  const s = notifyState(booked(patch), [perf('slot-10pm')], LEGACY);
  assert.equal(s.state, CLEAN);
  assert.equal(s.needsNotice, false);
});

/**
 * ⚠⚠ THE ONE THE OLD DESIGN COULD NOT SURVIVE. `assignMemberToSlot` deletes and
 * re-inserts the performance, so the row's id and timestamps change while the
 * artist's actual placement does not. Comparing SLOTS is immune to that.
 */
test('delete and recreate of a performance does not erase the communicated state', () => {
  const m = booked(notifiedPatch('slot-10pm', TOLD));
  const before = notifyState(m, [perf('slot-10pm', { id: 'perf-old' })], LEGACY);
  const after  = notifyState(m, [{ id: 'perf-brand-new', status: 'draft', slot_uuid: 'slot-10pm' }], LEGACY);
  assert.equal(before.state, CLEAN);
  assert.equal(after.state, CLEAN, 'a new row id for the same slot is not a change to announce');
});

/* ── 4 · moved after notification ──────────────────────────────────────────── */

test('moving the artist after notification produces a needs-notification state', () => {
  const s = notifyState(booked(notifiedPatch('slot-10pm', TOLD)), [perf('slot-8pm')], LEGACY);
  assert.equal(s.state, TIME_CHANGED);
  assert.equal(s.needsNotice, true);
  assert.equal(s.label, 'SET TIME CHANGED');
});

/* ⚠ Drag, reorder and reassignment all end as "which slot do they hold now",
   so one comparison covers every one of them. */
test('a reorder that returns them to the SAME slot is not a change', () => {
  const m = booked(notifiedPatch('slot-9pm', TOLD));
  assert.equal(notifyState(m, [perf('slot-8pm')], LEGACY).state, TIME_CHANGED);
  assert.equal(notifyState(m, [perf('slot-9pm')], LEGACY).state, CLEAN);
});

/* ── 5 · set time removed after notification ───────────────────────────────── */

test('removing the slot after notification produces a removal to tell', () => {
  const s = notifyState(booked(notifiedPatch('slot-10pm', TOLD)), [], LEGACY);
  assert.equal(s.state, REMOVAL_TO_TELL);
  assert.equal(s.needsNotice, true);
  assert.equal(s.label, 'REMOVAL NOT SENT');
});

/**
 * ⚠ The slot row itself can be deleted, which sets `notified_slot_uuid` to NULL
 * by the FK. Having been TOLD is what matters, ⛔ not whether what we said still
 * exists.
 */
test('a deleted slot still leaves a removal to tell', () => {
  const s = notifyState(booked({ notified_at: TOLD, notified_slot_uuid: null }), [], LEGACY);
  assert.equal(s.state, REMOVAL_TO_TELL);
});

/* ── 6 · one artist at a time ──────────────────────────────────────────────── */

/**
 * ⛔⛔ THE DEFECT THIS PHASE EXISTS FOR. The only sender was event-wide: reaching
 * one newly scheduled artist meant unlocking, which reverted every `offered` row
 * to draft, then republishing, which re-notified people already told.
 */
test('a newly added artist can be notified without touching anybody else', () => {
  const told   = { ...booked({ id: 'm-elbow', ...notifiedPatch('slot-7pm', TOLD) }) };
  const fresh  = booked({ id: 'm-new' });
  const plan = notifyPlan({
    members: [told, fresh],
    perfsByMember: { 'm-elbow': [perf('slot-7pm')], 'm-new': [perf('slot-10pm')] },
    event: LEGACY,
  });
  assert.deepEqual(plan.map(r => r.state), [CLEAN, NOT_SENT]);
  assert.deepEqual(artistsNeedingNotice(plan).map(r => r.member.id), ['m-new']);

  /* Sending to the new artist patches THEIR row only. The told artist's state is
     computed from their own row and cannot be disturbed by it. */
  const patched = { ...fresh, ...notifiedPatch('slot-10pm', '2026-08-17T12:00:00.000Z') };
  const after = notifyPlan({
    members: [told, patched],
    perfsByMember: { 'm-elbow': [perf('slot-7pm')], 'm-new': [perf('slot-10pm')] },
    event: LEGACY,
  });
  assert.deepEqual(after.map(r => r.state), [CLEAN, CLEAN]);
  assert.equal(after[0].notifiedAt, TOLD, 'the first artist was not re-notified');
  assert.deepEqual(artistsNeedingNotice(after), []);
});

/* ── 7 · the booking contracts stay intact ─────────────────────────────────── */

/**
 * ⛔ NOT BOOKED MEANS NOTHING TO SAY. A shortlisted artist can no longer acquire
 * a slot at all, but a row predating that gate must ⛔ never invite the host to
 * announce a booking that does not exist. (BVP was exactly this shape.)
 */
test('a shortlisted member with a slot has nothing to say, on every contract', () => {
  for (const event of [LEGACY, IMPORTED, MANAGED]) {
    const s = notifyState(booked({ status: 'shortlisted' }), [perf('slot-10pm')], event);
    assert.equal(s.state, NOTHING_TO_SAY, `invited a notice on ${event.booking_model}`);
    assert.equal(s.needsNotice, false);
    assert.equal(s.label, null);
  }
});

test('legacy and imported behaviour is unchanged: on_bill is booked', () => {
  for (const event of [LEGACY, IMPORTED]) {
    assert.equal(notifyState(booked(), [perf('slot-1')], event).state, NOT_SENT);
    assert.equal(notifyState(booked(), [], event).state, NEEDS_SET_TIME);
  }
  /* ⚠ An absent booking_model is the common case (153 rows) and must behave as
     legacy does. */
  assert.equal(notifyState(booked(), [perf('slot-1')], { id: 'e0' }).state, NOT_SENT);
});

/**
 * ⛔⛔ MANAGED CONFIRMATION IS NOT BYPASSED. `on_bill` is not a booking there, so
 * an unaccepted artist has no set time to announce however many rows exist.
 */
test('managed confirmation rules remain intact', () => {
  const m = booked();
  assert.equal(notifyState(m, [perf('slot-1', { status: 'offered' })], MANAGED).state, NOTHING_TO_SAY);
  /* ⚠ `accepted` with no recorded send is NOT_RECORDED, ⛔ not NOT_SENT: their
     acceptance proves they saw SOME offer. What matters here is that the managed
     contract lets them reach a set-time state at all. */
  assert.equal(notifyState(m, [perf('slot-1', { status: 'accepted' })], MANAGED).state, NOT_RECORDED);
  /* ⚠ And the hand-typed exception `canPlaceMember` allows: nobody can accept
     for them, so on_bill is the whole of their booking. */
  const typed = booked({ artist_id: null, artist_profile_id: null });
  assert.equal(notifyState(typed, [perf('slot-1', { status: 'offered' })], MANAGED).state, NOTHING_TO_SAY,
    'hand-typed booking is decided by hostLineup.isBooked, not by this module');
});

/* ── 8 · the multi-slot limitation is explicit ─────────────────────────────── */

/**
 * ⚠⚠ ONE COLUMN CANNOT DESCRIBE TWO PLACEMENTS. A festival act playing twice is
 * normal, so this is pinned as a DELIBERATE conservative reading: it asks for a
 * notice that may be unnecessary, and ⛔ never reports settled when an artist has
 * not heard about one of their sets.
 */
test('⚠ a member holding two slots reads as CHANGED, never as clean', () => {
  const s = notifyState(booked(notifiedPatch('slot-7pm', TOLD)), [perf('slot-7pm'), perf('slot-9pm')], LEGACY);
  assert.equal(s.state, TIME_CHANGED);
  assert.deepEqual(s.placements.sort(), ['slot-7pm', 'slot-9pm']);
});

test('duplicate performances on one slot are one placement', () => {
  const s = notifyState(booked(notifiedPatch('slot-7pm', TOLD)),
    [perf('slot-7pm', { id: 'a' }), perf('slot-7pm', { id: 'b' })], LEGACY);
  assert.equal(s.state, CLEAN);
  assert.deepEqual(placementsOf([perf('s1'), perf('s1'), perf(null)]), ['s1']);
});

/* ── 9 · shape and copy ────────────────────────────────────────────────────── */

test('needsNotice is true for exactly the three outstanding states', () => {
  assert.deepEqual(
    [NOTHING_TO_SAY, NEEDS_SET_TIME, NOT_SENT, NOT_RECORDED, CLEAN, TIME_CHANGED, REMOVAL_TO_TELL].filter(needsNotice),
    [NOT_SENT, TIME_CHANGED, REMOVAL_TO_TELL],
  );
});

test('the labels carry no em dashes', () => {
  Object.values(NOTIFY_LABELS).filter(Boolean).forEach(l => assert.equal(l.includes('—'), false));
});

test('empty and missing input is answered, not thrown on', () => {
  assert.equal(notifyState(null, [], LEGACY).state, NOTHING_TO_SAY);
  assert.deepEqual(notifyPlan(), []);
  assert.deepEqual(artistsNeedingNotice(), []);
  assert.deepEqual(placementsOf(), []);
});

/* ⛔ The patch never invents a truthy flag, and a removal notice records that
   there is no slot rather than pretending there is one. */
test('notifiedPatch records the slot, or its absence', () => {
  assert.deepEqual(notifiedPatch(null, TOLD), { notified_at: TOLD, notified_slot_uuid: null });
  const now = notifiedPatch('s1');
  assert.equal(now.notified_slot_uuid, 's1');
  assert.ok(!Number.isNaN(Date.parse(now.notified_at)));
});

/* ── ⛔⛔ NOBODY TO TELL IS NOT THE SAME AS NOT TOLD ────────────────────────── */

/**
 * ⚠⚠ THIS WAS FOUND IN THE RUNNING UI, ⛔ not here: `fewrf` on Bass Heavy is a
 * hand-typed act with no account, holding an `accepted` performance on the 11PM
 * slot, and the chip read SET TIME NOT SENT. There is no recipient, so that is
 * work the host can never discharge.
 */
test('⛔⛔ a hand-typed act with no account has NOTHING to say, however it is scheduled', () => {
  const typed = booked({ artist_id: null, artist_profile_id: null });
  for (const p of [[perf('slot-11pm', { status: 'accepted' })], [perf('slot-11pm')], []]) {
    const s = notifyState(typed, p, LEGACY);
    assert.equal(s.state, NOTHING_TO_SAY);
    assert.equal(s.needsNotice, false);
  }
});

/* ⚠ An `artist_profile_id` alone is NOT reachable — the same rule
   `lineupActions.isReachable` encodes, and the reason `profiles.user_id` is not
   an identity. */
test('⚠ a profile without an account is still nobody to tell', () => {
  const s = notifyState(booked({ artist_id: null, artist_profile_id: 'p-1' }), [perf('s1')], LEGACY);
  assert.equal(s.state, NOTHING_TO_SAY);
});

test('⭐ an artist WITH an account is unaffected by the reachability rule', () => {
  assert.equal(notifyState(booked(), [perf('s1')], LEGACY).state, NOT_SENT);
});

/* ── ⭐⭐ NULL IS "NOT RECORDED", ⛔ NOT "NEVER TOLD" (owner, 2026-08-17) ────── */

/**
 * ⭐ THE NEGATIVE IS THE ONLY PROVABLE HALF. The old publish path announced by
 * flipping `draft → offered` in the same act, so a placement still at `draft` was
 * never announced by anybody.
 */
test('⭐ a DRAFT placement with no record is NOT_SENT, and that IS work', () => {
  const s = notifyState(booked(), [perf('s1', { status: 'draft' })], LEGACY);
  assert.equal(s.state, NOT_SENT);
  assert.equal(s.needsNotice, true);
  assert.equal(s.label, 'SET TIME NOT SENT');
});

/**
 * ⛔⛔ AN `offered` ROW IS NOT PROOF OF A SEND. §8 item 17: 28 such rows were
 * written by ONE backfill script. Claiming NOT SENT would be a lie in one
 * direction and claiming CLEAN a lie in the other.
 */
test('⛔⛔ an OFFERED placement with no record is NOT_RECORDED, and is NOT work', () => {
  const s = notifyState(booked(), [perf('s1', { status: 'offered' })], LEGACY);
  assert.equal(s.state, NOT_RECORDED);
  assert.equal(s.needsNotice, false, 'we do not know must never read as you must act');
  assert.equal(s.label, 'SEND NOT RECORDED');
});

/**
 * ⚠⚠ `accepted_at` PROVES THEY ACCEPTED AN OFFER, ⛔ NOT THAT THEY WERE TOLD
 * ABOUT THE PLACEMENT THEY HOLD NOW (owner). A host can move somebody after
 * their acceptance, and the acceptance says nothing about the move.
 */
test('⚠⚠ an ACCEPTED placement, even with accepted_at, is NOT_RECORDED', () => {
  const withAccept = perf('s1', { status: 'accepted', accepted_at: '2026-07-09T14:00:00.000Z' });
  assert.equal(notifyState(booked(), [withAccept], LEGACY).state, NOT_RECORDED);
  assert.equal(notifyState(booked(), [perf('s1', { status: 'accepted' })], LEGACY).state, NOT_RECORDED);
});

/* ⚠ ANY draft placement is enough to surface real work: one provably unsent set
   time must not be hidden behind an unrelated unknown on another slot. */
test('⚠ a draft placement beside an offered one still reads NOT_SENT', () => {
  const s = notifyState(booked(), [perf('s1', { status: 'offered' }), perf('s2', { status: 'draft' })], LEGACY);
  assert.equal(s.state, NOT_SENT);
  assert.equal(s.needsNotice, true);
});

/**
 * ⛔⛔ THE BANG APPEARS ONLY FOR KNOWLEDGE. A legacy event whose schedule was
 * published under the old model must not light up: that is what trained hosts to
 * ignore the marker.
 */
test('⛔⛔ artistsNeedingNotice excludes NOT_RECORDED entirely', () => {
  const plan = notifyPlan({
    members: [booked({ id: 'm-old' }), booked({ id: 'm-new' }), booked({ id: 'm-moved', ...notifiedPatch('s9', TOLD) })],
    perfsByMember: {
      'm-old':   [perf('s1', { status: 'offered' })],
      'm-new':   [perf('s2', { status: 'draft' })],
      'm-moved': [perf('s8', { status: 'offered' })],
    },
    event: LEGACY,
  });
  assert.deepEqual(plan.map(r => r.state), [NOT_RECORDED, NOT_SENT, TIME_CHANGED]);
  assert.deepEqual(artistsNeedingNotice(plan).map(r => r.member.id), ['m-new', 'm-moved']);
});

/* ⭐ Once this system records a send, the row leaves the unknown for good. */
test('⭐ a recorded send resolves NOT_RECORDED permanently', () => {
  const before = notifyState(booked(), [perf('s1', { status: 'offered' })], LEGACY);
  const after  = notifyState(booked(notifiedPatch('s1', TOLD)), [perf('s1', { status: 'offered' })], LEGACY);
  assert.equal(before.state, NOT_RECORDED);
  assert.equal(after.state, CLEAN);
});

/* ⛔ The removed export must not come back: NULL cannot carry that claim. */
test('⛔ NOT_NOTIFIED is gone from the module surface', async () => {
  const mod = await import('./notifyPlan.js');
  assert.equal('NOT_NOTIFIED' in mod, false);
  assert.equal(Object.values(mod.NOTIFY_LABELS).includes('NOT NOTIFIED'), false);
});
