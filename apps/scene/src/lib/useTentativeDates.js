import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/**
 * TENTATIVE DATES — nights a promoter has pencilled in but not yet listed.
 *
 * Reads `public.tentative_dates`, a view over `personal_events` exposing THREE
 * columns: id, event_date and title. ⛔ It is not the table. `personal_events`
 * itself stays closed to anon, and `notes` and `user_id` never leave the
 * database — the view's WHERE clause and column list are the boundary.
 *
 * ⚠ A TENTATIVE DATE IS NOT AN ANNOUNCEMENT, and nothing here may let it look
 * like one. It earns a dot on the calendar and a line of text; it gets no
 * card, no poster and no event page, because there is no event yet. Owner,
 * 2026-08-21: "i dont want event cards until they make an actual event for
 * it". An offer is not an announcement — the same rule the enquiry work
 * settled, applied to a date.
 *
 * ⚠ FAILS SOFT. Migration pe2 may not be applied, and a missing view answers
 * 404. Its own query, its own swallowed error, so a pre-migration environment
 * loses the DOTS and nothing else. ⛔ Do not merge this into useEvents.
 */
export function useTentativeDates() {
  const { data } = useQuery({
    queryKey: ['tentative_dates'],
    // Pencilled-in dates move on a human timescale, not a page-load one.
    staleTime: 15 * 60 * 1000,
    // The failure this actually has is a missing view (404) before pe2 is
    // applied, and retrying does not conjure one.
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tentative_dates')
        .select('id, event_date, title')
        .order('event_date', { ascending: true });
      if (error) return [];
      return (data || []).filter(r => r.event_date);
    },
  });

  const rows = data || [];
  return {
    tentative: rows,
    /** The days that have at least one pencilled-in date, for the strip dots. */
    tentativeDaySet: new Set(rows.map(r => r.event_date)),
  };
}
