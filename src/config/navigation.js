/**
 * The Festival Portal's workspace navigation.
 *
 * Data, not markup — the sidebar renders whatever this describes, so adding a
 * category is an entry here and nothing else. Counts are placeholders and are
 * the only numbers in the shell; they arrive from the data layer later.
 *
 * ⛔ A badge means "N things await your decision" (the Studio badge law), and
 * `null` must never render as `0`. FestivalSidebarItem enforces that.
 *
 * Category keys match the ratified role keys in the Festival Applications
 * specification — `food_vendor` is separate from `market_stall` (D-17), and
 * the non-music performance role is `performance_artist`, never `performer`
 * (D-03b).
 */

export const APPLICATION_CATEGORIES = [
  { key: 'music',              label: 'Music',               count: 184 },
  { key: 'volunteer',          label: 'Volunteers',          count: 93 },
  { key: 'market_stall',       label: 'Market Stalls',       count: 41 },
  { key: 'food_vendor',        label: 'Food Vendors',        count: 22 },
  { key: 'workshop',           label: 'Workshops',           count: 18 },
  { key: 'performance_artist', label: 'Performance Artists', count: 27 },
  { key: 'decor',              label: 'Decor',               count: 11 },
  { key: 'media',              label: 'Media',               count: 12 },
  { key: 'theme_camp',         label: 'Theme Camps',         count: 9 },
];

export const PRIMARY_NAV = [
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: 'dashboard' },
];

export const SECONDARY_NAV = [
  { key: 'messages',      label: 'Messages',         to: '/messages',      icon: 'messages',      count: 4 },
  { key: 'announcements', label: 'Announcements',    to: '/announcements', icon: 'announcements', count: null },
  { key: 'profile',       label: 'Festival Profile', to: '/profile',       icon: 'profile',       count: null },
  { key: 'settings',      label: 'Settings',         to: '/settings',      icon: 'settings',      count: null },
];

/** Placeholder — the selector is a shell control, not a data feature yet. */
export const FESTIVALS = [
  {
    id: 'northern-skies-2027',
    name: 'Northern Skies Festival',
    dates: '16 – 19 January 2027',
    location: 'Dorrigo, NSW, Australia',
    applicationsOpen: true,
  },
];
