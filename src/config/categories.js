/**
 * THE CATEGORY REGISTRY — the single description of what a festival recruits.
 *
 * ⭐ Categories are NOT pages. There is one Applications workspace, and this
 * file is what makes it serve every category. Adding "Sponsors" next year is
 * an entry here: a tab appears, the table takes the right columns, the empty
 * state says the right thing. No new route, no new screen, no new component.
 *
 * `columns` names which column definitions (see `columns.js`) that category
 * shows. This is presentation configuration, not filtering — the table is
 * still the single source of truth about how a row renders.
 *
 * Keys match the platform's ratified role keys: `food_vendor` is separate
 * from `market_stall`, and the non-music performance role is
 * `performance_artist` — never `performer`, which would collide with Scene's
 * music artists.
 */

export const CATEGORIES = [
  {
    key: 'music',
    label: 'Music',
    icon: 'music',
    count: 184,
    noun: 'act',
    columns: ['applicant', 'genre', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'volunteer',
    label: 'Volunteers',
    icon: 'volunteer',
    count: 93,
    noun: 'volunteer',
    columns: ['applicant', 'skills', 'availability', 'stage', 'status', 'date'],
  },
  {
    key: 'market_stall',
    label: 'Market Stalls',
    icon: 'market_stall',
    count: 41,
    noun: 'stall',
    columns: ['applicant', 'trades', 'frontage', 'stage', 'status', 'date'],
  },
  {
    key: 'food_vendor',
    label: 'Food Vendors',
    icon: 'food_vendor',
    count: 22,
    noun: 'vendor',
    columns: ['applicant', 'cuisine', 'power', 'stage', 'status', 'date'],
  },
  {
    key: 'workshop',
    label: 'Workshops',
    icon: 'workshop',
    count: 18,
    noun: 'workshop',
    columns: ['applicant', 'topic', 'duration', 'stage', 'status', 'date'],
  },
  {
    key: 'performance_artist',
    label: 'Performance Artists',
    icon: 'performance_artist',
    count: 27,
    noun: 'act',
    columns: ['applicant', 'discipline', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'decor',
    label: 'Decor',
    icon: 'decor',
    count: 11,
    noun: 'crew',
    columns: ['applicant', 'discipline', 'scale', 'stage', 'status', 'date'],
  },
  {
    key: 'media',
    label: 'Media',
    icon: 'media',
    count: 12,
    noun: 'outlet',
    columns: ['applicant', 'outlet', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'theme_camp',
    label: 'Theme Camps',
    icon: 'theme_camp',
    count: 9,
    noun: 'camp',
    columns: ['applicant', 'campSize', 'footprint', 'stage', 'status', 'date'],
  },
];

/** The "All" pseudo-category. Not in the list above — it is a view of it. */
export const ALL_CATEGORY = {
  key: 'all',
  label: 'All',
  icon: 'dashboard',
  noun: 'application',
  columns: ['applicant', 'category', 'country', 'stage', 'status', 'date'],
  get count() {
    return CATEGORIES.reduce((n, c) => n + c.count, 0);
  },
};

export function getCategory(key) {
  if (!key || key === 'all') return ALL_CATEGORY;
  // An unknown key falls back to All rather than throwing or 404ing: a stale
  // bookmark to a retired category should show the list, not a dead end.
  return CATEGORIES.find(c => c.key === key) || ALL_CATEGORY;
}
