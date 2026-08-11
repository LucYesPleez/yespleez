import { supabase } from './supabase';
import { isKind } from './messageKindList';
import { track, EVENTS } from './analytics';

/**
 * The one place messages are sent and read.
 *
 * Written BEFORE the call sites exist, deliberately. `writeNotification.js`'s
 * header records what happened when that consolidation came late: fifteen write
 * paths, so any change to the row shape meant fifteen edits and the sixteenth
 * call site missed it. This module exists so messaging never accumulates those.
 *
 * ── THE DATABASE DOES MOST OF THIS ───────────────────────────────────
 *
 * M8a–M8e mean a send is ONE insert. Everything else is a trigger:
 *
 *   conversations.last_message_at   touch_conversation_last_message  (M8b)
 *   notifications + fan-out         notify_new_message               (M8e)
 *   preference suppression          apply_notification_preferences   (NP1)
 *
 * ⚠ DO NOT CALL writeNotification() WHEN SENDING A MESSAGE. The trigger already
 * did, for every human who can act as each recipient profile. Adding a client
 * write would double-notify, and would deliver to ONE human (the caller's
 * inferred profile owner) alongside the trigger's correct per-human fan-out —
 * so the duplicate would also be the wrong shape. `C18`: notifications
 * originate from shared services, never from UI.
 *
 * ── WHY THERE IS NO createConversation() FOR ARBITRARY PARTICIPANTS ───
 *
 * §4.3 makes creation automatic from workflow acts, and M8b grants the client
 * no INSERT on `conversations` at all. `openConversation` below is a thin call
 * to the elevated `open_conversation` function, which enforces the STRICT
 * caller rule: the caller must be able to act as at least one participant.
 * There is no other path, by design.
 *
 * ── IDENTITY: TWO VALUES, ONLY ONE OF THEM YOURS TO CHOOSE ───────────
 *
 * §A3 requires both on every message:
 *
 *   from_profile_id  ATTRIBUTION — which of YOUR profiles is speaking. The
 *                                  caller chooses this; it is displayed.
 *   from_user_id     AUDIT       — the human. NEVER caller-supplied. Read from
 *                                  the session, always.
 *
 * `sendMessage` deliberately takes no `fromUserId` parameter. M8b's policy
 * would reject a forged one anyway (`from_user_id = auth.uid()`), but an API
 * that accepts a value it then has to police is an API inviting the bug.
 */

/** Columns a conversation list needs. `participant_key` is internal to `C15`. */
const CONVERSATION_COLUMNS =
  'id, context_type, context_id, subject_state, status, created_at, last_message_at';

/**
 * §A3 — attribution and audit are both stored; only attribution is displayed.
 *
 * `kind` and `payload` (M9a) are NOT optional here. The renderer registry
 * dispatches on `kind`, and a select that omits it delivers `undefined` to
 * every message — so the dispatch resolves to text through its fallback and
 * looks perfectly healthy while being incapable of routing anywhere else.
 *
 * That is exactly the failure M9a was written to end, one layer further down:
 * the column existed for hours while this line still did not ask for it.
 * `messaging.columns.test.js` fails if either name is dropped again.
 */
const MESSAGE_COLUMNS =
  'id, conversation_id, from_profile_id, from_user_id, body, kind, payload, created_at, deleted_at, deleted_by';

/**
 * Postgres unique-violation, and the index that carries our idempotency key.
 * Named rather than inlined because sendMessage must distinguish OUR constraint
 * from any other unique violation on the table: only this one proves the very
 * message we are sending is already delivered. See the block in sendMessage.
 */
const DUPLICATE_KEY     = '23505';
const CLIENT_ID_INDEX   = 'messages_client_id_uniq';

function isClientIdDuplicate(error) {
  if (!error || error.code !== DUPLICATE_KEY) return false;
  // PostgREST puts the constraint name in `message` and the column in `details`;
  // either is enough, and matching both keeps this working if that ever flips.
  const reported = `${error.message ?? ''} ${error.details ?? ''}`;
  return reported.includes(CLIENT_ID_INDEX) || reported.includes('client_id');
}

