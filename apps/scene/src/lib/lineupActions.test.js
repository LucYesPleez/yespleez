import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planUnassign, planRemoveFromBill, planMoveToShortlist, planRemoveFromEvent, applyLineupPlan, restoreToBill,
  notifiablePerformances, wasEverSent, isReachable, executeLineupPlan, messageFor, assignMemberToSlot,
  planEventOffer, createEventOffer, removalNeedsNotice,
  planPublishSetTimes, applyPublishSetTimes,
} from './lineupActions.js';

/**
 * THE TWO BUTTONS THAT DID THE SAME DESTRUCTIVE THING.
 *
 * UNASSIGN and DISCARD both ran `delete performances` then `delete
 * lineup_members`. "Unassign" reads as taking back a set time; it erased the
 * artist from the bill. These tests pin the distinction.
 */

const madds  = { id: 'm-madds', artist_name: 'Madds', artist_id: 'u-1', artist_profile_id: 'p-1' };
const typed  = { id: 'm-typed', artist_name: 'fewrf', artist_id: null,  artist_profile_id: null };

const perfs = () => ([
  { id: 'p-1', lineup_member_id: 'm-madds', slot_uuid: 's-1', status: 'offered' },
  { id: 'p-2', lineup_member_id: 'm-madds', slot_uuid: 's-2', status: 'draft'   },
]);

test('⚠⚠ UNASSIGN takes the set times and LEAVES THEM ON THE BILL', () => {
  const plan = planUnassign(madds, perfs());
  assert.deepEqual(plan.deletePerformanceIds, ['p-1', 'p-2']);
  assert.equal(plan.writeMemberStatus, null,
    'the regression: this deleted the lineup_members row, erasing them from the event');
});

test('REMOVE FROM BILL takes them off, softly', () => {
  const plan = planRemoveFromBill(madds, perfs());
  assert.deepEqual(plan.deletePerformanceIds, ['p-1', 'p-2'], 'a booking for a slot you are not on is not a thing');
  assert.equal(plan.writeMemberStatus?.id, 'm-madds');
});

test('the two actions are actually different', () => {
  const a = planUnassign(madds, perfs());
  const b = planRemoveFromBill(madds, perfs());
  assert.notDeepEqual(a, b, 'they were byte-identical operations with different labels');
  assert.notEqual(a.kind, b.kind);
});

/**
 * ⭐ THE MIRROR OF THE RATIFIED RULE. Adding is private and notifies nobody;
 * offering a slot notifies. So removal may only announce what was announced.
 */
test('only a slot that was actually SENT produces a notification', () => {
  assert.equal(wasEverSent({ status: 'offered' }), true);
  assert.equal(wasEverSent({ status: 'accepted' }), true);
  assert.equal(wasEverSent({ status: 'draft' }), false,
    'a draft was never sent; announcing its removal announces the booking too');
  assert.equal(wasEverSent({ status: 'declined' }), false,
    'they already said no');

  assert.deepEqual(notifiablePerformances(perfs()).map(p => p.id), ['p-1']);
  assert.equal(planUnassign(madds, perfs()).notifyCount, 1, 'one offered, one draft');
});

test('⛔ a hand-entered act is never notified, because there is nobody to tell', () => {
  assert.equal(isReachable(typed), false);
  assert.equal(isReachable(madds), true);
  const plan = planRemoveFromBill(typed, [{ id: 'p-9', status: 'offered' }]);
  assert.equal(plan.notifyCount, 0);
  assert.equal(plan.writeMemberStatus?.id, 'm-typed', 'still removed, just silently');
});

test('a member with no set times is still removable from the bill', () => {
  const plan = planRemoveFromBill(madds, []);
  assert.deepEqual(plan.deletePerformanceIds, []);
  assert.equal(plan.writeMemberStatus?.id, 'm-madds');
  assert.equal(plan.notifyCount, 0);
  // ⚠ 123 of 152 members are in exactly this state.
  assert.equal(planUnassign(madds, []).deletePerformanceIds.length, 0);
});

/* ── execution, against a fake that models the calls ─────────────────────── */

function fakeDb(failOn = null) {
  const calls = [];
  const table = name => ({
    delete: () => ({ in: (col, ids) => { calls.push({ op: 'delete', name, col, ids }); return { error: failOn === name ? { message: 'RLS said no' } : null }; } }),
    update: fields => ({ eq: (col, val) => { calls.push({ op: 'update', name, col, val, fields }); return { error: failOn === name ? { message: 'RLS said no' } : null }; } }),
  });
  return { from: table, calls };
}

test('applying an unassign deletes performances and touches no member row', async () => {
  const db = fakeDb();
  const res = await applyLineupPlan(db, planUnassign(madds, perfs()));
  assert.equal(res.ok, true);
  assert.deepEqual(db.calls.map(c => `${c.op}:${c.name}`), ['delete:performances']);
});

test('⭐ removal WRITES status=removed — the value six readers filter on and nothing set', async () => {
  const db = fakeDb();
  const res = await applyLineupPlan(db, planRemoveFromBill(madds, perfs()));
  assert.equal(res.ok, true);
  const update = db.calls.find(c => c.op === 'update');
  assert.equal(update.name, 'lineup_members');
  assert.equal(update.fields.status, 'removed');
  assert.equal(update.val, 'm-madds');
  // ⛔ And never a hard delete of the member.
  assert.equal(db.calls.some(c => c.op === 'delete' && c.name === 'lineup_members'), false);
});

/**
 * ⚠⚠ RLS FILTERS A WRITE, IT DOES NOT ERROR IT — but when the client DOES get
 * an error back, swallowing it reproduces the same silence by hand.
 */
test('a refused write is reported, not swallowed', async () => {
  const res = await applyLineupPlan(fakeDb('performances'), planUnassign(madds, perfs()));
  assert.equal(res.ok, false);
  assert.match(res.error, /RLS said no/);
});

