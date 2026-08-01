// A COMPLETE, HIGH-QUALITY EVENT.
//
// The layout spec is written for an event that has everything. No row in the
// database is one — poster, start time, end time, coordinates, a lineup, a
// ticket link and an owner profile exist on 48, 23, 13, 20, 4, 8 and 32 of 50
// events respectively, and their intersection is empty. Tuning hierarchy and
// spacing against live data would mean tuning a page that is mostly hidden
// sections, so the layout is built against this instead.
//
// This is a DEV FIXTURE. It is never imported by the route — only by the
// layout harness. It exists to be looked at, and to be made hostile: see
// `variants` at the bottom for the content that breaks layouts.

// Stand-in artwork as an inline SVG data URI — no network, no asset, and the
// edges are marked so cropping is immediately visible if it ever creeps back
// in. Principle 0 forbids it; this is how we see a breach.
function poster(w, h, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b2a5e"/><stop offset="0.55" stop-color="#8d4a6b"/><stop offset="1" stop-color="#e0743f"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="14" y="14" width="${w - 28}" height="${h - 28}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="6" stroke-dasharray="26 18"/>
    <text x="${w / 2}" y="${h / 2}" fill="#fff" font-family="Helvetica,Arial" font-size="${Math.round(w / 12)}" font-weight="bold" text-anchor="middle">${label}</text>
    <text x="${w / 2}" y="${h / 2 + w / 12}" fill="rgba(255,255,255,.85)" font-family="Helvetica,Arial" font-size="${Math.round(w / 26)}" text-anchor="middle">${w} × ${h}</text>
    <text x="${w / 2}" y="60" fill="#fff" font-family="Helvetica,Arial" font-size="${Math.round(w / 30)}" text-anchor="middle">TOP EDGE</text>
    <text x="${w / 2}" y="${h - 34}" fill="#fff" font-family="Helvetica,Arial" font-size="${Math.round(w / 30)}" text-anchor="middle">BOTTOM EDGE</text>
  </svg>`;
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, w, h, alt: label };
}

// One case per rung of the Hero ladder (spec §0.3). Every rung must be judged,
// not just the one a given event happens to land on.
const COVER   = poster(1920, 1280, 'EVENT COVER');
const ART     = poster(1920, 1005, 'LANDSCAPE ARTWORK');
const POSTER  = poster(1080, 1528, 'OFFICIAL POSTER');
const TALL    = poster(1080, 3240, 'VERY TALL POSTER');
const GALLERY = [
  poster(1600, 900, 'GALLERY 1'),
  poster(1600, 900, 'GALLERY 2'),
  poster(1200, 1600, 'GALLERY 3 · PORTRAIT PHONE SHOT'),
  poster(1600, 900, 'GALLERY 4'),
  poster(1600, 900, 'GALLERY 5'),
];

export const heroCases = {
  'rung 1 · cover + gallery': { cover: COVER, gallery: GALLERY, poster: POSTER },
  'rung 2 · cover only':      { cover: COVER, poster: POSTER },
  'rung 3 · artwork':         { landscapeArtwork: ART, poster: POSTER },
  'rung 4 · chosen crop':     { poster: POSTER, posterCropY: 62 },
  'rung 5 · default crop':    { poster: POSTER },
  'rung 6 · blurred':         { poster: TALL },
  'rung 7 · no hero':         {},
};

export const posterSample = POSTER;

// Stickers / official images that sit under the poster. Square, transparent-ish
// artwork — the kind of thing someone saves to their phone.
function sticker(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <circle cx="256" cy="256" r="230" fill="hsl(${hue} 70% 22%)" stroke="hsl(${hue} 90% 65%)" stroke-width="14"/>
    <text x="256" y="240" fill="hsl(${hue} 95% 78%)" font-family="Helvetica,Arial" font-size="58" font-weight="bold" text-anchor="middle">${label}</text>
    <text x="256" y="310" fill="hsl(${hue} 80% 70%)" font-family="Helvetica,Arial" font-size="30" text-anchor="middle">COASTAL RHYTHMS</text>
  </svg>`;
  return {
    id: `sticker-${label.toLowerCase()}`,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    alt: `${label} sticker`,
    filename: `coastal-rhythms-${label.toLowerCase()}.svg`,
  };
}

