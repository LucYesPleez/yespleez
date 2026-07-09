import { supabase } from './supabase';

/**
 * Artist accepts a slot offer.
 * Updates the claim (by stable claim_id), advances the application, notifies the host.
 */
export async function acceptSlotOffer(data, userId) {
  if (data.claim_id) {
    await supabase.from('claims').update({ status: 'confirmed' }).eq('id', data.claim_id);
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
    await supabase.from('notifications').insert({
      user_id: data.host_id,
      type:    'slot_accepted',
      message: `${data.artist_name || 'An artist'} accepted the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
}

/**
 * Artist declines a slot offer.
 * Marks the claim declined, reverts the application to tentative, notifies the host.
 */
export async function declineSlotOffer(data, userId) {
  if (data.claim_id) {
    await supabase.from('claims').update({ status: 'declined' }).eq('id', data.claim_id);
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
    await supabase.from('notifications').insert({
      user_id: data.host_id,
      type:    'slot_declined',
      message: `${data.artist_name || 'An artist'} declined the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
}

/**
 * Artist accepts an event invite.
 * Creates a tentative application (host already invited them, so they're pre-shortlisted).
 */
export async function acceptInvite(data, userId) {
  await supabase.from('applications').insert({
    event_id:    data.event_id,
    artist_id:   userId,
    status:      'tentative',
    via_invite:  true,
    artist_name: data.artist_name,
    genre:       data.genre,
    mix_link:    data.mix_link,
  });
  if (data.host_id) {
    await supabase.from('notifications').insert({
      user_id: data.host_id,
      type:    'invite_accepted',
      message: `${data.artist_name || 'An artist'} accepted your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}

/**
 * Artist declines an event invite.
 * Notifies the host.
 */
export async function declineInvite(data, userId) {
  if (data.host_id) {
    await supabase.from('notifications').insert({
      user_id: data.host_id,
      type:    'invite_declined',
      message: `${data.artist_name || 'An artist'} declined your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}
