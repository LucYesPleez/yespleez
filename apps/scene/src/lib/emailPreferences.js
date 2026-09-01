import { supabase } from './supabase';

/**
 * E1/E6 · WHICH EMAILS YOU GET — a THIRD axis, beside the two that exist.
 *
 * ⚠⚠ THREE TABLES, THREE QUESTIONS, AND THEY MUST NOT BE CONFLATED:
 *
 *   notification_preferences        per CATEGORY  · do I want this AT ALL
 *                                   ⛔ governs in-app AND push (it stamps
 *                                      suppressed_at, which both read)
 *   notification_channel_prefs      per TYPE      · push, in-app, or off
 *   email_notification_preferences  per CATEGORY  · do I want this BY EMAIL
 *
 * They STACK. Muting a category in `notification_preferences` suppresses the
 * notification everywhere, whatever this file says, because a suppressed row
 * never reaches the email enqueue at all. ⛔ Nothing here can turn an email on
 * for a notification the user has already silenced.
 *
 * ── ABSENCE MEANS ENABLED ────────────────────────────────────────────
 *
 * The same convention NP1 uses, and it is the whole reason operational email is
 * on by default for every existing account with no backfill: a user who has
 * never opened this screen has no rows, and no rows means yes.
 *
 * ⛔ So this module only ever writes a row to say NO (or to undo one). It never
 * materialises a row per category per user.
 */

/**
 * ⭐ THE ACCOUNT-LEVEL MASTER SWITCH is a reserved CATEGORY, not a separate
 * column or table. `email_category_enabled()` checks it first, so an explicit
 * per-category `true` cannot contradict it.
 */
export const EMAIL_MASTER = 'all';

/**
 * ⭐⭐ WHAT THE USER SEES, AND WHY EACH ROW IS HERE.
 *
 * ⚠ `state` is the honest three-way answer, ⛔ not a boolean:
 *
 *   'switch'  the user decides
 *   'always'  un-mutable by `notification_category_is_mutable()` — payments and
 *             account have consequences OUTSIDE the app (owner, 2026-07-20)
 *   'in_app'  ⛔ NEVER EMAILED, by platform decision rather than user choice.
 *             `email_category_in_scope()` excludes social and contacts: high
 *             volume, no deadline, and the likeliest source of spam complaints,
 *             which would cost the deliverability of the mail that matters.
 *
 * ⭐ THE 'in_app' ROWS ARE SHOWN RATHER THAN HIDDEN. Hiding them leaves a user
 * hunting for a follower-email switch that does not exist and concluding the
 * app lost their setting. Saying "in the app only" answers it before it is
 * asked, exactly as NP1 does for its locked rows.
 */
export const EMAIL_CATEGORIES = [
  {
    key: 'bookings',
    label: 'BOOKINGS',
    desc: 'Enquiries, applications, slot offers, invitations and confirmations.',
    state: 'switch',
  },
  {
    key: 'schedule',
    label: 'SCHEDULE',
    /* ⚠⚠ AN EMAIL-ONLY CATEGORY. It does not exist in
       notification_expiry_policy: `slot_changed` and `set_times_released` are
       mapped here by email_category_overrides, because "when do I go on" is one
       question with two triggers. ⛔ The notification registry is untouched, so
       in-app still files set_times_released under EVENTS. That divergence is
       deliberate and is why this panel is separate from the one above. */
    desc: 'When set times are published, and when your own set time changes.',
    state: 'switch',
  },
  {
    key: 'events',
    label: 'EVENT UPDATES',
    desc: 'Changes and reminders for events you are involved with.',
    state: 'switch',
  },
  {
    key: 'messages',
    label: 'MESSAGES',
    /* ⚠ E4 limits this to one email per hour. Measured: one person received 17
       message notifications in a single day, which would have been 17 emails. */
    desc: 'A new message in your conversations. At most one email an hour.',
    state: 'switch',
  },
  {
    /* ⚠⚠ ONE ROW, TWO CATEGORIES. `payments` and `account` are separately
       un-mutable via notification_category_is_mutable(), but a user has one
       opinion about them and neither has a switch — so presenting two identical
       ALWAYS ON rows is noise. ⛔ This key is DISPLAY ONLY and is never written
       to the database; nothing reads it as a category. */
    key: 'payments_account',
    label: 'PAYMENTS & ACCOUNT',
    desc: 'Payment requests, receipts, profile claims and account notices.',
    state: 'always',
  },
  {
    key: 'social',
    label: 'SOCIAL',
    desc: 'New followers and profile updates. Shown in the app, never emailed.',
    state: 'in_app',
  },
  {
    key: 'contacts',
    label: 'CONTACTS',
    desc: 'When someone from your contacts joins. Shown in the app, never emailed.',
    state: 'in_app',
  },
];

/**
 * ⭐ THE ONLY KEYS THIS PANEL MAY WRITE. Derived from the list above rather than
 * restated, so a row added with the wrong `state` cannot quietly become
 * writable. ⛔ `payments_account` is display-only and must never appear here.
 */
export const WRITABLE_EMAIL_CATEGORIES =
  EMAIL_CATEGORIES.filter(c => c.state === 'switch').map(c => c.key);

/**
 * Read the caller's email preferences.
 *
 * @returns {Promise<{disabled: Set<string>, error: object|null}>} the categories
 *   explicitly turned OFF. ⚠ On error it returns an EMPTY set, which reads as
 *   "everything on" — the same direction the database fails in, so a failed
 *   read can never make the screen claim someone has muted something they have
 *   not.
 */
export async function getEmailPreferences(userId) {
  if (!userId) return { disabled: new Set(), error: null };
  const { data, error } = await supabase
    .from('email_notification_preferences')
    .select('category, enabled')
    .eq('user_id', userId);
  if (error) return { disabled: new Set(), error };
  return {
    disabled: new Set((data || []).filter(r => !r.enabled).map(r => r.category)),
    error: null,
  };
}

/**
 * Turn one email category on or off.
 *
 * ⚠ AN UPSERT EITHER WAY, ⛔ not "delete the row to enable". Deleting would also
 * mean enabled — absence is yes — but it loses the fact that the user made a
 * deliberate choice, and a later default change would silently overwrite them.
 */
export async function setEmailPreference(userId, category, enabled) {
  if (!userId) return { error: new Error('not signed in') };
  const { error } = await supabase
    .from('email_notification_preferences')
    .upsert(
      { user_id: userId, category, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' },
    );
  return { error: error ?? null };
}
