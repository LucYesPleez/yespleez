import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTransition, needsUpload, isAbandoned,
  DRAFT, QUEUED, UPLOADING, FAILED, SENT, DRAFT_TTL_MS,
} from './outboxMachine.js';

/* ── TRANSITIONS ─────────────────────────────────────────────────── */

test('the happy path: draft → queued → uploading → sent', () => {
  assert.equal(decideTransition(DRAFT, 'send'), QUEUED);
  assert.equal(decideTransition(QUEUED, 'upload-start'), UPLOADING);
  assert.equal(decideTransition(UPLOADING, 'upload-ok'), SENT);
});

test('an upload failure goes to failed, and retry re-queues it', () => {
  assert.equal(decideTransition(UPLOADING, 'upload-fail'), FAILED);
  assert.equal(decideTransition(FAILED, 'retry'), QUEUED);
});

test('a reconnect flush re-queues a failed entry the same way a manual retry does', () => {
  // The `online` sweep sends 'send' at a failed entry; it must mean "try again",
  // not be ignored, or offline messages would never leave after reconnect.
  assert.equal(decideTransition(FAILED, 'send'), QUEUED);
});

test('delete removes from any live state — the one permitted destructive act', () => {
  for (const s of [DRAFT, QUEUED, UPLOADING, FAILED]) {
    assert.equal(decideTransition(s, 'delete'), 'deleted', s);
  }
});

test('⚠ every unhandled event is INERT, never a silent drop', () => {
  // THE HEART OF RULE 1. A transition nobody designed must leave the entry
  // exactly where it is — returning null ("do nothing"), never removing it. If
  // any of these ever returns SENT or "deleted", a message vanishes on an event
  // no one intended.
  const noops = [
    [DRAFT, 'upload-ok'], [DRAFT, 'retry'], [DRAFT, 'upload-fail'],
    [QUEUED, 'send'], [QUEUED, 'upload-ok'],
    [UPLOADING, 'send'], [UPLOADING, 'retry'],
    [FAILED, 'upload-start'], [FAILED, 'upload-ok'],
  ];
  for (const [s, e] of noops) {
    const r = decideTransition(s, e);
    assert.equal(r, null, `${s} + ${e} must be inert, got ${r}`);
  }
});

test('needsUpload is exactly the flush work list', () => {
  assert.equal(needsUpload(QUEUED), true);
  assert.equal(needsUpload(FAILED), true);
  assert.equal(needsUpload(DRAFT), false);
  assert.equal(needsUpload(UPLOADING), false);
});

/* ── RETENTION ───────────────────────────────────────────────────── */

const NOW = 1_800_000_000_000;

test('a draft older than 30 days is abandoned', () => {
  assert.equal(isAbandoned({ state: DRAFT, updatedAt: NOW - DRAFT_TTL_MS - 1 }, NOW), true);
});

test('a draft touched within 30 days is kept', () => {
  assert.equal(isAbandoned({ state: DRAFT, updatedAt: NOW - 1000 }, NOW), false);
});

test('⚠ a FAILED entry is never abandoned, however old', () => {
  // A failed send is content the user pressed Send on. Ageing it away would
  // discard something they asked to deliver — rule 2. Only drafts age out.
  assert.equal(isAbandoned({ state: FAILED, updatedAt: NOW - DRAFT_TTL_MS * 10 }, NOW), false);
  assert.equal(isAbandoned({ state: QUEUED, updatedAt: 0 }, NOW), false);
});

test('abandonment measures from updatedAt, so auto-save keeps a draft alive', () => {
  // createdAt long ago, updatedAt just now → not abandoned. Continuous auto-save
  // refreshes updatedAt, so an actively edited draft never prunes.
  assert.equal(isAbandoned({ state: DRAFT, createdAt: 0, updatedAt: NOW - 5 }, NOW), false);
});

test('an unmeasurable timestamp is not treated as abandoned', () => {
  assert.equal(isAbandoned({ state: DRAFT, updatedAt: undefined, createdAt: undefined }, NOW), false);
  assert.equal(isAbandoned(null, NOW), false);
});
