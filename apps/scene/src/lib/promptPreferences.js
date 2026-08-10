import { supabase } from './supabase';

/**
 * "DON'T ASK ME THIS AGAIN" — P8.
 *
 * A row in `user_prompt_preferences` IS the suppression. There is no boolean,
 * so there is no third state to drift: present means suppressed, absent means
 * show it, and un-suppressing is a DELETE.
 *
 * ⛔ UI ONLY. Nothing here may gate a write, a permission, or the P6 enquiry
 * requirements. Suppressing the pre-send check skips the CONFIRMATION, never
 * the gate — that lives in `canSendEnquiry` and is not dismissible.
 */

/** The pre-send confirmation on a venue availability enquiry. */
export const ENQUIRY_PRE_SEND_CHECK = 'enquiry_pre_send_check';

/**
 * Should this prompt be shown?
 *
 * ⚠ FAILS TOWARD ASKING. A read error, a missing session, a dropped connection
 * — all return true. Being asked once more is a mild annoyance; silently
 * skipping a confirmation because a query failed is how something gets sent
 * that was never meant to be. This is the opposite polarity to the enquiry
 * gate, and deliberately so: THAT one fails closed because the cost of a wrong
 * send is permanent, and THIS one fails toward the same outcome — showing the
 * check rather than bypassing it.
 *
 * @returns {Promise<boolean>} true when the prompt should be displayed
 */
export async function shouldShowPrompt(userId, promptKey) {
  if (!userId || !promptKey) return true;
  try {
    const { data, error } = await supabase
      .from('user_prompt_preferences')
      .select('prompt_key')
      .eq('user_id', userId)
      .eq('prompt_key', promptKey)
      .maybeSingle();
    if (error) return true;
    return !data;
  } catch {
    return true;
  }
}

/**
 * Stop showing it.
 *
 * Upsert rather than insert: pressing "don't ask again" twice from two devices
 * is not an error, and a duplicate-key failure would leave the person believing
 * they had turned it off. Errors are swallowed for the same reason the read
 * fails open — the enquiry they were sending matters more than the preference,
 * and the worst case is being asked again next time.
 */
export async function suppressPrompt(userId, promptKey) {
  if (!userId || !promptKey) return false;
  try {
    const { error } = await supabase
      .from('user_prompt_preferences')
      .upsert({ user_id: userId, prompt_key: promptKey }, { onConflict: 'user_id,prompt_key' });
    return !error;
  } catch {
    return false;
  }
}
