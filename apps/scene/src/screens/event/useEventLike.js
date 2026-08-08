// EP-00d · the event favourite (the heart).
//
// ⚠ The toggle is not wired to anything yet. It was already unreachable in
// EventScreen — declared, never called, no control rendered — so this is not a
// regression, it is that dead code given a name and a home. EP-02 puts the
// heart in the hero and calls `toggleLike`.
//
// The effect is NOT dead and must keep running: it warms the module-level
// `likedEvents` cache from the row, which other screens read.
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getPersonalProfileId } from '../../lib/actingProfile';
import { track, EVENTS } from '../../lib/analytics';
import { likedEvents } from '../../lib/likedEvents';

export function useEventLike({ id, event, userId, isRealEvent }) {
  const [liked,     setLiked]     = useState(() => likedEvents.has(id));
  const [likedBusy, setLikedBusy] = useState(false);

  useEffect(() => {
    if (!event || !userId || !isRealEvent) return;
    if (likedEvents.has(id)) return; // already confirmed this session
    supabase.from('follows').select('id').eq('user_id', userId).eq('entity_id', id).maybeSingle()
      .then(({ data: fol }) => {
        if (fol) { likedEvents.add(id); setLiked(true); }
      });
  }, [event?.id, userId, isRealEvent]);

  async function toggleLike() {
    if (!userId || likedBusy || !isRealEvent) return;
    setLikedBusy(true);
    if (liked) {
      const { error } = await supabase.from('follows').delete().eq('user_id', userId).eq('entity_id', id);
      if (!error) { likedEvents.delete(id); setLiked(false); }
      else console.error('unfollow error:', error);
    } else {
      // M6 (R6.1): stamp attribution at write time — a follow is a
      // personal act, so it comes from the Personal profile (§A6/§A9).
      const fromProfileId = await getPersonalProfileId(userId);
      const { error } = await supabase.from('follows').insert({ user_id: userId, from_profile_id: fromProfileId, entity_id: id, entity_type: 'event', entity_name: event.name });
      if (!error) { likedEvents.add(id); setLiked(true); track(EVENTS.FOLLOWED, { entity_type: 'event' }); }
      else console.error('follow error:', error.message, error.code, error.details, error.hint);
    }
    setLikedBusy(false);
  }

  return { liked, likedBusy, toggleLike };
}
