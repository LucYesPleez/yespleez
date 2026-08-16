import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planUnassign, planRemoveFromBill, planMoveToShortlist, planRemoveFromEvent, applyLineupPlan, restoreToBill,
  notifiablePerformances, wasEverSent, isReachable, executeLineupPlan, messageFor, assignMemberToSlot,
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

function fakeAssignDb({ failInsert = false, failDelete = false } = {}) {
  const calls = [];
  return {
    calls,
    from: name => ({
      delete: () => ({ eq: (c1, v1) => ({ eq: (c2, v2) => {
        calls.push({ op: 'delete', name, where: { [c1]: v1, [c2]: v2 } });
        return { error: failDelete ? { message: 'RLS said no' } : null };
      } }) }),
      insert: row => ({ select: () => ({ single: async () => {
        calls.push({ op: 'insert', name, row });
        return failInsert
          ? { data: null, error: { message: 'new row violates row-level security policy' } }
          : { data: { id: 'perf-new', ...row }, error: null };
      } }) }),
    }),
  };
}

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

test('⛔ the replace-the-occupant delete matches on slot_uuid too', async () => {
  const db = fakeAssignDb();
  await assignMemberToSlot(db, { slotId: 'uuid-slot-1', eventId: 'e-1', memberId: 'm-1' });
  const del = db.calls.find(c => c.op === 'delete');
  assert.equal(del.where.slot_uuid, 'uuid-slot-1',
    'keyed on slot_id it matched nothing, so the previous occupant was never replaced');
  assert.equal(del.where.event_id, 'e-1');
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

test('⛔ a failed delete stops before inserting a SECOND act onto the slot', async () => {
  const db = fakeAssignDb({ failDelete: true });
  const res = await assignMemberToSlot(db, { slotId: 's', eventId: 'e', memberId: 'm' });
  assert.equal(res.ok, false);
  assert.equal(db.calls.filter(c => c.op === 'insert').length, 0);
});

test('⛔ an incomplete assignment writes nothing at all', async () => {
  for (const args of [{ eventId: 'e', memberId: 'm' }, { slotId: 's', memberId: 'm' }, { slotId: 's', eventId: 'e' }]) {
    const db = fakeAssignDb();
    const res = await assignMemberToSlot(db, args);
    assert.equal(res.ok, false);
    assert.equal(db.calls.length, 0);
  }
});
