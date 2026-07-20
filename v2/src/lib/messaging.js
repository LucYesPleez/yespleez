import { supabase } from './supabase';

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

/** §A3 — attribution and audit are both stored; only attribution is displayed. */
const MESSAGE_COLUMNS =
  'id, conversation_id, from_profile_id, from_user_id, body, created_at';

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
 * @param {string} opts.body
 * @returns {Promise<{message: object|null, error: object|null}>}
 */
export async function sendMessage({ conversationId, fromProfileId, body } = {}) {
  // Mirror CHECK messages_body_not_blank rather than letting Postgres raise it.
  // A constraint name is not a message a UI can show.
  if (!conversationId || !fromProfileId || !body || !body.trim()) {
    return { message: null, error: { message: 'sendMessage: conversationId, fromProfileId and a non-blank body are required' } };
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
    })
    .select(MESSAGE_COLUMNS)
    .single();

  // No notification write here. notify_new_message already fanned out. See header.
  return { message: error ? null : data, error: error ?? null };
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
    .select('conversation_id, profile_id, archived_at, profiles ( id, name, type )')
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
