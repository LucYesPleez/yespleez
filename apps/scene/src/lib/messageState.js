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

const STATE_COLUMNS = 'message_id, profile_id, handed_at, reaction';

/**
 * ⚠ A ROW NOW CARRIES TWO INDEPENDENT FACTS (MR1).
 *
 *   handed_at  the Yes — the platform's own acknowledgement
 *   reaction   an emoji, one of the registry keys in ./reactions.js
 *
 * Either may be null. A participant may Yes a message AND react to it, and
 * the two never compete — that separation is deliberate and is why the Hand
 * is not in the reaction registry. See the MR1 migration header.
 *
 * The consequence for every write below: CLEARING ONE MUST NOT DESTROY THE
 * OTHER. That is what changed `unhandMessage` from a DELETE into an UPDATE.
 */

/**
 * All participant state for a set of messages, in one round trip.
 *
 * Returns the two shapes the thread renders:
 *   hands     message_id → profile_ids that said Yes
 *   reactions message_id → [{profile_id, reaction}] for summariseReactions
 *
 * One query rather than two, because a thread render asks for both together
 * and a second round trip would show reactions arriving after the Yes.
 */
export async function listMessageState(messageIds = []) {
  const ids = messageIds.filter(Boolean);
  const empty = { hands: new Map(), reactions: new Map(), error: null };
  if (!ids.length) return empty;

  const { data, error } = await supabase
    .from('message_participant_state')
    .select(STATE_COLUMNS)
    .in('message_id', ids);

  if (error) return { ...empty, error };

  const hands = new Map();
  const reactions = new Map();
  for (const row of data ?? []) {
    if (row.handed_at) {
      const list = hands.get(row.message_id) ?? [];
      list.push(row.profile_id);
      hands.set(row.message_id, list);
    }
    if (row.reaction) {
      const list = reactions.get(row.message_id) ?? [];
      list.push({ profile_id: row.profile_id, reaction: row.reaction });
      reactions.set(row.message_id, list);
    }
  }
  return { hands, reactions, error: null };
}

/**
 * Every Hand on a set of messages.
 *
 * Kept as a thin wrapper over `listMessageState` rather than its own query,
 * so there is one definition of how state is read and the two cannot drift.
 */
export async function listHands(messageIds = []) {
  const { hands, error } = await listMessageState(messageIds);
  return { byMessage: hands, error };
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
        // ⚠ A YES CLEARS ANY REACTION. Owner, 2026-07-25: carrying both is
        // "weird". They share ONE badge slot on the bubble, so a row holding
        // both would have two marks competing for one position and the UI
        // would have to invent a winner. Mutual exclusivity is enforced here,
        // at the single write path, rather than in the components — the two
        // cannot then disagree about which mark a message has.
        reaction:     null,
      },
      // ⚠ MERGE, NOT `ignoreDuplicates` (changed by MR1).
      //
      // `ignoreDuplicates: true` compiles to ON CONFLICT DO NOTHING, which
      // was correct while a row could only ever mean "handed". Now a row may
      // already exist carrying a reaction — and DO NOTHING would make the Yes
      // silently fail for anyone who reacted to that message first.
      { onConflict: 'message_id,profile_id', ignoreDuplicates: false },
    );

  return { error: error ?? null };
}

/**
 * Take a Yes back.
 *
 * ⚠ NULLS `handed_at` — IT NO LONGER DELETES THE ROW (changed by MR1).
 *
 * Deleting was right while `handed_at` was the only fact a row could hold.
 * Now the same row may also carry a reaction, and a DELETE would take that
 * with it: un-Yes a message and your emoji would vanish too, with nothing
 * to explain it. The row is the participant's state, not the Yes itself.
 *
 * A row with both columns null is inert — no reader counts it — and is
 * cleaned up by ON DELETE CASCADE when the message goes. Left rather than
 * chased, because a delete-if-empty would race a Yes arriving on the same
 * row from another device.
 */
export async function unhandMessage({ messageId, profileId } = {}) {
  if (!messageId || !profileId) {
    return { error: { message: 'unhandMessage: messageId and profileId are required' } };
  }

  const { error } = await supabase
    .from('message_participant_state')
    .update({ handed_at: null })
    .eq('message_id', messageId)
    .eq('profile_id', profileId);

  return { error: error ?? null };
}

/**
 * React to a message, as one of your profiles.
 *
 * ONE ACTIVE REACTION PER PERSON PER MESSAGE — so this REPLACES rather than
 * adds, which the primary key (message_id, profile_id) enforces anyway. The
 * caller decides set-vs-clear with `decideReactionTap`; this performs it.
 *
 * `handed_at` is deliberately absent from the payload: reacting must never
 * disturb a Yes that is already there.
 */
export async function setReaction({ messageId, profileId, reaction } = {}) {
  if (!messageId || !profileId || !reaction) {
    return { error: { message: 'setReaction: messageId, profileId and reaction are required' } };
  }

  // §A3 AUDIT identity — from the session, never the caller.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { error: authError };
  const userId = auth?.user?.id;
  if (!userId) return { error: { message: 'setReaction: no authenticated user' } };

  const { error } = await supabase
    .from('message_participant_state')
    .upsert(
      {
        message_id: messageId,
        profile_id: profileId,
        from_user_id: userId,
        reaction,
        // ⚠ The mirror of handMessage: a reaction CLEARS any Yes. One badge
        // slot, one mark. See the note there.
        handed_at: null,
      },
      { onConflict: 'message_id,profile_id', ignoreDuplicates: false },
    );

  return { error: error ?? null };
}

/**
 * Remove your reaction, leaving any Yes on the same row untouched.
 * The mirror of `unhandMessage`, and null for the same reason.
 */
export async function clearReaction({ messageId, profileId } = {}) {
  if (!messageId || !profileId) {
    return { error: { message: 'clearReaction: messageId and profileId are required' } };
  }

  const { error } = await supabase
    .from('message_participant_state')
    .update({ reaction: null })
    .eq('message_id', messageId)
    .eq('profile_id', profileId);

  return { error: error ?? null };
}

/**
 * What a tap on the reaction bar performs.
 *
 * Takes the CURRENT reaction from the caller rather than reading it back
 * first — the thread already knows, and a round trip before acting would
 * put a visible delay on a gesture that must feel instant. The optimistic
 * update is the caller's; this performs the write it implies.
 */
export async function toggleReaction({ messageId, profileId, current, reaction } = {}) {
  return current === reaction
    ? clearReaction({ messageId, profileId })
    : setReaction({ messageId, profileId, reaction });
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
