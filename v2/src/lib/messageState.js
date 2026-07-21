import { supabase } from './supabase';

/**
 * MESSAGE PARTICIPANT STATE — what a participant has done with a message.
 *
 *     A CONVERSATION Hand is a MESSAGE.  A MESSAGE Hand is METADATA.
 *
 * `hands.js` sends the first. This reads and writes the second.
 *
 * Today that is only `handed_at`. `played_at` and `hidden_at` belong in the
 * same table and are not built — see M9i's header, they raise a visibility
 * question the current read policy would prejudge.
 *
 * ── A HAND IS A ROW, NOT A COLUMN ON A MESSAGE ───────────────────────
 *
 * `D9` keeps messages immutable and there is still no UPDATE policy on them.
 * A reaction that edited the message row would have to reopen that; a separate
 * row pointing at the message does not. Handing INSERTs, un-handing DELETEs,
 * and the primary key `(message_id, profile_id)` makes both idempotent.
 *
 * ── §A3 ──────────────────────────────────────────────────────────────
 *
 * `profile_id` is ATTRIBUTION — which of your profiles gave the Yes, and what
 * is displayed. `from_user_id` is AUDIT, read from the session and never
 * accepted from a caller, exactly as `sendMessage` does it.
 */

const STATE_COLUMNS = 'message_id, profile_id, handed_at';

/**
 * Every Hand on a set of messages.
 *
 * Returns a Map of message_id → array of profile_ids that handed it, which is
 * the shape the thread actually renders: "who said yes to this", in order, per
 * message. Callers should not have to group it themselves.
 */
export async function listHands(messageIds = []) {
  const ids = messageIds.filter(Boolean);
  if (!ids.length) return { byMessage: new Map(), error: null };

  const { data, error } = await supabase
    .from('message_participant_state')
    .select(STATE_COLUMNS)
    .in('message_id', ids)
    .not('handed_at', 'is', null);

  if (error) return { byMessage: new Map(), error };

  const byMessage = new Map();
  for (const row of data ?? []) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row.profile_id);
    byMessage.set(row.message_id, list);
  }
  return { byMessage, error: null };
}

/**
 * Give a message a Yes, as one of your profiles.
 *
 * Idempotent by the primary key: handing twice is one Hand, so a double-fired
 * gesture cannot produce a duplicate or an error the UI has to explain.
 */
export async function handMessage({ messageId, profileId } = {}) {
  if (!messageId || !profileId) {
    return { error: { message: 'handMessage: messageId and profileId are required' } };
  }

  // §A3 AUDIT identity — from the session, never the caller. The policy would
  // reject a forged one anyway, but an API that accepts a value it then has to
  // police is an API inviting the bug.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { error: authError };
  const userId = auth?.user?.id;
  if (!userId) return { error: { message: 'handMessage: no authenticated user' } };

  const { error } = await supabase
    .from('message_participant_state')
    .upsert(
      {
        message_id:   messageId,
        profile_id:   profileId,
        from_user_id: userId,
        handed_at:    new Date().toISOString(),
      },
      { onConflict: 'message_id,profile_id', ignoreDuplicates: true },
    );

  return { error: error ?? null };
}

/**
 * Take a Yes back.
 *
 * DELETE rather than nulling `handed_at`, so a row means a Yes and there is no
 * second state that looks like one. Also why there is no UPDATE policy in M9i.
 */
export async function unhandMessage({ messageId, profileId } = {}) {
  if (!messageId || !profileId) {
    return { error: { message: 'unhandMessage: messageId and profileId are required' } };
  }

  const { error } = await supabase
    .from('message_participant_state')
    .delete()
    .eq('message_id', messageId)
    .eq('profile_id', profileId);

  return { error: error ?? null };
}

/**
 * Toggle, which is what a double-tap actually means.
 *
 * Takes the CURRENT state from the caller rather than reading it back first:
 * the thread already knows, and a round-trip before acting would put a visible
 * delay on the most-used gesture in the app. The optimistic update is the
 * caller's; this just performs the write it implies.
 */
export async function toggleHand({ messageId, profileId, handed } = {}) {
  return handed
    ? unhandMessage({ messageId, profileId })
    : handMessage({ messageId, profileId });
}