test('a refused member update does not report success either', async () => {
  const res = await applyLineupPlan(fakeDb('lineup_members'), planRemoveFromBill(madds, []));
  assert.equal(res.ok, false);
});

test('restoring puts them back on the bill and grants no set times', async () => {
  const db = fakeDb();
  const res = await restoreToBill(db, 'm-madds');
  assert.equal(res.ok, true);
  assert.deepEqual(db.calls.map(c => `${c.op}:${c.name}`), ['update:lineup_members']);
  assert.equal(db.calls[0].fields.status, 'on_bill');
  // ⛔ Nothing recreates performances: that would offer slots nobody chose.
  assert.equal(db.calls.some(c => c.name === 'performances'), false);
});

/**
 * ⛔ THE BOUNDARY. Neither action may reach across and rewrite an application.
 * The old buttons wrote 'tentative' from one and 'declined' from the other, so
 * which of two adjacent controls you pressed decided whether a person had been
 * shortlisted or rejected.
 */
test('⛔ no lineup action touches applications', async () => {
  const db = fakeDb();
  await applyLineupPlan(db, planUnassign(madds, perfs()));
  await applyLineupPlan(db, planRemoveFromBill(madds, perfs()));
  await restoreToBill(db, 'm-madds');
  assert.equal(db.calls.some(c => c.name === 'applications'), false,
    'declining an applicant is its own act, on the surface that is about applications');
});

/**
 * ⛔⛔ THE THIRD DESTRUCTIVE OPERATION. Same deletion, different destination —
 * which is exactly the shape of the original defect, so it is pinned the same
 * way the first two are.
 */
test('MOVE TO SHORTLIST returns them to consideration, ⛔ not removed', () => {
  const plan = planMoveToShortlist(madds, perfs());
  assert.deepEqual(plan.deletePerformanceIds, ['p-1', 'p-2'], 'a set time for someone off the bill is not a thing');
  assert.equal(plan.writeMemberStatus?.id, 'm-madds');
  assert.equal(plan.writeMemberStatus?.status, 'shortlisted',
    '⛔ writing removed here would drop them off the event instead of back into the pool');
});

test('⛔ shortlist and remove are NOT the same plan', () => {
  const a = planMoveToShortlist(madds, perfs());
  const b = planRemoveFromEvent(madds, perfs());
  assert.deepEqual(a.deletePerformanceIds, b.deletePerformanceIds, 'both destroy the performances');
  assert.notEqual(a.writeMemberStatus.status, b.writeMemberStatus.status,
    'and the ONLY difference is the status they write — which is why it comes from the plan');
  assert.equal(a.writeMemberStatus.status, 'shortlisted');
  assert.equal(b.writeMemberStatus.status, 'removed');
});

test('applyLineupPlan writes the status the PLAN carries, ⛔ never a hardcoded one', async () => {
  const calls = [];
  const db = { from: (name) => ({
    delete: () => ({ in: async () => { calls.push({ op: 'delete', name }); return { error: null }; } }),
    update: (patch) => ({ eq: async () => { calls.push({ op: 'update', name, patch }); return { error: null }; } }),
  }) };
  await applyLineupPlan(db, planMoveToShortlist(madds, perfs()));
  const upd = calls.find(c => c.op === 'update');
  assert.equal(upd.name, 'lineup_members');
  assert.equal(upd.patch.status, 'shortlisted');
});

/* ── ⭐⭐ THE ONE EXECUTOR ────────────────────────────────────────────────────
 *
 * These pin the rules that used to live inside `EventHostView`, where only one
 * screen could reach them. The dashboard shipped with no REMOVE rather than a
 * second copy; now both call this, so a divergence has to fail here first.
 */

const ev = { id: 'e-1', name: 'Neverland', owner_profile_id: 'p-owner' };

function spyNotify() {
  const sent = [];
  const fn = async (row) => { sent.push(row); };
  fn.sent = sent;
  return fn;
}
const resolveOk = async () => ({ profileId: 'p-artist' });

test('⭐ an OFFERED set time was announced, so removing it tells them', async () => {
  const notify = spyNotify();
  const acting = [perfs()[0]];                       // p-1, offered
  const res = await executeLineupPlan(fakeDb(), planUnassign(madds, acting), {
    member: madds, perfs: acting, event: ev, notify, resolveProfileId: resolveOk,
  });
  assert.equal(res.ok, true);
  assert.equal(res.notified, true);
  assert.equal(notify.sent.length, 1);
  assert.equal(notify.sent[0].toUserId, 'u-1');
  assert.equal(notify.sent[0].toProfileId, 'p-artist');
  assert.equal(notify.sent[0].aboutProfileId, 'p-owner');
});

test('⛔⛔ a DRAFT slot was never announced, so removing it says NOTHING', async () => {
  const notify = spyNotify();
  const acting = [perfs()[1]];                       // p-2, draft
  const res = await executeLineupPlan(fakeDb(), planUnassign(madds, acting), {
    member: madds, perfs: acting, event: ev, notify, resolveProfileId: resolveOk,
  });
  assert.equal(res.ok, true);
  assert.equal(res.notified, false);
  assert.equal(notify.sent.length, 0,
    'announcing a booking and cancelling it in one message');
});

test('⛔ a hand-entered act has no account, so nothing is written to a null recipient', async () => {
  const notify = spyNotify();
  const acting = [{ id: 'p-9', lineup_member_id: 'm-typed', slot_uuid: 's-1', status: 'offered' }];
  const res = await executeLineupPlan(fakeDb(), planUnassign(typed, acting), {
    member: typed, perfs: acting, event: ev, notify, resolveProfileId: resolveOk,
  });
  assert.equal(res.notified, false);
  assert.equal(notify.sent.length, 0);
});

/**
 * ⚠⚠ THE SCOPING RULE. An act playing two slots keeps the other one, so a
 * caller may hand over everything the member holds and the executor still only
 * speaks about what the PLAN destroys.
 */
