import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptFor, litBars, RECEIPT } from './receiptState.js';

const T0 = '2026-07-22T10:00:00.000Z';
const T1 = '2026-07-22T10:00:05.000Z';

/* ── who gets a receipt at all ─────────────────────────────────────── */

test('⚠ a received message NEVER gets a receipt', () => {
  // Drawing one would report your own reading back to you — and on a shared
  // profile, your colleague's. That exposure is the whole reason §2.5 refused
  // receipts, and it survives the amendment.
  assert.equal(receiptFor({ isMine: false, createdAt: T0, seenWatermark: T1 }), null);
  assert.equal(receiptFor({ isMine: false, pendingState: RECEIPT.WAITING }), null);
  assert.equal(receiptFor({ isMine: false }), null);
});

test('a sent message always gets one', () => {
  assert.notEqual(receiptFor({ isMine: true, createdAt: T0 }), null);
});

/* ── the ladder ────────────────────────────────────────────────────── */

test('in flight is waiting', () => {
  assert.equal(receiptFor({ isMine: true, pendingState: RECEIPT.WAITING }), RECEIPT.WAITING);
});

test('acknowledged but unread is sent', () => {
  assert.equal(receiptFor({ isMine: true, createdAt: T0 }), RECEIPT.SENT);
  assert.equal(receiptFor({ isMine: true, createdAt: T0, seenWatermark: null }), RECEIPT.SENT);
});

test('a watermark past the message is seen', () => {
  assert.equal(receiptFor({ isMine: true, createdAt: T0, seenWatermark: T1 }), RECEIPT.SEEN);
});

test('a watermark BEFORE the message is still only sent', () => {
  // They read the thread, then you sent this. It has not been seen.
  assert.equal(receiptFor({ isMine: true, createdAt: T1, seenWatermark: T0 }), RECEIPT.SENT);
});

test('a watermark EQUAL to the message counts as seen', () => {
  // They were already looking when it landed. With a strict `<` this message
  // would sit on `sent` forever — nothing later moves the watermark back onto it.
  assert.equal(receiptFor({ isMine: true, createdAt: T0, seenWatermark: T0 }), RECEIPT.SEEN);
});

test('failure outranks everything', () => {
  assert.equal(
    receiptFor({ isMine: true, createdAt: T0, seenWatermark: T1, pendingState: RECEIPT.FAILED }),
    RECEIPT.FAILED,
  );
});

test('waiting outranks a stale watermark', () => {
  // No server timestamp exists yet, so there is nothing honest to compare.
  assert.equal(
    receiptFor({ isMine: true, seenWatermark: T1, pendingState: RECEIPT.WAITING }),
    RECEIPT.WAITING,
  );
});

/* ── malformed input must never invent a receipt ───────────────────── */

test('an unparseable timestamp falls back to sent, never to seen', () => {
  // Claiming "seen" on bad data tells the sender something untrue about another
  // person. Under-claiming is recoverable; over-claiming is not.
  for (const bad of ['not-a-date', '', null, undefined]) {
    assert.equal(receiptFor({ isMine: true, createdAt: bad, seenWatermark: T1 }), RECEIPT.SENT, String(bad));
    assert.equal(receiptFor({ isMine: true, createdAt: T0, seenWatermark: bad }), RECEIPT.SENT, String(bad));
  }
});

test('no arguments does not throw', () => {
  assert.equal(receiptFor(), null);
  assert.equal(receiptFor({}), null);
});

/* ── bars ──────────────────────────────────────────────────────────── */

test('the ladder lights 0 → 1 → 3 bars', () => {
  assert.equal(litBars(RECEIPT.WAITING), 0);
  assert.equal(litBars(RECEIPT.SENT), 1);
  assert.equal(litBars(RECEIPT.SEEN), 3);
});

test('failed lights nothing — colour carries it, not height', () => {
  // A failed send that lit bars would read as progress.
  assert.equal(litBars(RECEIPT.FAILED), 0);
});

/* ── delivered, real as of M10b ─────────────────────────────────────── */

test('a delivery watermark past the message is delivered', () => {
  assert.equal(
    receiptFor({ isMine: true, createdAt: T0, deliveredWatermark: T1 }),
    RECEIPT.DELIVERED,
  );
  assert.equal(litBars(RECEIPT.DELIVERED), 2);
});

test('⚠ delivered requires an ACK — a stored message alone is only sent', () => {
  // The whole point of M10b. Without an acknowledgement from the recipient's
  // client there is no watermark, and the sender must stay on one bar however
  // long the row has been sitting in the database.
  assert.equal(receiptFor({ isMine: true, createdAt: T0 }), RECEIPT.SENT);
  assert.equal(receiptFor({ isMine: true, createdAt: T0, deliveredWatermark: null }), RECEIPT.SENT);
});

test('a delivery watermark BEFORE the message is still only sent', () => {
  // They were online earlier, then went offline, then you sent this.
  assert.equal(
    receiptFor({ isMine: true, createdAt: T1, deliveredWatermark: T0 }),
    RECEIPT.SENT,
  );
});

test('read outranks delivered', () => {
  assert.equal(
    receiptFor({ isMine: true, createdAt: T0, deliveredWatermark: T1, seenWatermark: T1 }),
    RECEIPT.SEEN,
  );
});

test('read implies delivered even if the delivery ack never arrived', () => {
  // A lost broadcast or an ack that failed must not strand a message that has
  // demonstrably been READ on a lower rung — you cannot read what you have not
  // received, and the ladder must never contradict itself.
  assert.equal(
    receiptFor({ isMine: true, createdAt: T0, deliveredWatermark: null, seenWatermark: T1 }),
    RECEIPT.SEEN,
  );
});

test('an unparseable delivery watermark falls back to sent', () => {
  for (const bad of ['not-a-date', '']) {
    assert.equal(receiptFor({ isMine: true, createdAt: T0, deliveredWatermark: bad }), RECEIPT.SENT, String(bad));
  }
});

test('the ladder is ordered: sent < delivered < read', () => {
  assert.ok(litBars(RECEIPT.SENT) < litBars(RECEIPT.DELIVERED));
  assert.ok(litBars(RECEIPT.DELIVERED) < litBars(RECEIPT.SEEN));
});

test('an unknown state lights nothing rather than throwing', () => {
  assert.equal(litBars('something-new'), 0);
  assert.equal(litBars(undefined), 0);
});
