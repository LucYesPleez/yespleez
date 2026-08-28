/**
 * THE PARTICIPANT TYPE REGISTRY — how a ROLE is named on the roster.
 *
 * ⚠⚠ A PARTICIPANT TYPE IS NOT A CATEGORY KEY, and conflating them is the
 * mistake this file exists to prevent. Someone applies to the `music`
 * CATEGORY and participates as an `artist`, a `band` or a `standup` —
 * `accept_festival_applications` maps one to the other, and the mapping is
 * many-to-one. ⛔ Never look a participant type up in `config/categories.js`:
 * `artist` is not a key there, so every performer's chip would come back
 * blank, and a blank chip reads as missing data rather than a wrong lookup.
 *
 * ⭐ The keys here are exactly the rows of `participation_type_ceiling`, which
 * is the database's own list. Adding a type there is a row, not a migration —
 * so adding it here is an entry, not a component.
 *
 * ⚠ An unknown type renders as ITSELF rather than vanishing, for the reason
 * StatusBadge already learned: a row that disappears because of an
 * unrecognised value looks like data loss, while a wrong-looking label
 * announces the drift.
 */
const PARTICIPANT_TYPES = {
  artist:             { label: 'Artist',      icon: 'music',              tone: 'purple' },
  band:               { label: 'Band',        icon: 'music',              tone: 'purple' },
  standup:            { label: 'Standup',     icon: 'music',              tone: 'purple' },
  performance_artist: { label: 'Performer',   icon: 'performance_artist', tone: 'purple' },
  // ⭐ The one type with no role profile behind it — a volunteer participates
  // as the person. Its own tone because it is the type a festival is usually
  // counting, and the roster is read by scanning for it.
  volunteer:          { label: 'Volunteer',   icon: 'volunteer',          tone: 'cyan' },
  market_stall:       { label: 'Market',      icon: 'market_stall',       tone: 'gold' },
  food_vendor:        { label: 'Food',        icon: 'food_vendor',        tone: 'gold' },
  workshop:           { label: 'Workshop',    icon: 'workshop',           tone: 'gold' },
  decor:              { label: 'Decor',       icon: 'decor',              tone: 'gold' },
  media:              { label: 'Media',       icon: 'media',              tone: 'gold' },
  theme_camp:         { label: 'Theme Camp',  icon: 'theme_camp',         tone: 'gold' },
  attendee:           { label: 'Attendee',    icon: 'profile',            tone: 'neutral' },
};

export function participantType(key) {
  return PARTICIPANT_TYPES[key] ?? { label: key, icon: 'profile', tone: 'neutral' };
}

export default PARTICIPANT_TYPES;
