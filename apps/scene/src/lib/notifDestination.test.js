import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notifDestination, isNavigable } from './notifDestination.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

test('an event notice opens its event', () => {
  assert.equal(
    notifDestination({ type: 'slot_offer', data: { event_id: 'e1', performance_id: 'p1' } }),
    '/event/e1');
  assert.equal(
    notifDestination({ type: 'slot_removed', data: { event_id: 'e2' } }),
    '/event/e2');
});

/**
 * ⭐ A new application is WORK, and the event page has nowhere to do it.
 */
test('a new application opens the applications queue, not the event page', () => {
  assert.equal(
    notifDestination({ type: 'new_application', data: { event_id: 'e1' } }),
    '/event/e1/applications');
});

/**
 * ⚠ The subject is the COLUMN. ⛔ `to_profile_id` is which of the reader's own
 * profiles the row is for — routing there sends somebody to their own page.
 */
test('a follow opens the follower, from about_profile_id', () => {
  const notif = {
    type: 'new_follower',
    about_profile_id: 'them',
    to_profile_id: 'me',
    data: { follower_id: 'u-1' },
  };
  assert.equal(notifDestination(notif), '/profile/them');
});

/**
 * ⛔⛔ THE POINT OF THE WHOLE MODULE. A type that usually leads somewhere can
 * arrive without the key — a legacy row, a writer that predates it — and a link
 * built on the type alone lands on `/event/undefined`.
 */
test('⛔⛔ a row that names no event is NOT navigable', () => {
  for (const notif of [
    { type: 'slot_offer', data: {} },
    { type: 'slot_offer' },
    { type: 'new_application', data: {} },
    { type: 'event_reminder', data: { event_name: 'Bass Heavy' } },
  ]) {
    assert.equal(notifDestination(notif), null, `${JSON.stringify(notif)} produced a destination`);
    assert.equal(isNavigable(notif), false);
  }
  assert.equal(String(notifDestination({ type: 'slot_offer', data: {} })).includes('undefined'), false);
});

/**
 * ⚠ `about_profile_id` is nullable BY DESIGN under U4 — the system refuses to
 * guess which of several owned profiles acted. ⛔ A correct answer, so it must
 * yield no link rather than a wrong one.
 */
test('a follow with no resolved subject is not navigable', () => {
  assert.equal(notifDestination({ type: 'new_follower', about_profile_id: null, to_profile_id: 'me' }), null);
});

test('types with nowhere to go stay inert', () => {
  for (const type of ['generic', 'payment_requested', 'payment_received', 'festival_opened', 'festival_accepted', 'festival_declined']) {
    assert.equal(notifDestination({ type, data: { event_id: 'e1' } }), null,
      `${type} must not invent a destination`);
  }
});

test('an unknown type is inert rather than guessed at', () => {
  assert.equal(notifDestination({ type: 'something_new', data: { event_id: 'e1' } }), null);
  assert.equal(notifDestination(null), null);
});

/**
 * ⛔ CONVERSATION TYPES NEVER REACH EITHER SURFACE — DEF-3 sends conversation
 * activity to the MESSAGES badge, CJ2 keeps `in_app` out of the bell. A
 * destination for them would be dead code implying the row can appear.
 */
test('⛔ no destination is defined for conversation types', () => {
  assert.equal(notifDestination({ type: 'new_message', data: { conversation_id: 'c1' } }), null);
  const src = readFileSync(join(SRC, 'lib/notifDestination.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/conversation_id/.test(src), false, 'it routes a type that cannot appear');
});

/**
 * ⭐ Every type the app can DISPLAY is accounted for — either it leads
 * somewhere or it is deliberately inert. ⛔ Adding a type to notifMeta without
 * deciding which is what this test exists to catch.
 */
test('⭐ every displayable notification type has a decision recorded', () => {
  const meta = readFileSync(join(SRC, 'lib/notifMeta.jsx'), 'utf8');
  const types = [...meta.matchAll(/^\s{2}([a-z_]+):\s*\{\s*label:/gm)].map(m => m[1]);
  assert.ok(types.length > 20, `expected the full type list, read ${types.length}`);

  const dest = readFileSync(join(SRC, 'lib/notifDestination.js'), 'utf8');
  const routed = new Set([...dest.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));

  /* ⛔ INERT BY DECISION, each for a stated reason: no Scene route (festival),
     nothing to open (payments, generic), or a placeholder label. */
  const INERT = new Set([
    'generic', 'payment_requested', 'payment_received',
    'festival_opened', 'festival_accepted', 'festival_declined',
    'new_message',
  ]);

  const undecided = types.filter(t => !routed.has(t) && !INERT.has(t));
  assert.deepEqual(undecided, [],
    `these types are neither routed nor recorded as inert:\n  ${undecided.join('\n  ')}`);
});
