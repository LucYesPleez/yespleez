/**
 * M8f · MESSAGING SERVICE — regression tests.
 *
 * These exercise the REAL messaging.js. Only the Supabase client is stubbed, so
 * what is under test is the shipped module rather than a reimplementation —
 * the same approach as writeNotification.test.js.
 *
 * What they lock down, in order of how expensive the bug would be:
 *
 *   1. from_user_id comes from the SESSION, never the caller (§A3). A caller
 *      that could supply it could record a different human as the author.
 *   2. Sending writes NO notification (`C18`). notify_new_message already
 *      fanned out per-human; a client write would duplicate AND be the wrong
 *      shape, delivering to one human beside the trigger's correct fan-out.
 *   3. Recency ordering reads last_message_at (§2.7) and does not join
 *      messages — the M8b trigger maintains it precisely so this stays cheap.
 *
 * Run: npm test   (see package.json — needs the resolve hook and mock flag)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const USER    = '22222222-2222-2222-2222-222222222222';
const OTHER   = '99999999-9999-9999-9999-999999999999';
const PROFILE = '11111111-1111-1111-1111-111111111111';
const CONV    = '33333333-3333-3333-3333-333333333333';

/** Every insert issued, as {table, row}. Reset per test. */
let inserted = [];
/** Every rpc issued, as {fn, args}. Reset per test. */
let rpcCalls = [];
/** Every query builder created, so ordering/filters can be asserted. */
let queries = [];
/** What an awaited (non-.single) query resolves to. */
let queryResult = { data: [], error: null };
/** Who the session says we are. */
let sessionUser = { id: USER };
/** What every rpc resolves to. can_act_as tests flip this. */
let rpcAnswer = 'rpc-result';

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: sessionUser }, error: null }),
      },
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: fn === 'can_act_as' ? rpcAnswer : 'rpc-result', error: null };
      },
      from(table) {
        const q = {
          table,
          eqs: [],
          ins: [],
          orders: [],
          insert(row) { inserted.push({ table, row }); q.insertedRow = row; return q; },
          select(cols) { q.cols = cols; return q; },
          eq(col, val) { q.eqs.push([col, val]); return q; },
          in(col, vals) { q.ins.push([col, vals]); return q; },
          order(col, opts) { q.orders.push([col, opts]); return q; },
          single: async () => ({ data: { id: 'new-message', ...q.insertedRow }, error: null }),
          // Thenable so `await supabase.from(...).select(...)` resolves.
          then(resolve) { resolve(queryResult); },
        };
        queries.push(q);
        return q;
      },
    },
  },
});

const {
  openConversation, sendMessage, listMessages,
  listConversations, markConversationRead, unreadCount, totalUnread,
  listParticipants, resolveSenderProfile,
} = await import('./messaging.js');

beforeEach(() => {
  inserted = [];
  rpcCalls = [];
  queries = [];
  queryResult = { data: [], error: null };
  sessionUser = { id: USER };
  rpcAnswer = 'rpc-result';
});

// ── §A3 · the audit identity is the session's, never the caller's ──

test('the human on a message is the session user, not anything the caller passed', async () => {
  // A caller trying to attribute authorship to someone else. The parameter
  // does not exist, so the attempt must simply have no effect.
  await sendMessage({
    conversationId: CONV,
    fromProfileId:  PROFILE,
    body:           'hello',
    fromUserId:     OTHER,
    from_user_id:   OTHER,
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, 'messages');
  assert.equal(inserted[0].row.from_user_id, USER, 'audit identity must come from the session');
  assert.equal(inserted[0].row.from_profile_id, PROFILE, 'attribution is the caller\'s choice');
});

test('sending refuses when there is no authenticated user', async () => {
  sessionUser = null;
  const { message, error } = await sendMessage({
    conversationId: CONV, fromProfileId: PROFILE, body: 'hello',
  });
  assert.equal(message, null);
  assert.match(error.message, /no authenticated user/);
  assert.equal(inserted.length, 0, 'must not attempt the insert');
});

// ── C18 · the trigger notifies; the client must not ──

test('sending writes no notification — notify_new_message already fanned out', async () => {
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: 'hello' });

  const notifWrites = inserted.filter(i => i.table === 'notifications');
  assert.equal(notifWrites.length, 0,
    'C18: a client notification here would double-notify AND deliver to one human ' +
    'beside the trigger per-human fan-out');
});

