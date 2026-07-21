import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const CONV    = '11111111-1111-1111-1111-111111111111';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const USER    = '33333333-3333-3333-3333-333333333333';

let inserted = [];

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      from(table) {
        const q = {
          insert(row) { inserted.push({ table, row }); q.row = row; return q; },
          select() { return q; },
          single: async () => ({ data: { id: 'new-message', ...q.row }, error: null }),
          then(resolve) { resolve({ data: [], error: null }); },
        };
        return q;
      },
    },
  },
});

const { sendHand, HAND_BODY } = await import('./hands.js');
const { KINDS, LABELS } = await import('./messageKindList.js');

beforeEach(() => { inserted = []; });

test('a Hand is an ordinary message with kind hand', async () => {
  // "A conversation Hand is a MESSAGE" — the ratified rule. It goes through the
  // normal send path with no special handling, which is the whole claim M9a
  // made about adding kinds.
  await sendHand({ conversationId: CONV, fromProfileId: PROFILE });

  const { table, row } = inserted.at(-1);
  assert.equal(table, 'messages');
  assert.equal(row.kind, 'hand');
  assert.equal(row.conversation_id, CONV);
  assert.equal(row.from_profile_id, PROFILE);
  assert.equal(row.from_user_id, USER, '§A3 — the audit identity is still the session user');
});

test('a Hand carries no payload', async () => {
  // Nothing to carry: the mark IS the message. A payload here would be a place
  // for meaning to leak out of the kind and into unvalidated jsonb.
  await sendHand({ conversationId: CONV, fromProfileId: PROFILE });
  assert.equal(inserted.at(-1).row.payload, undefined);
});

test('the body says Yes, because three surfaces only read text', async () => {
  // M8a's non-blank CHECK applies to every kind. An inbox preview, a push
  // notification and a screen reader can render nothing else — and 'Yes' means
  // a client too old to know this kind still shows exactly what was meant.
  await sendHand({ conversationId: CONV, fromProfileId: PROFILE });
  assert.equal(inserted.at(-1).row.body, 'Yes');
  assert.equal(HAND_BODY, 'Yes');
  assert.ok(HAND_BODY.trim().length > 0, 'a blank body would violate messages_body_not_blank');
});

test('the product never says "hand" where a user can read it', async () => {
  // The mark is the Hand; the word is Yes. If the label or the body ever says
  // "hand", it has leaked from an internal identifier into copy.
  assert.equal(LABELS.hand, 'Yes');
  assert.doesNotMatch(HAND_BODY, /hand/i);
  assert.doesNotMatch(LABELS.hand, /hand/i);
});

test('hand is a registered kind', async () => {
  // Guards the whole file: every assertion above is meaningless if the kind is
  // not one the database would accept.
  assert.ok(KINDS.includes('hand'));
});

test('a Hand needs a conversation and a sender', async () => {
  const missing = await sendHand({ conversationId: CONV });
  assert.equal(missing.message, null);
  assert.ok(missing.error, 'a Hand with no sender must not reach the database');
  assert.equal(inserted.length, 0);
});

// ── the acknowledgement is not drawn in a bubble ────────────────────

test('hand is a BARE kind and text is not', async () => {
  const { isBareKind } = await import('./messageKindList.js');
  // A bubble means "someone said this". An acknowledgement is not saying
  // anything — it IS the thing, so wrapping it makes it a picture of a gesture.
  assert.equal(isBareKind('hand'), true);
  assert.equal(isBareKind('text'), false);
  assert.equal(isBareKind('voice'), false);
  assert.equal(isBareKind(undefined), false, 'a message with no kind must still get its bubble');
});

test('every bare kind is a real kind', async () => {
  const { BARE_KINDS, KINDS: K } = await import('./messageKindList.js');
  // A bare kind the database would reject is a presentation rule for a message
  // that can never exist.
  for (const k of BARE_KINDS) assert.ok(K.includes(k), `'${k}' is bare but not a kind`);
});

// ── scale, designed in before it is driven ──────────────────────────

test('scale defaults to the minimum and never escapes its range', async () => {
  const { handScale, HAND_SCALE_MIN, HAND_SCALE_MAX } = await import('./messageKindList.js');
  // payload is unvalidated by design (M9a), so the renderer owns this.
  assert.equal(handScale(undefined), HAND_SCALE_MIN);
  assert.equal(handScale(null), HAND_SCALE_MIN);
  assert.equal(handScale('nonsense'), HAND_SCALE_MIN, 'junk must not render a NaN-sized mark');
  assert.equal(handScale(NaN), HAND_SCALE_MIN);
  assert.equal(handScale(-40), HAND_SCALE_MIN, 'a negative scale would flip or vanish the mark');
  assert.equal(handScale(9999), HAND_SCALE_MAX, 'an unbounded scale would fill the screen');
  assert.equal(handScale(2), 2, 'a legitimate value passes through');
});

test('a tap sends no scale at all', async () => {
  // Same rule as waveform peaks: omit the default rather than writing it. A key
  // holding the default answers the renderer identically to no key, and costs
  // bytes on every read of every message forever.
  await sendHand({ conversationId: CONV, fromProfileId: PROFILE });
  assert.equal(inserted.at(-1).row.payload, undefined);
});