test('⛔ clearing one slot never announces the loss of a second one', async () => {
  const notify = spyNotify();
  const all = perfs();
  const plan = planUnassign(madds, [all[0]]);        // only p-1
  await executeLineupPlan(fakeDb(), plan, {
    member: madds, perfs: all, event: ev, notify, resolveProfileId: resolveOk,
  });
  assert.equal(notify.sent.length, 1, 'one slot cleared is one thing to say');
});

test('⛔ a write that RLS filtered is surfaced, and nobody is told it happened', async () => {
  const notify = spyNotify();
  const acting = [perfs()[0]];
  const res = await executeLineupPlan(fakeDb('performances'), planUnassign(madds, acting), {
    member: madds, perfs: acting, event: ev, notify, resolveProfileId: resolveOk,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /RLS said no/);
  assert.equal(notify.sent.length, 0, '⛔ never announce a change that did not save');
});

/**
 * ⛔⛔ THE DEAD BRANCH. `EventHostView` tested `kind === 'remove-from-bill'`,
 * which no planner has ever produced, so EVERY removal claimed "you are still
 * on the lineup" — including the ones that took somebody off it.
 */
test('⛔⛔ taking somebody OFF the lineup does not tell them they are still on it', () => {
  assert.match(messageFor('unassign', 'Neverland'), /still on the lineup/);
  assert.doesNotMatch(messageFor('remove-from-event', 'Neverland'), /still on the lineup/);
  assert.doesNotMatch(messageFor('move-to-shortlist', 'Neverland'), /still on the lineup/);
  // ⛔ No kind may default to the reassuring message.
  assert.doesNotMatch(messageFor('something-new', 'Neverland'), /still on the lineup/);
});

test('the copy carries no em dashes', () => {
  for (const k of ['unassign', 'move-to-shortlist', 'remove-from-event', 'unknown']) {
    assert.doesNotMatch(messageFor(k, 'Neverland'), /—/);
  }
});

/* ── ⛔⛔ PUTTING SOMEBODY ON A SLOT ──────────────────────────────────────────
 *
 * The regression these exist for: every insert site wrote `slot_id` (the
 * legacy TEXT key) with a UUID. The L3 trigger resolves `slot_uuid` only where
 * `event_slots.legacy_key = new.slot_id`, and across all 19 readable slots
 * `legacy_key` is `sat_0`-style and never equals the id — so the row landed
 * with a NULL `slot_uuid`, and `indexPerformances` skips exactly those.
 * Filling a slot wrote a performance nobody could see.
 */

/**
 * ⚠⚠ THE FAKE NOW SERVES THE BOOKING GATE'S READS. `assignMemberToSlot` reads
 * the member, their performances and the event before writing anything, because
 * a caller that can forget to pass the member's status is a caller that can
 * bypass the rule (the BVP incident).
 *
 * ⚠ The default member is `on_bill` on a `legacy` event — i.e. BOOKED — so the
 * older tests below keep asserting what they were written to assert.
 */
function fakeAssignDb({
  failInsert = false, failDelete = false, failUpdate = false,
  member = { id: 'm-madds', status: 'on_bill', artist_id: 'u-1', artist_profile_id: 'p-1' },
  memberPerfs = [],
  event = { id: 'e-1', booking_model: 'legacy' },
} = {}) {
  const calls = [];
  return {
    calls,
    from: name => ({
      select: () => ({
        eq: (col, val) => {
          calls.push({ op: 'select', name, where: { [col]: val } });
          const rows = name === 'performances' ? memberPerfs : [];
          return {
            /* ⚠ Both shapes: the gate uses `maybeSingle` for the member and the
               event, and a bare awaited query for the performances list. */
            maybeSingle: async () => ({ data: name === 'lineup_members' ? member : name === 'events' ? event : null, error: null }),
            then: (resolve) => resolve({ data: rows, error: null }),
          };
        },
      }),
      delete: () => ({ eq: (c1, v1) => ({ eq: (c2, v2) => {
        calls.push({ op: 'delete', name, where: { [c1]: v1, [c2]: v2 } });
        return { error: failDelete ? { message: 'RLS said no' } : null };
      } }) }),
      /* ⚠ P6.2.1 · the writer now UPDATES an existing row rather than replacing
         it. `failUpdate: 'filtered'` returns no error and NO ROW, which is what
         RLS actually does and the case that used to read as success. */
      update: patch => ({ eq: (col, val) => ({ select: () => ({ single: async () => {
        calls.push({ op: 'update', name, patch, where: { [col]: val } });
        if (failUpdate === 'filtered') return { data: null, error: null };
        if (failUpdate) return { data: null, error: { message: 'RLS said no' } };
        const row = (memberPerfs || []).find(p => p.id === val) || { id: val };
        return { data: { ...row, ...patch }, error: null };
      } }) }) }),
      insert: row => ({ select: () => ({ single: async () => {
        calls.push({ op: 'insert', name, row });
        return failInsert
          ? { data: null, error: { message: 'new row violates row-level security policy' } }
          : { data: { id: 'perf-new', ...row }, error: null };
      } }) }),
    }),
  };
}

/* ── ⛔⛔ THE BOOKING GATE · SET TIMES SCHEDULES, IT DOES NOT BOOK ───────────── */

/**
 * ⚠⚠ THE BVP REGRESSION, PINNED. A `shortlisted` member was given the 10PM slot
 * on Bass Heavy and nothing refused it. ⛔ If this ever goes green-to-red, an
 * artist can hold a set time without being on the bill again.
 */
test('⛔⛔ a SHORTLISTED member cannot be given a set time', async () => {
  const db = fakeAssignDb({ member: { id: 'm-bvp', status: 'shortlisted', artist_id: 'u-9', artist_profile_id: 'p-9' } });
  const res = await assignMemberToSlot(db, { slotId: 's-10pm', eventId: 'e-1', memberId: 'm-bvp' });
  assert.equal(res.ok, false);
  assert.equal(res.refused, 'not_booked');
  assert.match(res.error, /shortlist, not the lineup/);
  assert.equal(db.calls.some(c => c.op === 'insert'), false, 'it wrote a performance anyway');
  assert.equal(db.calls.some(c => c.op === 'delete'), false,
    '⛔⛔ WORSE THAN THE INSERT: the replace-delete would have cleared the slot before refusing');
});

test('⭐ a BOOKED member on a legacy event can be given a set time', async () => {
  const db = fakeAssignDb({ member: { id: 'm-luc', status: 'on_bill', artist_id: null, artist_profile_id: null } });
  const res = await assignMemberToSlot(db, { slotId: 's-10pm', eventId: 'e-1', memberId: 'm-luc' });
  assert.equal(res.ok, true);
  assert.equal(db.calls.find(c => c.op === 'insert').row.slot_uuid, 's-10pm');
});

/**
 * ⛔⛔ THE MANAGED CONTRACT MAY NOT BE BYPASSED. `on_bill` is not a booking
 * there: only the artist's own acceptance is, so a host cannot book somebody by
 * scheduling them.
 */
test('⛔⛔ a managed event refuses an on_bill member who has NOT accepted', async () => {
  const db = fakeAssignDb({
    member: { id: 'm-x', status: 'on_bill', artist_id: 'u-2', artist_profile_id: 'p-2' },
    memberPerfs: [{ id: 'perf-offer', status: 'offered', slot_uuid: null }],
    event: { id: 'e-m', booking_model: 'managed' },
  });
  const res = await assignMemberToSlot(db, { slotId: 's-1', eventId: 'e-m', memberId: 'm-x' });
  assert.equal(res.ok, false);
  assert.equal(res.refused, 'awaiting_acceptance');
  assert.equal(db.calls.some(c => c.op === 'insert'), false);
});

test('⭐ a managed event allows it once the artist HAS accepted', async () => {
  const db = fakeAssignDb({
    member: { id: 'm-x', status: 'on_bill', artist_id: 'u-2', artist_profile_id: 'p-2' },
    memberPerfs: [{ id: 'perf-acc', status: 'accepted', slot_uuid: null }],
    event: { id: 'e-m', booking_model: 'managed' },
  });
  const res = await assignMemberToSlot(db, { slotId: 's-1', eventId: 'e-m', memberId: 'm-x' });
  assert.equal(res.ok, true);
});

/**
 * ⚠ A HAND-TYPED ACT HAS NOBODY WHO COULD EVER ACCEPT, so requiring an
 * acceptance would make them unbookable on a managed event. ⛔ Still `on_bill`
 * only: shortlisted is refused whoever they are.
 */
test('⭐ a managed event allows a hand-typed on_bill act with no account', async () => {
  const base = { event: { id: 'e-m', booking_model: 'managed' } };
  const okDb = fakeAssignDb({ ...base, member: { id: 'm-t', status: 'on_bill', artist_id: null, artist_profile_id: null } });
  assert.equal((await assignMemberToSlot(okDb, { slotId: 's', eventId: 'e-m', memberId: 'm-t' })).ok, true);

  const noDb = fakeAssignDb({ ...base, member: { id: 'm-t', status: 'shortlisted', artist_id: null, artist_profile_id: null } });
  assert.equal((await assignMemberToSlot(noDb, { slotId: 's', eventId: 'e-m', memberId: 'm-t' })).ok, false);
});

/* ⚠ RLS can hide a row, and a hidden row is ⛔ NOT permission. */
test('⛔ a member the reader cannot see is refused, not assumed', async () => {
  const db = fakeAssignDb({ member: null });
  const res = await assignMemberToSlot(db, { slotId: 's', eventId: 'e-1', memberId: 'm-gone' });
  assert.equal(res.ok, false);
  assert.equal(res.refused, 'no_member');
});

/**
 * ⚠⚠ AN UNREADABLE EVENT MUST NOT BECOME `managed`. `bookingModel` fails safe to
 * `legacy`, so a null event behaves exactly as every existing event does.
 */
test('⚠ a null event falls back to legacy rather than blocking a booked member', async () => {
  const db = fakeAssignDb({ event: null, member: { id: 'm-1', status: 'on_bill', artist_id: 'u', artist_profile_id: 'p' } });
  assert.equal((await assignMemberToSlot(db, { slotId: 's', eventId: 'e-?', memberId: 'm-1' })).ok, true);
});

test('⛔⛔ an assignment writes slot_uuid and ⛔ NEVER the legacy slot_id', async () => {
  const db = fakeAssignDb();
  const res = await assignMemberToSlot(db, {
    slotId: 'uuid-slot-1', eventId: 'e-1', memberId: 'm-madds', status: 'offered',
  });
  assert.equal(res.ok, true);
  const ins = db.calls.find(c => c.op === 'insert');
  assert.equal(ins.row.slot_uuid, 'uuid-slot-1');
  assert.equal(ins.row.slot_id, undefined,
    '⛔ writing the legacy text column with a UUID is what made the row invisible');
  assert.equal(ins.row.status, 'offered');
});

/**
 * ⚠⚠ THIS TEST IS REVERSED FROM WHAT IT ONCE ASSERTED (P6.2.1, owner
 * 2026-08-17). It used to prove the replace-the-occupant DELETE was keyed on
 * `slot_uuid`. There is no longer a delete: placing somebody may not remove
 * anybody, because L3 constrains `(slot, member)` rather than the slot alone and
 * two acts on one slot is real. ⛔ The old assertion is not weakened, it is
 * WRONG, so it is gone rather than left to contradict this.
 */
test('⛔⛔ placing somebody DELETES NOBODY — the incumbent survives', async () => {
  const db = fakeAssignDb();
  const res = await assignMemberToSlot(db, { slotId: 'uuid-slot-1', eventId: 'e-1', memberId: 'm-madds' });
  assert.equal(res.ok, true);
  assert.equal(db.calls.some(c => c.op === 'delete'), false,
    'the incumbent lost their row, and with it accepted_at and any pending offer notification');
});

/**
 * ⭐ THE STATUS COMES FROM THE CALLER. A hand-entered act is `accepted` because
 * writing them down IS the booking; an artist with an account is `offered` or
 * `draft` because somebody still has to answer.
 */
test('⭐ the status is the caller\'s, ⛔ not this function\'s', async () => {
  for (const status of ['draft', 'offered', 'accepted']) {
    const db = fakeAssignDb();
    await assignMemberToSlot(db, { slotId: 's', eventId: 'e', memberId: 'm', status });
    assert.equal(db.calls.find(c => c.op === 'insert').row.status, status);
  }
  // ⚠ The default is the quiet one: a slot nobody has been told about.
  const db = fakeAssignDb();
  await assignMemberToSlot(db, { slotId: 's', eventId: 'e', memberId: 'm' });
  assert.equal(db.calls.find(c => c.op === 'insert').row.status, 'draft');
});

test('⛔ an insert RLS blocked is surfaced, ⛔ never reported as a fill', async () => {
  const db = fakeAssignDb({ failInsert: true });
  const res = await assignMemberToSlot(db, { slotId: 's', eventId: 'e', memberId: 'm' });
  assert.equal(res.ok, false);
  assert.match(res.error, /row-level security/);
  assert.equal(res.performance, null);
});

/**
 * ⚠⚠ RETIRED BY P6.2.1, and recorded rather than silently dropped. This proved
 * that a FAILED delete stopped before the insert, so a slot could not end up with
 * two acts by accident. ⛔ There is no delete to fail now: a second act on a slot
 * is legitimate (L3 constrains `(slot, member)`, B2B is real), so the guard has
 * nothing left to guard. The replacement assertion is
 * "placing somebody DELETES NOBODY" above.
 */
test('⛔ no delete is issued on any assignment path, so nothing can half-fail', async () => {
  for (const perfsHeld of [[], [{ id: 'p-1', status: 'accepted', slot_uuid: null }], [{ id: 'p-2', status: 'draft', slot_uuid: 'other' }]]) {
    const db = fakeAssignDb({ memberPerfs: perfsHeld });
    await assignMemberToSlot(db, { slotId: 's', eventId: 'e-1', memberId: 'm-madds' });
    assert.equal(db.calls.some(c => c.op === 'delete'), false);
  }
});

test('⛔ an incomplete assignment writes nothing at all', async () => {
  for (const args of [{ eventId: 'e', memberId: 'm' }, { slotId: 's', memberId: 'm' }, { slotId: 's', eventId: 'e' }]) {
    const db = fakeAssignDb();
    const res = await assignMemberToSlot(db, args);
    assert.equal(res.ok, false);
    assert.equal(db.calls.length, 0);
  }
});

/* ── ⭐⭐ P4 · OFFERING A PLACE AT THE EVENT ───────────────────────────────── */

/**
 * ⛔⛔ NOT A SET-TIME OFFER. "We would like you to play at this event", ⛔ not
 * "at 9pm". A null `slot_uuid` IS that offer.
 */
test('⛔⛔ an event offer carries NO slot', async () => {
  const db = fakeAssignDb();
  const res = await createEventOffer(db, { eventId: 'e-1', memberId: 'm-madds' });
  assert.equal(res.ok, true);
  const ins = db.calls.find(c => c.op === 'insert');
  assert.equal(ins.row.slot_uuid, null, 'a slot here would make it a set-time offer');
  assert.equal(ins.row.event_id, 'e-1');
  assert.equal(ins.row.lineup_member_id, 'm-madds');
});

/**
 * ⚠ `draft` means CREATED BUT NOT SENT, which is exactly what an unnotified
 * offer is. ⛔ `offered` would claim the artist has already been asked.
 */
test("⚠ a fresh offer is 'draft', ⛔ never 'offered'", async () => {
  const db = fakeAssignDb();
  await createEventOffer(db, { eventId: 'e-1', memberId: 'm-1' });
  assert.equal(db.calls.find(c => c.op === 'insert').row.status, 'draft');
});

/* ⛔⛔ IT DELETES NOTHING. This is not assignMemberToSlot, which replaces a
   slot's occupant. Nobody is displaced by being offered a place. */
test('⛔⛔ making an offer displaces nobody', async () => {
  const db = fakeAssignDb();
  await createEventOffer(db, { eventId: 'e-1', memberId: 'm-1' });
  assert.equal(db.calls.filter(c => c.op === 'delete').length, 0);
});

test('⛔ a second offer to the same member is refused before the round trip', () => {
  const held = [{ id: 'p-1', slot_uuid: null, status: 'draft' }];
  const plan = planEventOffer({ id: 'm-1' }, held);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already been offered/);
  assert.equal(plan.existing.id, 'p-1');
});

