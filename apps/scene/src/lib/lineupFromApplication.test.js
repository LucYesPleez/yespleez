import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planAddToBill, addToBill, findExistingMember, pipelineApplications } from './lineupFromApplication.js';

/**
 * THE ARROW THAT DID NOT EXIST.
 *
 * Nothing in the codebase ever created a `lineup_member` from an application:
 * `respondApp` wrote `applications.status` and stopped. A host could accept ten
 * people and the bill stayed empty — which is why the old code faked the link
 * by treating "accepted application" AS the bill.
 *
 * Fixtures are production shapes: `from_profile_id` is NULL on multi-profile
 * applicants (U4 refuses to guess) and every Solstice applicant has one.
 */

const shortlisted = { id: 'a-1', event_id: 'ev-1', artist_id: 'u-1', from_profile_id: 'p-1', artist_name: 'Bwoi', status: 'shortlisted' };
const accepted    = { id: 'a-2', event_id: 'ev-1', artist_id: 'u-2', from_profile_id: 'p-2', artist_name: 'Cosmatik', status: 'accepted' };
const declinedApp = { id: 'a-3', event_id: 'ev-1', artist_id: 'u-3', from_profile_id: 'p-3', artist_name: 'Social capital', status: 'declined' };
const legacyApp   = { id: 'a-4', event_id: 'ev-1', artist_id: 'u-4', from_profile_id: null,  artist_name: 'ESKIMHO', status: 'accepted' };

test('a shortlisted application becomes a bill member', () => {
  const p = planAddToBill(shortlisted, { name: 'Bwoi', sound: 'Breaks', genre_string: 'DNB' }, []);
  assert.equal(p.ok, true);
  assert.equal(p.member.event_id, 'ev-1');
  assert.equal(p.member.status, 'on_bill');
  assert.equal(p.member.artist_name, 'Bwoi');
  assert.equal(p.member.sound, 'Breaks');
});

/**
 * ⭐ M6: the application NAMES the profile. Re-deriving it from the account
 * guesses, and `resolveProfileId` can only ever return an 'artist' - wrong for
 * a band or a comedian.
 */
test('the profile comes from the application, never re-derived', () => {
  assert.equal(planAddToBill(shortlisted, null, []).member.artist_profile_id, 'p-1');
  // ⚠ NULL is a real answer: multi-profile applicants were left unattributed by
  // U4 on purpose. The member is still created, keyed by account.
  const legacy = planAddToBill(legacyApp, null, []);
  assert.equal(legacy.member.artist_profile_id, null);
  assert.equal(legacy.member.artist_id, 'u-4');
});

/**
 * ⭐⭐ Q3, ratified: adding to the bill is PRIVATE. Only the APPLICATION
 * DECISION may speak, and only when it actually changes.
 */
test('shortlisted → on the bill also accepts the application, and says so once', () => {
  const p = planAddToBill(shortlisted, null, []);
  assert.equal(p.statusUpdate, 'accepted', 'putting someone on the bill IS saying yes');
  assert.equal(p.notify, 'accepted');
});

test('⛔ an already-accepted application is not re-stamped, and notifies nobody', () => {
  const p = planAddToBill(accepted, null, []);
  assert.equal(p.ok, true);
  assert.equal(p.statusUpdate, null, 'rewriting a status it already holds would re-notify a days-old decision');
  assert.equal(p.notify, null);
});

/**
 * ⛔ NO PERFORMANCE IS CREATED. Being on the bill is not being given a time —
 * 123 of 152 members hold no performance, which is the normal state.
 */
test('⛔ joining the bill grants no set time', () => {
  const p = planAddToBill(shortlisted, null, []);
  assert.equal('slot_uuid' in p.member, false);
  assert.equal('performance' in p, false);
});

/**
 * ⛔ IDEMPOTENT. `lineup_members` has no uniqueness constraint, so this guard is
 * the only thing between a double-tap and the same act billed twice.
 */
test('⛔ a second press does not bill the same act twice', () => {
  const members = [{ id: 'm-1', artist_profile_id: 'p-1', artist_id: 'u-1' }];
  const p = planAddToBill(shortlisted, null, members);
  assert.equal(p.ok, false);
  assert.match(p.reason, /already on the bill/);
  assert.equal(p.existing.id, 'm-1');
});

test('the existing-member check matches on either key', () => {
  assert.ok(findExistingMember(shortlisted, [{ artist_profile_id: 'p-1' }]), 'by profile');
  assert.ok(findExistingMember(shortlisted, [{ artist_id: 'u-1' }]), 'by account');
  assert.equal(findExistingMember(shortlisted, [{ artist_profile_id: 'p-9', artist_id: 'u-9' }]), null);
  // ⛔ A member with BOTH keys null must not match everybody.
  assert.equal(findExistingMember(shortlisted, [{ artist_profile_id: null, artist_id: null }]), null);
});

test('⛔ a declined application cannot be added to the bill', () => {
  const p = planAddToBill(declinedApp, null, []);
  assert.equal(p.ok, false);
  assert.match(p.reason, /declined/);
});

test('malformed input is refused, not thrown', () => {
  assert.equal(planAddToBill(null, null, []).ok, false);
  assert.equal(planAddToBill({}, null, []).ok, false);
});

/* ── execution ───────────────────────────────────────────────────────────── */

