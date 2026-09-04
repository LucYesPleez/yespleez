/**
 * PUTTING SOMEBODY ON A BILL RESOLVES WHAT THEY ASKED.
 *
 * The planner is pure, so every rule that matters is testable here: who counts
 * as the same person, which enquiry belongs to which night, and what must never
 * be resolved. The writes and the notification are browser plumbing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOLVED_BY_BOOKING, RESOLVABLE_TABLES, OPEN_REQUEST_STATUSES,
  isOpenRequest, requestSubjectId, enquiryBelongsToEvent, planAnswerRequests, answerOpenRequests,
} from './answerOpenRequests.js';

const COSMATIK = 'prof-cosmatik';
const PROMOTER = 'prof-yespleez';
const VENUE    = 'prof-elbows';

const EVENT = {
  id: 'evt-oct17',
  name: 'YesPleez pres',
  owner_profile_id: PROMOTER,
  venue_profile_id: VENUE,
  config: { date: '2026-10-17' },
};

const MEMBER = { id: 'lm-1', artist_profile_id: COSMATIK, artist_id: 'acct-1' };

const app = (over = {}) => ({
  id: 'app-1', event_id: EVENT.id, from_profile_id: COSMATIK, status: 'seen', ...over,
});
const enq = (over = {}) => ({
  id: 'enq-1', event_id: null, applicant_profile_id: COSMATIK,
  venue_profile_id: PROMOTER, date_requested: '2026-10-17', status: 'pending', ...over,
});

/* ── ⭐⭐ The resolution state is the host's `accepted` ───────────────────── */

test('⭐⭐ the resolution state is `accepted`, and ⛔ NEVER `booked`', () => {
  /* ⚠⚠ AN EARLIER CUT WROTE `booked` AND IT WAS WRONG, for three reasons the
     module header sets out. The one that decides it: `booked` is DERIVED by
     `hostLineup.isBooked`, whose answer on a MANAGED event is
     `performances.status === 'accepted'` — the ARTIST's agreement. Every route
     that calls this fires when the HOST acts, so a stored `booked` would assert
     a booking that `isBooked` reports as false.

     ⛔ `accepted` is the host saying yes, which is exactly what putting
     somebody on the bill is (L4). The artist's agreement stays on
     `performances`, untouched. */
  assert.equal(RESOLVED_BY_BOOKING, 'accepted');
  assert.notEqual(RESOLVED_BY_BOOKING, 'booked', 'a stored `booked` contradicts isBooked on managed events');
});

test('⭐ the state it writes is inside the ratified L4/L5 vocabulary', () => {
  // ⛔ So no migration is needed and L5 cannot reject what this writes.
  const L5_CANONICAL = ['pending', 'seen', 'shortlisted', 'accepted', 'declined', 'cancelled'];
  assert.ok(L5_CANONICAL.includes(RESOLVED_BY_BOOKING));
});

test('⭐ both tables take the state', () => {
  /* `venue_enquiries.status` carries no CHECK at all (only `initiated_by` is
     constrained) and `applications_status_check` has listed `accepted` among
     the canonical six since L4 — so neither needs a migration. */
  assert.deepEqual(RESOLVABLE_TABLES, ['venue_enquiries', 'applications']);
});

/* ── What counts as still waiting ────────────────────────────────────────── */

test('every open spelling in both vocabularies counts as unresolved', () => {
  for (const s of ['pending', 'new', 'seen', 'viewed', 'tentative', 'shortlisted', 'offered']) {
    assert.ok(isOpenRequest({ status: s }), `${s} should be open`);
  }
});

test('⛔ a settled row is never re-resolved', () => {
  for (const s of ['accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled']) {
    assert.equal(isOpenRequest({ status: s }), false, `${s} should be settled`);
    assert.ok(!OPEN_REQUEST_STATUSES.includes(s), `${s} must not be fetched as open`);
  }
});

test('⭐ the state it writes is itself settled, so a second run is a no-op', () => {
  assert.equal(isOpenRequest({ status: RESOLVED_BY_BOOKING }), false);
});

test('a missing status reads as pending, which is open', () => {
  assert.ok(isOpenRequest({}));
});

/* ── ⛔⛔ Identity: the profile, and only the profile ─────────────────────── */

