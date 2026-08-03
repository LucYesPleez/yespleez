/**
 * N1 · HELD NOTIFICATIONS — regression tests.
 *
 * These exercise the REAL writeNotification.js. Only its two external
 * dependencies are stubbed (the Supabase client and the profile resolver),
 * so what is under test is the shipped module, not a reimplementation.
 *
 * The bug these lock down: notifications addressed to an UNCLAIMED profile
 * were silently discarded — by an early return in writeNotification(), by a
 * `.filter(r => r.toUserId)` in writeNotifications(), and by an
 * `if (profile.user_id)` guard at the follow call site. `N1` requires them
 * to be created and held instead.
 *
 * Run: npm test   (see package.json — needs the resolve hook and mock flag)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Rows handed to supabase.insert(), newest last. Reset per test. */
let inserted = [];

mock.module('./supabase', {
  exports: {
    supabase: {
      from(table) {
        assert.equal(table, 'notifications', 'writer must target the notifications table');
        return {
          insert(payload) {
            inserted.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  },
});

// Not exercised by these paths, but part of the module graph.
// getProfilesOfType — not getOwnerProfiles — is what inferToProfileId calls
// (2026-08-03: decoupled so a profile-type lookup for artist/band/standup
// isn't silently rerouted through OWNER_ELIGIBLE_TYPES, which no longer
// includes them). Mocking the wrong export here would pass by accident.
mock.module('./actingProfile', {
  exports: { getProfilesOfType: async () => [] },
});

const { writeNotification, writeNotifications, isHeld } =
  await import('./writeNotification.js');

const PROFILE = '11111111-1111-1111-1111-111111111111';
const USER    = '22222222-2222-2222-2222-222222222222';
const FOLLOWER = '33333333-3333-3333-3333-333333333333';

/** The follow write as ProfileScreen.jsx issues it. */
const followOf = ({ ownerUserId }) => ({
  toUserId:       ownerUserId ?? null,
  toProfileId:    PROFILE,
  aboutProfileId: FOLLOWER,
  type:           'new_follower',
  message:        'Someone followed your profile.',
  data:           { follower_id: FOLLOWER },
});

beforeEach(() => { inserted = []; });


// ── The regression the whole change exists to prevent ───────────────

test('following an UNCLAIMED profile creates a held notification', async () => {
  const error = await writeNotification(followOf({ ownerUserId: null }));

  assert.equal(error, null);
  assert.equal(inserted.length, 1, 'the notification must be written, not discarded');

  const row = inserted[0];
  assert.equal(row.to_user_id, null, 'held: no delivery identity (N1)');
  assert.equal(row.to_profile_id, PROFILE, 'held: recipient profile is retained');
  assert.equal(row.type, 'new_follower');
  assert.equal(isHeld(row), true);
});

test('a held notification is not lost when the owner field is undefined, not null', async () => {
  // ProfileScreen reads profile.user_id, which is undefined — not null — when
  // the column is absent from the selected row. The old guard treated both as
  // "skip"; buildRow must normalise undefined to null and still write.
  const opts = followOf({ ownerUserId: undefined });
  delete opts.toUserId;

  await writeNotification(opts);

  assert.equal(inserted.length, 1, 'an absent toUserId must still write a held row');
  assert.equal(inserted[0].to_user_id, null);
});


// ── Claimed profiles must be unaffected ─────────────────────────────

test('following a CLAIMED profile still delivers normally', async () => {
  const error = await writeNotification(followOf({ ownerUserId: USER }));

  assert.equal(error, null);
  assert.equal(inserted.length, 1);

  const row = inserted[0];
  assert.equal(row.to_user_id, USER, 'delivered: delivery identity present');
  assert.equal(row.to_profile_id, PROFILE);
  assert.equal(isHeld(row), false, 'a delivered row is not held');
});

test('a delivered row with a NULL to_profile_id stays legal (U4)', async () => {
  // U4: to_profile_id is NULL when the destination profile is not uniquely
  // inferable. Tightening the invariant to "to_profile_id required" would
  // reject these correct rows — the constraint is an OR for this reason.
  await writeNotification({
    toUserId: USER, toProfileId: null,
    type: 'shortlisted', message: 'You have been shortlisted.',
  });

  assert.equal(inserted.length, 1, 'U4 NULLs must not be refused');
  assert.equal(inserted[0].to_profile_id, null);
});


// ── The addressability invariant is the ONLY reason to refuse ───────

test('a row addressed to nobody is refused', async () => {
  const error = await writeNotification({
    type: 'orphan', message: 'unreachable',
  });

  assert.equal(error, null);
  assert.equal(inserted.length, 0, 'neither identity ⇒ nothing to write');
});

test('an empty or missing options object is refused without throwing', async () => {
  assert.equal(await writeNotification(undefined), null);
  assert.equal(await writeNotification({}), null);
  assert.equal(inserted.length, 0);
});


// ── Batch path: the same rule, and no silent loss ───────────────────

test('a batch preserves held rows alongside delivered ones', async () => {
  const error = await writeNotifications([
    followOf({ ownerUserId: USER }),   // delivered
    followOf({ ownerUserId: null }),   // held
    followOf({ ownerUserId: null }),   // held
  ]);

  assert.equal(error, null);
  assert.equal(inserted.length, 1, 'batch must remain a single insert');

  const rows = inserted[0];
  assert.equal(rows.length, 3, 'NO NOTIFICATION IS LOST — held rows survive the batch');
  assert.equal(rows.filter(r => r.to_user_id === null).length, 2);
  assert.equal(rows.filter(isHeld).length, 2);
});

test('a batch drops only unaddressable rows', async () => {
  await writeNotifications([
    followOf({ ownerUserId: null }),                      // held, kept
    { type: 'orphan', message: 'unreachable' },           // dropped
    null,                                                 // dropped
  ]);

  assert.equal(inserted[0].length, 1);
  assert.equal(isHeld(inserted[0][0]), true);
});

test('a batch of only unaddressable rows writes nothing', async () => {
  const error = await writeNotifications([{ type: 'x', message: 'y' }]);
  assert.equal(error, null);
  assert.equal(inserted.length, 0);
});


// ── isHeld is the single definition of "held" ───────────────────────

test('isHeld distinguishes held from delivered and from unaddressable', () => {
  assert.equal(isHeld({ to_user_id: null, to_profile_id: PROFILE }), true);
  assert.equal(isHeld({ to_user_id: USER, to_profile_id: PROFILE }), false);
  assert.equal(isHeld({ to_user_id: USER, to_profile_id: null }), false);
  assert.equal(isHeld({ to_user_id: null, to_profile_id: null }), false);
  assert.equal(isHeld(null), false);
});
