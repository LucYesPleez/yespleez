import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendSlotNotice, sendSlotNotices, summariseOutcomes, messageForKind } from './notifySender.js';
import { SLOT_OFFER, SLOT_CHANGED, SLOT_REMOVED, notifyState, CLEAN, TIME_CHANGED } from './notifyPlan.js';

const EVENT = { id: 'e-1', name: 'Bass Heavy', booking_model: 'legacy', owner_profile_id: 'own-1' };
const MANAGED = { ...EVENT, id: 'e-m', booking_model: 'managed' };

const member = (over = {}) => ({
  id: 'm-1', status: 'on_bill', artist_id: 'u-1', artist_profile_id: 'p-1',
  notified_at: null, notified_slot_uuid: null, notified_kind: null, ...over,
});
const perf = (slot, over = {}) => ({ id: 'perf-' + slot, status: 'draft', slot_uuid: slot, ...over });

/**
 * ⚠ The fake records the ORDER of everything, which is what most of these tests
 * are actually about.
 */
function fake({ failStatus = false, failRecord = false, recordFiltered = false } = {}) {
  const calls = [];
  return {
    calls,
    from: name => ({
      update: patch => ({ eq: (col, val) => {
        const op = { op: 'update', name, patch, where: { [col]: val } };
        calls.push(op);
        if (name === 'performances') return { error: failStatus ? { message: 'RLS said no' } : null };
        return { select: () => {
          if (failRecord) return { data: null, error: { message: 'RLS said no' } };
          /* ⚠⚠ An RLS-filtered UPDATE returns NO error and NO row. */
          if (recordFiltered) return { data: [], error: null };
          return { data: [{ id: val, ...patch }], error: null };
        } };
      } }),
    }),
  };
}

/* A transport that records what it was asked to send. */
function transport({ fails = false } = {}) {
  const sent = [];
  const fn = async row => { sent.push(row); return fails ? { message: 'insert blew up' } : null; };
  fn.sent = sent;
  return fn;
}

/* ── ⭐⭐ THE ORDERING INVARIANT ────────────────────────────────────────────── */

/**
 * ⛔⛔ THE ONE THAT MATTERS MOST. `notified_at` means "we told them". If the send
 * fails and the record is written anyway, the artist is silently marked as
 * notified and nothing will ever tell them.
 */
test('⛔⛔ a FAILED send writes NOTHING', async () => {
  const db = fake();
  const notify = transport({ fails: true });
  const res = await sendSlotNotice(db, { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify });

  assert.equal(res.ok, false);
  assert.equal(res.code, 'send_failed');
  assert.equal(res.sent, false);
  assert.equal(res.recorded, false);
  assert.deepEqual(db.calls, [], 'the communication record was written for a message that never left');
});

test('⭐ a successful send records all three facts, on that member only', async () => {
  const db = fake();
  const notify = transport();
  const res = await sendSlotNotice(db, { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify });

  assert.equal(res.ok, true);
  assert.equal(res.recorded, true);
  const record = db.calls.find(c => c.name === 'lineup_members');
  assert.deepEqual(Object.keys(record.patch).sort(), ['notified_at', 'notified_kind', 'notified_slot_uuid']);
  assert.equal(record.patch.notified_slot_uuid, 's1');
  assert.equal(record.patch.notified_kind, SLOT_OFFER);
  assert.ok(!Number.isNaN(Date.parse(record.patch.notified_at)));
  assert.equal(record.where.id, 'm-1');
});

/* ⚠ The send happens BEFORE any write. Asserted on order, not just presence. */
test('⭐ nothing is written before the transport is called', async () => {
  const order = [];
  const db = fake();
  db.from = (name => ({ update: patch => ({ eq: (col, val) => {
    order.push('write:' + name);
    return name === 'performances' ? { error: null } : { select: () => ({ data: [{ id: val, ...patch }], error: null }) };
  } }) }));
  const notify = async () => { order.push('send'); return null; };
  await sendSlotNotice(db, { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify });
  assert.equal(order[0], 'send');
});

/* ── the ONE permitted status transition ───────────────────────────────────── */

test('⭐ an offer moves that placement draft → offered, and only that row', async () => {
  const db = fake();
  await sendSlotNotice(db, {
    member: member(), event: EVENT, slotUuid: 's1', notify: transport(),
    perfs: [perf('s1'), perf('s2', { id: 'perf-other' })],
  });
  const status = db.calls.filter(c => c.name === 'performances');
  assert.equal(status.length, 1);
  assert.equal(status[0].where.id, 'perf-s1');
  assert.equal(status[0].patch.status, 'offered');
});