test('⛔⛔ a hand-typed act resolves nothing — no profile, nothing of theirs to resolve', () => {
  const typed = { id: 'lm-2', artist_profile_id: null, artist_id: 'acct-1', artist_name: 'Cosmatik' };
  assert.equal(requestSubjectId(typed), null);
  const plan = planAnswerRequests({
    member: typed, event: EVENT,
    // Same account and the same name — neither may be allowed to match.
    applications: [app({ artist_id: 'acct-1', artist_name: 'Cosmatik' })],
    enquiries: [enq()],
  });
  assert.deepEqual(plan.enquiryIds, []);
  assert.deepEqual(plan.applicationIds, []);
  assert.equal(plan.notify, null);
});

test('⛔ one account, two profiles: booking the DJ never resolves the band', () => {
  // profiles.user_id is shared across an account's profiles, so an account
  // match would resolve a request the band sent.
  const plan = planAnswerRequests({
    member: MEMBER, event: EVENT,
    applications: [app({ id: 'app-band', from_profile_id: 'prof-the-band', artist_id: 'acct-1' })],
    enquiries: [enq({ applicant_profile_id: 'prof-the-band' })],
  });
  assert.deepEqual(plan.applicationIds, []);
  assert.deepEqual(plan.enquiryIds, []);
});

/* ── Applications ────────────────────────────────────────────────────────── */

test('an open application on this event is resolved', () => {
  const plan = planAnswerRequests({ member: MEMBER, event: EVENT, applications: [app()] });
  assert.deepEqual(plan.applicationIds, ['app-1']);
});

test('an application alone is enough to tell them', () => {
  const plan = planAnswerRequests({ member: MEMBER, event: EVENT, applications: [app()] });
  assert.ok(plan.notify, 'something moved, so the person hears about it');
});

test('⛔ an application to a DIFFERENT event is untouched', () => {
  const plan = planAnswerRequests({
    member: MEMBER, event: EVENT, applications: [app({ event_id: 'evt-other' })],
  });
  assert.deepEqual(plan.applicationIds, []);
  assert.equal(plan.notify, null);
});

test('⭐⭐ the applicant’s own ADD TO LINEUP does not announce itself twice', () => {
  // planAddToBill already answered and announced this exact row.
  const plan = planAnswerRequests({
    member: MEMBER, event: EVENT, applications: [app()], skipApplicationId: 'app-1',
  });
  assert.deepEqual(plan.applicationIds, []);
  assert.equal(plan.notify, null);
});

/* ── ⚠⚠ Enquiries, and the three-venues trap ─────────────────────────────── */

test('an enquiry already linked to the event is resolved', () => {
  assert.ok(enquiryBelongsToEvent(enq({ event_id: EVENT.id, date_requested: null }), EVENT));
});

test('⛔ a linked enquiry pointing at another event is not this conversation', () => {
  assert.equal(enquiryBelongsToEvent(enq({ event_id: 'evt-other' }), EVENT), false);
});

test('⛔⛔ THE TRAP — same night, a different place, must NOT be resolved', () => {
  // Three asks out for one Saturday. One promoter booking them must not tell
  // the other two places they were booked.
  const elsewhere = enq({ id: 'enq-other', venue_profile_id: 'prof-somewhere-else' });
  assert.equal(enquiryBelongsToEvent(elsewhere, EVENT), false);
  const plan = planAnswerRequests({ member: MEMBER, event: EVENT, enquiries: [elsewhere] });
  assert.deepEqual(plan.enquiryIds, []);
  assert.equal(plan.notify, null);
});

test('the night plus the promoter matches — an artist asking a promoter', () => {
  assert.ok(enquiryBelongsToEvent(enq({ venue_profile_id: PROMOTER }), EVENT));
});

test('the night plus the venue matches — a venue-run night', () => {
  assert.ok(enquiryBelongsToEvent(enq({ venue_profile_id: VENUE }), EVENT));
});

test('⛔ the right place on the wrong night is a different conversation', () => {
  assert.equal(enquiryBelongsToEvent(enq({ date_requested: '2026-10-18' }), EVENT), false);
});

test('⛔ an event with no date cannot claim an unlinked enquiry', () => {
  const undated = { ...EVENT, config: {} };
  assert.equal(enquiryBelongsToEvent(enq(), undated), false);
});

test('⛔ an enquiry naming no receiving side is never matched by date alone', () => {
  assert.equal(enquiryBelongsToEvent(enq({ venue_profile_id: null }), EVENT), false);
});

/* ── One person, one answer ──────────────────────────────────────────────── */

test('⭐⭐ asked twice, told once', () => {
  const plan = planAnswerRequests({
    member: MEMBER, event: EVENT, applications: [app()], enquiries: [enq()],
  });
  assert.deepEqual(plan.enquiryIds, ['enq-1']);
  assert.deepEqual(plan.applicationIds, ['app-1']);
  assert.ok(plan.notify, 'one notification, not one per row');
  // ⛔ Neither noun, because one message may resolve either or both.
  assert.doesNotMatch(plan.notify.message, /application|enquiry/i);
  assert.match(plan.notify.message, /YesPleez pres/);
});