/**
 * Open (or re-open) the conversation for a workflow act.
 *
 * Idempotent per `C15`: calling twice for the same act returns the SAME
 * conversation rather than raising, so a caller needs no duplicate defence.
 *
 * @param {object} opts
 * @param {string} opts.contextType     one of application|invitation|booking|event|venue
 * @param {string} opts.contextId       the workflow object's id
 * @param {string[]} opts.participantIds participant PROFILE ids (§A5)
 * @returns {Promise<{conversationId: string|null, error: object|null}>}
 */
export async function openConversation({ contextType, contextId, participantIds } = {}) {
  if (!contextType || !contextId || !participantIds?.length) {
    return { conversationId: null, error: { message: 'openConversation: contextType, contextId and participantIds are required' } };
  }
  const { data, error } = await supabase.rpc('open_conversation', {
    p_context_type:    contextType,
    p_context_id:      contextId,
    p_participant_ids: participantIds,
  });
  return { conversationId: error ? null : data, error: error ?? null };
}

/**
 * The most recent message in each of these conversations, for inbox previews.
 *
 * ONE query rather than one per conversation: rows come back newest-first and
 * the first hit per conversation wins. The cap is a safety limit, not a page —
 * an inbox of any realistic size resolves well inside it, and a conversation
 * that falls outside simply shows no preview rather than a wrong one.
 *
 * §C32 is unaffected: this is content shown back to a participant who can
 * already read it, not content feeding a platform system.
 *
 * @param {string[]} conversationIds
 * @returns {Promise<{byConversation: object, error: object|null}>}
 */
export async function latestMessages(conversationIds) {
  const ids = [].concat(conversationIds ?? []).filter(Boolean);
  if (!ids.length) return { byConversation: {}, error: null };

  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id, body, created_at, from_profile_id, kind')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) return { byConversation: {}, error };

  const byConversation = {};
  for (const m of data ?? []) {
    if (!byConversation[m.conversation_id]) byConversation[m.conversation_id] = m;
  }
  return { byConversation, error: null };
}

/**
 * The profiles this human may send AS.
 *
 * Feeds the one-time "Message as…" prompt when starting a NEW conversation.
 * Once a conversation exists its sender identity is fixed — the participant
 * set is frozen at creation (§2.1), so there is nothing to re-ask.
 *
 * ⚠ THIS LIST IS FOR THE SENDER'S OWN EYES ONLY. Never render another human's
 * profile set anywhere in messaging: the recipient needs to know which PROFILE
 * is participating and nothing else. Exposing the set would leak that one
 * person runs a venue, a festival and an artist alias — a link the app does
 * not otherwise make, and cannot un-make once seen.
 */
export async function sendableProfiles(userId) {
  if (!userId) return { profiles: [], error: null };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, type, avatar_thumb, avatar')
    .eq('user_id', userId)
    .order('type');
  return { profiles: error ? [] : (data ?? []), error: error ?? null };
}

/**
 * Open a direct conversation between two profiles (M8h).
 *
 * `C17` (no cold DM) was amended by the owner on 20 Jul 2026 — any profile may
 * message any other. The STRICT caller rule is unchanged: you must be able to
 * act as the profile you are sending AS. Message anyone; never as someone else.
 *
 * Idempotent and symmetric — A→B and B→A resolve to ONE thread, because the
 * database derives the context id from the sorted pair.
 *
 * @returns {Promise<{conversationId: string|null, error: object|null}>}
 */
export async function openDirectConversation(fromProfileId, toProfileId) {
  if (!fromProfileId || !toProfileId) {
    return { conversationId: null, error: { message: 'openDirectConversation: both profiles are required' } };
  }
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    p_from_profile_id: fromProfileId,
    p_to_profile_id:   toProfileId,
  });
  return { conversationId: error ? null : data, error: error ?? null };
}

