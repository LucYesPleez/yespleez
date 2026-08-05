import { supabase } from './supabase';

/**
 * DEF-4 · THE ONLY PLACE `read: true` IS EVER WRITTEN.
 *
 * ⚠ THIS IS AN ENFORCED INVARIANT, NOT A CONVENTION — see
 * markNotificationsRead.test.js, which scans the source and fails if any other
 * module writes `read: true` to `notifications`. Import this instead.
 *
 * The rule exists because the previous arrangement had TWO copies of the write,
 * in NotificationsScreen and NotifPanel, and both were wrong in the same way:
 * they marked read everything the LOADER returned rather than everything the
 * user SAW. Each query fetched 60 rows and rendered 8, so up to 52 notifications
 * per open were marked read having never been on screen — and since the bell
 * counts only `read = false`, those rows could never ask for attention again.
 * There is no undo: `read` has no "unsee" path and dismissal is one-way too.
 *
 * The duplication is what let it rot quietly. Both copies had to be defended
 * with query filters every time a new class of row appeared (SEC-6a's dismissed
 * rows, CJ2's `in_app` rows, DEF-3's conversation types) because ANYTHING the
 * query returned got marked read on its way past. Three filters, two files, six
 * places to remember. One writer removes the whole class of mistake: rows are
 * now marked read because they were seen, so a row the query returns but the
 * list never shows is simply never passed here.
 *
 * @param {string[]} ids
 * @returns {Promise<{error: Error|null, count: number}>} count is rows ATTEMPTED
 */
export async function markNotificationsRead(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return { error: null, count: 0 };

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .in('id', unique);

  // Only on success. The badge re-reads from the database when it hears this
  // (see App.jsx), so announcing a write that did not land would just have it
  // fetch the same number back — noise that looks like a refresh.
  if (!error) announceNotificationsRead();

  return { error: error ?? null, count: unique.length };
}

/**
 * DEF-4 · the badge's cue to re-count.
 *
 * Marking read is a write with NO realtime event: App.jsx's subscription
 * watches INSERT only, so nothing tells the bell that its number just moved.
 * That is the same gap DEF-2 found for the messages badge, and this is
 * deliberately the same answer — a window event the badge listens for, which
 * then RE-READS the count from the database rather than adjusting a local
 * tally. §5.6's rule, applied to the other badge: the number on screen is
 * always one the database just gave us, so it cannot drift from what a reload
 * would show.
 */
export const NOTIFICATIONS_READ_EVENT = 'yp:notifications-read';

export function announceNotificationsRead() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}
