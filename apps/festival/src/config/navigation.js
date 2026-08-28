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
 *
 * ⚠⚠ AND IT IS CURRENTLY SEVEN, KNOWINGLY. The ratified spec is SIX — Home ·
 * Applications · People · Event · Comms · Settings — where Comms is Messages
 * and Announcements MERGED, because two of six slots for one verb was too
 * many. This list never got that merge, so when People arrived (2026-08-28)
 * there was no free slot and the owner chose to add it as a seventh rather
 * than restructure two working screens in the same change.
 *
 * ⛔ SO THIS IS A KNOWN DEBT, not a new architecture. The fix is not "remove
 * People"; it is the reconciliation the spec already ratified — merge Messages
 * and Announcements into one Comms room and this returns to six on its own.
 */

// ⚠ No counts here. A sidebar badge means "N things await YOUR decision", and
// a hardcoded 62 said that over an empty workspace. `null` never renders as a
// badge, so the number returns only when something real can produce it.
export const NAVIGATION = [
  { key: 'overview',      label: 'Overview',      to: '/overview',      icon: 'dashboard' },
  { key: 'applications',  label: 'Applications',  to: '/applications',  icon: 'inbox' },
  // ⭐ People sits DIRECTLY AFTER Applications because that is the pipeline:
  // Applied → Accepted, one flow, two stages. ⛔ Not at the end of the list.
  { key: 'people',        label: 'People',        to: '/people',        icon: 'volunteer' },
  { key: 'messages',      label: 'Messages',      to: '/messages',      icon: 'messages' },
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
