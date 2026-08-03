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
        // owner_profile_id rides along for the scene floor's favourite-first
        // ordering (follows.target_profile_id ↔ owner/venue profile ids).
        .select('id, host_id, name, status, is_public, config, created_at, venue_profile_id, owner_profile_id, postcode, lat, lng, venue:venue_profile_id(postcode, state, lat, lng)')
        // ⚠ THE PUBLIC-VISIBILITY GATE. Every consumer of this hook is a public
        // browse surface (What's On, My Scene), and this hook previously applied
        // neither filter — nor even SELECTED the two columns, so no consumer
        // could have filtered downstream either. A host who turned Public Event
        // OFF still saw their event listed in What's On, and the one live draft
        // event was listed too.
        //
        // These two clauses are DiscoverScreen's, verbatim (:174-175) — the
        // canonical public-event query. Copied rather than invented so the
        // surfaces agree; if this rule changes it must change in both.
        //
        // `is_public.is.null` is not sloppiness: NULL means "written before the
        // column existed" and the whole app reads that as public — see
        // CreateEventScreen's `data.is_public !== false` and EventsSection:92.
        // Using `.eq('is_public', true)` here would silently hide every older
        // event on the platform.
        .eq('status', 'live')
        .or('is_public.eq.true,is_public.is.null')
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