/* ⛔ Somebody holding a SLOT is past this step; offering them a place would be
   a second, contradictory offer. */
test('⛔ an artist who already has a set time is not offered a place', () => {
  const plan = planEventOffer({ id: 'm-1' }, [{ id: 'p-9', slot_uuid: 's-1', status: 'accepted' }]);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already have a set time/);
});

test('a first offer to a shortlisted artist is allowed', () => {
  assert.equal(planEventOffer({ id: 'm-1' }, []).ok, true);
  assert.equal(planEventOffer({ id: 'm-1' }, null).ok, true);
  assert.equal(planEventOffer(null, []).ok, false);
});

test('⛔ an incomplete offer writes nothing at all', async () => {
  for (const args of [{ eventId: 'e' }, { memberId: 'm' }, {}]) {
    const db = fakeAssignDb();
    const res = await createEventOffer(db, args);
    assert.equal(res.ok, false);
    assert.equal(db.calls.length, 0);
  }
});

/* ── ⛔⛔ P6.2.1 · A RESCHEDULE MAY NOT DESTROY A BOOKING ───────────────────── */

const legacyEv = { id: 'e-1', booking_model: 'legacy' };
const onBill   = { id: 'm-1', status: 'on_bill', artist_id: 'u-1', artist_profile_id: 'p-1' };

