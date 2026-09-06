/**
 * A REFUSED DECISION WRITES NOTHING AT ALL.
 *
 * ⛔⛔ THE BUG WAS THE ORDER, NOT THE VERIFICATION. `handleOfferRespond` already
 * verified its `venue_enquiries` update with `.select('id')` and already
 * withheld the notification when the update came back empty. But it inserted
 * the `applications` row FIRST — so a refused decision correctly told nobody,
 * correctly left the card alone, and still left a `pending` APPLICATION in the
 * host's pipeline for an acceptance that never happened.
 *
 * The verified write protected everything except the write that had already
 * run. These tests pin the invariant the ordering now gives:
 *
 *   WRITE REFUSED  → no application row, no notification, ok:false
 *   WRITE SUCCEEDS → the application row and the notice may follow
 *
 * ⚠ There is no transaction here and none is invented: PostgREST offers none
 * across two tables and this app has no client-side abstraction for one.
 * Ordering is what makes the guarantee, so ordering is what is tested.
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let enquiryUpdate;      // what the venue_enquiries update returns
let insertResult;       // what the applications insert returns
const writes  = [];     // every table write attempted, in order
const notices = [];     // every notification written

/** A PostgREST-shaped builder that records instead of talking to a server. */
function builder(table) {
  const filters = {};
  const chain = {
    update(values) { chain._op = { op: 'update', values }; return chain; },
    insert(values) { chain._op = { op: 'insert', values }; return chain; },
    eq(col, val)   { filters[col] = val; return chain; },
    /* `.select()` ENDS the chain — it is the awaited result, and it is the
       verification the whole fix rests on. */
    select() {
      writes.push({ table, ...chain._op, filters: { ...filters } });
      if (chain._op.op === 'insert') return Promise.resolve(insertResult);
      return Promise.resolve(enquiryUpdate);
    },
  };
  return chain;
}

mock.module('./supabase', { exports: { supabase: { from: table => builder(table) } } });
mock.module('./writeNotification', {
  exports: {
    writeNotification: async opts => { notices.push(opts); },
    inferToProfileId:  async () => 'venue-profile-1',
  },
});
mock.module('./actingProfile', {
  exports: { resolvePerformerProfileId: async () => ({ profileId: 'legacy-fallback-profile' }) },
});

const { respondToOffer } = await import('./respondToOffer.js');

const OFFER = {
  id: 42,
  event_id: 'ev-1',
  event_name: 'Friday Night',
  venue_user_id: 'venue-user-1',
  applicant_profile_id: 'act-profile-1',
};
const CTX = { actingProfileId: 'act-profile-1', userId: 'act-user-1' };

beforeEach(() => {
  writes.length = 0;
  notices.length = 0;
  enquiryUpdate = { data: [{ id: 42 }], error: null };
  insertResult  = { data: [{ id: 'app-1' }], error: null };
});

const appInserts = () => writes.filter(w => w.table === 'applications');

test('⛔⛔ RLS REFUSAL: zero rows back leaves NO application row behind', () => {
  /* ⚠⚠ THE EXACT SHAPE OF AN RLS REFUSAL: `error` is null and `data` is empty.
     A policy that forbids an UPDATE FILTERS it, it does not error it — which is
     why `error: null` could never be the check. */
  enquiryUpdate = { data: [], error: null };
  return respondToOffer(OFFER, 'accepted', CTX).then(res => {
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'refused');
    assert.deepEqual(appInserts(), [], 'the orphan application must not exist');
    assert.deepEqual(notices, [], 'and nobody may be told');
    assert.equal(writes.length, 1, 'exactly one write was ATTEMPTED, and it changed nothing');
  });
});

test('⛔ a hard error on the update leaves nothing behind either', async () => {
  enquiryUpdate = { data: null, error: { message: 'boom' } };
  const res = await respondToOffer(OFFER, 'accepted', CTX);
  assert.equal(res.ok, false);
  assert.deepEqual(appInserts(), []);
  assert.deepEqual(notices, []);
});

