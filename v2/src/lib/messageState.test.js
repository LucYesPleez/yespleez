import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const MSG     = '44444444-4444-4444-4444-444444444444';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const USER    = '33333333-3333-3333-3333-333333333333';

let ops = [];
let selectResult = { data: [], error: null };

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      from(table) {
        const q = {
          table, eqs: [], filters: [],
          upsert(row, opts) { ops.push({ op: 'upsert', table, row, opts }); return q; },
          update(row) { ops.push({ op: 'update', table, row }); return q; },
          delete() { ops.push({ op: 'delete', table }); return q; },
          select(cols) { q.cols = cols; return q; },
          in(col, vals) { q.filters.push(['in', col, vals]); return q; },
          not(col, op, val) { q.filters.push(['not', col, op, val]); return q; },
          eq(col, val) { q.eqs.push([col, val]); return q; },
          then(resolve) { resolve(selectResult); },
        };
        ops.push({ op: 'query', table, q });
        return q;
      },
    },
  },
});

const {
  listHands, listMessageState, handMessage, unhandMessage, toggleHand,
  setReaction, clearReaction, toggleReaction,
} = await import('./messageState.js');

beforeEach(() => {
  ops = [];
  selectResult = { data: [], error: null };
});

const lastOf = kind => [...ops].reverse().find(o => o.op === kind);

// ── §A3 · attribution and audit ─────────────────────────────────────

test('a Yes is attributed to the profile and audited to the session user', async () => {
  await handMessage({ messageId: MSG, profileId: PROFILE });
  const { row } = lastOf('upsert');
  assert.equal(row.message_id, MSG);
  assert.equal(row.profile_id, PROFILE, 'ATTRIBUTION — which profile said yes');
  assert.equal(row.from_user_id, USER, 'AUDIT — always the session, never a caller value');
  assert.ok(row.handed_at, 'a row exists only when there is a Yes');
});

test('the caller cannot forge the audit identity', async () => {
  // The parameter does not exist, so passing one must simply have no effect —
  // the same guarantee sendMessage makes.
  await handMessage({ messageId: MSG, profileId: PROFILE, from_user_id: 'someone-else', fromUserId: 'someone-else' });
  assert.equal(lastOf('upsert').row.from_user_id, USER);
});

// ── idempotence, because a gesture can double-fire ──────────────────

test('handing is idempotent on the primary key', async () => {
  // A double-tap that fires twice, or two devices at once, must be one Yes —
  // not a duplicate and not an error the UI has to explain.
  await handMessage({ messageId: MSG, profileId: PROFILE });
  const { opts } = lastOf('upsert');
  assert.equal(opts.onConflict, 'message_id,profile_id');
});

test('⚠ handing MERGES — it must not skip a row that already holds a reaction', () => {
  // CHANGED BY MR1, and this is the bug it prevents.
  //
  // This asserted `ignoreDuplicates: true` (ON CONFLICT DO NOTHING), which was
  // correct while a row could only ever mean "handed". A row may now already
  // exist carrying only a reaction — and DO NOTHING would make the Yes
  // silently fail for anyone who reacted to that message first. No error, no
  // symptom, just a Yes that does not appear.
  return handMessage({ messageId: MSG, profileId: PROFILE }).then(() => {
    const { opts } = lastOf('upsert');
    assert.equal(opts.ignoreDuplicates, false, 'must merge, not skip');
  });
});

test('⚠ a Yes and a reaction are MUTUALLY EXCLUSIVE — they share one badge slot', async () => {
  // Owner, 2026-07-25: carrying both is "weird". The chosen emoji sits exactly
  // where the Hand sits on the bubble, so a row holding both would put two
  // marks in one position and force the UI to invent a winner.
  //
  // Enforced at the single write path rather than in the components, so the
  // two cannot disagree about which mark a message has.
  await handMessage({ messageId: MSG, profileId: PROFILE });
  assert.equal(lastOf('upsert').row.reaction, null, 'a Yes clears the reaction');

  ops = [];
  await setReaction({ messageId: MSG, profileId: PROFILE, reaction: 'nails' });
  assert.equal(lastOf('upsert').row.handed_at, null, 'a reaction clears the Yes');
});

// ── a Yes is a ROW, never an edit to the message ────────────────────

test('nothing ever writes to the messages table', async () => {
  // D9 keeps messages immutable and there is no UPDATE policy on them. A
  // reaction that edited the message row would have to reopen that.
  await handMessage({ messageId: MSG, profileId: PROFILE });
  await unhandMessage({ messageId: MSG, profileId: PROFILE });
  await listHands([MSG]);
  assert.equal(ops.filter(o => o.table === 'messages').length, 0);
  assert.ok(ops.every(o => o.table === undefined || o.table === 'message_participant_state'));
});

test('⚠ taking a Yes back NULLS handed_at — it must not delete the row', async () => {
  // CHANGED BY MR1, and this is the bug it prevents.
  //
  // Deleting was right while `handed_at` was the only fact a row could hold.
  // The row may now also carry a reaction, and a DELETE would take that with
  // it: un-Yes a message and your emoji vanishes too, with nothing on screen
  // to explain why.
  //
  // A row with both columns null is inert — no reader counts it — and is
  // cleaned up by ON DELETE CASCADE with the message.
  await unhandMessage({ messageId: MSG, profileId: PROFILE });
  const upd = lastOf('update');
  assert.ok(upd, 'must UPDATE, not DELETE');
  assert.deepEqual(upd.row, { handed_at: null });
  assert.ok(!('reaction' in upd.row), 'and must not touch the reaction');
  assert.equal(lastOf('delete'), undefined, 'the row survives');

  const q = [...ops].reverse().find(o => o.op === 'query')?.q;
  assert.deepEqual(q.eqs, [['message_id', MSG], ['profile_id', PROFILE]],
    'scoped to one message and one profile — never a bulk write');
});

