/**
 * PORTAL NAVIGATION — six destinations, and that is the whole list.
 *
 * ⭐ Application categories are deliberately NOT here. Nine category pages
 * would make the sidebar the place you choose what to work on, and the table
 * merely a consequence. Inverting that — one Applications workspace, with
 * categories as tabs inside it — is what makes the table the primary surface
 * of the product rather than a panel on nine near-identical screens.
 *
 * Adding a seventh destination is an architecture decision, not a tweak. The
 * Scene app's five permanent tabs are governed the same way.
 */

export const NAVIGATION = [
  { key: 'overview',      label: 'Overview',      to: '/overview',      icon: 'dashboard' },
  { key: 'applications',  label: 'Applications',  to: '/applications',  icon: 'inbox',         count: 62 },
  { key: 'messages',      label: 'Messages',      to: '/messages',      icon: 'messages',      count: 4 },
  { key: 'announcements', label: 'Announcements', to: '/announcements', icon: 'announcements' },
  { key: 'festival',      label: 'Festival',      to: '/festival',      icon: 'profile' },
  { key: 'settings',      label: 'Settings',      to: '/settings',      icon: 'settings' },
];

/** Placeholder identity for the shell. Replaced by the profile system later. */
export const FESTIVAL = {
  id: 'northern-skies-2027',
  name: 'Northern Skies Festival',
  dates: '16 – 19 January 2027',
  location: 'Dorrigo, NSW, Australia',
  applicationsOpen: true,
};

export const CURRENT_USER = {
  name: 'Ben Anderson',
  role: 'Festival Director',
};