export const collectableCases = {
  'poster + 6': [
    sticker('SUNSET', 18), sticker('PALMS', 150), sticker('WAVE', 200),
    sticker('DAY 1', 280), sticker('NIGHT', 260), sticker('CREW', 330),
  ],
  'poster + 2': [sticker('SUNSET', 18), sticker('WAVE', 200)],
  'poster only': [],
};

const ARTIST_NAMES = [
  'Locklead', 'Jesse M', 'Tiana', 'Brawther', 'Sunbeam Sound System',
  'Kali', 'Nite Fleit', 'Roza Terenzi', 'D. Tiffany', 'Sleep D',
  'Hana', 'Objekt', 'CC:DISCO!', 'Andras', 'Jennifer Loveless',
  'Turner Street Sound', 'D-Grade', 'Sui Zhen', 'D.Blakely', 'Otologic',
  'Rings Around Saturn', 'Sarah Jane', 'Prequel', 'Chiara Kickdrum',
  'Mall Grab', 'X Club.', 'Marcus Whale', 'LUCIANBLOMKAMP', 'Rebel Yell', 'Air Max 97',
];

const artists = n => ARTIST_NAMES.slice(0, n).map((name, i) => ({
  id: `artist-${i}`,
  name,
  location: ['Sydney', 'Melbourne', 'Byron Bay', 'Brisbane', 'Perth'][i % 5],
}));

// A stand-in map tile. Real tiles need a provider that has not been chosen —
// until one is, the caller passes no mapUrl and the Venue ladder falls to the
// address, which is the honest outcome rather than an empty frame.
const mapTile = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
    <rect width="640" height="400" fill="#0e1622"/>
    <g stroke="#1d2c3f" stroke-width="2" fill="none">
      <path d="M0 120 L640 90M0 250 L640 300M140 0 L180 400M420 0 L380 400"/>
    </g>
    <path d="M470 0 L520 400 L640 400 L640 0z" fill="#0b1a2b"/>
    <circle cx="330" cy="205" r="9" fill="#b060ff"/>
    <circle cx="330" cy="205" r="18" fill="none" stroke="#b060ff" stroke-opacity=".45" stroke-width="2"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const venueCases = {
  'map':       { name: 'The Federal Hotel', address: '77 Hyde St', locality: 'Bellingen', state: 'NSW', mapUrl: mapTile() },
  'address':   { name: 'The Federal Hotel', address: '77 Hyde St', locality: 'Bellingen', state: 'NSW' },
  'locality':  { name: 'The Federal Hotel', locality: 'Bellingen', state: 'NSW' },
  'name only': { name: 'The Federal Hotel' },
  // ⚠ coordinates present AND withheld — the leak this must never allow.
  'withheld':  { name: 'Secret Location', locality: 'Mid North Coast', state: 'NSW', mapUrl: mapTile(), withheld: true },
  'none':      {},
};

export const detailRows = [
  { key: 'doors',         label: 'Doors',         value: '1:30pm' },
  { key: 'stages',        label: '2 Stages',      value: 'Day Stage · 2pm – 9pm\nNight Stage · 9pm – Late' },
  { key: 'age',           label: 'Age',           value: '18+ · Photo ID required' },
  { key: 'accessibility', label: 'Accessibility', value: 'Step-free access to both stages. Accessible amenities on site.' },
  { key: 'bring',         label: 'What to Bring', value: 'Sunscreen · Water bottle · Dancing shoes' },
  { key: 'parking',       label: 'Parking',       value: 'On-site parking, $10, cash only' },
];

export const detailCases = {
  'six rows': detailRows,
  'one row':  [detailRows[2]],
  'none':     [],
};

// `profile` is the presenter's own profiles row — what ProfileCard resolves
// its accent, type badge and default image from. Type `host` IS the promoter
// type (the asset is named defaultpromoter; the type string is `host`).
export const presenterCases = {
  'promoter':   { presenter: { name: 'SABBIA', type: 'host', bio: 'Curating authentic experiences that bring people together through music and culture.', profile: { id: 'p-sabbia', location: 'Bellingen', state: 'NSW' } } },
  'no bio':     { presenter: { name: 'SABBIA', type: 'host', profile: { id: 'p-sabbia', location: 'Bellingen', state: 'NSW' } } },
  'venue only': { presenter: null, venue: { name: 'The Federal Hotel', bio: 'Live music seven nights.', profile: { id: 'p-fed', location: 'Bellingen', state: 'NSW' } } },
  'none':       { presenter: null, venue: null },
};

