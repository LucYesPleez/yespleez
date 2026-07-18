import { supabase } from './supabase';

/**
 * The one place notifications are created.
 *
 * Identity v1.1 §A7 and the communication architecture's C18 both say
 * notifications originate from shared services and are never generated
 * inside UI components. Before this consolidation there were fifteen
 * write paths — six through this helper and nine inserting directly —
 * so any change to the notification row shape meant fifteen edits, and
 * the sixteenth call site would have missed it.
 *
 * Everything now funnels through buildRow(). When the M6 notification
 * identities land (§A7: about_profile_id = subject, to_profile_id =
 * recipient, user_id = delivery) they are added THERE, once.
 *
 * Deliberately NOT added yet. This refactor is purely structural and
 * changes no behaviour; profile attribution is the next commit.
 */

/**
 * Build a notification row. The single definition of a notification's
 * shape — extend here, never at a call site.
 */
function buildRow({ userId, type, message, data = {} }) {
  return {
    user_id: userId,
    type,
    message,
    data,
    read: false,
  };
}

/**
 * Write one notification.
 *
 * @param {string} userId  – recipient's auth user id (delivery identity, §A7)
 * @param {string} type    – e.g. 'slot_offer', 'invite_accepted'
 * @param {string} message – readable message
 * @param {object} data    – JSONB payload (event_id, host_id, …)
 * @returns {Promise<object|null>} the Postgres error, or null on success
 */
export async function writeNotification(userId, type, message, data = {}) {
  const { error } = await supabase
    .from('notifications')
    .insert(buildRow({ userId, type, message, data }));
  return error;
}

/**
 * Write several notifications in a single insert.
 *
 * Exists so the batch slot-offer path stays ONE round trip. Mapping it
 * to N writeNotification() calls would have been a behaviour change
 * dressed as a refactor — N requests instead of one, and partial
 * failure where previously there was none.
 *
 * @param {Array<{userId: string, type: string, message: string, data?: object}>} rows
 * @returns {Promise<object|null>} the Postgres error, or null on success
 */
export async function writeNotifications(rows) {
  const list = (rows || []).filter(r => r && r.userId);
  if (!list.length) return null;
  const { error } = await supabase
    .from('notifications')
    .insert(list.map(buildRow));
  return error;
}
