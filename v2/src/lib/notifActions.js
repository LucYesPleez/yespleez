import { supabase } from './supabase';
import { writeNotification } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';

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
    await writeNotification(
      data.host_id,
      'slot_accepted',
      `${data.artist_name || 'An artist'} accepted the slot at ${data.event_name || 'your event'}.`,
      { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    );
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
    await writeNotification(
      data.host_id,
      'slot_declined',
      `${data.artist_name || 'An artist'} declined the slot at ${data.event_name || 'your event'}.`,
      { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    );
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
    await writeNotification(
      data.host_id,
      'invite_accepted',
      `${data.artist_name || 'An artist'} accepted your invite to ${data.event_name || 'your event'}.`,
      { event_id: data.event_id, artist_user_id: userId },
    );
  }
}

export async function declineInvite(data, userId) {
  if (data.host_id) {
    await writeNotification(
      data.host_id,
      'invite_declined',
      `${data.artist_name || 'An artist'} declined your invite to ${data.event_name || 'your event'}.`,
      { event_id: data.event_id, artist_user_id: userId },
    );
  }
}