/* ⛔⛔ An acceptance may never be downgraded by a send. */
test('⛔⛔ an ACCEPTED placement keeps its status', async () => {
  const db = fake();
  await sendSlotNotice(db, {
    member: member(), event: EVENT, slotUuid: 's1', notify: transport(),
    perfs: [perf('s1', { status: 'accepted', accepted_at: '2026-08-01T00:00:00.000Z' })],
  });
  assert.equal(db.calls.some(c => c.name === 'performances'), false);
  assert.equal(db.calls.find(c => c.name === 'lineup_members').patch.notified_kind, SLOT_OFFER);
});

test('⛔ a CHANGE notice never touches status', async () => {
  const db = fake();
  await sendSlotNotice(db, {
    member: member(), event: EVENT, slotUuid: 's1', kind: SLOT_CHANGED, notify: transport(),
    perfs: [perf('s1')],
  });
  assert.equal(db.calls.some(c => c.name === 'performances'), false);
});

/**
 * ⚠⚠ SENT BUT THE STATUS WRITE FAILED. The artist HAS the message, so the record
 * must still be written or the next pass tells them twice. A stale status is
 * visible and fixable; a duplicate notice is not.
 */
test('⚠⚠ a failed status write still records the communication, and says so', async () => {
  const db = fake({ failStatus: true });
  const res = await sendSlotNotice(db, { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify: transport() });
  assert.equal(res.ok, true);
  assert.equal(res.recorded, true);
  assert.match(res.statusError, /RLS said no/);
});

/* ── sent but not recorded ─────────────────────────────────────────────────── */

/**
 * ⚠⚠ THE WORST OUTCOME AND IT MUST BE LOUD. ⛔ An RLS-filtered UPDATE returns no
 * error AND no row, the exact silence that let 22 events look editable.
 */
test('⛔⛔ a record write that changed nothing is reported, not swallowed', async () => {
  for (const opts of [{ failRecord: true }, { recordFiltered: true }]) {
    const res = await sendSlotNotice(fake(opts), {
      member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify: transport(),
    });
    assert.equal(res.sent, true, 'the message did go');
    assert.equal(res.ok, false);
    assert.equal(res.recorded, false);
    assert.equal(res.code, 'sent_not_recorded');
  }
});

/* ── refusals, none of which send or write ─────────────────────────────────── */

test('⛔ every refusal sends nothing and writes nothing', async () => {
  const cases = {
    unreachable:  { member: member({ artist_id: null }), perfs: [perf('s1')], slotUuid: 's1' },
    not_booked:   { member: member({ status: 'shortlisted' }), perfs: [perf('s1')], slotUuid: 's1' },
    not_placed:   { member: member(), perfs: [perf('s1')], slotUuid: 's-nope' },
    still_placed: { member: member(), perfs: [perf('s1')], slotUuid: 's1', kind: SLOT_REMOVED },
    unknown_kind: { member: member(), perfs: [perf('s1')], slotUuid: 's1', kind: 'slot_cancelled' },
    missing_input:{ member: null, perfs: [], slotUuid: 's1' },
  };
  for (const [code, args] of Object.entries(cases)) {
    const db = fake();
    const notify = transport();
    const res = await sendSlotNotice(db, { event: EVENT, notify, ...args });
    assert.equal(res.code, code, `expected ${code}`);
    assert.equal(res.ok, false);
    assert.deepEqual(notify.sent, [], `${code} sent a message anyway`);
    assert.deepEqual(db.calls, [], `${code} wrote something anyway`);
  }
});