test('⚠ clearing a reaction leaves the Yes alone', async () => {
  // The mirror of the above, and the other half of the separation: the Hand
  // and the reaction are independent facts and neither may destroy the other.
  await clearReaction({ messageId: MSG, profileId: PROFILE });
  const upd = lastOf('update');
  assert.deepEqual(upd.row, { reaction: null });
  assert.ok(!('handed_at' in upd.row), 'must not touch the Yes');
  assert.equal(lastOf('delete'), undefined);
});

test('a reaction replaces rather than adds — one per person per message', async () => {
  await setReaction({ messageId: MSG, profileId: PROFILE, reaction: 'nails' });
  const { row, opts } = lastOf('upsert');
  assert.equal(row.reaction, 'nails');
  assert.equal(opts.onConflict, 'message_id,profile_id');
  assert.equal(opts.ignoreDuplicates, false, 'a second reaction must overwrite the first');
});

test('a reaction is audited to the session user, never the caller', async () => {
  await setReaction({ messageId: MSG, profileId: PROFILE, reaction: 'woozy', fromUserId: 'forged' });
  assert.equal(lastOf('upsert').row.from_user_id, USER);
});

test('toggleReaction clears the active one and sets a different one', async () => {
  await toggleReaction({ messageId: MSG, profileId: PROFILE, current: 'nails', reaction: 'nails' });
  assert.deepEqual(lastOf('update').row, { reaction: null }, 'same reaction → clear');

  ops = [];
  await toggleReaction({ messageId: MSG, profileId: PROFILE, current: 'nails', reaction: 'woozy' });
  assert.equal(lastOf('upsert').row.reaction, 'woozy', 'different reaction → replace');
});

// ── the toggle ──────────────────────────────────────────────────────

test('toggle hands when not handed and un-hands when handed', async () => {
  await toggleHand({ messageId: MSG, profileId: PROFILE, handed: false });
  assert.ok(lastOf('upsert'), 'not handed → hand it');

  ops = [];
  await toggleHand({ messageId: MSG, profileId: PROFILE, handed: true });
  assert.ok(lastOf('update'), 'already handed → take it back (by nulling, see above)');
  assert.equal(lastOf('upsert'), undefined);
});

test('toggle trusts the caller rather than re-reading first', async () => {
  // The thread already knows. A round-trip before acting would put a visible
  // delay on the gesture this feature exists to make instant.
  await toggleHand({ messageId: MSG, profileId: PROFILE, handed: false });
  assert.equal(ops.filter(o => o.op === 'query' && o.q.cols).length, 0, 'no SELECT before writing');
});

// ── reading ─────────────────────────────────────────────────────────

test('hands are grouped by message, and only real ones are read', async () => {
  selectResult = { data: [
    { message_id: MSG, profile_id: PROFILE, handed_at: '2026-07-21T00:00:00Z' },
    { message_id: MSG, profile_id: 'other', handed_at: '2026-07-21T00:01:00Z' },
    { message_id: 'm2', profile_id: PROFILE, handed_at: '2026-07-21T00:02:00Z' },
  ], error: null };

  const { byMessage, error } = await listHands([MSG, 'm2']);
  assert.equal(error, null);
  assert.deepEqual(byMessage.get(MSG), [PROFILE, 'other']);
  assert.deepEqual(byMessage.get('m2'), [PROFILE]);
});

test('⚠ a row with a reaction but no Yes is not read as a Yes', async () => {
  // The filter used to be `.not('handed_at','is',null)` in the query. MR1 reads
  // both facts in ONE round trip — a thread needs them together, and a second
  // request would show reactions arriving after the Yeses — so the split is
  // now in code. This is that split, pinned: the same row must be able to
  // appear in one map and not the other.
  selectResult = { data: [
    { message_id: MSG, profile_id: PROFILE, handed_at: null, reaction: 'nails' },
    { message_id: MSG, profile_id: 'other', handed_at: '2026-07-21T00:01:00Z', reaction: null },
    { message_id: MSG, profile_id: 'both',  handed_at: '2026-07-21T00:02:00Z', reaction: 'woozy' },
  ], error: null };

  const { hands, reactions } = await listMessageState([MSG]);
  assert.deepEqual(hands.get(MSG), ['other', 'both'], 'only rows with handed_at');
  assert.deepEqual(reactions.get(MSG).map(r => r.profile_id), [PROFILE, 'both'],
    'only rows with a reaction');
});

test('an empty thread asks the database nothing', async () => {
  const { byMessage } = await listHands([]);
  assert.equal(byMessage.size, 0);
  assert.equal(ops.length, 0, 'opening an empty conversation should cost no query');
});

test('a read failure returns an empty map, not a broken thread', async () => {
  selectResult = { data: null, error: { message: 'boom' } };
  const { byMessage, error } = await listHands([MSG]);
  assert.ok(error);
  assert.equal(byMessage.size, 0, 'reactions are decoration — their failure must not break messages');
});

test('both writes refuse incomplete arguments before reaching the database', async () => {
  for (const fn of [handMessage, unhandMessage]) {
    ops = [];
    const { error } = await fn({ messageId: MSG });
    assert.ok(error, `${fn.name} must refuse a missing profile`);
    assert.equal(ops.length, 0);
  }
});