function fakeDb({ failMember = false, failStatus = false } = {}) {
  const calls = [];
  return {
    calls,
    from: name => ({
      insert: row => ({
        select: () => ({
          single: async () => {
            calls.push({ op: 'insert', name, row });
            return failMember
              ? { data: null, error: { message: 'RLS said no' } }
              : { data: { id: 'm-new' }, error: null };
          },
        }),
      }),
      update: fields => ({
        eq: async (col, val) => {
          calls.push({ op: 'update', name, fields, col, val });
          return { error: failStatus ? { message: 'update refused' } : null };
        },
      }),
    }),
  };
}

test('adding writes the member and then the application status', async () => {
  const db = fakeDb();
  const res = await addToBill(db, planAddToBill(shortlisted, null, []));
  assert.equal(res.ok, true);
  assert.equal(res.memberId, 'm-new');
  assert.deepEqual(db.calls.map(c => `${c.op}:${c.name}`), ['insert:lineup_members', 'update:applications']);
  assert.equal(db.calls[1].fields.status, 'accepted');
  assert.equal(db.calls[1].val, 'a-1', 'the status update targets the application the plan came from');
});

test('an already-accepted application writes ONLY the member', async () => {
  const db = fakeDb();
  await addToBill(db, planAddToBill(accepted, null, []));
  assert.deepEqual(db.calls.map(c => c.name), ['lineup_members']);
});

/**
 * ⚠ A REFUSED MEMBER INSERT IS FATAL AND LOUD. Until L1 the host could not
 * write this table on 22 events; an INSERT fails with 42501 rather than
 * silently, and reporting it is what makes a policy regression visible.
 */
test('a refused member insert is reported and writes no status', async () => {
  const db = fakeDb({ failMember: true });
  const res = await addToBill(db, planAddToBill(shortlisted, null, []));
  assert.equal(res.ok, false);
  assert.match(res.error, /RLS said no/);
  assert.equal(db.calls.some(c => c.name === 'applications'), false, 'no status change on a failed add');
});

/**
 * ⚠ A REFUSED STATUS UPDATE IS NOT FATAL. They ARE on the bill - that write
 * succeeded and is the thing the host can see. Rolling it back would remove a
 * membership already on screen.
 */
test('a refused status update still reports the successful add', async () => {
  const db = fakeDb({ failStatus: true });
  const res = await addToBill(db, planAddToBill(shortlisted, null, []));
  assert.equal(res.ok, true);
  assert.equal(res.memberId, 'm-new');
  assert.match(res.error, /On the bill, but/);
});

test('a refused plan touches nothing at all', async () => {
  const db = fakeDb();
  const res = await addToBill(db, planAddToBill(declinedApp, null, []));
  assert.equal(res.ok, false);
  assert.deepEqual(db.calls, []);
});

/**
 * ── ⭐⭐ NOBODY ON THE BILL IS AWAITING A DECISION ───────────────────────────
 *
 * Cosmatik was on the LINEUP of `YesPleez pres` and in its PIPELINE at once.
 * ⛔ This guard is DEFENSIVE and stays even once every write path resolves the
 * request properly: an invariant that only holds while the code is correct is
 * not an invariant.
 */

const undecided = { id: 'a-9', event_id: 'ev-1', artist_id: 'u-9', from_profile_id: 'p-9', artist_name: 'Cosmatik', status: 'seen' };
const onBillRow = { id: 'm-9', artist_profile_id: 'p-9', artist_id: 'u-9', artist_name: 'Cosmatik', status: 'on_bill' };

test('an undecided application with nobody on the bill still shows', () => {
  assert.deepEqual(pipelineApplications([undecided], []).map(a => a.id), ['a-9']);
});

test('⭐⭐ the same person on the bill is no longer awaiting a decision', () => {
  assert.deepEqual(pipelineApplications([undecided], [onBillRow]), []);
});

test('⛔ a SHORTLISTED member is still undecided — pass the bill, not the mixed array', () => {
  // Being considered is not being answered. Hiding this would be the same lie
  // in the other direction.
  const shortlistedMember = { ...onBillRow, status: 'shortlisted' };
  assert.deepEqual(
    pipelineApplications([undecided], [shortlistedMember]).map(a => a.id), ['a-9'],
    'the caller passes on_bill rows; a shortlisted one reaching here must not hide anybody');
});

test('⛔ a decided application never appears, bill or no bill', () => {
  assert.deepEqual(pipelineApplications([accepted, declinedApp], []), []);
});

test('⚠⚠ SCOPED BY EVENT — booked on Friday does not answer for Saturday', () => {
  const otherNight = { ...onBillRow, event_id: 'ev-2' };
  const thisNight  = { ...undecided, event_id: 'ev-1' };
  assert.deepEqual(
    pipelineApplications([thisNight], [otherNight]).map(a => a.id), ['a-9'],
    'a member of another event must never hide this event’s applicant');
});

test('⚠⚠ a member row with no event_id is trusted as caller-scoped', () => {
  // `useEventData` selects the bill with .eq('event_id', id) and so never
  // selects the column. Requiring it would silently disable the guard on the
  // event page, which is the surface it was written for.
  assert.deepEqual(pipelineApplications([undecided], [onBillRow]), []);
});

test('the name key still hides a hand-typed member of the same name', () => {
  const anon = { id: 'a-10', event_id: 'ev-1', artist_id: null, from_profile_id: null, artist_name: 'Cosmatik', status: 'new' };
  const typed = { id: 'm-10', artist_profile_id: null, artist_id: null, artist_name: 'Cosmatik', status: 'on_bill' };
  assert.deepEqual(pipelineApplications([anon], [typed]), []);
});
