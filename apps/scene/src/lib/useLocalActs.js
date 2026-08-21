import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { LOCALS_TYPES, linkedProfileIds, withUpcomingEvents } from './locals';

const POOL_COLS =
  'id,user_id,name,type,avatar,avatar_thumb,location,suburb,state,postcode,' +
  'lat,lng,sound,genre_string,venue_type,claim_status,updated_at';

/**
 * THE PEOPLE AND PLACES WITH SOMETHING COMING UP.
 *
 * ⭐ Only acts attached to one of `events` come back. Owner, 2026-08-21: "only
 * artists that have events coming up. if they dont have events listed they
 * dont get listed in this section. obviously theyll still be searchable on
 * discover". A rail of acts with nothing booked is a directory, and Discover
 * is where a directory belongs — this answers "who is playing around here".
 *
 * ⚠ The candidate pull stays deliberately wide and cheap, exactly as it was on
 * My Scene: one page of live profiles, newest activity first. The ladder in
 * lib/locals.js decides what surfaces, not the query — and now the events
 * filter narrows it before the ladder ever runs.
 *
 * ⚠ Two queries, not a join. `lineup_members` cannot be embedded from
 * `profiles`, and the ids arrive in two keyspaces anyway
 * (`artist_profile_id` and the legacy `artist_id`), which a join would not
 * reconcile. Both reads are anon-readable, so this works signed out.
 */
export function useLocalActs(events) {
  const eventIds = (events || []).map(e => e && e.id).filter(Boolean);
  const key = eventIds.slice().sort().join(',');

  const { data } = useQuery({
    queryKey: ['localActs', key],
    staleTime: 10 * 60 * 1000,
    // A missing table or grant is not something a retry fixes, and this rail
    // is an enhancement — it must never be the reason the page looks broken.
    retry: false,
    enabled: eventIds.length > 0,
    queryFn: async () => {
      const [poolRes, lineupRes] = await Promise.all([
        supabase.from('profiles').select(POOL_COLS)
          .in('type', LOCALS_TYPES)
          .or('is_live.is.null,is_live.neq.false')
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase.from('lineup_members').select('event_id,artist_profile_id,artist_id')
          .in('event_id', eventIds),
      ]);
      if (poolRes.error) return [];
      const linked = linkedProfileIds(events, lineupRes.data || []);
      return withUpcomingEvents(poolRes.data || [], linked);
    },
  });

  return data || [];
}
