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

/* ── ⭐⭐ THE NAME ON A CARD FOLLOWS THE PROFILE ─────────────────────────────
   ⚠⚠ WRITTEN FOR A REAL REPORT (owner, 2026-08-28): a profile renamed in Studio
   "changed everywhere but the set times". The card drew the NEW picture beside
   the OLD name, because the picture is lifted from the profiles row and the
   name came from `lineup_members.artist_name`, frozen at booking.

   `name` was also missing from CLAIM_PROFILE_COLUMNS, so the row that could
   have answered was never asked for it — the exact failure that column list's
   own header warns about. */

function fakeDb(rows) {
  return {
    from() {
      return {
        select() { return this; },
        in(col, vals) {
          return Promise.resolve({
            data: rows.filter(r => vals.includes(r[col === 'id' ? 'id' : 'user_id'])),
          });
        },
      };
    },
  };
}

test('⛔ the profile name replaces the booking snapshot on a linked act', async () => {
  const { enrichClaims, CLAIM_PROFILE_COLUMNS } = await import('./claimEnrichment.js');

  assert.match(CLAIM_PROFILE_COLUMNS, /\bname\b/,
    'A column that is never selected cannot fix anything — this is why the bug survived.');

  const claims = [{ profile_id: 'p1', name: 'Riftwalker' }];
  await enrichClaims(fakeDb([{ id: 'p1', name: 'Riftwalkrr', user_id: null }]), claims);

  assert.equal(claims[0].name, 'Riftwalkrr',
    'Renaming a profile must reach the set-times card, like the picture already did.');
});

test('⛔ a hand-entered act with no profile keeps the name somebody typed', async () => {
  const { enrichClaims } = await import('./claimEnrichment.js');
  // A workshop act: artist_id and artist_profile_id both null. The typed name
  // is all there is, and nothing may overwrite it.
  const claims = [{ profile_id: null, user_id: null, name: 'Yoga w/ Crystal Rose' }];
  await enrichClaims(fakeDb([]), claims);
  assert.equal(claims[0].name, 'Yoga w/ Crystal Rose');
});

test('⚠ the booking snapshot is still recoverable, not destroyed', async () => {
  const { enrichClaims } = await import('./claimEnrichment.js');
  const claims = [{ profile_id: 'p1', name: 'Riftwalker', member: { artist_name: 'Riftwalker' } }];
  await enrichClaims(fakeDb([{ id: 'p1', name: 'Riftwalkrr', user_id: null }]), claims);
  assert.equal(claims[0].member.artist_name, 'Riftwalker',
    'What the act was BILLED as on the night is a real fact — the lift must not erase it.');
});
