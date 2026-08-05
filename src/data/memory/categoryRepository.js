import { CATEGORIES, ALL_CATEGORY } from '../../config/categories';
import { settle } from './latency';

/**
 * CATEGORIES — in-memory implementation.
 *
 * Reads the same registry the UI already used, but behind the repository
 * interface. When these become rows in a `festival_categories` table, this
 * file is the only thing that changes.
 *
 * ⭐ The registry stays the source of column sets and icons even after the
 * database owns categories: which columns a Music application shows is a
 * PRESENTATION decision, and storing it per festival would let two festivals
 * disagree about what a Music application looks like.
 */
const WINDOWS = {
  music:              { opensAt: '2026-09-01', closesAt: '2026-10-14', state: 'open' },
  volunteer:          { opensAt: '2026-09-01', closesAt: '2026-12-01', state: 'open' },
  market_stall:       { opensAt: '2026-09-01', closesAt: '2026-11-01', state: 'open' },
  food_vendor:        { opensAt: '2026-09-01', closesAt: '2026-10-01', state: 'open' },
  workshop:           { opensAt: '2026-09-01', closesAt: null,         state: 'scheduled' },
  performance_artist: { opensAt: '2026-09-01', closesAt: '2026-10-14', state: 'open' },
  decor:              { opensAt: '2026-09-01', closesAt: '2026-10-01', state: 'open' },
  media:              { opensAt: '2026-10-01', closesAt: '2026-12-01', state: 'scheduled' },
  theme_camp:         { opensAt: '2026-09-01', closesAt: '2026-11-01', state: 'closed' },
  // The trades have no closing date: a register-interest listing stays open
  // because there is no round to close.
  sound_system:       { opensAt: '2026-09-01', closesAt: null,         state: 'open' },
  lighting:           { opensAt: '2026-09-01', closesAt: null,         state: 'open' },
  staging:            { opensAt: '2026-09-01', closesAt: null,         state: 'open' },
};

function decorate(cat) {
  const w = WINDOWS[cat.key] || {};
  return {
    id: `cat_${cat.key}`,
    key: cat.key,
    label: cat.label,
    icon: cat.icon,
    noun: cat.noun,
    columns: cat.columns,
    count: cat.count,
    // ⚠ `decorate` builds an explicit object, so anything added to the registry
    // and not named here is silently dropped before the UI sees it. `intent`
    // decides whether a category renders as a queue or a list.
    intent: cat.intent,
    opensAt: w.opensAt ?? null,
    closesAt: w.closesAt ?? null,
    state: w.state ?? 'open',
    // D-05 — decision mode is per CATEGORY, never per festival. Volunteers
    // are accepted continuously; Music is held until the lineup is settled.
    decisionMode: cat.key === 'volunteer' ? 'immediate' : 'hold',
  };
}

export const categoryRepository = {
  /** Every category on the current edition. */
  async list() {
    return settle(CATEGORIES.map(decorate));
  },

  /**
   * One category, or the "All" pseudo-category.
   * An unknown key resolves to All rather than throwing — a stale bookmark to
   * a retired category should show the list, not a dead end.
   */
  async get(key) {
    if (!key || key === 'all') return settle({ ...ALL_CATEGORY, id: 'cat_all', state: 'open' });
    const found = CATEGORIES.find(c => c.key === key);
    return settle(found ? decorate(found) : { ...ALL_CATEGORY, id: 'cat_all', state: 'open' });
  },
};