export const sourcesCases = {
  'discovery': { origin: 'discovery', contributors: ['Federal Hotel', 'Humanitix', 'Event Host'], lastChecked: '2 hours ago', confidence: 'High' },
  'merged':    { origin: 'merged', contributors: ['Humanitix', 'Facebook'], lastChecked: 'yesterday', confidence: 'Medium' },
  'manual':    { origin: 'manual', contributors: [], lastChecked: null, confidence: null },
};

export const lineupCases = {
  'full bill':    { artists: artists(30) },
  'mid':          { artists: artists(5) },
  'two':          { artists: artists(2) },
  'solo':         { artists: artists(1) },
  'withheld':     { artists: [], withheld: true },
  'none':         { artists: [] },
  'long names':   {
    artists: [
      { id: 'a', name: 'The Wide Open Spaces Orchestra & Friends', location: 'Northern Rivers NSW' },
      { id: 'b', name: 'LUCIANBLOMKAMP', location: 'Melbourne' },
      { id: 'c', name: 'X Club.', location: 'Sydney' },
      { id: 'd', name: 'Rings Around Saturn Collective', location: 'Bellingen' },
    ],
  },
};

// Summary content cases. The layout is judged against all of these, not against
// the one that happens to fit — that is what the `variants` export was for and
// this is it applied.
const TODAY = new Date().toISOString().slice(0, 10);
const LAST_WEEK = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

export const summaryCases = {
  'complete': {
    name: 'Coastal Rhythms',
    when: { date: '2026-11-16', startTime: '2:00pm', endTime: '11:00pm', confidence: 'confirmed' },
    where: { venue: 'Secret Location', locality: 'Mid North Coast', state: 'NSW' },
    genres: ['House', 'Tech House', 'Disco', 'Melodic'],
    ticketUrl: 'https://example.invalid/tickets',
    attending: 320,
    description: 'Day into night. Two stages. 30+ artists. Good people. Good vibes.\nA celebration of sound, connection and our coastal community, held on a stretch of coastline that only a few hundred people will ever see it from.',
  },
  'minimal': {
    // R4's floor: title and date are load-bearing, everything else is absent.
    name: 'Fen',
    when: { date: '2026-11-16' },
    where: {},
    genres: [],
    ticketUrl: null,
    attending: null,
    description: '',
  },
  'long everything': {
    name: 'The Beyond Jazz Weekender 2026 — Saturday: The Jazz Social',
    when: { date: '2026-11-16', startTime: '2:00pm', endTime: '11:00pm' },
    where: { venue: 'Bellingen Memorial Hall', locality: 'Bellingen', state: 'NSW' },
    genres: ['Jazz', 'New Orleans Brass', 'Ethio-Jazz', 'Ambient', 'Minimal', 'Breaks', 'Acid', 'Spiritual Jazz'],
    ticketUrl: 'https://example.invalid/tickets',
    attending: 1284,
    description: 'Day into night. '.repeat(40),
  },
  'no tickets': {
    name: 'Open Mic Night',
    when: { date: '2026-11-16', startTime: '7:30pm' },
    where: { venue: 'The Chippo Hotel', locality: 'Chippendale', state: 'NSW' },
    genres: ['Spoken Word'],
    ticketUrl: null,
    attending: 12,
    description: 'Free entry. Sign-ups from 7pm at the bar.',
  },
  'on now': {
    name: 'Creatures of the Swamp',
    when: { date: TODAY, startTime: '8:00pm' },
    where: { venue: 'The Federal Hotel', locality: 'Bellingen', state: 'NSW' },
    genres: ['Live Band'],
    ticketUrl: 'https://example.invalid/tickets',
    attending: 64,
    description: 'Boss Stomp and The Stops. Free entry.',
  },
  'past': {
    name: 'Solstice Soirée',
    when: { date: LAST_WEEK, startTime: '4:00pm', endTime: 'late' },
    where: { venue: 'Bellingen Showground', locality: 'Bellingen', state: 'NSW' },
    genres: ['DJs', 'House'],
    ticketUrl: null,
    attending: 210,
    description: 'That was a big one.',
  },
  'unconfirmed date': {
    // R1 · unknown — rendered, but qualified, never as fact.
    name: 'Rowdy Roots Roundup',
    when: { date: '2026-11-16', confidence: 'inferred' },
    where: { locality: 'Sydney', state: 'NSW' },
    genres: ['Live Band'],
    ticketUrl: null,
    attending: null,
    description: '',
  },
};

