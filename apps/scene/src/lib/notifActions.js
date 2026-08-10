import { supabase } from './supabase';
import { writeNotification, inferToProfileId } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';
import { scopeToApplicant } from './applicantProfiles';

/**
 * Remove a notification from the recipient's inbox WITHOUT destroying it.
 *
 * ⚠ DISMISSAL IS NOT DELETION, and the difference is the point. There is no
 * DELETE policy on `notifications` and there is not meant to be one — see
 * migration `20260804000000_sec6a_notification_dismissal.sql`. The row stays;
 * only its visibility changes, which is the same choice `N1` makes for held
 * rows and `NP1` makes for muted ones ("a held notification is an asset; a
 * suppressed one is a deleted fact").
 *
 * It matters more since SEC-1: any authenticated user can address a
 * notification to anyone, so a row may be FORGED, and a forged row is the only
 * evidence of the attempt. The instinct on seeing a suspicious notification is
 * to get rid of it, and deletion would spend that evidence to do it.
 *
 * Held rows cannot reach here: they carry `to_user_id IS NULL`, the UPDATE
 * policy keys on `auth.uid() = to_user_id`, and equality never matches NULL.
 *
 * @param {string} id
 * @returns {Promise<{error: Error|null}>}
 */
export async function dismissNotification(id) {
  if (!id) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error ?? null };
}

/**
 * Record that an actionable notification has been answered.
 *
 * ⚠ THIS USED TO LIVE ONLY IN REACT STATE, and that was a defect rather than a
 * shortcut. `responded_at` was read back on render (so the row knew how to look
 * answered) but every write went to `setNotifs` and stopped there. After a
 * reload the column was still NULL, ACCEPT and DECLINE returned, and tapping
 * again re-ran the whole action — re-updating `performances` and
 * `applications` with no record that a response had already happened.
 *
 * That made the SEC-1 forgery replayable, which is why this is part of the same
 * change rather than a later tidy-up.
 *
 * Deliberately fire-and-forget at the call site: the underlying accept/decline
 * has already committed by the time this runs, so failing to stamp the receipt
 * must not present as the action having failed. The row simply offers its
 * buttons again, which is exactly today's behaviour.
 *
 * @param {string} id
 * @returns {Promise<{error: Error|null}>}
 */
export async function markResponded(id) {
  if (!id) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ responded_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error ?? null };
}

/**
 * §A7 identities for the four host-directed notices below. All four say
 * "an artist did something to your event", so they share one shape:
 *
 *   about = the acting ARTIST's profile   (the activity the notice concerns)
 *   to    = the recipient's HOST profile  (which of their profiles it is for)
 *   toUser= data.host_id                  (delivery)
 *
 * Both profile ids resolve under `U4` — exactly one owned profile of the
 * applicable type, or null. Null is a correct answer here, not a gap; see
 * the note in writeNotification.js.
 */
/**
 * Which PROFILE was offered this slot.
 *
 * The two status updates below narrowed by `artist_id` — the account — so a
 * person with a DJ act and a band could accept a slot offered to one and flip
 * the other's application row for the same event. The offer itself is not
 * ambiguous: a performance names a lineup member, and a lineup member names
 * the profile the host booked. That is the answer, so ask for it.
 *
 * Returns null for a manually-typed lineup entry (`fillManual` writes a name
 * and no profile) — the caller then keeps the account filter, which is the
 * pre-identity behaviour and no worse than before.
 */
async function offeredProfileId(performanceId) {
  if (!performanceId) return null;
  const { data: perf } = await supabase.from('performances')
    .select('lineup_member_id').eq('id', performanceId).maybeSingle();
  if (!perf?.lineup_member_id) return null;
  const { data: member } = await supabase.from('lineup_members')
    .select('artist_profile_id').eq('id', perf.lineup_member_id).maybeSingle();
  return member?.artist_profile_id ?? null;
}

// `scopeToApplicant` moved to lib/applicantProfiles.js at M6 completion: three
// other call sites needed the same profile-first-with-account-fallback rule,
// and a second copy of it is how the two drift apart.

