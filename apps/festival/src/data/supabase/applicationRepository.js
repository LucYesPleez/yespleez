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
    // A festival with no event yet has no applications — an empty page, not a
    // crash. Same for every event-scoped read below.
    if (!current) return { items: [], total: 0, page, pageSize };

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
    if (!current) return null;
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
    if (!current) return Object.fromEntries(CATEGORIES.map(c => [c.key, 0]));
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

  /**
   * Record a decision. PRIVATE until released — see the note at the top.
   *
   * ⭐⭐ ACCEPTANCE GOES THROUGH AN RPC, EVERY OTHER OUTCOME IS AN UPDATE, and
   * the asymmetry is the point: accepting is where an application becomes
   * PARTICIPATION, and the two must be written in one transaction or they can
   * drift. A client that stamped the status and then created participation
   * would leave a window where someone reads as accepted and is part of
   * nothing — and neither half looks wrong on its own, so nothing would notice.
   *
   * ⭐ The category → participant_type mapping deliberately lives in the
   * database, not here. Which identity a person participates as is platform
   * knowledge; this app should not have to learn it, and a second copy in Scene
   * would be a third place to get it wrong.
   *
   * ⛔ Shortlisted, waitlisted and declined create no participation.
   * Participation begins at Accepted — a waitlisted person is still an
   * applicant whose application has another outcome.
   */
  async decide(ids, status) {
    if (!ids?.length) return 0;

    if (status === 'accepted') {
      const { data, error } = await supabase.rpc('accept_festival_applications', { p_ids: ids });
      if (error) throw error;
      return data ?? 0;
    }

    const terminal = status === 'declined';
    const { data, error } = await supabase
      .from('festival_applications')
      .update({ status, decided_at: terminal ? new Date().toISOString() : null })
      .in('id', ids)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  },

  /**
   * The Overview's figures, for the SELECTED EVENT.
   *
   * ⚠ Every number is an exact head-count, never a fetch-and-count-in-JS:
   * PostgREST caps a response at 1000 rows, and an Overview that quietly
   * under-reports past a thousand applications is worse than one that is
   * missing. These are the first numbers an organiser reads each morning.
   *
   * ⭐ Only deltas that can be COMPUTED are returned. There is no audit log, so
   * "↑ 5 since yesterday" is unknowable and is therefore absent rather than
   * invented — absent and zero are different facts, and a made-up trend is the
   * one thing a summary screen must never do.
   */
  async stats() {
    const { current } = await getFestivalContext();
    if (!current) {
      return {
        total: 0, newThisWeek: 0, awaitingReview: 0, shortlisted: 0, accepted: 0, declined: 0,
        today: { newToday: 0, musicToday: 0, volunteersToday: 0, acceptedToday: 0, declinedToday: 0 },
      };
    }
    const q = () => supabase
      .from('festival_applications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', current.id);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayIso = startOfToday.toISOString();
    const weekIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await Promise.all([
      q(),
      q().gte('submitted_at', weekIso),
      q().in('status', ['submitted', 'in_review']),
      q().eq('status', 'shortlisted'),
      q().eq('status', 'accepted'),
      q().eq('status', 'declined'),
      q().gte('submitted_at', todayIso),
      q().gte('submitted_at', todayIso).eq('category_key', 'music'),
      q().gte('submitted_at', todayIso).eq('category_key', 'volunteer'),
      q().eq('status', 'accepted').gte('decided_at', todayIso),
      q().eq('status', 'declined').gte('decided_at', todayIso),
    ]);

    const n = r => { if (r.error) throw r.error; return r.count ?? 0; };
    const [total, newThisWeek, awaitingReview, shortlisted, accepted, declined,
      newToday, musicToday, volunteersToday, acceptedToday, declinedToday] = results.map(n);

    return {
      total, newThisWeek, awaitingReview, shortlisted, accepted, declined,
      today: { newToday, musicToday, volunteersToday, acceptedToday, declinedToday },
    };
  },

  /**
   * Decisions made but not yet told to anyone.
   *
   * ⭐ This is the number that makes hold-and-release visible to the organiser.
   * Without it a reviewer has no idea anything is waiting, and "decide over
   * three weeks, tell everyone at once" quietly becomes "nobody ever hears".
   */
  async pendingRelease({ categoryKey } = {}) {
    const { current } = await getFestivalContext();
    if (!current) return [];
    let q = supabase
      .from('festival_applications')
      .select('id')
      .eq('event_id', current.id)
      .in('status', ['accepted', 'declined'])
      .is('outcome_released_at', null);
    if (categoryKey && categoryKey !== 'all') q = q.eq('category_key', categoryKey);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(r => r.id);
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