/**
 * Send a message.
 *
 * Returns the created row as well as the error — unlike writeNotification,
 * which returns only an error. A sender displays what they just sent; a
 * notification's author never sees it.
 *
 * @param {object} opts
 * @param {string} opts.conversationId
 * @param {string} opts.fromProfileId  which of the sender's profiles is speaking (§A3)
 * @param {string} opts.body    for a non-text kind this is the FALLBACK text —
 *                              what a notification preview, a screen reader and
 *                              an older client will show. Required either way.
 * @param {string} [opts.kind]  M9a. Omitted means text, applied by the column
 *                              default rather than by a literal here.
 * @param {object} [opts.payload] kind-specific structure. The renderer owns its
 *                              shape; the database validates none of it.
 * @param {string} [opts.clientId] IDEMPOTENCY KEY — see the block below. The
 *                              Outbox passes its entry id; nothing else passes
 *                              anything, and without it behaviour is unchanged.
 * @returns {Promise<{message: object|null, error: object|null}>}
 */
export async function sendMessage({ conversationId, fromProfileId, body, kind, payload, clientId } = {}) {
  // Mirror CHECK messages_body_not_blank rather than letting Postgres raise it.
  // A constraint name is not a message a UI can show.
  //
  // body is required for EVERY kind, not just text. A voice note sends
  // 'Voice message' — M9a keeps the column non-blank precisely so an
  // unrenderable message is still legible to the three surfaces that only ever
  // see text.
  if (!conversationId || !fromProfileId || !body || !body.trim()) {
    return { message: null, error: { message: 'sendMessage: conversationId, fromProfileId and a non-blank body are required' } };
  }

  // Mirror CHECK messages_kind_valid, same reasoning as body above. The
  // database remains the authority — this exists so a typo surfaces as a
  // sentence instead of as `23514 messages_kind_valid`.
  if (kind !== undefined && !isKind(kind)) {
    return { message: null, error: { message: `sendMessage: '${kind}' is not a message kind` } };
  }

  // §A3 AUDIT identity — from the session, never from the caller. See header.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { message: null, error: authError };
  const userId = auth?.user?.id;
  if (!userId) {
    return { message: null, error: { message: 'sendMessage: no authenticated user' } };
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      from_profile_id: fromProfileId,   // ATTRIBUTION — the caller's choice
      from_user_id:    userId,          // AUDIT — the session's, always
      body:            body.trim(),
      // Spread rather than set: an omitted kind must reach Postgres ABSENT so
      // the column default applies. Writing `kind: kind ?? 'text'` here would
      // put a client literal on every row, which is the shape of bug that made
      // lastPreview claim 'text' for messages that had no kind at all.
      ...(kind     !== undefined && { kind }),
      ...(payload  !== undefined && { payload }),
      ...(clientId !== undefined && { client_id: clientId }),
    })
    .select(MESSAGE_COLUMNS)
    .single();

  let row     = data;
  let failure = error;

  /* ── THE SEND IS IDEMPOTENT, AND THIS IS WHERE ─────────────────────
   *
   * ⚠ THE BUG THIS EXISTS TO END (a tester received the same Voicey 10+ times):
   * the line above is ONE statement to us but a WRITE and a READ-BACK to
   * Postgres. On flaky mobile data the insert lands — the row is written and
   * notify_new_message has already fanned out to the recipient — and then the
   * response never comes home. We see `error`, the Outbox marks the entry
   * failed, and every later flush re-runs this uploader and inserts the message
   * AGAIN. Nothing deduplicated, so the copies were unbounded: retry was not
   * safe to repeat, which is the one property an at-least-once delivery system
   * has to have.
   *
   * A unique index on client_id makes the second insert impossible, and its
   * violation is PROOF the first one landed. So 23505 here is not a failure to
   * report — it is a delivery to confirm. We read the row back so the thread can
   * show it immediately; if even that read fails we still report success,
   * because the constraint has already told us the truth and the realtime echo
   * will bring the row. Reporting the error instead would put the entry back
   * into the loop this block exists to break.
   *
   * The guard is `clientId` being present, so ONLY Outbox sends can take this
   * path — every other caller behaves exactly as before.
   */
  if (failure && clientId && isClientIdDuplicate(failure)) {
    const { data: existing } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('client_id', clientId)
      .maybeSingle();
    row     = existing ?? null;
    failure = null;
  }

  // No notification write here. notify_new_message already fanned out. See header.

  // A1 · instrumented HERE and nowhere else, because this is the one insert
  // every kind passes through — voice notes, photos, files and Hands all call
  // sendMessage rather than writing their own row. Tracking at the four
  // composer call sites instead would miss whichever one is added next.
  //
  // Only on success: a failed send is not a sent message, and counting the
  // attempt would make the messaging graph disagree with the messages table.
  //
  // A recovered duplicate counts exactly ONCE: the attempt that actually wrote
  // the row reported an error and never got here, so this is the first and only
  // time that message is tracked.
  if (!failure) {
    track(kind === 'voice' ? EVENTS.SENT_VOICEY : EVENTS.SENT_MESSAGE, {
      // The kind, never the body — rule 3. `kind` is undefined for plain text
      // (the column default applies), so it is normalised here rather than
      // recorded as a hole in the data.
      kind: kind ?? 'text',
    });
  }

  return { message: failure ? null : row, error: failure ?? null };
}

