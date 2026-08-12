/**
 * TEACH ONE THING, THE FIRST TIME IT BECOMES TRUE — and never again.
 *
 * O4 (2026-08-12). ⛔ NOT A TOUR, and it must never grow into one: no steps,
 * no sequence, no "1 of 5", nothing to dismiss before the app is usable. A
 * teaching moment is a single sentence that appears because the person just
 * did the thing it explains, and disappears on its own.
 *
 * ⭐⭐ THE ONLY CONCEPT WORTH TEACHING AT A SAVE IS WHERE IT WENT. The heart
 * is self-evident — everyone knows what a heart does. What is NOT self-evident
 * is that this app has a place called MY SCENE and that hearting is how it
 * fills. That is the product's central loop (My Scene is populated by actions,
 * never configured), and it is invisible until someone's first save lands
 * somewhere they have not looked yet.
 *
 * ⛔ Do NOT add a note for the second concept that "would also be useful".
 * Every addition here is a sentence someone did not ask for; the bar is that
 * the product is materially confusing without it.
 *
 * ── THE MOMENT ANNOUNCES ITSELF ──────────────────────────────────────
 *
 * HeartBtn dispatches and forgets, exactly as ApplyButton does for the push
 * offer. This module owns the policy and the once-ness, so a second moment
 * later is one dispatch and one entry in TEACH — not another copy of these
 * rules. Same shape as `yp:messages-read` / `yp:message-received`.
 *
 * ── ⛔ NO SECOND PREFERENCES SYSTEM ──────────────────────────────────
 *
 * "Already taught" is a row in `user_prompt_preferences` (P8) — the table for
 * exactly this sentence. Presence IS the suppression. Keyed by USER, so it
 * follows the person across devices rather than teaching them again on a
 * phone. ⚠ A failed read errs toward SHOWING, per P8's own rule: one extra
 * sentence is cheap, and the alternative is a loop nobody can ever be told
 * about.
 */

import { supabase } from './supabase';

export const TEACH_EVENT = 'yp:teach';

/** The registry. One entry per concept, and the bar for adding one is high. */
export const TEACH = Object.freeze({
  saved_event: {
    key: 'teach_saved_event',
    text: 'Saved. Find it any time under MY SCENE.',
  },
});

/**
 * "Something just happened that is worth explaining once."
 * ⚠ Fire-and-forget: the caller must not learn whether it will be shown.
 */
export function announceTeach(momentKey) {
  try {
    window.dispatchEvent(new CustomEvent(TEACH_EVENT, { detail: { momentKey } }));
  } catch { /* a lesson that cannot be shown must never break the act */ }
}

/** Has this person already been told? ⚠ Errs toward telling them. */
export async function alreadyTaught(userId, promptKey) {
  if (!userId || !promptKey) return true;
  try {
    const { data, error } = await supabase
      .from('user_prompt_preferences')
      .select('prompt_key')
      .eq('user_id', userId)
      .eq('prompt_key', promptKey)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/** Spend it. Shown once is the whole contract. */
export async function markTaught(userId, promptKey) {
  if (!userId || !promptKey) return;
  try {
    await supabase.from('user_prompt_preferences')
      .upsert({ user_id: userId, prompt_key: promptKey }, { onConflict: 'user_id,prompt_key' });
  } catch { /* costs one repeat, never an error the user sees */ }
}
