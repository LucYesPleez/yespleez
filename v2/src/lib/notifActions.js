import { supabase } from './supabase';
import { writeNotification, inferToProfileId } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';

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
    await supabase
      .from('applications')
      .update({ status: 'confirmed' })
      .eq('event_id', data.event_id)
      .eq('artist_id', userId)
      .in('status', ['offered', 'accepted']);
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
    await supabase
      .from('applications')
      .update({ status: 'tentative' })
      .eq('event_id', data.event_id)
      .eq('artist_id', userId)
      .in('status', ['offered', 'accepted']);
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

export async function acceptInvite(data, userId) {
  // M6 (R6.1): stamp the sender profile. This path has no UI to ask with,
  // so it resolves deterministically only. Where the account owns several
  // performer profiles the sender stays NULL rather than being guessed —
  // U4's rule applied at write time instead of at backfill time.
  //
  // If the invite ever starts carrying the invited profile id (as
  // venue_enquiries.applicant_profile_id already does), prefer that and
  // this branch stops mattering.
  const { profileId, ambiguous } = await resolvePerformerProfileId(userId);
  if (ambiguous) {
    console.warn('[acceptInvite] multiple performer profiles; sender left unattributed', { userId });
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