/**
 * Messages in a conversation, oldest first.
 *
 * No participant filter: M8b's SELECT policy already restricts this to
 * conversations the caller participates in. Adding a predicate here would be a
 * second access rule that could disagree with the first.
 */
export async function listMessages(conversationId) {
  if (!conversationId) return { messages: [], error: null };
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return { messages: error ? [] : (data ?? []), error: error ?? null };
}

/**
 * The caller's conversations, most recently active first.
 *
 * Sorted by `last_message_at` (§2.7), which the M8b trigger maintains — so this
 * does not join `messages` to find recency. NULLs (no messages yet) sort last.
 */
export async function listConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  return { conversations: error ? [] : (data ?? []), error: error ?? null };
}

/**
 * Advance this HUMAN's read watermark (`C11`).
 *
 * Monotonic in the database (`GREATEST`), so calling it out of order or twice
 * cannot resurrect read messages as unread.
 */
export async function markConversationRead(conversationId) {
  if (!conversationId) return { readAt: null, error: null };
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  return { readAt: error ? null : data, error: error ?? null };
}

/**
 * Unread count for one conversation, for this human.
 *
 * §5.6 — one counting rule across four surfaces. Every badge MUST come from
 * here or from `totalUnread`; a surface that counts for itself is a surface
 * that can disagree with the others.
 */
export async function unreadCount(conversationId) {
  if (!conversationId) return { count: 0, error: null };
  const { data, error } = await supabase.rpc('conversation_unread_count', {
    p_conversation_id: conversationId,
  });
  return { count: error ? 0 : (data ?? 0), error: error ?? null };
}

/**
 * The latest moment ANY OTHER participant read this conversation, or null.
 *
 * Drives the EQ receipt's top rung: every message you sent at or before this
 * instant has been seen.
 *
 * ── ONE TIMESTAMP, NOT A LIST, AND THAT IS THE POINT ─────────────────
 *
 * M10a amends §2.5 to allow receipts at all — but it exposes an AGGREGATE
 * rather than opening `conversation_read_state`, which stays as locked as M8d
 * left it. §2.5's objection was never that the sender must not know; it was
 * that a raw table read would reveal WHICH human inside a shared profile opened
 * a booking negotiation, and when. This answers the sender's question and
 * nothing else.
 *
 * So on a multi-owner profile, ANY owner's reading marks it seen and the sender
 * cannot tell them apart. Intended, not a gap.
 *
 * Never throws: a receipt is an embellishment on a message that has already
 * been delivered, and it must not be able to break a thread from rendering.
 */
export async function conversationSeenWatermark(conversationId) {
  if (!conversationId) return { seenAt: null, error: null };
  const { data, error } = await supabase.rpc('conversation_seen_watermark', {
    p_conversation_id: conversationId,
  });
  return { seenAt: error ? null : (data ?? null), error: error ?? null };
}

/**
 * The realtime channel a conversation's receipts travel on.
 *
 * ⚠ BROADCAST, NOT `postgres_changes`, AND THAT IS FORCED. Row-change events
 * respect RLS, and the sender CANNOT read the recipient's read-state row —
 * that wall is M8d's and M10a deliberately left it standing. A table
 * subscription would therefore deliver the sender nothing at all.
 *
 * Broadcast is client-to-client, so it sidesteps the read entirely: the
 * recipient announces "I have it", the sender hears it directly. The database
 * row is still written and is still the source of truth on load — the
 * broadcast only saves the sender from asking.
 *
 * Ephemeral by nature: a sender who is offline misses the announcement and
 * picks it up from `conversationReceipts` next time the thread opens. That is
 * the correct division — durable state in the table, liveness on the wire.
 */
