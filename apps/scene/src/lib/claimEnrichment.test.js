import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachNotifyState } from './claimEnrichment.js';


/* ── ⭐ P6.2 · attachNotifyState ────────────────────────────────────────────── */

const LEG = { id: 'e-1', booking_model: 'legacy' };
const bookedMember = (over = {}) => ({ id: 'm-1', status: 'on_bill', artist_id: 'u-1', notified_at: null, notified_slot_uuid: null, ...over });

test('⭐ P6.2 · every claim gets a notify state, from the member row the loader read', () => {
  const claims = [{ id: 'p-1', member_id: 'm-1', slot_id: 's-1' }];
  attachNotifyState(claims, {
    members: [bookedMember()],
    perfsByMember: { 'm-1': [{ id: 'p-1', status: 'draft', slot_uuid: 's-1' }] },
    event: LEG,
  });
  assert.equal(claims[0].notify.state, 'NOT_SENT');
  assert.equal(claims[0].notify.needsNotice, true);
  assert.equal(claims[0].notify.label, 'SET TIME NOT SENT');
});

/**
 * ⚠⚠ ALL THEIR PLACEMENTS, ⛔ not just this slot's. Judging from one row would
 * call a two-slot act settled on the strength of half their bookings.
 */
test('⚠ a member holding two slots is judged on both, not on the claim in hand', () => {
  const claims = [{ id: 'p-1', member_id: 'm-1', slot_id: 's-1' }];
  attachNotifyState(claims, {
    members: [bookedMember({ notified_at: '2026-08-17T11:00:00.000Z', notified_slot_uuid: 's-1' })],
    perfsByMember: { 'm-1': [{ slot_uuid: 's-1' }, { slot_uuid: 's-2' }] },
    event: LEG,
  });
  assert.equal(claims[0].notify.state, 'TIME_CHANGED',
    'reading only this slot would have reported CLEAN');
});

/* ⚠ THE KIND IS REQUIRED for a claim to read clean since 2026-08-18: matching
   slots are not enough, because "we told them they were REMOVED from s-1" also
   matches s-1. */
test('a notified, unmoved claim carries no outstanding notice', () => {
  const claims = [{ id: 'p-1', member_id: 'm-1', slot_id: 's-1' }];
  attachNotifyState(claims, {
    members: [bookedMember({ notified_at: '2026-08-17T11:00:00.000Z', notified_slot_uuid: 's-1', notified_kind: 'slot_offer' })],
    perfsByMember: { 'm-1': [{ slot_uuid: 's-1' }] },
    event: LEG,
  });
  assert.equal(claims[0].notify.needsNotice, false);
});

/* ⛔ A claim whose member the loader did not return must not throw, and must not
   invite a notice about a booking nobody can see. */
test('⛔ an unresolvable member is answered, not thrown on', () => {
  const claims = [{ id: 'p-9', member_id: 'm-gone', slot_id: 's-1' }];
  attachNotifyState(claims, { members: [], perfsByMember: {}, event: LEG });
  assert.equal(claims[0].notify.state, 'NOTHING_TO_SAY');
  assert.equal(claims[0].notify.needsNotice, false);
  assert.deepEqual(attachNotifyState(), []);
});
