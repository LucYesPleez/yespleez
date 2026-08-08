import { PLACEHOLDER_ROWS } from '../../config/placeholderRows';
import { settle } from './latency';

/**
 * APPLICATIONS — in-memory implementation.
 *
 * ⭐ THE INTERFACE IS THE POINT. Every method below is shaped the way the
 * unified applications engine will be: filtering, sorting and paging are
 * arguments to a query, not something the UI does to an array it was handed.
 *
 * That matters more than it looks. A repository that returns everything and
 * lets the screen filter works perfectly against ten placeholder rows and
 * collapses at four hundred — and by then the filtering logic is spread
 * across components and cannot be pushed down to the database without
 * rewriting them. Doing it in the wrong place is cheap now and expensive
 * exactly when it starts to matter.
 *
 * ⚠ `decide()` records a decision and does NOT release it. Hold-and-release
 * is ratified (D-05): `decidedAt` is private until `outcomeReleasedAt` is
 * stamped, so an organiser can decide over three weeks and tell everyone at
 * once. Anything that sets both in one step has broken the rule.
 */

/**
 * The placeholder rows carry a human label; the model carries a role key.
 * Unmapped labels fall back to `music` rather than throwing — seed data is
 * not worth a crash, and the fallback is visible in the UI.
 */
const KEY_BY_LABEL = {
  Music: 'music',
  Volunteers: 'volunteer',
  Stalls: 'market_stall',
  Workshops: 'workshop',
  Performance: 'performance_artist',
};

/** Seeded from the shell's placeholder rows, normalised into the unified shape. */
let store = PLACEHOLDER_ROWS.map((r, i) => ({
  id: r.id,
  targetType: 'festival_edition',
  targetId: 'ed_2027',
  categoryKey: KEY_BY_LABEL[r.category] || 'music',
  fromProfileId: `prof_${i + 1}`,
  name: r.name,
  location: r.location,
  // The shell used 'new' as a display state; the model's word is 'submitted'.
  status: r.status === 'new' ? 'submitted' : r.status,
  stage: r.stage,
  submittedAt: null,
  decidedAt: null,
  outcomeReleasedAt: null,
  answers: {
    genre: r.genre, country: r.country, date: r.date,
    discipline: r.discipline, topic: r.topic, trades: r.trades, skills: r.skills,
    category: r.category,
  },
}));

export const applicationRepository = {
  /**
   * @param {Object} query
   * @param {string} [query.categoryKey]  omit or 'all' for every category
   * @param {string} [query.search]
   * @param {Object} [query.filters]      { status: [], stage: [], ... }
   * @param {string} [query.sort]
   * @param {number} [query.page]
   * @param {number} [query.pageSize]
   * @returns {Promise<import('../types').Page>}
   */
  async list({ categoryKey, search, filters = {}, sort = 'newest', page = 1, pageSize = 20 } = {}) {
    let items = store;

    if (categoryKey && categoryKey !== 'all') {
      items = items.filter(a => a.categoryKey === categoryKey);
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.location || '').toLowerCase().includes(q));
    }

    if (filters.status?.length) {
      items = items.filter(a => filters.status.includes(a.status));
    }

    if (sort === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'oldest') items = [...items].reverse();

    // The total is of the FILTERED set, before paging — it is what the
    // pagination bar states, and it must be exact.
    const total = items.length;
    const start = (page - 1) * pageSize;

    return settle({ items: items.slice(start, start + pageSize), total, page, pageSize });
  },

  async get(id) {
    return settle(store.find(a => a.id === id) || null);
  },

  /** Counts per category, for the tabs and the sidebar. One call, not nine. */
  async countsByCategory() {
    const counts = {};
    store.forEach(a => { counts[a.categoryKey] = (counts[a.categoryKey] || 0) + 1; });
    return settle(counts);
  },

  /**
   * Record a decision. PRIVATE until released — see the note at the top.
   * @param {string[]} ids
   * @param {'accepted'|'declined'|'shortlisted'|'in_review'} status
   */
  async decide(ids, status) {
    const now = new Date().toISOString();
    const terminal = status === 'accepted' || status === 'declined';
    store = store.map(a => ids.includes(a.id)
      ? { ...a, status, decidedAt: terminal ? now : null }
      : a);
    return settle(ids.length);
  },

  /** Overview figures. Mirrors the Supabase version's shape exactly. */
  async stats() {
    const count = fn => store.filter(fn).length;
    return settle({
      total: store.length,
      newThisWeek: 0,
      awaitingReview: count(a => a.status === 'submitted' || a.status === 'in_review'),
      shortlisted: count(a => a.status === 'shortlisted'),
      accepted: count(a => a.status === 'accepted'),
      declined: count(a => a.status === 'declined'),
      today: { newToday: 0, musicToday: 0, volunteersToday: 0, acceptedToday: 0, declinedToday: 0 },
    });
  },

  /** Decisions made but not yet told to anyone. Mirrors the Supabase version. */
  async pendingRelease({ categoryKey } = {}) {
    return settle(store
      .filter(a => (a.status === 'accepted' || a.status === 'declined')
        && a.decidedAt && !a.outcomeReleasedAt
        && (!categoryKey || categoryKey === 'all' || a.categoryKey === categoryKey))
      .map(a => a.id));
  },

  /** The separate, deliberate act of telling people. */
  async releaseOutcomes(ids) {
    const now = new Date().toISOString();
    store = store.map(a => ids.includes(a.id) && a.decidedAt
      ? { ...a, outcomeReleasedAt: now }
      : a);
    return settle(ids.length);
  },
};
