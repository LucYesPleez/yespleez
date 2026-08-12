/**
 * ASK FOR NOTIFICATIONS AT THE MOMENT THEY OBVIOUSLY MATTER — and never before.
 *
 * O4 (2026-08-12). Push permission is a one-shot resource: Chrome and iOS
 * permanently and silently block `Notification.requestPermission()` for an
 * origin once someone dismisses it, with no way back from JS. So the ask is
 * spent exactly once, and spending it on "you just made an account" wastes it
 * on someone with no reason to say yes.
 *
 * ⭐⭐ THE MOMENT IS SUBMITTING AN APPLICATION. From that second the person is
 * WAITING FOR SOMEONE ELSE — the reply is the thing they want and cannot make
 * happen. That is the first point in the product where a notification is the
 * answer to a question they are already asking. (The owner's own example when
 * this was scoped: "Don't miss an opportunity. Get notified when someone
 * responds to your application.")
 *
 * ── THE MOMENT ANNOUNCES ITSELF; THIS DECIDES ────────────────────────
 *
 * ApplyButton does not know about push, and must not: it dispatches
 * `yp:push-worth-it` and forgets. One listener (PushValuePrompt) applies the
 * policy below. Adding a second worthwhile moment later — an enquiry sent, a
 * first booking confirmed — is one dispatch, not another copy of these rules.
 * Same shape as `yp:messages-read` and `yp:message-received`.
 *
 * ── ⛔ NO SECOND PREFERENCES SYSTEM ──────────────────────────────────
 *
 * "Asked already" lives in `user_prompt_preferences` (P8) — the table built
 * for exactly this sentence. Presence IS the suppression; there is no boolean
 * and un-suppressing is a DELETE. ⚠ A FAILED READ ERRS TOWARD ASKING, which
 * is P8's own rule and the recoverable direction: being offered once more is
 * a mild annoyance, and the alternative is a person who can never be asked.
 */

import { supabase } from './supabase';

export const PUSH_PROMPT_EVENT = 'yp:push-worth-it';
export const PUSH_PROMPT_KEY = 'push_value_prompt';

/**
 * "Something just happened that a notification would answer."
 * ⚠ Fire-and-forget, and deliberately ignorant of whether anyone is
 * listening or whether the ask is allowed — that is the policy's job.
 */
export function announcePushWorthIt(reason) {
  try {
    window.dispatchEvent(new CustomEvent(PUSH_PROMPT_EVENT, { detail: { reason } }));
  } catch { /* a prompt that cannot be offered must never break the act */ }
}

/**
 * May the ask be spent right now? Pure, so the rules are testable without a
 * browser, a session or a permission dialog.
 *
 * ⛔ `granted` and `denied` are BOTH terminal here. Granted needs nothing;
 * denied cannot be undone from JS, so re-offering would show a card whose
 * button provably does nothing — worse than silence.
 */
export function shouldOfferPush({ signedIn, supported, permission, suppressed } = {}) {
  if (!signedIn || !supported || suppressed) return false;
  return permission === 'default';
}

/** Has this person already been asked? ⚠ Errs toward asking (P8's rule). */
export async function isPushPromptSuppressed(userId) {
  if (!userId) return true;   // nobody to ask
  try {
    const { data, error } = await supabase
      .from('user_prompt_preferences')
      .select('prompt_key')
      .eq('user_id', userId)
      .eq('prompt_key', PUSH_PROMPT_KEY)
      .maybeSingle();
    if (error) return false;  // a failed read shows the prompt
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Spend the ask — recorded whether they said yes or no.
 *
 * ⚠ "Not now" suppresses too, and that is deliberate: the alternative is
 * re-offering on the next application, which is the nagging this whole design
 * exists to avoid. The permanent way in is the toggle on /notifications,
 * which is unchanged and always available.
 */
export async function suppressPushPrompt(userId) {
  if (!userId) return;
  try {
    await supabase.from('user_prompt_preferences')
      .upsert({ user_id: userId, prompt_key: PUSH_PROMPT_KEY }, { onConflict: 'user_id,prompt_key' });
  } catch { /* a preference that failed to save costs one extra offer */ }
}