// ── the blank-body guard mirrors CHECK messages_body_not_blank ──

test('a blank body is refused without touching the network', async () => {
  for (const body of ['', '   ', '\n\t', undefined]) {
    const { message, error } = await sendMessage({
      conversationId: CONV, fromProfileId: PROFILE, body,
    });
    assert.equal(message, null);
    assert.ok(error, `expected refusal for ${JSON.stringify(body)}`);
  }
  assert.equal(inserted.length, 0, 'no insert should be attempted');
  assert.equal(queries.length, 0, 'no query builder should even be created');
});

test('a body is trimmed before it is stored', async () => {
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: '  hi  ' });
  assert.equal(inserted[0].row.body, 'hi');
});

test('a missing conversation or profile is refused', async () => {
  const a = await sendMessage({ fromProfileId: PROFILE, body: 'hi' });
  const b = await sendMessage({ conversationId: CONV, body: 'hi' });
  assert.ok(a.error);
  assert.ok(b.error);
  assert.equal(inserted.length, 0);
});

// ── C15 · creation goes through the elevated function, never a client insert ──

test('opening a conversation calls the elevated function, never inserts', async () => {
  const { conversationId } = await openConversation({
    contextType: 'application', contextId: CONV, participantIds: [PROFILE, OTHER],
  });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'open_conversation');
  assert.deepEqual(rpcCalls[0].args, {
    p_context_type:    'application',
    p_context_id:      CONV,
    p_participant_ids: [PROFILE, OTHER],
  });
  assert.equal(conversationId, 'rpc-result');
  assert.equal(inserted.length, 0, 'M8b grants the client no INSERT on conversations');
});

test('opening a conversation with no participants is refused locally', async () => {
  const { error } = await openConversation({ contextType: 'application', contextId: CONV, participantIds: [] });
  assert.ok(error);
  assert.equal(rpcCalls.length, 0);
});

// ── §2.7 · recency comes from last_message_at, not from joining messages ──

test('conversations are ordered by last_message_at, nulls last', async () => {
  await listConversations();

  const q = queries.at(-1);
  assert.equal(q.table, 'conversations');
  assert.deepEqual(q.orders, [['last_message_at', { ascending: false, nullsFirst: false }]]);
  assert.ok(!/messages/.test(q.cols), '2.7: must not join messages to find recency');
});

test('messages are ordered oldest first and scoped to the conversation', async () => {
  await listMessages(CONV);

  const q = queries.at(-1);
  assert.equal(q.table, 'messages');
  assert.deepEqual(q.eqs, [['conversation_id', CONV]]);
  assert.deepEqual(q.orders, [['created_at', { ascending: true }]]);
});

test('listing messages adds no participant filter of its own', async () => {
  await listMessages(CONV);
  const q = queries.at(-1);
  const filtered = q.eqs.map(([col]) => col);
  assert.deepEqual(filtered, ['conversation_id'],
    'M8b RLS is the access rule; a second one here could disagree with it');
});

// ── C11 / §5.6 · read state and the single counting rule ──

test('marking read goes through the monotonic function', async () => {
  await markConversationRead(CONV);
  assert.equal(rpcCalls[0].fn, 'mark_conversation_read');
  assert.deepEqual(rpcCalls[0].args, { p_conversation_id: CONV });
  assert.equal(inserted.length, 0, 'read state is never written directly from the client');
});

