/**
 * A HOST DECISION NOBODY MADE MUST TELL NOBODY.
 *
 * ⛔⛔ RLS FILTERS AN UPDATE RATHER THAN ERRORING IT, and the applications
 * screen is the one a CO-HOST is most likely to be filtered on. Trusting
 * `error: null` meant a blocked decision still sent the applicant "your
 * application was unsuccessful", still fired APPLICATION_ACCEPTED, and still
 * moved the row into DECLINED locally — while it stayed in NEW for the actual
 * owner. Two hosts, two truths, and an artist told the losing one.
 *
 * The invariant, in both directions:
 *   ZERO ROWS      → ok:false, no notification (and the caller's early return
 *                    makes the analytics call and the local move unreachable)
 *   WRITE SUCCEEDS → the applicant is told, in the vocabulary they were written
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let updateResult;
const writes  = [];
const notices = [];

function builder(table) {
  const filters = {};
  const chain = {
    update(values) { chain._values = values; return chain; },
    eq(col, val)   { filters[col] = val; return chain; },
    select() {
      writes.push({ table, values: chain._values, filters: { ...filters } });
      return Promise.resolve(updateResult);
    },
  };
  return chain;
}

mock.module('./supabase', { exports: { supabase: { from: table => builder(table) } } });
mock.module('./writeNotification', {
  exports: { writeNotification: async opts => { notices.push(opts); } },
});
mock.module('./actingProfile', {
  exports: { resolvePerformerProfileId: async () => ({ profileId: 'artist-profile-1' }) },
});

const { respondToApplication } = await import('./respondToApplication.js');

const CTX = {
  artistId: 'artist-user-1',
  eventId: 'ev-1',
  eventName: 'Friday Night',
  eventOwnerProfileId: 'host-profile-1',
};

beforeEach(() => {
  writes.length = 0;
  notices.length = 0;
  updateResult = { data: [{ id: 'app-1' }], error: null };
});

test('⛔⛔ RLS REFUSAL: zero rows back tells NOBODY and reports failure', async () => {
  updateResult = { data: [], error: null };
  const res = await respondToApplication('app-1', 'declined', CTX);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'refused');
  assert.deepEqual(notices, [], 'no "your application was unsuccessful" on a write that never landed');
  assert.equal(writes.length, 1, 'the write was attempted and changed nothing');
});

test('⛔ a hard error is a refusal too', async () => {
  updateResult = { data: null, error: { message: 'boom' } };
  const res = await respondToApplication('app-1', 'accepted', CTX);
  assert.equal(res.ok, false);
  assert.deepEqual(notices, []);
});

test('⛔⛔ a REFUSED ACCEPT tells nobody — the analytics case', async () => {
  /* ⭐ `track(APPLICATION_ACCEPTED)` lives in the caller, AFTER an early return
     on `ok === false`. So proving the refusal here proves the analytics event
     is unreachable: there is no path from a refused write to a tracked accept.
     `applicationsRespondGuard.test.js` pins that ordering in the screen. */
  updateResult = { data: [], error: null };
  const res = await respondToApplication('app-1', 'accepted', CTX);
  assert.equal(res.ok, false);
  assert.deepEqual(notices, []);
});

test('⭐ a successful decision notifies the applicant', async () => {
  const res = await respondToApplication('app-1', 'declined', CTX);
  assert.equal(res.ok, true);
  assert.equal(res.notified, true);
  assert.equal(writes[0].table, 'applications');
  assert.deepEqual(writes[0].values, { status: 'declined' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'application_declined');
  assert.match(notices[0].message, /unsuccessful for Friday Night/);
  // §A7 · about = the event's owner, whose decision this is.
  assert.equal(notices[0].aboutProfileId, 'host-profile-1');
  assert.equal(notices[0].toProfileId, 'artist-profile-1');
});

test('⚠ the notice is keyed on the NORMALISED bucket, not the raw word', async () => {
  /* ⛔ Keyed on the raw value this map missed every decline: `declined` is what
     gets written and `rejected` is what the old map listened for, so the
     applicant was never told at all. */
  const cases = [
    ['shortlisted', 'shortlisted'],
    ['tentative',   'shortlisted'],   // the older vocabulary, same bucket
    ['declined',    'application_declined'],
    ['rejected',    'application_declined'],
    ['accepted',    'booking_confirmed'],
    ['booked',      'booking_confirmed'],
  ];
  /* ⚠ SEQUENTIAL, deliberately. These share one `notices` array, and running
     them through Promise.all lets each case read whatever another one just
     pushed — the assertion then measures the interleaving, not the mapping. */
  for (const [status, type] of cases) {
    notices.length = 0;
    await respondToApplication('app-1', status, CTX);
    assert.equal(notices[0]?.type, type, `${status} should notify as ${type}`);
  }
});

test('⚠ a status with no notice writes the row and says so', async () => {
  const res = await respondToApplication('app-1', 'seen', CTX);
  assert.equal(res.ok, true);
  assert.equal(res.notified, false, 'marking something seen is not news');
  assert.equal(writes.length, 1, 'but the status was still written');
});

test('⚠ an application with no artist is written, not notified', async () => {
  const res = await respondToApplication('app-1', 'declined', { ...CTX, artistId: null });
  assert.equal(res.ok, true);
  assert.equal(res.notified, false);
  assert.deepEqual(notices, []);
});

test('⛔ a missing id writes nothing', async () => {
  const res = await respondToApplication(null, 'declined', CTX);
  assert.equal(res.ok, false);
  assert.deepEqual(writes, []);
});