export function receiptChannelName(conversationId) {
  return `receipts:${conversationId}`;
}

/**
 * Announce a receipt for a conversation this client has no open channel to.
 *
 * The thread's own channel only exists while `ConversationView` has it open.
 * Delivery, though, happens wherever the app is — a message arriving while the
 * recipient is on Discover is every bit as delivered, and the sender should see
 * it. So this opens a channel just long enough to say so.
 *
 * Transient on purpose. Holding a live channel for every conversation a user
 * has would be a socket per thread to carry an event that fires a few times a
 * day; a few hundred bytes on arrival is the cheaper trade.
 *
 * Fire-and-forget. The durable record is the row the caller already wrote, so a
 * failed announcement costs the sender a delay, never correctness.
 */
export function announceDelivered(conversationId) {
  if (!conversationId) return;
  const channel = supabase.channel(receiptChannelName(conversationId), {
    config: { broadcast: { self: false } },
  });
  channel.subscribe(status => {
    if (status !== 'SUBSCRIBED') return;
    channel.send({
      type: 'broadcast',
      event: 'receipt',
      payload: { delivered: new Date().toISOString() },
    });
    // Let the frame settle before tearing down, or the send can be dropped
    // with the socket it was written to.
    setTimeout(() => supabase.removeChannel(channel), 400);
  });
}

/**
 * ⚠ THE ACKNOWLEDGEMENT. Call this ONLY when this device genuinely has the
 * message — never on send, never on notify, never on a guess.
 *
 * "Delivered" is the one receipt that is easy to fake and worthless once faked.
 * Storing a row, queueing a push, or a notification being accepted all happen
 * without the recipient's device ever seeing anything; a sender who is told
 * "delivered" on any of those has been told something untrue at the exact
 * moment they are deciding whether to chase a reply.
 *
 * Idempotent in the database (GREATEST), so a replay, a reconnect or three
 * devices acknowledging at once cannot produce inconsistent state — and this
 * client is free to call it whenever it is unsure rather than tracking whether
 * it already has.
 */
export async function markConversationDelivered(conversationId) {
  if (!conversationId) return { deliveredAt: null, error: null };
  const { data, error } = await supabase.rpc('mark_conversation_delivered', {
    p_conversation_id: conversationId,
  });
  return { deliveredAt: error ? null : (data ?? null), error: error ?? null };
}

/**
 * Both watermarks for everyone OTHER than the caller, in one round trip.
 *
 * Supersedes `conversationSeenWatermark`. Same aggregate discipline: the sender
 * learns WHEN their message arrived and was read, never WHO on a shared profile
 * did either — which is the §2.5 line that M10a amended without erasing.
 *
 * Never throws. A receipt is an embellishment on a message that has already
 * been delivered, and it must not be able to stop a thread rendering.
 */
export async function conversationReceipts(conversationId) {
  if (!conversationId) return { deliveredAt: null, seenAt: null, error: null };
  const { data, error } = await supabase.rpc('conversation_receipts', {
    p_conversation_id: conversationId,
  });
  // A TABLE-returning function arrives as an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    deliveredAt: error ? null : (row?.delivered_at ?? null),
    seenAt:      error ? null : (row?.seen_at ?? null),
    error: error ?? null,
  };
}

/**
 * Participants of one or more conversations, with the profile fields a list
 * needs to render.
 *
 * M8b's SELECT policy returns the WHOLE participant set to any participant —
 * §2.2 makes a conversation a relationship, and a thread whose other party is
 * invisible cannot be reasoned about. So this needs no filter.
 *
 * @param {string|string[]} conversationIds
 */