test('nothing open means nothing written and nobody told', () => {
  const plan = planAnswerRequests({
    member: MEMBER, event: EVENT,
    applications: [app({ status: 'accepted' })], enquiries: [enq({ status: 'declined' })],
  });
  assert.deepEqual(plan.enquiryIds, []);
  assert.deepEqual(plan.applicationIds, []);
  assert.equal(plan.notify, null);
});

test('the notice is addressable even when the profile is unclaimed (N1: held)', () => {
  const unclaimed = { id: 'lm-3', artist_profile_id: COSMATIK, artist_id: null };
  const plan = planAnswerRequests({ member: unclaimed, event: EVENT, enquiries: [enq()] });
  assert.equal(plan.notify.toUserId, null);
  assert.equal(plan.notify.toProfileId, COSMATIK);
});

test('the notice carries a destination the row can open', () => {
  const plan = planAnswerRequests({ member: MEMBER, event: EVENT, enquiries: [enq()] });
  assert.equal(plan.notify.data.event_id, EVENT.id);
});

/* ── The executor: what actually gets written, and who gets told ─────────── */

/**
 * A chainable stand-in for the supabase client. Every filter returns `this`;
 * awaiting it yields the rows seeded for that table. Writes are recorded.
 */
function fakeDb({ applications = [], venue_enquiries = [], failOn = null } = {}) {
  const seeded = { applications, venue_enquiries };
  const writes = [];
  const q = (table) => {
    const self = {
      _op: 'select', _fields: null,
      select() { return self; },
      eq() { return self; },
      in(col, vals) { if (self._op === 'update') self._ids = vals; return self; },
      or() { return self; },
      update(fields) { self._op = 'update'; self._fields = fields; return self; },
      then(resolve) {
        if (self._op === 'update') {
          writes.push({ table, status: self._fields.status, ids: self._ids });
          return resolve(failOn === table ? { error: { message: 'RLS' } } : { error: null });
        }
        return resolve({ data: seeded[table] || [] });
      },
    };
    return self;
  };
  return { from: q, writes };
}

test('⭐⭐ ONE NOTIFICATION FOR THE PERSON even when both tables resolve', async () => {
  const sent = [];
  const db = fakeDb({ applications: [app()], venue_enquiries: [enq()] });
  const res = await answerOpenRequests(db, {
    event: EVENT, member: MEMBER, notify: (n) => { sent.push(n); return null; },
  });
  assert.equal(res.resolved, 2, 'both rows resolved');
  assert.equal(sent.length, 1, '⛔ one person, one message — never one per row');
  assert.deepEqual(db.writes.map(w => w.status), ['accepted', 'accepted']);
});

test('⭐⭐ NO DUPLICATE — a route that already notifies passes notify:null', async () => {
  /* ⛔⛔ THE RULE. `addApplicantToBill` sends its own acceptance notice and
     `doAssign` sends its slot offer, so both pass `notify: null` and this must
     stay silent while STILL resolving the rows. A second "you are on the
     lineup" a moment after either one reads as a second booking. */
  const db = fakeDb({ applications: [app()], venue_enquiries: [enq()] });
  const res = await answerOpenRequests(db, { event: EVENT, member: MEMBER, notify: null });
  assert.equal(res.resolved, 2, 'still resolved');
  assert.equal(res.notified, false, 'and nobody was told twice');
  assert.deepEqual(db.writes.map(w => w.status), ['accepted', 'accepted']);
});

test('⛔⛔ a failed write sends NOTHING — never announce a status that did not move', async () => {
  const sent = [];
  const db = fakeDb({ applications: [app()], venue_enquiries: [enq()], failOn: 'applications' });
  const res = await answerOpenRequests(db, {
    event: EVENT, member: MEMBER, notify: (n) => { sent.push(n); return null; },
  });
  assert.equal(res.resolved, 0);
  assert.equal(res.notified, false);
  assert.equal(sent.length, 0, 'RLS filters an UPDATE rather than erroring it, so silence is the safe direction');
});

test('nothing open means no write and no message', async () => {
  const sent = [];
  const db = fakeDb();
  const res = await answerOpenRequests(db, {
    event: EVENT, member: MEMBER, notify: (n) => { sent.push(n); return null; },
  });
  assert.equal(res.resolved, 0);
  assert.deepEqual(db.writes, []);
  assert.equal(sent.length, 0);
});
