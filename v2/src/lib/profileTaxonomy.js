/**
 * YesPleez — canonical profile taxonomy (single source of truth)
 * ---------------------------------------------------------------------------
 * The genre lists that were previously duplicated across the profile screens
 * now live here once. Both the app (profile screens) and YesPleez Studio (via
 * scripts/export-profile-schema.mjs → profile-schema.json) read from this file,
 * so a change to the genre model is made ONCE and both stay in sync.
 *
 * Location data stays in ./auLocations.js (already single-source); the export
 * bundles it alongside this taxonomy.
 */

// Electronic main genres (used by artist + host "electronic" + venue).
export const MAIN_GENRES = [
  'Techno', 'House', 'Drum & Bass', 'Breaks', 'Trance', 'Psytrance',
  'Progressive Psy', 'Dubstep / Bass', 'Hard Dance / Hardcore',
  'Ambient / Downtempo', 'Electronica', 'Funk / Soul / Disco',
  'Hip-Hop', 'Reggae / Dancehall', 'World / Global', 'Experimental', 'Multi Genre',
];

// Host genre groups (electronic reuses MAIN_GENRES; bands + spoken word extend it).
export const HOST_GENRES = {
  'ELECTRONIC':  MAIN_GENRES,
  'BANDS':       ['Rock', 'Pop', 'Indie', 'Alternative', 'Metal', 'Punk', 'Jazz', 'Blues', 'Soul / RnB', 'Country', 'Folk / Acoustic', 'Reggae', 'Hip-Hop', 'Funk', 'Latin', 'World Music', 'Classic Rock', 'Covers / Top 40', 'Original', 'Multi Genre', 'Other'],
  'SPOKEN WORD': ['Stand-up Comedy', 'Storytelling', 'Poetry / Spoken Word', 'Improv', 'Panel Discussion', 'Debate', 'Cabaret', 'Variety / Mixed Bill', 'Quiz / Trivia', 'Lecture / Talk', 'Open Mic', 'Multi Genre', 'Other'],
};

export const ALL_GENRES = [...new Set([...MAIN_GENRES, ...HOST_GENRES.BANDS, ...HOST_GENRES['SPOKEN WORD']])];

// "What do you host?" — producer categories a Host profile can select from.
// The `key` is what's actually stored (inside genre_string, alongside genres/
// subgenres/vibes — see HostProfileScreen's buildGenreString/parseGenreString)
// so it must never change once shipped; `label` is display-only and free to
// edit any time. HOST_GENRES[key] is optional — a category that isn't itself
// a music genre (Festivals) simply has no bucket, and the genre picker's
// `HOST_GENRES[c] || []` already treats a missing bucket as "no genre filter
// added by this category" with no other code change needed.
//
// `enabled: false` = defined in the data model but not offered in the picker
// this release — a deliberate launch-sequencing decision (Festival Edition is
// a separate, more capable product; this app's launch shouldn't set festival
// organisers' expectations against it), not a technical limitation. Festival
// organisers stay Host profiles either way — flipping `enabled` back to true
// is the entire re-launch step, no structural change needed. Use
// VISIBLE_HOST_CATEGORIES for anything user-facing (pill pickers, etc.);
// HOST_CATEGORIES (the full list) stays the source of truth for parsing
// already-stored data (e.g. a Studio-imported host tagged as producing
// festivals before this flag existed) and for Studio's own alignment.
export const HOST_CATEGORIES = [
  { key: 'ELECTRONIC',  label: 'Electronic Music', enabled: true },
  { key: 'BANDS',       label: 'Bands / Live Music', enabled: true },
  { key: 'SPOKEN WORD', label: 'Comedy / Spoken Word', enabled: true },
  { key: 'FESTIVALS',   label: 'Festivals', enabled: false },
];

export const VISIBLE_HOST_CATEGORIES = HOST_CATEGORIES.filter(c => c.enabled);

export const SUBGENRES = {
  'Techno':                ['Peak Time', 'Hard Techno', 'Schranz', 'Industrial', 'Melodic Techno', 'Atmospheric', 'Raw / Hypnotic', 'Minimal', 'Deep Tech', 'Detroit', 'Acid', 'Rave'],
  'House':                 ['Tech House', 'Deep House', 'Afro House', 'Organic House', 'UK Garage', '2-Step', 'Progressive House', 'Melodic House', 'Jackin House', 'Funky / Groove', 'Electro House', 'Soulful'],
  'Drum & Bass':           ['Liquid', 'Rollers', 'Neurofunk', 'Jump Up', 'Dark / Atmospheric', 'Jungle', 'Techstep', 'Minimal DnB'],
  'Breaks':                ['Psy Breaks', 'Nu Skool Breaks', 'Electro Breaks', 'Florida Breaks', 'Acid Breaks', 'Big Beat', 'Breakbeat'],
  'Psytrance':             ['Full On', 'Goa', 'Dark Psy', 'Forest Psy', 'Hi-Tech', 'Twilight', 'Psybient', 'Suomi'],
  'Progressive Psy':       ['Night Prog', 'Psyprog', 'Prog Trance', 'Minimal Psy', 'Chunk'],
  'Dubstep / Bass':        ['Dubstep', 'UK Dubstep', 'Brostep', 'Riddim', 'Bass House', 'UK Bass', 'Future Bass', 'Trap', 'Footwork', 'Halftime', '80 BPM', 'Glitch Hop', 'Leftfield', 'Grime'],
  'Hard Dance / Hardcore': ['Hard Techno', 'Hardstyle', 'Hardcore', 'Gabber', 'Happy Hardcore', 'UK Hardcore'],
};

