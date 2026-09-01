import { supabase } from './supabase';
import { writeNotification } from './writeNotification';
import { normaliseStatus, clearedColumnFor } from './enquiryUtils';

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

  /**
   * ⭐⭐ EITHER SIDE MAY WITHDRAW WHAT IT SENT, so this function may not assume
   * the canceller is the applicant.
   *
   * ⛔⛔ IT DID, AND A VENUE'S CANCEL SILENTLY DID NOTHING (2026-09-01). A
   * venue-initiated OFFER is outgoing to the VENUE, but the row still keeps the
   * artist in `applicant_profile_id` — so scoping the write to that column
   * matched no row for the venue, and setting `applicant_cleared_at` would have
   * hidden the row from the ARTIST, who never asked for it to go.
   *
   * ⚠ `clearedColumnFor` ALREADY ANSWERED THIS. It derives the viewer's own
   * cleared column from the row plus the viewer, and exists precisely so no
   * surface hides a row from the wrong person. Reused rather than re-derived.
   */
  const isVenueSide = Boolean(enq.venue_profile_id) && enq.venue_profile_id === actingProfileId;
  const clearedCol  = clearedColumnFor(enq, actingProfileId);
  /* ⛔ SCOPE THE WRITE TO THE SIDE THAT IS ACTING — belt-and-braces against a
     mis-passed id, and it agrees with RLS from the other direction (S5 for the
     applicant leg, the venue-owner policies for this one). */
  const scopeCol    = isVenueSide ? 'venue_profile_id' : 'applicant_profile_id';

  /* ⚠ READ THE STATUS BEFORE THE WRITE. Whether the other side is owed a notice
     depends on what they had already agreed to, and after the update every row
     is `cancelled`. ⚠ Direction is irrelevant here: both maps resolve
     accepted/booked/confirmed to `accepted`. */
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
    /* ⛔ THE CANCELLER'S OWN CLEARED COLUMN, never the other side's. The row
       leaves the list of whoever withdrew it; the other party keeps seeing it,
       which is the whole point of telling them. */
    .update({ status: 'cancelled', [clearedCol]: new Date().toISOString() })
    .eq('id', enq.id)
    .eq(scopeCol, actingProfileId)
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
    /**
     * ⭐ THE NOTICE GOES TO THE OTHER SIDE, whichever side that is — and it says
     * what actually happened to them.
     *
     * ⛔ ONE MESSAGE FOR BOTH DIRECTIONS WOULD LIE TO ONE OF THEM. An act
     * pulling out of a date frees a SPOT the venue must refill; a venue
     * withdrawing an offer takes a BOOKING away from the act. Telling an artist
     * "the spot is open again" about their own cancelled gig is nonsense.
     */
    await writeNotification({
      toUserId:       (isVenueSide ? enq.applicant_user_id : enq.venue_user_id) ?? null,
      toProfileId:    (isVenueSide ? enq.applicant_profile_id : enq.venue_profile_id) ?? null,
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
      message: isVenueSide
        ? `${actingProfileName || 'A venue'} has withdrawn their offer${enq.date_requested ? ` for ${enq.date_requested}` : ''}.`
        : `${actingProfileName || 'An act'} has pulled out${enq.date_requested ? ` of ${enq.date_requested}` : ''}. The spot is open again.`,
      data:    { enquiry_id: enq.id, date_requested: enq.date_requested ?? null },
    });
  }
  return { error: null };
}