test('⛔⛔ THE ORDER: the enquiry is written BEFORE the application, always', async () => {
  await respondToOffer(OFFER, 'accepted', CTX);
  assert.equal(writes[0].table, 'venue_enquiries',
    'the authoritative row goes first — a consequence may not outlive its cause');
  assert.equal(writes[1].table, 'applications');
});

test('⭐ a successful accept writes both rows and tells the venue', async () => {
  const res = await respondToOffer(OFFER, 'accepted', CTX);
  assert.equal(res.ok, true);
  assert.equal(res.applicationWarning, null);

  const [enq, app] = writes;
  assert.deepEqual(enq.values, { status: 'accepted' });
  /* ⚠ SCOPED TO THE ACTING PROFILE. The scope is what turns an RLS refusal into
     a deliberate no-op rather than an accident. */
  assert.deepEqual(enq.filters, { id: 42, applicant_profile_id: 'act-profile-1' });
  assert.deepEqual(app.values, {
    event_id: 'ev-1', artist_id: 'act-user-1',
    from_profile_id: 'act-profile-1', status: 'pending',
  });

  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'invite_accepted');
  /* §A7 · the notice names the SAME profile the application was attributed to.
     Re-deriving it is how the two come to disagree. */
  assert.equal(notices[0].aboutProfileId, 'act-profile-1');
});

test('⭐ DECLINE writes the status and nothing else', async () => {
  const res = await respondToOffer(OFFER, 'declined', CTX);
  assert.equal(res.ok, true);
  assert.deepEqual(appInserts(), [], 'declining creates no application');
  assert.deepEqual(notices, [], 'and the invite_accepted notice is for accepts only');
  assert.deepEqual(writes[0].values, { status: 'declined' });
});

test('⚠ a DUPLICATE application is not a failure — the row already exists', async () => {
  /* `applications` carries UNIQUE (event_id, artist_id), so an act who had
     already applied to this event collides. The row it collides with is exactly
     the row this wanted to exist. ⛔⛔ AND IT IS NOT AN UPSERT: overwriting
     would reset a status the HOST has since set back to `pending`, destroying
     their decision. */
  insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
  const res = await respondToOffer(OFFER, 'accepted', CTX);
  assert.equal(res.ok, true);
  assert.equal(res.applicationWarning, null, 'already present is the desired end state');
  assert.equal(notices.length, 1, 'the acceptance is real, so the venue is still told');
});

test('⚠ any OTHER insert failure is REPORTED, never swallowed', async () => {
  insertResult = { data: null, error: { code: '42501', message: 'permission denied' } };
  const res = await respondToOffer(OFFER, 'accepted', CTX);
  /* ⭐ The acceptance stands — it is written and true, and un-accepting it
     would be a second wrong answer. But the caller is owed the fact that the
     pipeline entry did not appear, which is the mirror of the orphan case. */
  assert.equal(res.ok, true);
  assert.equal(res.applicationWarning, 'application-not-created');
  assert.equal(notices.length, 1);
});

test('⚠ the insert is VERIFIED too — it ends in .select(), not a bare await', async () => {
  await respondToOffer(OFFER, 'accepted', CTX);
  // The recorder only pushes on `.select()`, so the row being here at all is
  // the proof: a bare `.insert()` would never have been observed.
  assert.equal(appInserts().length, 1);
});

test('⛔ no acting profile means no write at all', async () => {
  const res = await respondToOffer(OFFER, 'accepted', { actingProfileId: null, userId: 'u' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing-identity');
  assert.deepEqual(writes, []);
});

test('⚠ a legacy offer with no applicant_profile_id falls back to the seam', async () => {
  const legacy = { ...OFFER, applicant_profile_id: null };
  await respondToOffer(legacy, 'accepted', CTX);
  assert.equal(appInserts()[0].values.from_profile_id, 'legacy-fallback-profile');
  assert.equal(notices[0].aboutProfileId, 'legacy-fallback-profile',
    'the notice and the application must still name the same profile');
});

test('⚠ an accept on an offer with no event writes no application', async () => {
  await respondToOffer({ ...OFFER, event_id: null }, 'accepted', CTX);
  assert.deepEqual(appInserts(), [], 'there is no event to apply to');
  assert.equal(notices.length, 1, 'but the venue is still told');
});
