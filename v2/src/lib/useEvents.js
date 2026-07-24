import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

// Fetches all upcoming events once and filters in JS — cached for 3 min via React Query
export function useEvents(fromDate, toDate) {
  const { data, isLoading: loading, error } = useQuery({
    queryKey: ['events', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        // The embedded venue is where an event's location comes from — the
        // venue owns it, and the event's own postcode/lat/lng are the
        // venue-independent fallback for doofs, showgrounds and multi-venue
        // festivals. Resolution order lives in lib/geo.js eventCoords().
        .select('id, host_id, name, config, created_at, venue_profile_id, postcode, lat, lng, venue:venue_profile_id(postcode, state, lat, lng)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const events = (data || []).filter(ev => {
    const d = ev.config?.date;
    if (!d) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    return true;
  });

  return { events, loading, error };
}
