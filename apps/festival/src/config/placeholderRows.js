/**
 * Shell placeholder rows.
 *
 * ⚠ NOT MOCK DATA and NOT a fixture to build against. These exist so the
 * table's real behaviour is reviewable before a data layer exists: column
 * widths, row height, hover, the two different selection treatments, the
 * sticky header under scroll.
 *
 * Rows deliberately do NOT carry every category's fields. Viewing them under
 * Volunteers shows dimmed dashes where "Skills" and "Availability" would be,
 * which is exactly the behaviour worth proving early — absent and blank must
 * be visibly different from a value.
 *
 * Delete this file the moment a data layer exists. Only ApplicationsWorkspace
 * may import it.
 */
export const PLACEHOLDER_ROWS = [
  { id: 'a1', name: 'Luna Tides',      location: 'Byron Bay, NSW',  category: 'Music',      genre: 'Psytrance',   country: 'AUS', stage: 'Reviewing',   status: 'new',         date: 'Yesterday' },
  { id: 'a2', name: 'Solar Wave',      location: 'Paris, France',   category: 'Music',      genre: 'Tech House',  country: 'FRA', stage: 'Shortlisted', status: 'shortlisted', date: '2 days ago' },
  { id: 'a3', name: 'Echo Bloom',      location: 'Berlin, Germany', category: 'Music',      genre: 'Downtempo',   country: 'DEU', stage: 'Reviewing',   status: 'reviewing',   date: '2 days ago' },
  { id: 'a4', name: 'Forest Dwellers', location: 'Melbourne, VIC',  category: 'Music',      genre: 'Ambient',     country: 'AUS', stage: 'Shortlisted', status: 'shortlisted', date: '3 days ago' },
  { id: 'a5', name: 'Kai Flame',       location: 'Brisbane, QLD',   category: 'Performance', discipline: 'Fire',  country: 'AUS', stage: 'Reviewing',   status: 'new',         date: '3 days ago' },
  { id: 'a6', name: 'Maya Star',       location: 'Byron Bay, NSW',  category: 'Music',      genre: 'Progressive', country: 'AUS', stage: 'Accepted',    status: 'accepted',    date: '4 days ago' },
  { id: 'a7', name: 'Green Roots',     location: 'Lismore, NSW',    category: 'Workshops',  topic: 'Weaving',     country: 'AUS', stage: 'Reviewing',   status: 'reviewing',   date: '4 days ago' },
  { id: 'a8', name: 'Nightshade',      location: 'Auckland, NZ',    category: 'Music',      genre: 'Dark Psy',    country: 'NZL', stage: 'Declined',    status: 'declined',    date: '5 days ago' },
  { id: 'a9', name: 'Willow Markets',  location: 'Mullumbimby, NSW', category: 'Stalls',    trades: 'Jewellery',  country: 'AUS', stage: 'Reviewing',   status: 'new',         date: '6 days ago' },
  { id: 'a10', name: 'Ruby Sun',       location: 'Nimbin, NSW',     category: 'Volunteers', skills: 'First Aid',  country: 'AUS', stage: 'Shortlisted', status: 'shortlisted', date: '6 days ago' },
];
