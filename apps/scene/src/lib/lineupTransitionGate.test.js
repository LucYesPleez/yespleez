import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planAddToBill, addToBill, findExistingMember } from './lineupFromApplication.js';

/**
 * THE LINEUP MEMBERSHIP TRANSITION GATE — tests 1..9, as specified.
 *
 * ⭐⭐ THE THREE MEANINGS THIS PINS APART:
 *
 *   applications.accepted   the HOST accepted the application
 *   lineup_members          the act is on the bill
 *   performances.accepted   the ARTIST accepted a particular performance
 *
 * ⛔ accepting an application ≠ an artist accepting a performance
 * ⛔ adding to the lineup    ≠ creating a performance
 *
 * ⚠ A STATEFUL FAKE, not a call recorder. Idempotency and immutability cannot
 * be shown by a fake that forgets what was written — test 3 needs the SECOND
 * call to see the row the FIRST one made.
 */
function fakeWorld({ apps = [], members = [], perfs = [], slots = [] } = {}) {
  const world = {
    applications:   apps.map(r => ({ ...r })),
    lineup_members: members.map(r => ({ ...r })),
    performances:   perfs.map(r => ({ ...r })),
    event_slots:    slots.map(r => ({ ...r })),
  };
  let seq = 0;
  const failures = { lineup_members: false, applications: false };
  const db = {
    world, failures,
    from(table) {
      return {
        insert(row) {
          return { select: () => ({ single: async () => {
            if (failures[table]) return { data: null, error: { message: `${table} insert refused` } };
            const created = { id: `new-${++seq}`, ...row };
            world[table].push(created);
            return { data: { id: created.id }, error: null };
          } }) };
        },
        update(fields) {
          return { eq: async (col, val) => {
            if (failures[table]) return { error: { message: `${table} update refused` } };
            world[table].filter(r => r[col] === val).forEach(r => Object.assign(r, fields));
            return { error: null };
          } };
        },
      };
    },
  };
  return db;
}

/** The caller sends the notification; the module decides IF one is owed. */
const notificationsFor = plan => (plan.ok && plan.notify ? [plan.notify] : []);

const SHORTLISTED = { id: 'a-short', event_id: 'ev', artist_id: 'u-1', from_profile_id: 'p-1', artist_name: 'Bwoi',     status: 'shortlisted' };
const ACCEPTED    = { id: 'a-acc',   event_id: 'ev', artist_id: 'u-2', from_profile_id: 'p-2', artist_name: 'Cosmatik', status: 'accepted' };
const DECLINED    = { id: 'a-dec',   event_id: 'ev', artist_id: 'u-3', from_profile_id: 'p-3', artist_name: 'Social capital', status: 'declined' };

const PERFS = [{ id: 'perf-1', slot_uuid: 's-1', lineup_member_id: 'm-x', status: 'offered', offered_at: 'T', accepted_at: null }];
const SLOTS = [{ id: 's-1', event_id: 'ev', dur_mins: 90 }];

/** Run the transition end to end against the fake world. */
async function run(db, app, profile = null) {
  const plan = planAddToBill(app, profile, db.world.lineup_members);
  const res = plan.ok ? await addToBill(db, plan) : { ok: false, error: plan.reason };
  return { plan, res, notifications: notificationsFor(plan) };
}

/* ── TEST 1 · shortlisted → lineup ─────────────────────────────────────────── */
test('1 · shortlisted → ADD TO BILL → accepted + one member + one notification', async () => {
  const db = fakeWorld({ apps: [SHORTLISTED], perfs: PERFS, slots: SLOTS });
  const { res, notifications } = await run(db, SHORTLISTED);

  assert.equal(res.ok, true);
  assert.equal(db.world.applications[0].status, 'accepted', 'the host decision moves');
  assert.equal(db.world.lineup_members.length, 1, 'exactly one member');
  assert.deepEqual(notifications, ['accepted'], 'exactly one acceptance notification');
});

/* ── TEST 2 · accepted → lineup ────────────────────────────────────────────── */
test('2 · accepted → ADD TO BILL → member only, status untouched, NO notification', async () => {
  const db = fakeWorld({ apps: [ACCEPTED], perfs: PERFS, slots: SLOTS });
  const { res, notifications } = await run(db, ACCEPTED);

  assert.equal(res.ok, true);
  assert.equal(db.world.applications[0].status, 'accepted');
  assert.equal(db.world.lineup_members.length, 1);
  assert.deepEqual(notifications, [], '⛔ re-notifying a days-old decision');
});

/* ── TEST 3 · idempotency ──────────────────────────────────────────────────── */
test('3 · ADD TO BILL twice creates exactly ONE member', async () => {
  const db = fakeWorld({ apps: [ACCEPTED] });
  const first = await run(db, ACCEPTED);
  assert.equal(first.res.ok, true);
  assert.equal(db.world.lineup_members.length, 1);

  // ⚠ The second call plans against the world the first one changed.
  const second = await run(db, ACCEPTED);
  assert.equal(second.plan.ok, false);
  assert.match(second.plan.reason, /already on the bill/);
  assert.equal(db.world.lineup_members.length, 1, '⛔ lineup_members has NO uniqueness constraint — this guard is the only one');
});

/* ── TEST 4 · existing membership ──────────────────────────────────────────── */
test('4 · an accepted applicant already on the bill reads ON BILL and inserts nothing', async () => {
  const existing = { id: 'm-1', event_id: 'ev', artist_profile_id: 'p-2', artist_id: 'u-2' };
  const db = fakeWorld({ apps: [ACCEPTED], members: [existing] });

  assert.ok(findExistingMember(ACCEPTED, db.world.lineup_members), 'ON BILL is derived from lineup_members');
  const { plan } = await run(db, ACCEPTED);
  assert.equal(plan.ok, false);
  assert.equal(db.world.lineup_members.length, 1);
});

