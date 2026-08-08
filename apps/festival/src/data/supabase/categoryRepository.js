import { supabase } from './client';
import { getFestivalContext } from './currentEvent';
import { CATEGORIES, ALL_CATEGORY } from '../../config/categories';
import { applicationRepository } from './applicationRepository';

/**
 * CATEGORIES — Supabase implementation.
 *
 * ⭐ THE REGISTRY STAYS. `label`, `icon`, `noun` and `columns` are PRESENTATION
 * and remain in `config/categories.js`; the database owns only what varies per
 * festival and per round — `state`, the open/close dates, `decision_mode` and
 * `intent`. Storing the column set per festival would let two festivals
 * disagree about what a Music application looks like.
 *
 * A category row with no registry entry is DROPPED rather than rendered: the
 * table would have no columns to show it with, and a nameless tab is worse
 * than a missing one.
 */
function merge(row, entry, count) {
  return {
    id: row.id,
    key: entry.key,
    label: entry.label,
    icon: entry.icon,
    noun: entry.noun,
    columns: entry.columns,
    count,
    opensAt: row.opens_at ?? null,
    closesAt: row.closes_at ?? null,
    state: row.state,
    decisionMode: row.decision_mode,
    intent: row.intent,
  };
}

async function rows() {
  const { current } = await getFestivalContext();
  // No event selected-or-existing yet: no categories, not an error.
  if (!current) return [];
  const { data, error } = await supabase
    .from('festival_categories')
    .select('id, key, state, opens_at, closes_at, decision_mode, intent')
    .eq('event_id', current.id);
  if (error) throw error;
  return data ?? [];
}

export const categoryRepository = {
  async list() {
    const [data, counts] = await Promise.all([rows(), applicationRepository.countsByCategory()]);
    const byKey = new Map(data.map(r => [r.key, r]));
    // Registry order, not database order — the tab strip must not reshuffle
    // because a row was inserted later.
    return CATEGORIES
      .filter(entry => byKey.has(entry.key))
      .map(entry => merge(byKey.get(entry.key), entry, counts[entry.key] ?? 0));
  },

  async get(key) {
    if (!key || key === 'all') {
      const counts = await applicationRepository.countsByCategory();
      const total = Object.values(counts).reduce((n, c) => n + c, 0);
      return { ...ALL_CATEGORY, id: 'cat_all', state: 'open', count: total };
    }
    const entry = CATEGORIES.find(c => c.key === key);
    const data = await rows();
    const row = data.find(r => r.key === key);
    // An unknown or retired category resolves to All rather than throwing — a
    // stale bookmark should show the list, not a dead end.
    if (!entry || !row) return this.get('all');
    const counts = await applicationRepository.countsByCategory();
    return merge(row, entry, counts[key] ?? 0);
  },
};