/**
 * ⭐⭐ THE INVARIANT. `accepted_at` is the ARTIST's own act, and a host moving a
 * set time is not permission to erase it.
 */
test('⭐⭐ moving an ACCEPTED artist keeps the row, its id, its status and accepted_at', async () => {
  const existing = { id: 'perf-keep', status: 'accepted', slot_uuid: null, accepted_at: '2026-08-01T00:00:00.000Z' };
  const db = fakeAssignDb({ member: onBill, memberPerfs: [existing], event: legacyEv });
  const res = await assignMemberToSlot(db, { slotId: 'slot-9pm', eventId: 'e-1', memberId: 'm-1', status: 'draft' });

  assert.equal(res.ok, true);
  assert.equal(db.calls.some(c => c.op === 'insert'), false, 'a new row means the old one was abandoned');
  const up = db.calls.find(c => c.op === 'update');
  assert.equal(up.where.id, 'perf-keep', '⛔ the row id must survive: notifications point at it');
  assert.deepEqual(Object.keys(up.patch).sort(), ['slot_uuid', 'updated_at'],
    '⛔⛔ status is INSERT-ONLY: a reschedule may not rewrite what the artist agreed to');
  assert.equal(res.performance.status, 'accepted');
  assert.equal(res.performance.accepted_at, '2026-08-01T00:00:00.000Z');
});

