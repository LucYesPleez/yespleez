import { supabase } from './supabase';
import { writeNotification } from './writeNotification';
import { normaliseStatus } from './enquiryUtils';

/**
 * ⭐ THE ASKER WITHDRAWS. One row, both sides, one place.
 *
 * ⛔⛔ NOT `declined`. `declined` is the VENUE'S verdict. Writing it here puts
 * everything you changed your mind about into the same pile as everything you
 * were turned down for, and DECLINED exists to show the second (owner,
 * 2026-08-14). `cancelled` is already understood by both status maps:
 * INCOMING_STATUS_MAP files it under the venue's "off the table" pile, and the
 * asker's side never buckets it at all because `applicant_cleared_at` removes
 * the row from their list entirely.
 *
 * ⭐ ONE ROW MEANS ONE CANCEL. `direction` is derived, never stored, so a
 * single status write is what both parties read. There is no second row to
 * keep in step and no venue-side column to set — the venue SEES the withdrawal
 * (that is the point of notifying them); it is not hidden from them.
 *
 * ⚠ SCOPED BY THE ACTING PROFILE, matching S5's RLS policy
 * (`initiated_by = 'applicant' AND can_act_as(applicant_profile_id)`). The
 * filter is belt-and-braces: without it a wrong id silently updates nothing,
 * which is the failure mode this whole fix exists to remove.
 */
export async function cancelEnquiry(enq, actingProfileId, actingProfileName) {
  if (!enq?.id || !actingProfileId) return { error: 'missing-identity' };

  /* ⚠ READ THE STATUS BEFORE THE WRITE. Whether the venue is owed a notice
     depends on what they had already agreed to, and after the update every row
     is `cancelled`. */
  const wasAccepted = normaliseStatus({ ...enq, direction: 'outgoing' }) === 'accepted';

  /**
   * ⛔⛔ `.neq('status', 'cancelled')` IS THE DUPLICATE GUARD, AND IT MUST LIVE
   * IN THE WRITE.
   *
   * ⚠⚠ PROVEN IN PRODUCTION-LIKE TESTING, 2026-09-01: pressing cancel twice —
   * the card and the sheet both offer it — mailed the venue TWO "they pulled
   * out" notices for one withdrawal. `wasAccepted` reads the React prop, and
   * the second press still saw the pre-cancel copy because the refetch had not
   * landed. A client-side flag can never be the guard against a repeat: it
   * describes what the browser last heard, not what is true.
   *
   * ⭐ The DATABASE decides. A row already cancelled matches nothing, so the
   * second press updates zero rows and `.select()` returns `[]` — no write, no
   * notice, no error to explain to anyone. Two racing presses serialise: the
   * loser sees the winner's `cancelled` and comes back empty.
   */
  const { data: changed, error } = await supabase.from('venue_enquiries')
    .update({ status: 'cancelled', applicant_cleared_at: new Date().toISOString() })
    .eq('id', enq.id)
    .eq('applicant_profile_id', actingProfileId)
    .neq('status', 'cancelled')
    .select('id');
  /* ⛔ NO NOTIFICATION ON A FAILED WRITE. Telling a venue an act pulled out of
     a booking that is still live is worse than the silence this replaces. */
  if (error) return { error };
  /* ⭐ NOTHING CHANGED = ALREADY WITHDRAWN. Not an error — the asker got what
     they wanted — but emphatically not a second notice. */
  if (!changed?.length) return { error: null, alreadyCancelled: true };

  /**
   * ⭐⭐ AN ACCEPTED DATE THAT FALLS THROUGH IS NEWS THE VENUE IS OWED (owner,
   * 2026-09-01: "they need to know to fill the spot after someone pulls out").
   *
   * ⛔ ONLY WHEN IT WAS ACCEPTED. Withdrawing an ask nobody has answered yet is
   * the asker stepping back from their own request — the venue lost nothing and
   * a notice for it is noise. That is the existing rule and it stands; this
   * narrows it rather than reversing it.
   *
   * ⚠ ADDRESSED FROM THE ROW, ⛔ never re-derived. `venue_user_id` is what the
   * record states; `venue_profile_id` carries it as HELD (N1) if the venue is
   * an unclaimed profile, so an enquiry to a venue that has not signed up still
   * reaches them when they claim it.
   *
   * ⛔ `profiles.user_id` IS NOT AN IDENTITY and is not consulted here.
   */
  if (wasAccepted) {
    await writeNotification({
      toUserId:       enq.venue_user_id ?? null,
      toProfileId:    enq.venue_profile_id ?? null,
      aboutProfileId: actingProfileId,
      /* ⛔ NOT A NEW TYPE. `booking_cancelled` is already registered in
         `notifMeta` (BOOKING CANCELLED, red, CalendarX2Icon) and already has a
         destination in `notifDestination`. An unregistered type renders as an
         inert row with no icon and nowhere to go. */
      type:    'booking_cancelled',
      /* ⛔⛔ THE ACT'S NAME, NOT THE VENUE'S. This notice is addressed TO the
         venue, and `enq.name` on an OUTGOING row is the venue they asked —
         reading it here would tell the venue that they themselves pulled out.
         The acting profile is the only correct source. */
      message: `${actingProfileName || 'An act'} has pulled out${enq.date_requested ? ` of ${enq.date_requested}` : ''}. The spot is open again.`,
      data:    { enquiry_id: enq.id, date_requested: enq.date_requested ?? null },
    });
  }
  return { error: null };
}
