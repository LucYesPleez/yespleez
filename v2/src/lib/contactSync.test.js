/**
 * C1 · CONTACT SYNC CLIENT — regression tests.
 *
 * Exercises the REAL contactSync.js with only Supabase stubbed, same approach
 * as phoneKey.test.js.
 *
 * What they lock down, in order of how expensive the bug would be:
 *
 *   1. THE ADDRESS BOOK NEVER LEAVES THE DEVICE. No contact name may appear
 *      in an RPC payload. This is the promise the primer card makes in so
 *      many words, and breaking it would be invisible in the UI.
 *   2. `contact_code_id -> name` is stored for EVERY contact, including the
 *      ones that did not match — those are exactly the people who might join
 *      tomorrow, and Contact Join Notifications cannot name them otherwise.
 *   3. savedAs is attached to matches, and no phone number escapes with them.
 *
 * Run: npm test
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let rpcCalls = [];
let syncRows = [];
let rpcError = null;
let rpcData = null;

mock.module('./supabase', {
  exports: {
    supabase: {
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (rpcError) return { data: null, error: rpcError };
        if (fn === 'sync_contacts') return { data: syncRows, error: null };
        return { data: rpcData, error: null };
      },
    },
  },
});

const {
  syncContacts, getContactSync, setContactSync, deleteContactCodes,
  localNameFor, __setContactNameStore,
} = await import('./contactSync.js');

/** In-memory stand-in for localStorage, so the store is inspectable. */
let saved = {};
beforeEach(() => {
  rpcCalls = [];
  syncRows = [];
  rpcError = null;
  rpcData = null;
  saved = {};
  __setContactNameStore({
    read: () => ({ ...saved }),
    write: (m) => { saved = { ...m }; },
    clear: () => { saved = {}; },
  });
});

test('THE PROMISE: no contact name is ever sent to the server', async () => {
  syncRows = [];
  await syncContacts([
    { number: '0474 755 829', name: 'Mads' },
    { number: '0412 345 678', name: 'Mum ❤' },
    { number: '+64 21 555 0199', name: 'Wiremu' },
  ], 'AU');

  assert.equal(rpcCalls.length, 1);
  const payload = JSON.stringify(rpcCalls[0].args);
  for (const name of ['Mads', 'Mum', 'Wiremu']) {
    assert.ok(!payload.includes(name), `contact name "${name}" was sent to the server`);
  }
  // Numbers only, normalised, nothing else in the payload at all.
  assert.deepEqual(rpcCalls[0].args, {
    p_e164: ['+61474755829', '+61412345678', '+64215550199'],
  });
});

test('a name is remembered for EVERY contact, not just the matches', async () => {
  // The reason sync_contacts returns an id for unmatched contacts. Someone who
  // has not joined yet is precisely who Contact Join Notifications is for, and
  // the name must already be on the device when they do.
  syncRows = [
    { input_index: 1, contact_code_id: 11, profile_id: 'p-1', display_name: 'Mads N', avatar: null },
    { input_index: 2, contact_code_id: 22, profile_id: null,  display_name: null,     avatar: null },
  ];

  await syncContacts([
    { number: '0474755829', name: 'Mads' },
    { number: '0412345678', name: 'Not On Yespleez Yet' },
  ], 'AU');

  assert.equal(localNameFor(11), 'Mads');
  assert.equal(localNameFor(22), 'Not On Yespleez Yet', 'unmatched contact was forgotten');
});

test('savedAs follows the INDEX, not the order of results', async () => {
  // Only the second contact matched. Zipping results against inputs
  // positionally would label this match "Mads".
  syncRows = [
    { input_index: 2, contact_code_id: 22, profile_id: 'p-2', display_name: 'Jess Deluxe', avatar: null },
  ];

  const { matches } = await syncContacts([
    { number: '0474755829', name: 'Mads' },
    { number: '0412345678', name: 'Jess' },
  ], 'AU');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].savedAs, 'Jess', 'the wrong contact name was attached');
});

