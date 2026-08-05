import { supabase } from './client';
import { getFestivalContext } from './currentEvent';
import { CATEGORIES } from '../../config/categories';

/**
 * APPLICATIONS — Supabase implementation.
 *
 * ⭐ Filtering, sorting and paging are ARGUMENTS TO A QUERY, exactly as the
 * in-memory version promised. Nothing here hands the screen an array to filter.
 *
 * ⚠ `decide()` records a decision and does NOT release it. Hold-and-release is
 * ratified: `decided_at` is private until `outcome_released_at` is stamped, so
 * an organiser can decide over three weeks and tell everyone at once. Anything
 * that sets both in one step has broken the rule — and the RLS policy backs
 * this up by giving applicants no read at all.
 */

// The applicant's name and location are RESOLVED FROM THE PROFILE, never copied
// onto the application. `!inner` makes it a real join so a search on the name
// filters applications rather than just trimming the embedded object.
const SELECT = `
  id, category_key, from_profile_id, status, stage,
  submitted_at, decided_at, outcome_released_at, answers,
  profiles!inner ( name, location )
`;

function toModel(row, eventId) {
  return {
    id: row.id,
    // An application targets an EVENT — the platform's own, with a public URL.
    targetType: 'event',
    targetId: eventId,
    categoryKey: row.category_key,
    fromProfileId: row.from_profile_id,
    name: row.profiles?.name ?? '',
    location: row.profiles?.location ?? null,
    status: row.status,
    stage: row.stage ?? null,
    submittedAt: row.submitted_at ?? null,
    decidedAt: row.decided_at ?? null,
    outcomeReleasedAt: row.outcome_released_at ?? null,
    answers: row.answers ?? {},
  };
}

export const applicationRepository = {
  async list({ categoryKey, search, filters = {}, sort = 'newest', page = 1, pageSize = 20 } = {}) {
    const { current } = await getFestivalContext();

    let q = supabase
      .from('festival_applications')
      .select(SELECT, { count: 'exact' })
      .eq('event_id', current.id);

    if (categoryKey && categoryKey !== 'all') q = q.eq('category_key', categoryKey);
    if (search) q = q.ilike('profiles.name', `%${search}%`);
    if (filters.status?.length) q = q.in('status', filters.status);
    if (filters.stage?.length) q = q.in('stage', filters.stage);

    // ⚠ sort === 'name' is NOT supported yet and falls through to newest.
    // PostgREST orders an embedded table WITHIN each parent row, so ordering
    // applications by the applicant's name needs a joined view. The toolbar
    // does not offer name sort today, so nothing regresses — but do not
    // "fix" this by sorting the current page in JS, which orders 20 rows and
    // silently lies about the other 600.
    q = q.order('submitted_at', { ascending: sort === 'oldest' });

    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw error;

    return {
      items: (data ?? []).map(r => toModel(r, current.id)),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  async get(id) {
    const { current } = await getFestivalContext();
    const { data, error } = await supabase
      .from('festival_applications')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? toModel(data, current.id) : null;
  },

  /**
   * Counts per category, for the tabs and the sidebar.
   *
   * ⚠ One exact head-count per category rather than fetching every row and
   * counting in JS: PostgREST caps a response at 1000 rows, so the JS version
   * would quietly under-report the moment Deliverance passes a thousand
   * applications — and a count that is wrong without complaining is worse than
   * one that is missing. The pagination bar states these numbers.
   */
  async countsByCategory() {
    const { current } = await getFestivalContext();
    const entries = await Promise.all(CATEGORIES.map(async ({ key }) => {
      const { count, error } = await supabase
        .from('festival_applications')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', current.id)
        .eq('category_key', key);
      if (error) throw error;
      return [key, count ?? 0];
    }));
    return Object.fromEntries(entries);
  },

  /** Record a decision. PRIVATE until released — see the note at the top. */
  async decide(ids, status) {
    if (!ids?.length) return 0;
    const terminal = status === 'accepted' || status === 'declined';
    const { data, error } = await supabase
      .from('festival_applications')
      .update({ status, decided_at: terminal ? new Date().toISOString() : null })
      .in('id', ids)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  },

  /** The separate, deliberate act of telling people. */
  async releaseOutcomes(ids) {
    if (!ids?.length) return 0;
    const { data, error } = await supabase
      .from('festival_applications')
      .update({ outcome_released_at: new Date().toISOString() })
      .in('id', ids)
      // Releasing an undecided application would tell an applicant an outcome
      // that does not exist. Filtered here as well as in the UI.
      .not('decided_at', 'is', null)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  },
};
