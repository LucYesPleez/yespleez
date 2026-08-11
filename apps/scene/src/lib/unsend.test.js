/**
 * UNSEND — who may withdraw what, and for how long.
 *
 * ⚠ THESE TEST THE OFFER, NOT THE RULE. Enforcement is U1's RLS policy and
 * trigger; this file only checks that the app offers the action exactly when
 * the server would honour it. A test here passing proves the menu is honest,
 * never that the database is safe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNSEND_WINDOW_MS, canUnsend, isUnsent, unsendMsRemaining, unsendRemainingLabel,
} from './unsend.js';

const ME = 'user-me';
const THEM = 'user-them';
const NOW = Date.parse('2026-08-11T12:00:00Z');

const msg = (over = {}) => ({
  id: 'm1',
  from_user_id: ME,
  created_at: new Date(NOW - 60_000).toISOString(),   // a minute old
  deleted_at: null,
  ...over,
});

test('the sender may withdraw their own recent message', () => {
  assert.equal(canUnsend(msg(), ME, NOW), true);
});

test('⛔ nobody may withdraw someone else\'s message', () => {
  assert.equal(canUnsend(msg({ from_user_id: THEM }), ME, NOW), false,
    'Offering this would put a button on screen that the server refuses — and ' +
    'imply a power over another person\'s words that nobody has.');
});

test('the window closes, and closes exactly on time', () => {
  const justInside = msg({ created_at: new Date(NOW - UNSEND_WINDOW_MS + 1000).toISOString() });
  const justOutside = msg({ created_at: new Date(NOW - UNSEND_WINDOW_MS - 1000).toISOString() });
  assert.equal(canUnsend(justInside, ME, NOW), true);
  assert.equal(canUnsend(justOutside, ME, NOW), false);
});

test('⚠ the client window MATCHES the policy\'s 15 minutes', () => {
  // If this fails, the two have drifted and one of them is lying to the user:
  // either a button appears that the server refuses, or one is hidden that
  // would have worked. The interval lives in U1; this is its mirror.
  assert.equal(UNSEND_WINDOW_MS, 15 * 60 * 1000);
});

test('a message already withdrawn offers nothing further', () => {
  const gone = msg({ deleted_at: new Date(NOW - 1000).toISOString() });
  assert.equal(isUnsent(gone), true);
  assert.equal(canUnsend(gone, ME, NOW), false,
    'The trigger refuses a second withdrawal, so offering one is a dead button.');
});

test('⛔ a message that never left the outbox is not "unsent"', () => {
  // It reached nobody, so there is nothing to withdraw. Deleting a failed send
  // is a different act with a different affordance, and conflating them would
  // fire a server call for a row that does not exist.
  assert.equal(canUnsend(msg({ pending: true }), ME, NOW), false);
  assert.equal(canUnsend(msg({ failed: true }), ME, NOW), false);
});

test('the remaining time is shown, and counts down', () => {
  assert.equal(unsendRemainingLabel(msg(), NOW), '14 min left');
  const nearlyGone = msg({ created_at: new Date(NOW - UNSEND_WINDOW_MS + 8000).toISOString() });
  assert.equal(unsendRemainingLabel(nearlyGone, NOW), '8s left',
    'Under a minute it counts seconds — "0 min left" beside a live button ' +
    'reads as broken.');
  assert.equal(unsendRemainingLabel(msg({ created_at: new Date(NOW - UNSEND_WINDOW_MS - 1).toISOString() }), NOW), '');
});

test('⚠ an unparseable or missing timestamp refuses, it does not throw', () => {
  // Defensive: a row arriving without created_at must not take the whole
  // action sheet down with it. Refusing is the safe direction — the worst case
  // is an action that is absent, not one that misfires.
  assert.equal(unsendMsRemaining({ created_at: 'not-a-date' }, NOW), 0);
  assert.equal(unsendMsRemaining({}, NOW), 0);
  assert.equal(canUnsend({ from_user_id: ME }, ME, NOW), false);
});
