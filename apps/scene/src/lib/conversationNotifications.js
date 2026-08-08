import { supabase } from './supabase';

/**
 * WHICH NOTIFICATION TYPES BELONG TO CONVERSATIONS.
 *
 * Navigation architecture rule: **conversation activity must never increment
 * the notification bell.** Message notifications, voice notes, images,
 * attachments and any other conversation activity update the MESSAGES badge
 * only. The bell is application activity: follows, application updates,
 * booking enquiries, ownership requests, event changes, system notices.
 *
 * ── WHY THIS IS A QUERY AND NOT A CONSTANT ───────────────────────────
 *
 * `new_message` is the only conversation type today, and hardcoding it would
 * work today. But voice notes, images and attachments are named in the rule as
 * future members of the same class — so a constant here is a list someone must
 * remember to extend, and forgetting it puts conversation activity back on the
 * bell silently.
 *
 * `notification_expiry_policy` already classifies every type by category, and
 * `new_message` is already `messages`. Reading the classification means a new
 * conversation type joins the rule by being categorised correctly, which the
 * NP1 migration already requires of every type. One source, not two.
 *
 * ── FAILING TOWARD THE RULE ──────────────────────────────────────────
 *
 * If the query fails, this returns the known conversation types rather than an
 * empty list. An empty list would mean "exclude nothing", so a transient
 * network error would put message notifications back on the bell — a silent
 * violation of a permanent rule, caused by a failure that has nothing to do
 * with it. The fallback fails toward the rule instead of away from it.
 */

/** Known at authoring time. The floor, never the ceiling — see above. */
const KNOWN_CONVERSATION_TYPES = ['new_message'];

export async function conversationNotificationTypes() {
  const { data, error } = await supabase
    .from('notification_expiry_policy')
    .select('type')
    .eq('category', 'messages');

  if (error || !data?.length) return KNOWN_CONVERSATION_TYPES;

  // Union, so a categorised type and a known type both count even if the
  // policy table is mid-migration.
  return [...new Set([...KNOWN_CONVERSATION_TYPES, ...data.map(r => r.type)])];
}

/**
 * True when this notification is conversation activity and therefore belongs
 * to the Messages badge, not the bell.
 *
 * @param {object} notif
 * @param {string[]} conversationTypes from conversationNotificationTypes()
 */
export function isConversationActivity(notif, conversationTypes) {
  if (!notif?.type) return false;
  return (conversationTypes ?? KNOWN_CONVERSATION_TYPES).includes(notif.type);
}

export { KNOWN_CONVERSATION_TYPES };