// ── §A4 · ownership is asked, never recomputed in the client ──

test('resolving the sender profile asks can_act_as — it never compares user_id', async () => {
  queryResult = {
    data: [
      { conversation_id: CONV, profile_id: 'theirs', profiles: { id: 'theirs', name: 'Them', type: 'venue', user_id: OTHER } },
      { conversation_id: CONV, profile_id: 'mine',   profiles: { id: 'mine',   name: 'Me',   type: 'artist', user_id: USER } },
    ],
    error: null,
  };
  // can_act_as answers true. Note the module requires a STRICT true — a
  // truthy string is not an ownership answer.
  rpcAnswer = true;

  const { profileId } = await resolveSenderProfile(CONV);

  assert.ok(rpcCalls.length > 0, 'A4: can_act_as is the sole ownership predicate');
  assert.ok(rpcCalls.every(c => c.fn === 'can_act_as'));
  // The stub answers true for the FIRST profile asked, so a client-side
  // user_id comparison would have returned 'mine' instead.
  assert.equal(profileId, 'theirs',
    'must take the database answer, not the row that happens to match the session');
});

test('resolving the sender profile returns null when no profile answers true', async () => {
  queryResult = {
    data: [{ conversation_id: CONV, profile_id: 'theirs' }],
    error: null,
  };
  rpcAnswer = false;

  const { profileId, error } = await resolveSenderProfile(CONV);

  assert.equal(profileId, null, 'no speakable profile is a null, not a guess');
  assert.equal(error, null, 'and not an error — it is a legitimate state');
});

test('participants are fetched for every requested conversation, unfiltered', async () => {
  await listParticipants([CONV, 'other-conv']);
  const q = queries.at(-1);
  assert.equal(q.table, 'conversation_participants');
  assert.deepEqual(q.ins, [['conversation_id', [CONV, 'other-conv']]]);
  assert.equal(q.eqs.length, 0,
    '2.2: a participant sees the WHOLE set; a filter here would hide the other party');
});

test('both badge surfaces use the database counting rule, not a local count', async () => {
  await unreadCount(CONV);
  await totalUnread();

  assert.deepEqual(rpcCalls.map(c => c.fn),
    ['conversation_unread_count', 'total_unread_count']);
  assert.equal(queries.length, 0, '5.6: one counting rule — no surface counts for itself');
});

// ── M9a · the read path must actually ASK for the kind ──────────────
//
// The renderer registry dispatches on `message.kind`. If the select omits it,
// every message arrives with kind undefined, resolves to text through the
// registry's fallback, and looks entirely healthy — a dispatch that cannot
// route anywhere else. That is what shipped: the column went live while
// MESSAGE_COLUMNS still did not name it.
//
// Asserted on BOTH paths that produce a message. Testing only listMessages
// would leave the message you just sent kindless until a refetch, which is the
// harder bug to see because it fixes itself on reload.

test('listing messages asks the database for kind and payload', async () => {
  await listMessages(CONV);
  const cols = queries.at(-1).cols;
  assert.match(cols, /\bkind\b/,    'without kind, every message renders as text through the fallback');
  assert.match(cols, /\bpayload\b/, 'without payload, no kind can carry its own data');
});

test('a sent message comes back with its kind and payload', async () => {
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: 'hello' });
  const cols = queries.at(-1).cols;
  assert.match(cols, /\bkind\b/,    'the sender renders what they just sent — it needs a kind too');
  assert.match(cols, /\bpayload\b/);
});

test('the kind on a sent message comes from the row, not a client literal', async () => {
  // The insert deliberately omits kind so Postgres applies its default. The
  // point is that nothing on the client SETS it to 'text' — a literal here
  // would survive into a voice note and be silently wrong.
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: 'hello' });
  const row = inserted.at(-1).row;
  assert.equal(row.kind, undefined,
    'sendMessage must not hardcode a kind; the column defaults to text (M9a)');
});
