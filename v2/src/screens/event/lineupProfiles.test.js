import test from 'node:test';
import assert from 'node:assert/strict';
import { memberProfileKeys, indexMemberProfiles } from './lineupProfiles.js';

// The three shapes that actually exist in lineup_members. Counts are from the
// live table on the day the join was fixed: 25 imported, 11 legacy, 21 typed.
const IMPORTED = { id: 'm1', artist_name: 'Fr3aky', artist_profile_id: 'p1', artist_id: null };
const LEGACY   = { id: 'm2', artist_name: 'Old Mate', artist_profile_id: null, artist_id: 'u2' };
const TYPED    = { id: 'm3', artist_name: 'Just A Name', artist_profile_id: null, artist_id: null };

test('⚠ an imported member is fetched — the bug that hid 25 of 57 rows', () => {
  // The importer attaches a profile and never a user account, so a fetch that
  // requires artist_id asks for nothing and the profile is silently dropped.
  const { profileIds, userIds } = memberProfileKeys([IMPORTED]);
  assert.deepEqual(profileIds, ['p1']);
  assert.deepEqual(userIds, []);
});

test('⚠ an imported member is indexed, keyed by the member row', () => {
  const map = indexMemberProfiles([IMPORTED], { p1: { id: 'p1', name: 'Fr3aky' } }, {});
  assert.equal(map.m1?.name, 'Fr3aky');
  // Never by artist_id: it is null here, so a map keyed by it collapses every
  // imported member onto the single key `null`.
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map.null, undefined);
});

test('a legacy member still resolves through user_id', () => {
  const { profileIds, userIds } = memberProfileKeys([LEGACY]);
  assert.deepEqual(profileIds, []);
  assert.deepEqual(userIds, ['u2']);
  const map = indexMemberProfiles([LEGACY], {}, { u2: { id: 'pX', name: 'Old Mate' } });
  assert.equal(map.m2?.id, 'pX');
});

test('a typed billing name resolves to nothing, and that is correct', () => {
  // Absent, not broken: nobody attached a profile, so there is none to show.
  const { profileIds, userIds } = memberProfileKeys([TYPED]);
  assert.deepEqual(profileIds, []);
  assert.deepEqual(userIds, []);
  assert.deepEqual(indexMemberProfiles([TYPED], {}, {}), {});
});

test('profile id wins when a row carries both — the user_id join is ambiguous', () => {
  const both = { id: 'm4', artist_profile_id: 'p9', artist_id: 'u9' };
  const { profileIds, userIds } = memberProfileKeys([both]);
  assert.deepEqual(profileIds, ['p9']);
  assert.deepEqual(userIds, [], 'a row with a profile id must not also be queried by user_id');
  const map = indexMemberProfiles([both], { p9: { id: 'p9' } }, { u9: { id: 'pWRONG' } });
  assert.equal(map.m4.id, 'p9');
});

test('the three shapes coexist in one lineup', () => {
  const members = [IMPORTED, LEGACY, TYPED];
  const { profileIds, userIds } = memberProfileKeys(members);
  assert.deepEqual(profileIds, ['p1']);
  assert.deepEqual(userIds, ['u2']);
  const map = indexMemberProfiles(members, { p1: { id: 'p1' } }, { u2: { id: 'pX' } });
  assert.deepEqual(Object.keys(map).sort(), ['m1', 'm2']);
});

test('ids are de-duplicated and bad rows never throw', () => {
  const dupes = [IMPORTED, { ...IMPORTED, id: 'm5' }];
  assert.deepEqual(memberProfileKeys(dupes).profileIds, ['p1']);
  assert.deepEqual(memberProfileKeys([null, undefined]).profileIds, []);
  assert.deepEqual(memberProfileKeys(), { profileIds: [], userIds: [] });
  assert.deepEqual(indexMemberProfiles([{ artist_profile_id: 'p1' }], { p1: {} }, {}), {},
    'a row with no id has nothing to key on and must be skipped, not crash');
  assert.deepEqual(indexMemberProfiles(), {});
});

test('a member whose profile row did not come back is absent, not undefined-valued', () => {
  // The profile was deleted or is unreadable. The renderer falls back to
  // artist_name; it must not be handed an undefined value under a live key.
  const map = indexMemberProfiles([IMPORTED], {}, {});
  assert.deepEqual(map, {});
  assert.equal('m1' in map, false);
});
