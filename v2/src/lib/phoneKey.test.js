/**
 * P1 · PHONE DISCOVERY CLIENT — regression tests.
 *
 * These exercise the REAL phoneKey.js with only Supabase stubbed, so what is
 * under test is the shipped module rather than a reimplementation — same
 * approach as messaging.test.js.
 *
 * What they lock down, in order of how expensive the bug would be:
 *
 *   1. THE PHONEBOOK NAME NEVER REACHES THE RPC. Sending it would hand the
 *      server a copy of the user's address book — the one thing the whole
 *      design promises not to do, and nothing in the UI would look wrong.
 *   2. `savedAs` is actually populated. This is mitigation 4, the corroboration
 *      line that replaces SMS verification. It was BROKEN in the first draft of
 *      this module — the correlation between input and result did not exist, so
 *      savedAs was silently always null and a squatted number would have looked
 *      exactly like a genuine one. Nothing else in the app would have failed.
 *   3. No phone number escapes in a returned object, so no screen can render
 *      one by accident.
 *
 * Run: npm test   (see package.json — needs the resolve hook and mock flag)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Every rpc issued, as {fn, args}. Reset per test. */
let rpcCalls = [];
/** What `find_by_phone` resolves to; tests set this per case. */
let findRows = [];
/** Forced error, or null. */
let rpcError = null;

mock.module('./supabase', {
  exports: {
    supabase: {
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (rpcError) return { data: null, error: rpcError };
        return { data: fn === 'find_by_phone' ? findRows : null, error: null };
      },
    },
  },
});

const { setPhoneKey, removePhoneKey, setPhoneVisibility, findByPhone, matchContacts } =
  await import('./phoneKey.js');

beforeEach(() => {
  rpcCalls = [];
  findRows = [];
  rpcError = null;
});

test('the phonebook name NEVER reaches the server', () => {
  return (async () => {
    findRows = [];
    await matchContacts(
      [
        { number: '0412 345 678', name: 'Bob' },
        { number: '0499 000 111', name: 'Mum ❤' },
      ],
      'AU',
    );

    assert.equal(rpcCalls.length, 1);
    const sent = JSON.stringify(rpcCalls[0].args);
    assert.ok(!sent.includes('Bob'), 'a contact name was sent to the database');
    assert.ok(!sent.includes('Mum'), 'a contact name was sent to the database');
    // Only the numbers, normalised, and nothing else.
    assert.deepEqual(rpcCalls[0].args, { p_e164: ['+61412345678', '+61499000111'] });
  })();
});

test('savedAs is populated — the corroboration line actually renders', async () => {
  // The regression. `find_by_phone` returns input_index (1-based), and the
  // client joins the saved-as name back on locally. If that correlation breaks,
  // savedAs goes silently null and the squatting signal disappears.
  findRows = [{ input_index: 1, profile_id: 'p-mallory', display_name: 'Mallory X' }];

  const { matches } = await matchContacts([{ number: '0412 345 678', name: 'Bob' }], 'AU');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].displayName, 'Mallory X');
  assert.equal(matches[0].savedAs, 'Bob', 'savedAs must survive the round trip');
});

test('savedAs follows the INDEX, not the order of results', async () => {
  // Two contacts, and only the second matches. A naive implementation that
  // zipped results against inputs positionally would label this match "Bob".
  findRows = [{ input_index: 2, profile_id: 'p-jess', display_name: 'Jess Deluxe' }];

  const { matches } = await matchContacts(
    [
      { number: '0412 345 678', name: 'Bob' },
      { number: '0499 000 111', name: 'Jess' },
    ],
    'AU',
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].savedAs, 'Jess', 'the wrong contact name was attached');
});

test('no phone number escapes in a returned match', async () => {
  findRows = [{ input_index: 1, profile_id: 'p-1', display_name: 'Jess Deluxe', avatar: '/a.jpg' }];
  const { matches } = await matchContacts([{ number: '0412 345 678', name: 'Jess' }], 'AU');

  const serialised = JSON.stringify(matches);
  assert.ok(!serialised.includes('+61412345678'), 'an E.164 number escaped to the caller');
  assert.ok(!serialised.includes('412345678'), 'a phone number escaped to the caller');

  // An EXACT whitelist, not a subset check. Any field added to a match has to
  // be added here deliberately, which is what stops a number (or a hash, or a
  // user_id) arriving one day as an unnoticed extra key.
  assert.deepEqual(
    Object.keys(matches[0]).sort(),
    ['avatar', 'displayName', 'profileId', 'savedAs'],
  );
});

test('numbers are normalised and de-duplicated before they are sent', async () => {
  await findByPhone(['0412 345 678', '+61412345678', '0412345678', '(0412) 345-678'], 'AU');
  assert.deepEqual(rpcCalls[0].args, { p_e164: ['+61412345678'] });
});

test('unparseable contacts are dropped, never fatal', async () => {
  // A real address book contains "Pizza", "*611" and blank rows. One of them
  // must not cost the entire sync.
  await matchContacts(
    [
      { number: 'Pizza Hut', name: 'Pizza' },
      { number: '', name: 'Blank' },
      { number: '0412 345 678', name: 'Bob' },
      { number: null, name: 'Null' },
    ],
    'AU',
  );
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0].args, { p_e164: ['+61412345678'] });
});

test('an empty or all-rubbish contact list makes no round trip', async () => {
  const a = await findByPhone([], 'AU');
  const b = await matchContacts([{ number: 'nope', name: 'x' }], 'AU');
  assert.deepEqual(a.matches, []);
  assert.deepEqual(b.matches, []);
  assert.equal(rpcCalls.length, 0, 'a pointless request was made');
});

test('a malformed number never reaches the server, and says why', async () => {
  const { reason, error } = await setPhoneKey('12', 'AU');
  assert.equal(reason, 'too-short');
  assert.equal(error, null);
  assert.equal(rpcCalls.length, 0, 'the database was asked to validate what we can');
});

test('setPhoneKey normalises before sending', async () => {
  await setPhoneKey('0412 345 678', 'AU');
  assert.deepEqual(rpcCalls[0], { fn: 'set_phone_key', args: { p_e164: '+61412345678' } });
});

test('a squatted number and a rate limit are distinguishable', async () => {
  // Both are ordinary outcomes with different copy (§2, §7); collapsing them
  // into "failed" would make one of them unexplainable to the user.
  rpcError = { code: '23505', message: 'duplicate key' };
  assert.equal((await setPhoneKey('0412 345 678', 'AU')).reason, 'already-taken');

  rpcError = { code: '23514', message: 'check violation' };
  assert.equal((await setPhoneKey('0412 345 678', 'AU')).reason, 'rate-limited');

  rpcError = { code: '08006', message: 'connection failure' };
  assert.equal((await setPhoneKey('0412 345 678', 'AU')).reason, 'failed');
});

test('a lookup error yields no partial matches', async () => {
  rpcError = { code: '08006', message: 'connection failure' };
  const { matches, error } = await matchContacts([{ number: '0412 345 678', name: 'Bob' }], 'AU');
  assert.deepEqual(matches, []);
  assert.ok(error);
});

test('the remaining writes go through their own RPCs', async () => {
  await removePhoneKey();
  await setPhoneVisibility('nobody');
  assert.deepEqual(rpcCalls.map((c) => c.fn), ['remove_phone_key', 'set_phone_visibility']);
  assert.deepEqual(rpcCalls[1].args, { p_visibility: 'nobody' });
});