// The reviewer-facing "mood" tags the owner refines on claim. (Kept here as the
// canonical set; screens may still show a superset while their own lists are
// migrated — see VIBES divergence note in the drift-proofing task.)
export const VIBES = [
  'Fun', 'Funky', 'Groove', 'Wobbly', 'Thinky', 'Bouncy', 'Uplifting', 'Clubby',
  'Bangers', 'Staunch', 'Crankin', 'Chunks', 'Sinister', 'Techy', 'Melodic', 'Hypnotic',
  'Deep', 'Dark', 'Dank', 'Organic', 'Shanti', 'Warm Up', 'Wonky', 'Classy',
  'Experimental', 'Underground', 'Glitchy', 'Versatile', 'Sledgy',
];

// Genre-string encoding shared with the app (genre_string column).
export const GENRE_SEP = ' · ';

/**
 * Per-type profile field spec — the shared contract Studio uses to render
 * editors that match the app's profile columns. `kind` tells the editor which
 * input to use; `col` is the app/profile column the value maps to.
 *   kind: text | textarea | url | social | number | image | genre | location | state | postcode
 * `location` fields auto-fill the paired `state`/`postcode` via auLocations.
 */
export const PROFILE_FIELDS = {
  artist: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'display_name', label: 'Display name', kind: 'text' },
    { key: 'aliases', label: 'Aliases', kind: 'text' },
    { key: 'role', label: 'Role', kind: 'text' },
    { key: 'location', label: 'Location (suburb / town)', kind: 'location' },
    { key: 'state', label: 'State', kind: 'state' },
    { key: 'postcode', label: 'Postcode', kind: 'postcode' },
    { key: 'description', label: 'Bio', kind: 'textarea' },
    { key: 'genre_string', label: 'Genres', kind: 'genre' },
    { key: 'website', label: 'Website', kind: 'url' },
    { key: 'instagram', label: 'Instagram', kind: 'social' },
    { key: 'facebook', label: 'Facebook', kind: 'social' },
    { key: 'spotify', label: 'Spotify', kind: 'social' },
    { key: 'soundcloud', label: 'SoundCloud', kind: 'social' },
    { key: 'bandcamp', label: 'Bandcamp', kind: 'social' },
    { key: 'ra', label: 'Resident Advisor', kind: 'social' },
    { key: 'image', label: 'Image URL', kind: 'image' },
  ],
  venue: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'display_name', label: 'Display name', kind: 'text' },
    { key: 'description', label: 'Description', kind: 'textarea' },
    { key: 'address', label: 'Address', kind: 'text' },
    { key: 'suburb', label: 'Suburb / town', kind: 'location' },
    { key: 'state', label: 'State', kind: 'state' },
    { key: 'postcode', label: 'Postcode', kind: 'postcode' },
    { key: 'genre_string', label: 'Genres', kind: 'genre' },
    { key: 'website', label: 'Website', kind: 'url' },
    { key: 'facebook', label: 'Facebook', kind: 'social' },
    { key: 'instagram', label: 'Instagram', kind: 'social' },
    { key: 'email', label: 'Contact email', kind: 'text' },
    { key: 'phone', label: 'Contact phone', kind: 'text' },
    { key: 'capacity', label: 'Capacity', kind: 'number' },
    { key: 'accessibility', label: 'Accessibility', kind: 'text' },
    { key: 'image', label: 'Image URL', kind: 'image' },
  ],
  host: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'display_name', label: 'Display name', kind: 'text' },
    { key: 'description', label: 'Description', kind: 'textarea' },
    { key: 'location', label: 'Location (suburb / town)', kind: 'location' },
    { key: 'state', label: 'State', kind: 'state' },
    { key: 'postcode', label: 'Postcode', kind: 'postcode' },
    { key: 'genre_string', label: 'Genres', kind: 'genre' },
    { key: 'website', label: 'Website', kind: 'url' },
    { key: 'instagram', label: 'Instagram', kind: 'social' },
    { key: 'facebook', label: 'Facebook', kind: 'social' },
    { key: 'email', label: 'Contact email', kind: 'text' },
    { key: 'phone', label: 'Contact phone', kind: 'text' },
    { key: 'image', label: 'Image URL', kind: 'image' },
  ],
  // No `festival` entry — a festival is an event category owned by a host
  // profile (see HOST_CATEGORIES above), not a separate profile type.
};
