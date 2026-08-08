import test from 'node:test';
import assert from 'node:assert/strict';
import { applicantProfileKeys, indexApplicantProfiles, scopeToApplicant, fetchApplicantProfiles } from './applicantProfiles.js';

/** Minimal stand-in for the Supabase query builder, recording what was asked for. */
function fakeDb(rowsById = [], rowsByUid = []) {
  const calls = [];
  return {
    calls,
    from: () => ({
      select: () => ({
        in: (col, vals) => {
          calls.push([col, vals]);
          return Promise.resolve({ data: col === 'id' ? rowsById : rowsByUid });
        },
      }),
    }),
  };
}

// The three shapes that exist in `applications` after M6c.
//
// MIGRATED  — M6c resolved the account to exactly one profile (U4 satisfied).
// LEGACY    — the account owned 2+ applicable profiles, so from_profile_id is
//             NULL and will stay NULL. These are the multi-profile people.
// ORPHAN    — neither key. Pre-identity rows with no recoverable applicant.
const MIGRATED = { id: 'a1', from_profile_id: 'p1', artist_id: 'u1' };
const LEGACY   = { id: 'a2', from_profile_id: null, artist_id: 'u2' };
const ORPHAN   = { id: 'a3', from_profile_id: null, artist_id: null };

test('⚠ a LEGACY row is still fetched — dropping artist_id would delete it from the result', () => {
  // The whole reason artist_id survives M6. from_profile_id is NULL here by
  // ratified decision (U4), not by oversight, so a from_profile_id-only read
  // does not migrate this row — it loses it.
  const { profileIds, userIds } = applicantProfileKeys([LEGACY]);
  assert.deepEqual(profileIds, []);
  assert.deepEqual(userIds, ['u2']);
  const map = indexApplicantProfiles([LEGACY], {}, { u2: { id: 'pX', name: 'Old Mate' } });
  assert.equal(map.a2?.id, 'pX', 'a legacy application must still resolve to a profile');
});

test('a migrated row resolves through from_profile_id', () => {
  const { profileIds, userIds } = applicantProfileKeys([MIGRATED]);
  assert.deepEqual(profileIds, ['p1']);
  assert.deepEqual(userIds, [], 'a row with a profile id must not also be queried by user_id');
  const map = indexApplicantProfiles([MIGRATED], { p1: { id: 'p1', name: 'Dulcet' } }, {});
  assert.equal(map.a1?.name, 'Dulcet');
});

test('⚠ profile id wins when a row carries both — this is the multi-profile fix', () => {
  const map = indexApplicantProfiles([MIGRATED], { p1: { id: 'p1' } }, { u1: { id: 'pWRONG' } });
  assert.equal(map.a1.id, 'p1',
    'the account join answers "a profile this person owns", not "the profile that applied"');
});

test('⚠ two applications from ONE account do not collapse onto one key', () => {
  // A person with a DJ alias and a band applies to the same event twice. Keyed
  // by artist_id these are one entry and both rows render the same profile —
  // the defect this module exists to remove.
  const dj   = { id: 'a10', from_profile_id: 'pDJ',   artist_id: 'u9' };
  const band = { id: 'a11', from_profile_id: 'pBAND', artist_id: 'u9' };
  const map = indexApplicantProfiles([dj, band],
    { pDJ: { id: 'pDJ', name: 'Dulcet' }, pBAND: { id: 'pBAND', name: 'Fauna' } }, {});
  assert.equal(map.a10.name, 'Dulcet');
  assert.equal(map.a11.name, 'Fauna');
  assert.equal(Object.keys(map).length, 2, 'one key per application, never one per account');
});

test('an orphan row resolves to nothing, and that is correct', () => {
  // Absent, not broken. Renderers fall back to the stored applicant name.
  const { profileIds, userIds } = applicantProfileKeys([ORPHAN]);
  assert.deepEqual(profileIds, []);
  assert.deepEqual(userIds, []);
  assert.deepEqual(indexApplicantProfiles([ORPHAN], {}, {}), {});
});

test('the three shapes coexist in one event', () => {
  const apps = [MIGRATED, LEGACY, ORPHAN];
  const { profileIds, userIds } = applicantProfileKeys(apps);
  assert.deepEqual(profileIds, ['p1']);
  assert.deepEqual(userIds, ['u2']);
  const map = indexApplicantProfiles(apps, { p1: { id: 'p1' } }, { u2: { id: 'pX' } });
  assert.deepEqual(Object.keys(map).sort(), ['a1', 'a2']);
});

test('ids are de-duplicated and bad rows never throw', () => {
  assert.deepEqual(applicantProfileKeys([MIGRATED, { ...MIGRATED, id: 'a5' }]).profileIds, ['p1']);
  assert.deepEqual(applicantProfileKeys([null, undefined]).profileIds, []);
  assert.deepEqual(applicantProfileKeys(), { profileIds: [], userIds: [] });
  assert.deepEqual(indexApplicantProfiles([{ from_profile_id: 'p1' }], { p1: {} }, {}), {},
    'a row with no id has nothing to key on and must be skipped, not crash');
  assert.deepEqual(indexApplicantProfiles(), {});
});

test('an application whose profile row did not come back is absent, not undefined-valued', () => {
  const map = indexApplicantProfiles([MIGRATED], {}, {});
  assert.deepEqual(map, {});
  assert.equal('a1' in map, false);
});

test('fetchApplicantProfiles queries BOTH keys and indexes by application id', async () => {
  const db = fakeDb([{ id: 'p1', user_id: 'u1', name: 'Dulcet' }],
                    [{ id: 'pX', user_id: 'u2', name: 'Old Mate' }]);
  const map = await fetchApplicantProfiles(db, [MIGRATED, LEGACY], 'id, user_id, name');
  assert.deepEqual(db.calls, [['id', ['p1']], ['user_id', ['u2']]],
    'a migrated row is fetched by profile id and a legacy row by account, in one pass');
  assert.equal(map.a1?.name, 'Dulcet');
  assert.equal(map.a2?.name, 'Old Mate');
});

test('fetchApplicantProfiles makes no query when there is nothing to resolve', async () => {
  const db = fakeDb();
  assert.deepEqual(await fetchApplicantProfiles(db, [ORPHAN], 'id, user_id'), {});
  assert.deepEqual(db.calls, [], 'an orphan-only set must not issue two empty `in ()` queries');
});

test('⚠ fetchApplicantProfiles refuses a column list that would silently lose profiles', async () => {
  // Omitting `id` leaves the profile-id map empty, so every MIGRATED row
  // resolves to nothing — indistinguishable from "this applicant has no
  // profile". It must fail at the call site, not render as absence.
  await assert.rejects(() => fetchApplicantProfiles(fakeDb(), [MIGRATED], 'user_id, name'),
    /must include `id`/);
  await assert.rejects(() => fetchApplicantProfiles(fakeDb(), [MIGRATED], 'id, name'),
    /must include `user_id`/);
});

test('scopeToApplicant prefers the profile and falls back to the account', () => {
  const calls = [];
  const q = { eq: (col, val) => { calls.push([col, val]); return q; } };

  scopeToApplicant(q, 'p1', 'u1');
  assert.deepEqual(calls, [['from_profile_id', 'p1']], 'a known profile must narrow to that profile');

  calls.length = 0;
  scopeToApplicant(q, null, 'u1');
  assert.deepEqual(calls, [['artist_id', 'u1']], 'no known profile falls back to the account, not to nothing');
});
