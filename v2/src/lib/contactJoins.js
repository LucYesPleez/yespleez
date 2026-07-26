import { supabase } from './supabase';

/**
 * CJ1 · THE BADGE ON *FIND FRIENDS* — owner's words: *"The red badge only
 * appears on Find Friends. Not the whole page. That tells the user exactly
 * where the new discovery happened."*
 *
 * That is the strongest idea in the Find People sketch and the reason this is
 * its own counter rather than a slice of the bell's. A badge on a tab says
 * "something, somewhere". A badge on the row that caused it says what happened
 * and where to go, and it clears when the user has looked at the thing it
 * refers to — not when they open the app.
 *
 * ⚠ THIS DOES NOT REPLACE THE BELL. A contact joining is not conversation
 * activity, so per the navigation architecture it DOES belong on the bell and
 * `contact_joined` must never enter KNOWN_CONVERSATION_TYPES. The same
 * notification is counted in two places on purpose: the bell says "you have
 * news", this says "the news is here".
 *
 * ── ⚠ SUPPRESSED ROWS ARE EXCLUDED, AGAINST THE DESIGN DOC ───────────────
 *
 * docs/contacts-page-2026-07.md §5.4 recommends counting *regardless* of
 * suppression, so that a future "In Messages only" channel would still light
 * this row. That recommendation assumed the channel ladder existed. It does
 * not: `notification_channel_prefs` was never created, so today the only thing
 * suppression can mean is that the user turned these OFF. Counting suppressed
 * rows now would put a badge on something they explicitly muted.
 *
 * It is also an enforced invariant, not a preference — notificationReaders
 * .test.js fails any read of `notifications` that omits the filter (NP1).
 *
 * ⭐ WHEN THE CHANNEL LADDER SHIPS, THIS IS THE LINE THAT CHANGES, and the
 * reader-contract test is the thing that will have to be taught about the
 * exception. Do not weaken the test to make it pass; give the exception a name.
 */
const TYPE = 'contact_joined';

/**
 * How many contacts have joined that the user has not looked at yet.
 *
 * @param {string} userId
 * @returns {Promise<number>} 0 on any failure — a badge is decoration, and a
 *   failed count must never be able to break the screen it sits on.
 */
export async function unreadContactJoinCount(userId) {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    // N1/N5: held rows carry to_user_id = NULL and SQL equality never matches
    // NULL, so scoping here is what keeps an unclaimed profile's notifications
    // out of this count.
    .eq('to_user_id', userId)
    .is('suppressed_at', null)
    .eq('read', false)
    .eq('type', TYPE);
  return error ? 0 : (count || 0);
}

/**
 * Clear the badge, because the user has now seen what it referred to.
 *
 * ⚠ CALLED WHEN THE SECTION OPENS, NOT WHEN THE APP DOES. That is the whole
 * contract of a located badge: it survives until the user looks at the thing
 * it points to. Marking these read on app load would clear the badge for
 * someone who never saw it, which is indistinguishable from never having sent
 * it.
 *
 * Marks read rather than deleting: the notification remains in the bell's feed
 * as history, exactly like every other type.
 *
 * @param {string} userId
 */
export async function markContactJoinsRead(userId) {
  if (!userId) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('to_user_id', userId)
    .eq('read', false)
    .eq('type', TYPE);
  return { error: error ?? null };
}