test('no phone number escapes with a match', async () => {
  syncRows = [
    { input_index: 1, contact_code_id: 11, profile_id: 'p-1', display_name: 'Mads N', avatar: '/a.jpg' },
  ];
  const { matches } = await syncContacts([{ number: '0474755829', name: 'Mads' }], 'AU');

  const serialised = JSON.stringify(matches);
  assert.ok(!serialised.includes('+61474755829'), 'an E.164 number escaped');
  assert.ok(!serialised.includes('474755829'), 'a phone number escaped');
  // Exact whitelist: a new field has to be added here deliberately, which is
  // what stops a number arriving one day as an unnoticed extra key.
  assert.deepEqual(
    Object.keys(matches[0]).sort(),
    ['avatar', 'displayName', 'profileId', 'savedAs'],
  );
});

test('numbers are normalised and de-duplicated before upload', async () => {
  syncRows = [];
  await syncContacts([
    { number: '0474755829',    name: 'Mads' },
    { number: '+61474755829',  name: 'Mads (work)' },
    { number: '0474 755 829',  name: 'Mads mobile' },
  ], 'AU');
  assert.deepEqual(rpcCalls[0].args, { p_e164: ['+61474755829'] });
});

test('the first name wins for a duplicated number', async () => {
  syncRows = [
    { input_index: 1, contact_code_id: 11, profile_id: 'p-1', display_name: 'Mads N', avatar: null },
  ];
  const { matches } = await syncContacts([
    { number: '0474755829',   name: 'Mads' },
    { number: '+61474755829', name: 'Mads (work)' },
  ], 'AU');
  assert.equal(matches[0].savedAs, 'Mads');
});

test('rubbish entries are dropped, never fatal', async () => {
  syncRows = [];
  await syncContacts([
    { number: 'Pizza Hut', name: 'Pizza' },
    { number: '*611',      name: 'Telstra' },
    { number: '',          name: 'Blank' },
    { number: null,        name: 'Null' },
    { number: '0474755829', name: 'Mads' },
  ], 'AU');
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0].args, { p_e164: ['+61474755829'] });
});

test('an empty or all-rubbish list makes no round trip', async () => {
  const a = await syncContacts([], 'AU');
  const b = await syncContacts([{ number: 'nope', name: 'x' }], 'AU');
  assert.deepEqual(a.matches, []);
  assert.deepEqual(b.matches, []);
  assert.equal(rpcCalls.length, 0, 'a pointless request was made');
});

test('a failed sync yields no partial matches and remembers nothing', async () => {
  rpcError = { code: '08006', message: 'connection failure' };
  const { matches, error } = await syncContacts([{ number: '0474755829', name: 'Mads' }], 'AU');
  assert.deepEqual(matches, []);
  assert.ok(error);
  assert.deepEqual(saved, {}, 'names were stored despite the sync failing');
});

test('deleting codes also clears this device name map', async () => {
  // Those ids no longer exist, so keeping names against them would leave the
  // only copy of an address-book fragment sitting in storage for dead records.
  syncRows = [
    { input_index: 1, contact_code_id: 11, profile_id: null, display_name: null, avatar: null },
  ];
  await syncContacts([{ number: '0474755829', name: 'Mads' }], 'AU');
  assert.equal(localNameFor(11), 'Mads');

  rpcData = 1;
  const { deleted } = await deleteContactCodes();
  assert.equal(deleted, 1);
  assert.equal(localNameFor(11), null, 'the name map survived a delete');
});

test('sync state reads through, with sane defaults', async () => {
  rpcData = [{ enabled: true, last_synced_at: '2026-07-26T00:00:00Z', code_count: 212 }];
  const { state } = await getContactSync();
  assert.deepEqual(state, {
    enabled: true, lastSyncedAt: '2026-07-26T00:00:00Z', codeCount: 212,
  });

  rpcData = [];
  const { state: empty } = await getContactSync();
  assert.deepEqual(empty, { enabled: false, lastSyncedAt: null, codeCount: 0 });
});

test('the toggle goes through its own RPC', async () => {
  await setContactSync(false);
  assert.deepEqual(rpcCalls[0], { fn: 'set_contact_sync', args: { p_enabled: false } });
});