/* ⚠ THE EVENT-LEVEL OFFER (P4) IS THE THING TO PLACE — a row with no slot is an
   artist who accepted a place at the event, and their acceptance must not be
   stranded on a row nobody reads. */
test('⚠ an unplaced performance is reused rather than left behind', async () => {
  const db = fakeAssignDb({ member: onBill, event: legacyEv,
    memberPerfs: [{ id: 'perf-offer', status: 'accepted', slot_uuid: null }] });
  await assignMemberToSlot(db, { slotId: 'slot-1', eventId: 'e-1', memberId: 'm-1' });
  assert.equal(db.calls.find(c => c.op === 'update').patch.slot_uuid, 'slot-1');
  assert.equal(db.calls.some(c => c.op === 'insert'), false);
});

/* ⛔ Re-pressing must not restamp a row, or the audit trail records edits that
   never happened. */
test('⛔ assigning somebody to the slot they already hold writes NOTHING', async () => {
  const db = fakeAssignDb({ member: onBill, event: legacyEv,
    memberPerfs: [{ id: 'perf-same', status: 'offered', slot_uuid: 'slot-1' }] });
  const res = await assignMemberToSlot(db, { slotId: 'slot-1', eventId: 'e-1', memberId: 'm-1', status: 'draft' });
  assert.equal(res.ok, true);
  assert.equal(res.unchanged, true);
  assert.equal(db.calls.some(c => c.op === 'update' || c.op === 'insert' || c.op === 'delete'), false);
  assert.equal(res.performance.status, 'offered', 'the caller status must not overwrite it');
});

/* ⭐ With nothing to reuse it still inserts, and only THEN does the caller's
   status apply — that is what "insert-only" means. */
test('⭐ a member with no performances gets a new row carrying the caller status', async () => {
  const db = fakeAssignDb({ member: onBill, memberPerfs: [], event: legacyEv });
  await assignMemberToSlot(db, { slotId: 'slot-1', eventId: 'e-1', memberId: 'm-1', status: 'offered' });
  const ins = db.calls.find(c => c.op === 'insert');
  assert.equal(ins.row.status, 'offered');
  assert.equal(ins.row.slot_uuid, 'slot-1');
});

/**
 * ⚠⚠ AN UPDATE RLS FILTERED RETURNS NO ERROR AND NO ROW. ⛔ That must be a
 * failure: this is the exact shape that let 22 events look editable when they
 * were not.
 */
test('⛔⛔ an update that changed nothing is a FAILURE, not a success', async () => {
  const db = fakeAssignDb({ member: onBill, event: legacyEv, failUpdate: 'filtered',
    memberPerfs: [{ id: 'perf-x', status: 'draft', slot_uuid: null }] });
  const res = await assignMemberToSlot(db, { slotId: 'slot-1', eventId: 'e-1', memberId: 'm-1' });
  assert.equal(res.ok, false);
  assert.match(res.error, /not saved/);
});

test('an update error is surfaced too', async () => {
  const db = fakeAssignDb({ member: onBill, event: legacyEv, failUpdate: true,
    memberPerfs: [{ id: 'perf-x', status: 'draft', slot_uuid: null }] });
  assert.equal((await assignMemberToSlot(db, { slotId: 's', eventId: 'e-1', memberId: 'm-1' })).ok, false);
});

/**
 * ⚠⚠ THIS PINS THE INTERIM, ⛔ NOT THE FINAL ANSWER (owner, 2026-08-17). A member
 * may legitimately hold several slots (L3 constrains `(slot, member)` for exactly
 * that reason), so a second placement INSERTS and the first is untouched: no data
 * is lost, which is the safe half of a genuinely ambiguous instruction.
 *
 * ⛔ The ratified destination is an EXPLICIT CHOICE in the sheet, "move them here"
 * versus "add a second set". When that lands, this test changes with it — ⛔ and
 * it must not be closed by inferring intent from the number of slots held.
 */
test('⚠ INTERIM · a member already playing one slot gains a second, and keeps the first', async () => {
  const db = fakeAssignDb({ member: onBill, event: legacyEv,
    memberPerfs: [{ id: 'perf-a', status: 'accepted', slot_uuid: 'slot-7pm' }] });
  await assignMemberToSlot(db, { slotId: 'slot-11pm', eventId: 'e-1', memberId: 'm-1', status: 'draft' });
  assert.equal(db.calls.some(c => c.op === 'update'), false, 'their 7PM set was moved instead of added to');
  assert.equal(db.calls.find(c => c.op === 'insert').row.slot_uuid, 'slot-11pm');
});