/* ── TEST 5 · declined ─────────────────────────────────────────────────────── */
test('5 · declined → REFUSED, with no mutation of any kind', async () => {
  const db = fakeWorld({ apps: [DECLINED], perfs: PERFS, slots: SLOTS });
  const before = JSON.stringify(db.world);
  const { res } = await run(db, DECLINED);

  assert.equal(res.ok, false);
  assert.equal(db.world.lineup_members.length, 0);
  assert.equal(db.world.applications[0].status, 'declined', '⛔ do not silently resurrect a host decision');
  assert.equal(JSON.stringify(db.world), before, 'nothing anywhere changed');
});

/* ── TEST 6 · identity ─────────────────────────────────────────────────────── */
test('6 · artist_profile_id comes from from_profile_id, with no account re-resolution', async () => {
  const db = fakeWorld({ apps: [SHORTLISTED] });
  await run(db, SHORTLISTED);
  assert.equal(db.world.lineup_members[0].artist_profile_id, SHORTLISTED.from_profile_id);

  /**
   * ⚠⚠ THE MULTI-PROFILE ACCOUNT. One account owns artist / band / standup /
   * venue / host profiles. `resolveProfileId(account,'artist')` can only ever
   * return the ARTIST one — so a BAND's application would be billed under the
   * wrong identity. The application already names the profile; that is the
   * only correct answer.
   */
  const bandApp = { id: 'a-band', event_id: 'ev', artist_id: 'u-multi', from_profile_id: 'p-band', artist_name: 'Dusky Waters', status: 'shortlisted' };
  const db2 = fakeWorld({ apps: [bandApp] });
  await run(db2, bandApp, { name: 'Dusky Waters' });
  const m = db2.world.lineup_members[0];
  assert.equal(m.artist_profile_id, 'p-band', 'the BAND profile, not an artist profile guessed from the account');
  assert.equal(m.artist_id, 'u-multi');

  // ⚠ A NULL from_profile_id is a real answer (U4 refuses to guess) and must
  // stay NULL rather than being invented.
  const legacy = { id: 'a-l', event_id: 'ev', artist_id: 'u-9', from_profile_id: null, artist_name: 'ESKIMHO', status: 'accepted' };
  const db3 = fakeWorld({ apps: [legacy] });
  await run(db3, legacy);
  assert.equal(db3.world.lineup_members[0].artist_profile_id, null);
});

/* ── TEST 7 · application immutability on the accepted path ────────────────── */
test('7 · the accepted path leaves the application byte-identical', async () => {
  const db = fakeWorld({ apps: [ACCEPTED] });
  const before = JSON.stringify(db.world.applications);
  await run(db, ACCEPTED);
  assert.equal(JSON.stringify(db.world.applications), before);
  assert.equal(db.world.applications[0].status, 'accepted');
});

/* ── TEST 8 · performance and slot immutability ────────────────────────────── */
test('8 · ⛔ nothing touches performances or event_slots, on any path', async () => {
  for (const app of [SHORTLISTED, ACCEPTED, DECLINED]) {
    const db = fakeWorld({ apps: [app], perfs: PERFS, slots: SLOTS });
    const beforePerfs = JSON.stringify(db.world.performances);
    const beforeSlots = JSON.stringify(db.world.event_slots);
    await run(db, app);
    assert.equal(JSON.stringify(db.world.performances), beforePerfs, `${app.status}: performances changed`);
    assert.equal(JSON.stringify(db.world.event_slots), beforeSlots, `${app.status}: event_slots changed`);
    // ⛔ And no timing fields are invented on the member either.
    const m = db.world.lineup_members[0];
    if (m) {
      ['slot_uuid', 'offered_at', 'accepted_at', 'slot_id'].forEach(k =>
        assert.equal(k in m, false, `a member must not carry ${k}`));
    }
  }
});

/* ── TEST 9 · partial failure ──────────────────────────────────────────────── */
test('9 · member created + status update refused → membership KEPT, state reported', async () => {
  const db = fakeWorld({ apps: [SHORTLISTED] });
  db.failures.applications = true;          // insert succeeds, status write fails

  const { res } = await run(db, SHORTLISTED);

  assert.equal(res.ok, true, 'the host action that matters succeeded');
  assert.equal(db.world.lineup_members.length, 1, '⛔ do NOT roll back a membership already visible on screen');
  assert.equal(db.world.applications[0].status, 'shortlisted', 'the application stays at its previous state');
  assert.match(res.error, /On the bill, but the application status was not updated/);
});

test('9b · the inverse — a refused member insert changes nothing at all', async () => {
  const db = fakeWorld({ apps: [SHORTLISTED] });
  db.failures.lineup_members = true;
  const before = JSON.stringify(db.world);

  const { res } = await run(db, SHORTLISTED);

  assert.equal(res.ok, false);
  assert.equal(JSON.stringify(db.world), before, 'a failed add must not move the application');
});

/* ── The shape of the approved model, asserted directly ────────────────────── */
test('⭐ the three meanings stay distinct', async () => {
  const db = fakeWorld({ apps: [SHORTLISTED], perfs: PERFS, slots: SLOTS });
  await run(db, SHORTLISTED);

  assert.equal(db.world.applications[0].status, 'accepted', 'host accepted the APPLICATION');
  assert.equal(db.world.lineup_members[0].status, 'on_bill', 'the act is on the BILL');
  assert.equal(db.world.performances[0].status, 'offered', 'the artist has accepted NO performance');
  assert.equal(db.world.performances[0].accepted_at, null);
});