/* ⛔ No transport means no send, ⛔ not a silent success. */
test('⛔ a missing transport refuses rather than pretending', async () => {
  const res = await sendSlotNotice(fake(), { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1' });
  assert.equal(res.code, 'no_transport');
});

/**
 * ⛔⛔ THE MANAGED CONTRACT IS NOT BYPASSED. `on_bill` is not a booking there, so
 * an artist who has not accepted cannot be told about a set time.
 */
test('⛔⛔ a managed event refuses an unaccepted artist', async () => {
  const notify = transport();
  const res = await sendSlotNotice(fake(), {
    member: member(), event: MANAGED, slotUuid: 's1', notify,
    perfs: [perf('s1', { status: 'offered' })],
  });
  assert.equal(res.code, 'not_booked');
  assert.deepEqual(notify.sent, []);

  /* ⭐ And it proceeds once they HAVE accepted. */
  const ok = await sendSlotNotice(fake(), {
    member: member(), event: MANAGED, slotUuid: 's1', notify: transport(),
    perfs: [perf('s1', { status: 'accepted' })],
  });
  assert.equal(ok.ok, true);
});

/* ── a removal ─────────────────────────────────────────────────────────────── */

test('⭐ a removal is sent about a slot they no longer hold, and records the kind', async () => {
  const db = fake();
  const notify = transport();
  const res = await sendSlotNotice(db, {
    member: member(), event: EVENT, perfs: [perf('s2')], slotUuid: 's1', kind: SLOT_REMOVED, notify,
  });
  assert.equal(res.ok, true);
  assert.equal(notify.sent[0].type, SLOT_REMOVED);
  assert.equal(notify.sent[0].data.performance_id, null, 'the row is gone, so there is nothing to point at');
  const rec = db.calls.find(c => c.name === 'lineup_members').patch;
  assert.equal(rec.notified_kind, SLOT_REMOVED);
  assert.equal(rec.notified_slot_uuid, 's1');
});

/* ── what the transport is handed ──────────────────────────────────────────── */

test('⭐ the notification carries the kind as its type and the performance id', async () => {
  const notify = transport();
  await sendSlotNotice(fake(), { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify,
    resolveProfileId: async () => ({ profileId: 'resolved-p' }) });
  const row = notify.sent[0];
  assert.equal(row.type, SLOT_OFFER);
  assert.equal(row.toUserId, 'u-1');
  assert.equal(row.toProfileId, 'resolved-p');
  assert.equal(row.aboutProfileId, 'own-1');
  assert.equal(row.data.performance_id, 'perf-s1');
  assert.equal(row.data.slot_id, 's1');
  assert.equal(row.data.event_id, 'e-1');
});

/* ⚠ Without a resolver it falls back to the member's own profile rather than null,
   so attribution is not lost. */
test('⚠ the recipient profile falls back to the member row', async () => {
  const notify = transport();
  await sendSlotNotice(fake(), { member: member(), event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify });
  assert.equal(notify.sent[0].toProfileId, 'p-1');
});

test('the copy carries no em dashes and survives a missing slot label', () => {
  for (const kind of [SLOT_OFFER, SLOT_CHANGED, SLOT_REMOVED]) {
    const withLabel = messageForKind(kind, 'Bass Heavy', '9:00 PM');
    const without   = messageForKind(kind, 'Bass Heavy');
    for (const m of [withLabel, without]) {
      assert.equal(m.includes('—'), false);
      assert.equal(m.includes('undefined'), false);
      assert.equal(m.includes('null'), false);
    }
  }
});

/* ── ⭐⭐ PER ARTIST, INDEPENDENTLY ─────────────────────────────────────────── */

/**
 * ⛔⛔ ONE FAILURE MUST NOT STOP THE OTHERS, and one success must not mark anybody
 * else notified. This is the property `publishSetTimes` could not have: its single
 * batched insert meant one bad row left every status flipped and nobody told.
 */
test('⛔⛔ one artist failing does not block or contaminate the rest', async () => {
  const db = fake();
  /* ⚠ The transport fails for ONE recipient only. */
  const sent = [];
  const notify = async row => {
    sent.push(row.toUserId);
    return row.toUserId === 'u-2' ? { message: 'that one blew up' } : null;
  };
  const items = ['u-1', 'u-2', 'u-3'].map(uid => ({
    member: member({ id: 'm-' + uid, artist_id: uid }),
    perfs: [perf('s-' + uid)],
    slotUuid: 's-' + uid,
  }));

  const results = await sendSlotNotices(db, items, { event: EVENT, notify });

  assert.deepEqual(sent, ['u-1', 'u-2', 'u-3'], 'it stopped at the failure');
  assert.deepEqual(results.map(r => r.ok), [true, false, true]);
  assert.deepEqual(results.map(r => r.code), ['sent', 'send_failed', 'sent']);
  /* ⛔ Only the two that succeeded were recorded, and each on their own row. */
  const recorded = db.calls.filter(c => c.name === 'lineup_members').map(c => c.where.id);
  assert.deepEqual(recorded, ['m-u-1', 'm-u-3']);
  assert.deepEqual(summariseOutcomes(results), { sent: 2, recorded: 2, refused: 1, sentNotRecorded: 0 });
});

test('⛔ a refusal in the middle is also survivable', async () => {
  const db = fake();
  const results = await sendSlotNotices(db, [
    { member: member({ id: 'm-a' }), perfs: [perf('s-a')], slotUuid: 's-a' },
    { member: member({ id: 'm-b', artist_id: null }), perfs: [perf('s-b')], slotUuid: 's-b' },
    { member: member({ id: 'm-c' }), perfs: [perf('s-c')], slotUuid: 's-c' },
  ], { event: EVENT, notify: transport() });
  assert.deepEqual(results.map(r => r.code), ['sent', 'unreachable', 'sent']);
  assert.deepEqual(summariseOutcomes(results), { sent: 2, recorded: 2, refused: 1, sentNotRecorded: 0 });
});

test('empty input is answered, not thrown on', async () => {
  assert.deepEqual(await sendSlotNotices(fake(), [], { event: EVENT, notify: transport() }), []);
  assert.deepEqual(await sendSlotNotices(fake()), []);
  assert.deepEqual(summariseOutcomes(), { sent: 0, recorded: 0, refused: 0, sentNotRecorded: 0 });
});

/* ── ⛔ THE THINGS IT MUST NEVER TOUCH ─────────────────────────────────────── */

/**
 * ⛔⛔ `publishSetTimes` wrote `applications.status` and `events.config` on every
 * press. Neither belongs to a send: one is a host decision in another domain, the
 * other is an editing lock.
 */
test('⛔⛔ a send never touches applications, events or any other member', async () => {
  const db = fake();
  await sendSlotNotices(db, [
    { member: member({ id: 'm-1' }), perfs: [perf('s1')], slotUuid: 's1' },
    { member: member({ id: 'm-2', artist_id: 'u-2' }), perfs: [perf('s2')], slotUuid: 's2', kind: SLOT_CHANGED },
  ], { event: EVENT, notify: transport() });

  const tables = [...new Set(db.calls.map(c => c.name))].sort();
  assert.deepEqual(tables, ['lineup_members', 'performances']);
  assert.equal(db.calls.some(c => c.name === 'applications'), false);
  assert.equal(db.calls.some(c => c.name === 'events'), false);
  /* ⛔ And no write carries a set-times lock. */
  assert.equal(JSON.stringify(db.calls).includes('set_times_locked'), false);
});

/**
 * ── ⛔⛔ P6.3c-3 · THE REMOVAL FALLBACK IS GATED, AND IS NOT A SECOND SENDER ──
 *
 * ⚠ A SOURCE-TEXT CHECK, so it proves wiring rather than pixels. What it protects
 * is the pair of rules most easily lost in a later edit: the control appears ONLY
 * for `REMOVAL_TO_TELL`, and it goes through THIS module rather than growing a
 * removal implementation of its own.
 *
 * ⛔ Shown for `NEEDS SET TIME` it would announce a booking and cancel it in one
 * message, to somebody who was never told anything.
 */
test('⛔⛔ the removal control is gated on REMOVAL_TO_TELL and routes through sendSlotNotice', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../screens/event/EventHostView.jsx', import.meta.url), 'utf8');

  assert.ok(src.includes('SEND REMOVAL NOTICE'), 'the fallback control is gone');
  assert.ok(/rowNotice\.state === 'REMOVAL_TO_TELL' && \(/.test(src),
    'the control must be gated on REMOVAL_TO_TELL, never on needsSetTime');
  assert.ok(src.includes('askToSendRemoval'), 'the control must go through the confirm step');
  /* ⛔ ONE sender. If a screen ever writes `type: 'slot_removed'` itself, the
     recording contract has been forked. */
  assert.equal(/type:\s*'slot_removed'/.test(src), false,
    'EventHostView composes its own removal notification instead of using sendSlotNotice');
  assert.ok(src.includes('sendSlotNotice'), 'the screen must use the one sender');
});

/* ── the record is what the derivation then reads ──────────────────────────── */

/**
 * ⭐⭐ END TO END, THROUGH THE PURE DERIVATION. What the sender writes must make
 * `notifyState` read CLEAN, and a later move must make it TIME_CHANGED. ⛔ If these
 * two modules ever disagree the whole phase is pointless.
 */
test('⭐⭐ what the sender records is what notifyPlan reads', async () => {
  const db = fake();
  const m = member();
  const res = await sendSlotNotice(db, { member: m, event: EVENT, perfs: [perf('s1')], slotUuid: 's1', notify: transport() });

  const after = { ...m, ...db.calls.find(c => c.name === 'lineup_members').patch };
  assert.equal(res.recorded, true);
  assert.equal(notifyState(after, [perf('s1', { status: 'offered' })], EVENT).state, CLEAN);
  /* ⚠ Moved afterwards: the placement no longer matches what was communicated. */
  assert.equal(notifyState(after, [perf('s9', { status: 'offered' })], EVENT).state, TIME_CHANGED);
});
