import { supabase } from './supabase';

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
    await supabase.from('notifications').insert({
      user_id: data.host_id,
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
    await supabase.from('notifications').insert({
      user_id: data.host_id,
      type:    'slot_declined',
      message: `${data.artist_name || 'An artist'} declined the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
}

export async function acceptInvite(data, userId) {
  await supabase.from('applications').insert({
    event_id:  data.event_id,
    artist_id: userId,
    status:    'tentative',
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
