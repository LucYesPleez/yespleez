import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/**
 * THE FEATURED EXPOSURE LEDGER, as the ranking engine wants it.
 *
 * Returns `[{ eventId, date }]` — the shape `featuredEvent.js` reads. The
 * mapping happens here so the engine never learns a column name and stays a
 * pure function of plain data.
 *
 * ⚠ FAILS SOFT, DELIBERATELY. Migration `fe1_featured_allocation` may not be
 * applied yet, and a missing table answers 404/400. This is its own query with
 * its own error swallowed so a pre-migration environment loses the LEDGER and
 * nothing else — the same discipline My Scene uses for `scene_radius_km`.
 * ⛔ Do not merge this into useEvents: one failure would then take What's On
 * down entirely.
 *
 * An empty result is not an error. Nothing writes this table from the app (by
 * design — see the migration header), so until Studio records allocations the
 * caller falls back to `replayHistory()`.
 */
export function useFeaturedAllocations(fromIso) {
  const { data } = useQuery({
    queryKey: ['featured_allocation', fromIso || 'all'],
    // The ledger changes at most once a day; re-fetching it on every mount
    // buys nothing and costs a round trip on a public browse surface.
    staleTime: 15 * 60 * 1000,
    // ⚠ Belt and braces only. The PGRST205 (missing table) case never reaches
    // React Query at all — supabase-js RESOLVES with `{error}` rather than
    // throwing, and the queryFn below turns that into `[]`. This covers the
    // other path, a transport-level throw, where retrying a table that does
    // not exist would just multiply the console noise a real error has to
    // stand out against.
    retry: false,
    queryFn: async () => {
      let q = supabase
        .from('featured_allocation')
        .select('event_id, featured_date, selection_type, allocation_id, status')
        // ⭐⭐ REMOVED ROWS ARE HISTORY, NOT EXPOSURE. A cancelled future day
        // never happened, so charging the event for it would penalise an act
        // for a run an administrator called off. The rows stay in the table as
        // the record of what was scheduled; they simply do not reach the
        // engine. ⛔ Never fix this by deleting the row instead.
        .eq('status', 'active')
        .order('featured_date', { ascending: true });
      if (fromIso) q = q.gte('featured_date', fromIso);
      const { data, error } = await q;
      if (error) return [];              // pre-migration, or no read grant yet
      return (data || [])
        .filter(r => r.event_id && r.featured_date)
        .map(r => ({
          eventId: r.event_id,
          date: r.featured_date,
          // Carried so `allocationForToday()` can tell a human decision from
          // one this engine made itself.
          selectionType: r.selection_type,
          allocationId: r.allocation_id,
        }));
    },
  });

  return { allocations: data || [] };
}