async function hostNoticeIdentities(hostUserId, artistUserId) {
  const [toProfileId, performer] = await Promise.all([
    inferToProfileId(hostUserId, 'host'),
    resolvePerformerProfileId(artistUserId),
  ]);
  return { toProfileId, aboutProfileId: performer.profileId ?? null };
}

export async function acceptSlotOffer(data, userId) {
  if (data.performance_id) {
    await supabase.from('performances').update({ status: 'accepted' }).eq('id', data.performance_id);
  }
  if (data.event_id && userId) {
    await scopeToApplicant(
      supabase.from('applications').update({ status: 'confirmed' }).eq('event_id', data.event_id),
      await offeredProfileId(data.performance_id), userId,
    ).in('status', ['offered', 'accepted']);
  }
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'slot_accepted',
      message: `${data.artist_name || 'An artist'} accepted the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
}

export async function declineSlotOffer(data, userId) {
  if (data.performance_id) {
    await supabase.from('performances').update({ status: 'declined' }).eq('id', data.performance_id);
  }
  if (data.event_id && userId) {
    await scopeToApplicant(
      supabase.from('applications').update({ status: 'tentative' }).eq('event_id', data.event_id),
      await offeredProfileId(data.performance_id), userId,
    ).in('status', ['offered', 'accepted']);
  }
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'slot_declined',
      message: `${data.artist_name || 'An artist'} declined the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
}

/**
 * Accept an invitation to perform, which creates the application.
 *
 * ⭐⭐ THE INVITED PROFILE IS KNOWN — USE IT, DO NOT RE-DERIVE IT.
 *
 * The invitation names exactly one act: `InviteSheet` writes it as the
 * notification's `to_profile_id`, and `venue_enquiries.applicant_profile_id`
 * carries the same value. This function's own comment predicted the fix — "if
 * the invite ever starts carrying the invited profile id … prefer that and this
 * branch stops mattering" — and since `0758227` it always does.
 *
 * ⚠ WHAT THE OLD BEHAVIOUR COST. `resolvePerformerProfileId` looks the account
 * up and refuses to guess when it owns several performer profiles, correctly
 * under U4 — leaving `from_profile_id` NULL. So a person with a DJ act and a
 * band who accepted an invite got an application attributed to NOBODY: absent
 * from their dashboard, which reads by profile, and unattributable for the
 * host. It picked the ambiguity up from the ACCOUNT when the invitation had
 * already resolved it.
 *
 * ⚠ P11 made multi-act accounts a first-class case, so this was getting more
 * likely, not less.
 *
 * @param {object} data          the notification's `data` payload
 * @param {string} userId        the accepting account
 * @param {string|null} [invitedProfileId]
 *   the notification's `to_profile_id` — the act that was invited. Omitted
 *   only by a caller that has not been updated, or by a LEGACY invite written
 *   before the id was guaranteed; both fall back to the old resolution.
 */
export async function acceptInvite(data, userId, invitedProfileId = null) {
  let profileId = invitedProfileId ?? null;

  if (!profileId) {
    // Legacy path. Same U4 rule as before: refuse to guess, leave it NULL,
    // and say so — an unattributed application is a known state, not a
    // silent one.
    const resolved = await resolvePerformerProfileId(userId);
    profileId = resolved.profileId;
    if (resolved.ambiguous) {
      console.warn('[acceptInvite] no invited profile on the notification and several performer profiles; sender left unattributed', { userId });
    }
  }
  await supabase.from('applications').insert({
    event_id:        data.event_id,
    artist_id:       userId,
    from_profile_id: profileId ?? null,
    status:          'tentative',
  });
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      toProfileId: await inferToProfileId(data.host_id, 'host'),
      // The performer profile was already resolved above under the same U4
      // rule — reuse it rather than resolving twice and risking divergence.
      aboutProfileId: profileId ?? null,
      type:    'invite_accepted',
      message: `${data.artist_name || 'An artist'} accepted your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}

export async function declineInvite(data, userId) {
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'invite_declined',
      message: `${data.artist_name || 'An artist'} declined your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}
