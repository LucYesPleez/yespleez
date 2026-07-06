import { supabase } from './supabase';

/**
 * Write a notification to another user's notifications table.
 * @param {string} userId  – the recipient's auth user id
 * @param {string} type    – e.g. 'event_invite', 'slot_offer', 'generic'
 * @param {string} message – the readable message string
 * @param {object} data    – optional JSONB payload (event_id, host_id, etc.)
 */
export async function writeNotification(userId, type, message, data = {}) {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    message,
    data,
    read: false,
  });
  return error;
}
