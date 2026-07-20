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

/** §5.6 — the app-icon / nav-bar badge. Same rule, aggregated. */
export async function totalUnread() {
  const { data, error } = await supabase.rpc('total_unread_count');
  return { count: error ? 0 : (data ?? 0), error: error ?? null };
}
