import { sendMessage } from './messaging';

/**
 * THE HAND — YesPleez's universal acknowledgement.
 *
 * The Hand means **Yes**. Not "like", not a high-five: yes, agreed, I'm in,
 * sounds good, nice one, confirmed, approved. It is the one gesture the whole
 * platform uses to say the most common thing anyone says.
 *
 * ── THE RULE THAT SEPARATES ITS TWO FORMS ────────────────────────────
 *
 *     A CONVERSATION Hand is a MESSAGE.  A MESSAGE Hand is METADATA.
 *
 *   composer  → tap the Hand → a message with kind = 'hand'   ← this file
 *   message   → double-tap   → `handed_at` in participant message state,
 *                              a later design pass
 *
 * Both are the same gesture aimed at different targets. Only the first is a
 * conversation event: it appears in the thread, bumps the conversation and
 * notifies like any other message. The second must do none of those things,
 * which is exactly why it is not built as a message.
 *
 * ── WHY THE PRODUCT NEVER SAYS "HAND" ────────────────────────────────
 *
 * `hand` names the MARK. Every string a person can read says **Yes** — the
 * body below, the label in `messageKindList`, the notification, the inbox
 * preview. A user should never need to know what the icon is called.
 */

/**
 * What a Hand writes to `body`.
 *
 * M8a's non-blank CHECK applies to every kind, and it is doing real work here:
 * a Hand has no words of its own, but an inbox preview, a push notification and
 * a screen reader can only render text.
 *
 * 'Yes' rather than a placeholder or an emoji, because a client too old to know
 * this kind then shows exactly what was meant. The message degrades to its own
 * meaning instead of to "unsupported".
 */
export const HAND_BODY = 'Yes';

/**
 * Send a Hand to a conversation.
 *
 * Deliberately a thin call to `sendMessage` and nothing else — no upload, no
 * payload, no special path. A Hand is the simplest possible message, and the
 * kind registry means it needs no machinery of its own.
 */
export async function sendHand({ conversationId, fromProfileId, clientId } = {}) {
  return sendMessage({
    conversationId,
    fromProfileId,
    clientId,          // idempotency — a retry re-uses it, so the row cannot double
    body: HAND_BODY,
    kind: 'hand',
  });
}
