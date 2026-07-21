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

const { listHands, handMessage, unhandMessage, toggleHand } = await import('./messageState.js');

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
  assert.equal(opts.ignoreDuplicates, true);
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

test('taking a Yes back deletes the row rather than nulling it', async () => {
  // A row means a Yes. Nulling would create a second state that looks like one,
  // and is why M9i has no UPDATE policy.
  await unhandMessage({ messageId: MSG, profileId: PROFILE });
  assert.ok(lastOf('delete'), 'must DELETE');
  const q = [...ops].reverse().find(o => o.op === 'query')?.q;
  assert.deepEqual(q.eqs, [['message_id', MSG], ['profile_id', PROFILE]],
    'scoped to one message and one profile — never a bulk delete');
});

// ── the toggle ──────────────────────────────────────────────────────

test('toggle hands when not handed and un-hands when handed', async () => {
  await toggleHand({ messageId: MSG, profileId: PROFILE, handed: false });
  assert.ok(lastOf('upsert'), 'not handed → hand it');

  ops = [];
  await toggleHand({ messageId: MSG, profileId: PROFILE, handed: true });
  assert.ok(lastOf('delete'), 'already handed → take it back');
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

  const q = [...ops].reverse().find(o => o.op === 'query')?.q;
  assert.ok(q.filters.some(f => f[0] === 'not' && f[1] === 'handed_at'),
    'rows without a handed_at are not Yeses and must not be read as ones');
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
