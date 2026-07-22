import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makePending, appendPending, settlePending, failPending, dropPending,
  isPending, PENDING_PREFIX,
} from './pendingSend.js';
import { receiptFor, RECEIPT } from './receiptState.js';

const T0 = '2026-07-22T10:00:00.000Z';
const sent = (id, extra = {}) => ({ id, body: 'hi', created_at: T0, ...extra });

/* ── the placeholder ───────────────────────────────────────────────── */

test('a pending message is identifiable from its id alone', () => {
  const p = makePending({ body: 'hi', fromProfileId: 'prof-1' });
  assert.ok(p.id.startsWith(PENDING_PREFIX));
  assert.equal(isPending(p), true);
  assert.equal(isPending(sent('real-id')), false);
});

test('two pending messages never collide', () => {
  const a = makePending({ body: 'hi' });
  const b = makePending({ body: 'hi' });
  assert.notEqual(a.id, b.id);
});

test('a pending message carries a timestamp, so the bubble draws its receipt', () => {
  // The timestamp-and-receipt row only renders when created_at is present. A
  // pending message without one would be the single message in the thread
  // missing the exact glyph the sender needs to watch.
  const p = makePending({ body: 'hi', now: T0 });
  assert.equal(p.created_at, T0);
  assert.equal(receiptFor({ isMine: true, createdAt: p.created_at, pendingState: p.pendingState }), RECEIPT.WAITING);
});

test('retry is stored as data, never as a closure', () => {
  // A closure would capture the acting profile at first attempt, so a retry
  // after switching identity would send as the wrong profile — silently.
  const p = makePending({ body: 'hi', retry: { type: 'text', body: 'hi' } });
  assert.equal(typeof p.retry, 'object');
  assert.deepEqual(p.retry, { type: 'text', body: 'hi' });
});

/* ── settling ──────────────────────────────────────────────────────── */

test('settling swaps the placeholder for the real row, in place', () => {
  const p = makePending({ body: 'hi' });
  const list = appendPending([sent('a')], p);
  const out = settlePending(list, p.id, sent('b'));
  assert.deepEqual(out.map(m => m.id), ['a', 'b']);
});

test('⚠ settling does not duplicate when realtime echoed the row back first', () => {
  // The sender receives their own insert over realtime, and nothing orders that
  // echo against the insert's own response. When the echo wins, the row is
  // already in the list — appending would show the message twice. The existing
  // realtime dedupe cannot catch this: at echo time the list holds only a
  // `pending:` id it has never seen.
  const p = makePending({ body: 'hi' });
  const echoed = sent('b');
  const list = [...appendPending([sent('a')], p), echoed];   // echo arrived early
  const out = settlePending(list, p.id, sent('b'));
  assert.deepEqual(out.map(m => m.id), ['a', 'b']);
  assert.equal(out.filter(m => m.id === 'b').length, 1);
});

test('settling an id that is not there still lands the row exactly once', () => {
  const out = settlePending([sent('a')], 'pending:gone', sent('b'));
  assert.deepEqual(out.map(m => m.id), ['a', 'b']);
});

/* ── failing ───────────────────────────────────────────────────────── */

test('⚠ a failed send KEEPS the message and moves it to the failed rung', () => {
  // Removing it is what the old path effectively did, and is why a lost send
  // was invisible: your own words vanishing looks identical to them having been
  // delivered and scrolled past.
  const p = makePending({ body: 'the booking enquiry' });
  const list = appendPending([], p);
  const out = failPending(list, p.id, 'offline');

  assert.equal(out.length, 1);
  assert.equal(out[0].body, 'the booking enquiry');
  assert.equal(out[0].pendingState, RECEIPT.FAILED);
  assert.equal(receiptFor({ isMine: true, createdAt: out[0].created_at, pendingState: out[0].pendingState }), RECEIPT.FAILED);
});

test('failing one pending send leaves the others alone', () => {
  const a = makePending({ body: 'a' });
  const b = makePending({ body: 'b' });
  const out = failPending([a, b], a.id);
  assert.equal(out[0].pendingState, RECEIPT.FAILED);
  assert.equal(out[1].pendingState, RECEIPT.WAITING);
});

test('a failed message outranks the watermarks', () => {
  // It has a local created_at, so a watermark set after it would otherwise
  // claim the recipient had read a message that never left this device.
  const p = failPending([makePending({ body: 'hi', now: T0 })], undefined)[0];
  const failed = { ...p, pendingState: RECEIPT.FAILED };
  assert.equal(receiptFor({
    isMine: true, createdAt: failed.created_at, pendingState: failed.pendingState,
    seenWatermark: '2026-07-22T11:00:00.000Z',
  }), RECEIPT.FAILED);
});

/* ── dropping ──────────────────────────────────────────────────────── */

test('dropping removes only the named placeholder', () => {
  const a = makePending({ body: 'a' });
  const b = makePending({ body: 'b' });
  const out = dropPending([sent('x'), a, b], a.id);
  assert.deepEqual(out.map(m => m.id), ['x', b.id]);
});
