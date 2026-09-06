import { supabase } from './supabase';
import { writeNotification, inferToProfileId } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';

/**
 * ⭐ THE ACT ANSWERS A VENUE'S INVITE. One decision, three writes, one order.
 *
 * ⛔⛔ THE ORDER IS THE WHOLE FIX, AND IT USED TO BE BACKWARDS.
 *
 * `handleOfferRespond` inserted the `applications` row FIRST and only then ran
 * the verified `venue_enquiries` update. So a refused update — RLS filters an
 * UPDATE rather than erroring it — correctly withheld the notification and
 * correctly left the card alone, and still left a `pending` APPLICATION behind
 * it. The host's pipeline then showed an act waiting on a decision that the
 * act had never successfully made, on a row whose own status still said
 * `pending`. The verified write protected everything except the write that had
 * already happened.
 *
 * ⭐⭐ THE AUTHORITATIVE ROW GOES FIRST. `venue_enquiries.status` is the record
 * of the artist's answer; the `applications` row is a CONSEQUENCE of it, and a
 * consequence may never outlive the thing it follows from. Nothing at all is
 * written until the update comes back with a row, so a refusal now leaves the
 * database exactly as it found it.
 *
 * ⛔ NO TRANSACTION, AND NONE IS INVENTED. This app has no client-side
 * transaction abstraction and PostgREST offers none across two tables. Ordering
 * gives the same guarantee for this shape — one authoritative write, then a
 * consequence — without an RPC and without a migration. The residual case is
 * the mirror one, an accepted invite whose application row fails to appear, and
 * that is REPORTED rather than hidden: see `applicationWarning`.
 *
 * ⭐ Shaped like `lib/cancelEnquiry`, which owns the other verified write on
 * this table: it imports supabase itself, returns a plain result, and leaves
 * every piece of UI state to the caller.
 */

/** The unique violation on `applications (event_id, artist_id)`. */
const UNIQUE_VIOLATION = '23505';

export async function respondToOffer(offer, status, { actingProfileId, userId }) {
  if (!offer?.id || !actingProfileId) return { ok: false, reason: 'missing-identity' };

  /**
   * M6 (R6.1): the invitation already names the profile that was invited —
   * `applicant_profile_id`. Use it rather than re-deriving: the host chose this
   * profile, so any other answer would attribute the application to someone
   * they did not invite. The seam is a fallback for legacy rows only.
   *
   * ⚠ RESOLVED BEFORE THE WRITE ON PURPOSE. It is a READ, so doing it first
   * costs nothing and commits nothing — and the notification further down must
   * name the same profile the application was attributed to.
   */
  const fromProfileId = status === 'accepted'
    ? (offer.applicant_profile_id
        ?? (await resolvePerformerProfileId(userId)).profileId
        ?? null)
    : null;

  /**
   * ⛔⛔ `.select()` IS THE VERIFICATION. RLS filters an UPDATE rather than
   * erroring it: a policy that forbids this write returns `error: null` and
   * touches nothing. Only a returned id proves the row moved.
   *
   * ⚠ SCOPED TO THE ACTING PROFILE, like `handleClearEnquiries` and
   * `cancelEnquiry`. The scope is what turns an RLS refusal into a deliberate
   * no-op rather than an accident.
   */
  const { data: changed, error } = await supabase
    .from('venue_enquiries')
    .update({ status })
    .eq('id', offer.id)
    .eq('applicant_profile_id', actingProfileId)
    .select('id');
  if (error || !(changed || []).length) return { ok: false, reason: 'refused', error: error ?? null };

  /**
   * ⭐ NOW the consequence, and only now. The act is in the host's pipeline
   * because they accepted, so this cannot run before the acceptance is real.
   *
   * ⚠ A DUPLICATE IS NOT A FAILURE. `applications` carries
   * `UNIQUE (event_id, artist_id)`, so an act who had already applied to this
   * event hits 23505 — and the row it collides with is exactly the row this
   * wanted to exist. ⛔⛔ NOT an upsert: that would overwrite a status the HOST
   * has since set, resetting a decided application back to `pending`. Leaving
   * the existing row untouched is the only answer that cannot destroy someone
   * else's decision.
   *
   * ⚠ Any OTHER insert failure is reported, never swallowed. The acceptance
   * still stands — it is written and true — but the caller is owed the fact
   * that the pipeline entry did not appear.
   */
  let applicationWarning = null;
  if (status === 'accepted' && offer.event_id) {
    const { error: insErr } = await supabase
      .from('applications')
      .insert({ event_id: offer.event_id, artist_id: userId, from_profile_id: fromProfileId, status: 'pending' })
      .select('id');
    if (insErr && insErr.code !== UNIQUE_VIOLATION) applicationWarning = 'application-not-created';
  }

  /**
   * ⛔ NO NOTIFICATION ON A FAILED WRITE — and the write that governs this
   * notice is the one above, which succeeded. A missing application row does
   * not un-accept the invite, so the venue is still owed the news.
   */
  if (offer.venue_user_id && status === 'accepted') {
    // §A7: about = the performer profile that accepted (the same one the
    // application was attributed to, never re-derived, or the notice and the
    // application could name different profiles). to = the venue's profile,
    // inferred under U4; null if ambiguous.
    await writeNotification({
      toUserId:       offer.venue_user_id,
      toProfileId:    await inferToProfileId(offer.venue_user_id, 'venue'),
      aboutProfileId: fromProfileId,
      type:    'invite_accepted',
      message: `An artist accepted your invite${offer.event_name ? ` to ${offer.event_name}` : ''}.`,
      data:    { event_id: offer.event_id, event_name: offer.event_name },
    });
  }

  return { ok: true, applicationWarning };
}