export async function listParticipants(conversationIds) {
  const ids = [].concat(conversationIds ?? []).filter(Boolean);
  if (!ids.length) return { participants: [], error: null };
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id, profile_id, archived_at, profiles ( id, name, type, avatar_thumb, avatar )')
    .in('conversation_id', ids);
  return { participants: error ? [] : (data ?? []), error: error ?? null };
}

/**
 * Of these profile ids, which may the caller act as?
 *
 * Deduplicates before asking, because an inbox repeats the same few profiles
 * across many conversations. Exists so a SCREEN never has to work out "is this
 * one mine?" — the answer comes from `can_act_as` (§A4), never from comparing
 * `profiles.user_id` in the client.
 *
 * @param {string[]} profileIds
 * @returns {Promise<{mine: Set<string>, error: object|null}>}
 */
export async function actableProfileIds(profileIds) {
  const unique = [...new Set((profileIds ?? []).filter(Boolean))];
  const mine = new Set();
  for (const id of unique) {
    const { data, error } = await supabase.rpc('can_act_as', { profile_id: id });
    if (error) return { mine, error };
    if (data === true) mine.add(id);
  }
  return { mine, error: null };
}

/**
 * Which of the caller's profiles may speak in this conversation.
 *
 * ⚠ DOES NOT COMPARE `profiles.user_id` TO THE SESSION. That would be a second
 * ownership rule living in the client, and §A4 makes `can_act_as` the SOLE
 * ownership predicate. When identity goes multi-owner, a client-side
 * `user_id === session.user.id` silently becomes wrong while continuing to
 * return an answer — the same failure `profile_actors` was written to avoid on
 * the server side.
 *
 * Asks the database once per participant. A conversation has two.
 *
 * @returns {Promise<{profileId: string|null, error: object|null}>}
 */
export async function resolveSenderProfile(conversationId) {
  const { participants, error } = await listParticipants(conversationId);
  if (error) return { profileId: null, error };

  for (const p of participants) {
    const { data, error: rpcError } = await supabase.rpc('can_act_as', {
      profile_id: p.profile_id,
    });
    if (rpcError) return { profileId: null, error: rpcError };
    if (data === true) return { profileId: p.profile_id, error: null };
  }
  // Not a participant, or the thread belongs to profiles you no longer own.
  return { profileId: null, error: null };
}

/** §5.6 — the app-icon / nav-bar badge. Same rule, aggregated. */
export async function totalUnread() {
  const { data, error } = await supabase.rpc('total_unread_count');
  return { count: error ? 0 : (data ?? 0), error: error ?? null };
}

/**
 * UNSEND — withdraw a message you sent.
 *
 * ⚠⚠ THE UPDATE SETS ONE COLUMN, AND THAT IS THE WHOLE INTERFACE. `deleted_at`
 * is sent as a mere signal of intent; U1's trigger throws away the value and
 * every other column the request carries, then writes the redaction itself. So
 * this cannot be turned into an edit by adding a field here — the server would
 * discard it. Do not "improve" this by sending the tombstone body from the
 * client; that would be the app asserting what the record becomes, which is
 * exactly what the trigger exists to prevent.
 *
 * ⭐ `.select()` IS SAFE HERE, unlike on insert. The read-back failure that
 * caused duplicate sends mattered because a retry re-inserted; withdrawing is
 * idempotent in the only direction that counts — the second attempt is refused
 * by the trigger because the row is already withdrawn, so a lost response can
 * never produce a second effect. Realtime carries the redaction to both sides.
 *
 * @returns {Promise<{message: object|null, error: object|null}>}
 */
export async function unsendMessage(messageId) {
  if (!messageId) return { message: null, error: new Error('messageId is required') };

  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();

  /**
   * ⚠ ZERO ROWS IS THE WINDOW CLOSING, NOT A BUG. RLS filters the UPDATE
   * rather than refusing it, so a message past its 15 minutes — or one sent by
   * somebody else — simply matches nothing and returns `null` with no error.
   * Reporting that as success would leave the sender believing a message was
   * withdrawn while the other person still has it, which is the exact shape of
   * the duplicate-send defect: a silent failure that looks like a win.
   */
  if (!error && !data) {
    return {
      message: null,
      error: new Error('That message can no longer be unsent.'),
    };
  }

  return { message: data ?? null, error: error ?? null };
}
