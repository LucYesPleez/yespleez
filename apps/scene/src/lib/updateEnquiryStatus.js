import { supabase } from './supabase';

/**
 * ⭐ THE VENUE'S DECISION ON AN ENQUIRY, WRITTEN AND PROVED.
 *
 * ⛔⛔ THE WRITE THIS REPLACES CHECKED NOTHING AT ALL — not even `error`:
 *
 *     await supabase.from('venue_enquiries').update({ status }).eq('id', id);
 *
 * and then, unconditionally, moved the card, ran `onAccepted` (which CREATES A
 * DRAFT EVENT or adds the act to an existing one) and told the artist
 * "{venue} accepted your enquiry". RLS filters an UPDATE rather than erroring
 * it, so a refused decision produced a night in the organiser's list, a
 * notification in the artist's, and a `venue_enquiries` row that still said
 * pending. Three surfaces, three different answers.
 *
 * ⭐ `.select('id')` IS THE VERIFICATION. `error: null` proves nothing; only a
 * returned id proves the row moved. Same rule `lib/cancelEnquiry` states for
 * the cancel path on this very table, and the same one `respondToOffer` and
 * `respondToApplication` follow on theirs.
 *
 * ⚠ THE WRITE IS NOT NARROWED, deliberately. `cancelEnquiry` scopes by the
 * acting side's profile column, but this path also answers legacy rows whose
 * `venue_profile_id` was never populated, and adding a scope here would turn
 * those into silent no-ops — trading one wrong answer for another. Verifying
 * the result catches an RLS refusal either way, which is the actual defect.
 *
 * ⛔ The status predicate is untouched: whatever the caller decided is what
 * gets written.
 */
export async function updateEnquiryStatus(id, status) {
  if (!id || !status) return { ok: false, reason: 'missing-identity' };

  const { data, error } = await supabase
    .from('venue_enquiries')
    .update({ status })
    .eq('id', id)
    .select('id');

  /* ⛔ ZERO ROWS IS A FAILURE, not a quiet success. This is the leg that has no
     error to report and is therefore the one that got through. */
  if (error) return { ok: false, reason: 'error', error };
  if (!(data || []).length) return { ok: false, reason: 'refused', error: null };
  return { ok: true };
}
