import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isEventManager, manageableEvents } from './eventOwnership.js';

/**
 * THE 82 EVENTS NOBODY COULD MANAGE.
 *
 * Fixtures are real rows as measured on 2026-08-15. `Creatures of the Swamp` is
 * the concrete case: a live event with a bill, owned by a CLAIMED profile
 * (The Federal Hotel), and a NULL `host_id`. The shipped gate returned false
 * for its owner and served them the punter's page.
 */

const creaturesOfTheSwamp = { id: 'ev-1', host_id: null, owner_profile_id: 'p-federal' };
const bassHeavy           = { id: 'ev-2', host_id: 'u-owner', owner_profile_id: 'p-host' };
const importerCatalogue   = { id: 'ev-3', host_id: null, owner_profile_id: null };

test('⚠⚠ the owner of a NULL-host_id event manages it', () => {
  assert.equal(
    isEventManager(creaturesOfTheSwamp, { userId: 'u-fed', ownedProfileIds: ['p-federal'] }),
    true,
    'the regression: this returned false and hid the whole management UI',
  );
});

test('the legacy host_id route still works', () => {
  assert.equal(isEventManager(bassHeavy, { userId: 'u-owner', ownedProfileIds: [] }), true);
});

test('a stranger manages nothing', () => {
  assert.equal(isEventManager(creaturesOfTheSwamp, { userId: 'u-other', ownedProfileIds: ['p-else'] }), false);
  assert.equal(isEventManager(bassHeavy, { userId: 'u-other', ownedProfileIds: [] }), false);
});

/**
 * ⛔ THE ONE THAT WOULD BE CATASTROPHIC.
 *
 * 34 events have BOTH columns NULL. Without the `event.host_id &&` guard,
 * `null === null` makes every signed-out visitor their manager.
 */
test('⛔ a NULL host_id never matches a NULL user', () => {
  assert.equal(isEventManager(importerCatalogue, { userId: null,      ownedProfileIds: [] }), false);
  assert.equal(isEventManager(importerCatalogue, { userId: undefined, ownedProfileIds: [] }), false);
  assert.equal(isEventManager(importerCatalogue, { userId: 'u-any',   ownedProfileIds: [] }), false);
  // And the inverse: owning some other profile must not admit you.
  assert.equal(isEventManager(importerCatalogue, { userId: 'u-any', ownedProfileIds: ['p-federal'] }), false);
});

test('no session, no management, whatever is owned', () => {
  assert.equal(isEventManager(creaturesOfTheSwamp, { userId: null, ownedProfileIds: ['p-federal'] }), false);
});

test('missing or malformed input is not a manager', () => {
  assert.equal(isEventManager(null, { userId: 'u-1', ownedProfileIds: ['p-1'] }), false);
  assert.equal(isEventManager(creaturesOfTheSwamp), false);
});

test('the dashboard and the event page ask the same question', () => {
  const owned = { userId: 'u-fed', ownedProfileIds: ['p-federal'] };
  const mine = manageableEvents([creaturesOfTheSwamp, bassHeavy, importerCatalogue], owned);
  assert.deepEqual(mine.map(e => e.id), ['ev-1']);
  // ⭐ The guarantee, not the implementation: whatever the list says, the
  // per-event gate must agree with it, or an event appears in your LINEUP and
  // then refuses to open.
  mine.forEach(e => assert.equal(isEventManager(e, owned), true));
});