export const completeEvent = {
  id: 'fixture-complete',
  name: 'Coastal Rhythms',
  status: 'live',

  // The media model (spec §0): one Cover, one Poster, up to five Gallery
  // images. Cover and Gallery render ONLY in the Hero carousel; the Poster
  // renders ONLY in § 9. They are never interchanged.
  media: {
    cover: COVER,
    gallery: GALLERY,
    poster: POSTER,
    posterCropY: null,     // untouched — the Hero would fall to the default band
  },

  when: {
    date: '2026-11-16',
    startTime: '2:00pm',
    endTime: '11:00pm',
    confidence: 'confirmed',
  },

  where: {
    venue: 'Secret Location',
    locality: 'Mid North Coast',
    state: 'NSW',
    address: null,
    lat: -30.4521,
    lng: 152.8994,
  },

  genres: ['House', 'Tech House', 'Disco', 'Melodic'],

  decision: {
    attending: 320,
    ticketUrl: 'https://example.invalid/tickets',
  },

  description:
    'Day into night. Two stages. 30+ artists. Good people. Good vibes. ' +
    'A celebration of sound, connection and our coastal community, held on ' +
    'a stretch of coastline that only a few hundred people will ever see it from.',

  // 30 artists, not 4. A rail tuned against four faces understates the bill it
  // was built to show.
  lineup: Array.from({ length: 30 }, (_, i) => ({
    id: `artist-${i}`,
    name: [
      'Locklead', 'Jesse M', 'Tiana', 'Brawther', 'Sunbeam Sound System',
      'Kali', 'Nite Fleit', 'Roza Terenzi', 'D. Tiffany', 'Sleep D',
      'Hana', 'Objekt', 'CC:DISCO!', 'Andras', 'Jennifer Loveless',
      'Turner Street Sound', 'D-Grade', 'Sui Zhen', 'D.Blakely', 'Otologic',
      'Rings Around Saturn', 'Sarah Jane', 'Prequel', 'Chiara Kickdrum',
      'Mall Grab', 'X Club.', 'Marcus Whale', 'LUCIANBLOMKAMP', 'Rebel Yell', 'Air Max 97',
    ][i],
    location: ['Sydney', 'Melbourne', 'Byron Bay', 'Brisbane', 'Perth'][i % 5],
  })),

  details: [
    { key: 'doors',         label: 'Doors',          value: '1:30pm' },
    { key: 'stages',        label: '2 Stages',       value: 'Day Stage · 2pm – 9pm\nNight Stage · 9pm – Late' },
    { key: 'age',           label: 'Age',            value: '18+ · Photo ID required' },
    { key: 'accessibility', label: 'Accessibility',  value: 'Step-free access to both stages. Accessible amenities on site.' },
    { key: 'bring',         label: 'What to Bring',  value: 'Sunscreen · Water bottle · Dancing shoes' },
    { key: 'parking',       label: 'Parking',        value: 'On-site parking, $10, cash only' },
  ],

  presentedBy: {
    name: 'SABBIA',
    role: 'Event Promoter',
    bio: 'Curating authentic experiences that bring people together through music and culture.',
    claimed: true,
  },

  sources: {
    origin: 'discovery',
    contributors: ['Federal Hotel', 'Humanitix', 'Event Host'],
    lastChecked: '2 hours ago',
    confidence: 'High',
  },
};

// The content that breaks layouts. Every section must survive all of these
// before it is considered done — not the version that happens to fit.
export const variants = {
  longTitle:      'The Beyond Jazz Weekender 2026 — Saturday: The Jazz Social',
  shortTitle:     'Fen',
  portraitHero:   { w: 1080, h: 1528 },   // A-series poster
  landscapeHero:  { w: 1920, h: 1005 },   // made-for-page image
  squareHero:     { w: 1080, h: 1080 },   // Instagram
  manyGenres:     ['House', 'Tech House', 'Disco', 'Melodic', 'Minimal', 'Breaks', 'Acid', 'Ambient'],
  shortBlurb:     'One night. One room.',
  longBlurb:      'Day into night. '.repeat(40),
  soloLineup:     1,
  emptyLineup:    0,
};