/* ── ⭐⭐ P6.3c-2 · THE REMOVAL NOTICE RECORDS WHAT IT SENT ─────────────────── */

const reachable = (over = {}) => ({ id: 'm-r', artist_id: 'u-1', artist_name: 'Madds', notified_at: null, notified_slot_uuid: null, ...over });
const placed = (over = {}) => ({ id: 'p-1', slot_uuid: 's-8pm', status: 'offered', ...over });

function planDb({ failRecord = false } = {}) {
  const calls = [];
  return {
    calls,
    from: name => ({
      delete: () => ({ in: (col, ids) => { calls.push({ op: 'delete', name, ids }); return { error: null }; } }),
      update: fields => ({ eq: (col, val) => {
        calls.push({ op: 'update', name, fields, id: val });
        const failing = failRecord && name === 'lineup_members' && fields.notified_kind;
        return { error: failing ? { message: 'RLS said no' } : null };
      } }),
    }),
  };
}
const okNotify   = async () => null;
const failNotify = async () => ({ message: 'transport died' });

/**
 * ⭐ WE KNOW WE TOLD THEM: the RECORD decides, ⛔ not the status. ⚠ This is the
 * case a status-only gate got wrong after an unlock, which reverts offered to
 * draft and would have gone silent about a removal the artist was told about.
 */
test('⭐ a recorded send means the removal IS announced, even from a draft row', () => {
  const m = reachable({ notified_at: '2026-08-17T11:00:00.000Z', notified_slot_uuid: 's-8pm' });
  assert.equal(removalNeedsNotice(m, [placed({ status: 'draft' })]), true);
});

/**
 * ⚠⚠ THE MIGRATION EXCEPTION, and ⛔ NOT "status is evidence again". Five legacy
 * placements are offered/accepted with no record: we cannot establish whether
 * they were told, and a removal notice is the SAFE error.
 */
test('⚠ no record + offered or accepted still announces, as the safe error', () => {
  for (const status of ['offered', 'accepted']) {
    assert.equal(removalNeedsNotice(reachable(), [placed({ status })]), true, status);
  }
});

/* ⭐ AND WE KNOW WHEN WE NEVER TOLD THEM. A draft was never announced, so
   ⛔ announcing its removal announces the booking and cancels it in one message. */
test('⛔ no record + draft is SILENT', () => {
  assert.equal(removalNeedsNotice(reachable(), [placed({ status: 'draft' })]), false);
});

test('⛔ nobody to tell, and nothing placed, are both silent', () => {
  assert.equal(removalNeedsNotice({ id: 'm-t', artist_id: null }, [placed()]), false);
  assert.equal(removalNeedsNotice(reachable(), [{ id: 'p-x', slot_uuid: null, status: 'accepted' }]), false,
    'an event-level offer is not a set time to take away');
  assert.equal(removalNeedsNotice(reachable(), []), false);
});

test('⭐⭐ a successful removal notice records all three facts', async () => {
  const db = planDb();
  const m = reachable();
  const res = await executeLineupPlan(db, planUnassign(m, [placed()]), {
    member: m, perfs: [placed()], event: { id: 'e-1', name: 'Bass Heavy' }, notify: okNotify,
  });
  assert.equal(res.notified, true);
  assert.equal(res.recorded, true);
  const rec = db.calls.find(c => c.name === 'lineup_members' && c.fields.notified_kind);
  assert.equal(rec.id, 'm-r');
  assert.equal(rec.fields.notified_kind, 'slot_removed');
  assert.equal(rec.fields.notified_slot_uuid, 's-8pm', 'the slot they were told they have lost');
  assert.ok(!Number.isNaN(Date.parse(rec.fields.notified_at)));
});

/**
 * ⛔⛔ THE ORDERING INVARIANT, ON THIS PATH TOO. The notify result used to be
 * discarded, so a notice that never left reported notified: true.
 */
test('⛔⛔ a FAILED removal notice records nothing and does not claim to have sent', async () => {
  const db = planDb();
  const m = reachable();
  const res = await executeLineupPlan(db, planUnassign(m, [placed()]), {
    member: m, perfs: [placed()], event: { id: 'e-1' }, notify: failNotify,
  });
  assert.equal(res.notified, false);
  assert.match(res.notifyError, /transport died/);
  assert.equal(db.calls.some(c => c.fields?.notified_kind), false);
});

/* ⚠⚠ Sent but not recorded is surfaced: the artist HAS been told, so this is not
   a failed removal, but the record now disagrees with reality. */
test('⚠⚠ a failed record is reported without denying the send', async () => {
  const m = reachable();
  const res = await executeLineupPlan(planDb({ failRecord: true }), planUnassign(m, [placed()]), {
    member: m, perfs: [placed()], event: { id: 'e-1' }, notify: okNotify,
  });
  assert.equal(res.notified, true);
  assert.equal(res.recorded, undefined);
  assert.match(res.recordError, /RLS said no/);
});

/* ⭐ What we last TOLD them outranks the row being deleted, when they differ. */
test('⭐ the recorded slot prefers what was actually communicated', async () => {
  const db = planDb();
  const m = reachable({ notified_at: '2026-08-17T11:00:00.000Z', notified_slot_uuid: 's-told' });
  await executeLineupPlan(db, planUnassign(m, [placed({ slot_uuid: 's-moved-to' })]), {
    member: m, perfs: [placed({ slot_uuid: 's-moved-to' })], event: { id: 'e-1' }, notify: okNotify,
  });
  assert.equal(db.calls.find(c => c.fields?.notified_kind).fields.notified_slot_uuid, 's-told');
});

/**
 * ⚠⚠ THE RECORD SURVIVES AN UNBOOKING (owner, ratified). After move-to-shortlist
 * or remove-from-event the member is no longer booked, so the derivation reads
 * NOTHING_TO_SAY and the row is HISTORY, ⛔ not work. ⛔ It is never cleared.
 */
