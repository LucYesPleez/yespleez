// Demo events — dates computed relative to today so they never go stale.
// Mirrors v1's _calDemoRaw / _calGetDemoEvents() pattern.
// Real DB events with matching names take precedence (filtered out in getDemoEvents).

const DEMO_RAW = [
  // ── FEATURED ──────────────────────────────────────────────────────────────
  // Not festival-flavoured this release — Discover/What's On don't showcase
  // festivals yet (Festival Edition, a separate product, hasn't shipped) so
  // demo content shouldn't set that expectation either. See HOST_CATEGORIES
  // in profileTaxonomy.js.
  { id: 'demo_feat', name: 'Bellingen Winter Solstice Sessions',
    config: { venue: 'Bellingen Showground, NSW', genres: 'Live Music,Folk,World Music,Electronic,Acoustic',
              state: 'NSW', location: 'Bellingen', featured: true, daysFromNow: 3,
              _bg: 'linear-gradient(160deg,#1a0533 0%,#3d1a6e 35%,#1a3a0a 65%,#0a2a0a 100%)' } },

  // ── TONIGHT (daysFromNow: 0) ───────────────────────────────────────────────
  { id: 'demo_t1', name: 'Open Mic Night',
    config: { venue: 'The Chippo Hotel, Sydney', genres: 'Live Music,Acoustic,Singer-Songwriter',
              state: 'NSW', location: 'Chippendale', daysFromNow: 0,
              _bg: 'linear-gradient(135deg,#081a10,#122a1a)' } },
  { id: 'demo_t2', name: 'Friday Night Laughs',
    config: { venue: 'Comedy Republic, Melbourne', genres: 'Comedy,Stand-Up,Observational',
              state: 'VIC', location: 'Melbourne CBD', daysFromNow: 0,
              _bg: 'linear-gradient(135deg,#1a1005,#2a1a08)' } },
  { id: 'demo_t3', name: 'House Sessions',
    config: { venue: 'Midnight Club, Melbourne', genres: 'DJ,Electronic,House,Deep House',
              state: 'VIC', location: 'Fitzroy', daysFromNow: 0,
              _bg: 'linear-gradient(135deg,#050a1a,#0a0520)' } },

  // ── THIS WEEKEND (daysFromNow: 1–3, will land on Fri/Sat/Sun) ─────────────
  { id: 'demo_w1', name: 'Proper Massive',
    config: { venue: 'The Forum, Melbourne', genres: 'DJ,Drum & Bass,Electronic',
              state: 'VIC', location: 'Melbourne CBD', daysFromNow: 1,
              _bg: 'linear-gradient(135deg,#050a1a,#0a0520)' } },
  { id: 'demo_w2', name: 'Akmal – My Family and Other Animals',
    config: { venue: 'Enmore Theatre, Sydney', genres: 'Comedy,Stand-Up',
              state: 'NSW', location: 'Newtown', daysFromNow: 2,
              _bg: 'linear-gradient(135deg,#1a1005,#2a1a08)' } },
  { id: 'demo_w3', name: 'Rowdy Roots Roundup',
    config: { venue: 'Lansdowne Hotel, Sydney', genres: 'Live Music,Roots,Folk',
              state: 'NSW', location: 'Chippendale', daysFromNow: 3,
              _bg: 'linear-gradient(135deg,#0a1a0a,#142a14)' } },

  // ── COMING UP ─────────────────────────────────────────────────────────────
  { id: 'demo_c1', name: 'Carriageworks Night Market',
    config: { venue: 'Carriageworks, Sydney', genres: 'Live Music,Electronic,Community',
              state: 'NSW', location: 'Eveleigh', daysFromNow: 7,
              _bg: 'linear-gradient(135deg,#1a0f08,#0f1a08)' } },
  { id: 'demo_c2', name: 'Dune Rats',
    config: { venue: 'Manning Bar, Sydney', genres: 'Live Music,Rock,Punk',
              state: 'NSW', location: 'Camperdown', daysFromNow: 8,
              _bg: 'linear-gradient(135deg,#1a0808,#100a0a)' } },
  { id: 'demo_c3', name: 'Darkroom Sessions',
    config: { venue: 'The Burdekin, Sydney', genres: 'DJ,Techno,Dark Electronic',
              state: 'NSW', location: 'Darlinghurst', daysFromNow: 9,
              _bg: 'linear-gradient(135deg,#050505,#0a050f)' } },
  { id: 'demo_c4', name: 'Folk Collective',
    config: { venue: 'Newtown Social Club, Sydney', genres: 'Live Music,Folk,Acoustic',
              state: 'NSW', location: 'Newtown', daysFromNow: 10,
              _bg: 'linear-gradient(135deg,#081505,#0a1a10)' } },
  { id: 'demo_c5', name: 'Bass Kitchen Vol. 5',
    config: { venue: 'Ding Dong Lounge, Melbourne', genres: 'DJ,Drum & Bass,Bass',
              state: 'VIC', location: 'Melbourne CBD', daysFromNow: 11,
              _bg: 'linear-gradient(135deg,#05100a,#050a12)' } },
  { id: 'demo_c6', name: 'Spoken Word Night',
    config: { venue: 'Red Rattler Theatre, Sydney', genres: 'Spoken Word,Poetry',
              state: 'NSW', location: 'Marrickville', daysFromNow: 12,
              _bg: 'linear-gradient(135deg,#05050f,#100510)' } },
];

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDemoEvents(realEvents = []) {
  const now = new Date();
  const realNames = new Set(realEvents.map(e => (e.name || '').toLowerCase().trim()));

  return DEMO_RAW
    .filter(ev => !realNames.has(ev.name.toLowerCase().trim()))
    .map(ev => {
      const d = new Date(now);
      d.setDate(d.getDate() + (ev.config.daysFromNow || 0));
      return {
        ...ev,
        config: { ...ev.config, date: localDateStr(d) },
        _isDemo: true,
      };
    });
}

// Looks up a single demo event by id — used by EventScreen when a demo
// card is opened directly via its /event/:id route (e.g. a bookmarked link).
export function getDemoEventById(id) {
  const raw = DEMO_RAW.find(ev => ev.id === id);
  if (!raw) return null;
  const d = new Date();
  d.setDate(d.getDate() + (raw.config.daysFromNow || 0));
  return { ...raw, config: { ...raw.config, date: localDateStr(d) }, _isDemo: true };
}