test('⭐⭐ all three plans record, and booking state still takes precedence after', async () => {
  const { notifyState } = await import('./notifyPlan.js');
  const cases = [
    ['unassign',          planUnassign,        'on_bill',     'CLEAN'],
    ['move-to-shortlist', planMoveToShortlist, 'shortlisted', 'NOTHING_TO_SAY'],
    ['remove-from-event', planRemoveFromEvent, 'removed',     'NOTHING_TO_SAY'],
  ];
  for (const [kind, plan, status, expected] of cases) {
    const db = planDb();
    const m = reachable();
    const res = await executeLineupPlan(db, plan(m, [placed()]), {
      member: m, perfs: [placed()], event: { id: 'e-1' }, notify: okNotify,
    });
    assert.equal(res.recorded, true, kind);
    const patch = db.calls.find(c => c.fields?.notified_kind).fields;
    const after = { ...m, ...patch, status };
    assert.equal(notifyState(after, [], { booking_model: 'legacy' }).state, expected,
      `${kind}: a historical record must not become actionable work once unbooked`);
    assert.equal(after.notified_kind, 'slot_removed', `${kind}: the record was cleared`);
  }
});

/* ⛔ The record writes nothing else, on any path. */
test('⛔ the removal record never writes accepted_at, a lock, or another table', async () => {
  const db = planDb();
  const m = reachable();
  await executeLineupPlan(db, planUnassign(m, [placed()]), {
    member: m, perfs: [placed()], event: { id: 'e-1' }, notify: okNotify,
  });
  const written = JSON.stringify(db.calls.map(c => c.fields || {}));
  for (const forbidden of ['accepted_at', 'set_times_locked']) {
    assert.equal(written.includes(forbidden), false, `it wrote ${forbidden}`);
  }
  assert.equal(db.calls.some(c => c.name === 'applications'), false);
  assert.equal(db.calls.some(c => c.name === 'events'), false);
});

/* ── PUBLISH SET TIMES ──────────────────────────────────────────────────────
 *
 * Live case, 2026-08-22: an event with four assigned slots showed "Open slot"
 * on all four to the public. Every act was hand-entered against an unclaimed
 * profile, so `artist_id` was NULL, no offer could be sent, nobody could
 * accept, and RLS shows the public only accepted rows. These tests pin the two
 * halves of the rule: publish the unaskable, ⛔ never the askable.
 */
const pubMembers = [
  { id: 'm-hand',  artist_name: '6ixy',   artist_id: null },
  { id: 'm-hand2', artist_name: 'Jemzy',  artist_id: null },
  { id: 'm-real',  artist_name: 'Wyldcard', artist_id: 'u-1' },
];

test('publishes a draft set time for an act with no account', () => {
  const plan = planPublishSetTimes(pubMembers, [
    { id: 'p-1', lineup_member_id: 'm-hand', slot_uuid: 's-1', status: 'draft' },
  ]);
  assert.deepEqual(plan.promoteIds, ['p-1']);
  assert.deepEqual(plan.names, ['6ixy']);
});

test('⛔⛔ NEVER publishes a reachable artist — their answer is theirs to give', () => {
  const plan = planPublishSetTimes(pubMembers, [
    { id: 'p-1', lineup_member_id: 'm-hand', slot_uuid: 's-1', status: 'draft' },
    { id: 'p-2', lineup_member_id: 'm-real', slot_uuid: 's-2', status: 'draft' },
  ]);
  assert.deepEqual(plan.promoteIds, ['p-1'], 'a booking nobody agreed to must not go public');
  assert.equal(plan.skippedReachable, 1);
});

test('⛔ a bare place-offer has no set time to publish', () => {
  // slot_uuid null is "you are on the bill", not a scheduled set.
  const plan = planPublishSetTimes(pubMembers, [
    { id: 'p-1', lineup_member_id: 'm-hand', slot_uuid: null, status: 'draft' },
  ]);
  assert.deepEqual(plan.promoteIds, []);
});

test('already-accepted and offered rows are left alone', () => {
  const plan = planPublishSetTimes(pubMembers, [
    { id: 'p-1', lineup_member_id: 'm-hand',  slot_uuid: 's-1', status: 'accepted' },
    { id: 'p-2', lineup_member_id: 'm-hand2', slot_uuid: 's-2', status: 'offered' },
  ]);
  assert.deepEqual(plan.promoteIds, []);
});

test('a performance whose member is missing is not published', () => {
  // A row pointing at a member that is not on the bill is unexplained; ⛔ a
  // publish button is not the place to resolve it.
  const plan = planPublishSetTimes(pubMembers, [
    { id: 'p-1', lineup_member_id: 'm-gone', slot_uuid: 's-1', status: 'draft' },
  ]);
  assert.deepEqual(plan.promoteIds, []);
});

test('an empty plan writes nothing at all', async () => {
  let called = false;
  const db = { from() { called = true; return {}; } };
  const res = await applyPublishSetTimes(db, { promoteIds: [] });
  assert.equal(res.ok, true);
  assert.equal(res.published, 0);
  assert.equal(called, false, 'an empty publish must not touch the database');
});

test('applying stamps accepted_at, because a filled slot is counted by acceptance', async () => {
  let payload = null, scopedIds = null;
  const db = { from: () => ({ update(p) { payload = p; return { in(_c, ids) { scopedIds = ids; return { error: null }; } }; } }) };
  const res = await applyPublishSetTimes(db, { promoteIds: ['p-1', 'p-2'] });
  assert.equal(res.ok, true);
  assert.equal(res.published, 2);
  assert.equal(payload.status, 'accepted');
  assert.ok(payload.accepted_at, 'slotTally counts by acceptance; a null stamp reads as unanswered');
  assert.deepEqual(scopedIds, ['p-1', 'p-2'], 'scoped by id — never by event+status');
});
