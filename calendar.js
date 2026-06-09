// ═══════════════════════════════════════════════════
//  calendar.js — YesPleez Discovery Calendar
//  Depends on: state.js, navigation.js, events.js
// ═══════════════════════════════════════════════════

// ── State ──────────────────────────────────────────
let _calEvents    = [];
let _calViewMonth = new Date();
let _calSelDate   = null;    // 'YYYY-MM-DD'
let _calLoaded    = false;

// Entry is in navigation.js showCalendar()

// ── Filter state ───────────────────────────────────
let _calGenreFilter   = '';
let _calStateFilter   = '';
let _calPostcodeLat   = null;
let _calPostcodeLng   = null;
let _calPostcodeKm    = 50;
let _calPostcodeTimer = null;

// ── Category / sub-genre filter state ─────────────
let _calCategoryFilter = '';
let _calSubGenreFilter = '';

const _calSubGenreMap = {
  dj:        ['House','Techno','Drum & Bass','Trance','Dubstep','Disco','Minimal','Progressive'],
  band:      ['Rock','Indie','Folk','Punk','Metal','Blues','Acoustic','Country'],
  comedy:    ['Stand Up','Improvised','Storytelling','Observational','Open Mic'],
  spokenword:['Poetry','Slam','Narrative','Spoken Word','Experimental'],
  festival:  ['Electronic','Folk','Arts','Community','Camping','Multi-Genre'],
  market:    ['Artisan','Vintage','Night Market','Food','Makers'],
  workshop:  ['Music','Art','Dance','Writing','Mindfulness'],
};

// Category → genre keywords for matching real DB events
const _calCatKeywords = {
  dj:        ['dj','house','techno','drum','dnb','trance','dubstep','disco','minimal','electronic','garage','jungle','breaks','psytrance'],
  band:      ['band','rock','indie','folk','punk','metal','blues','acoustic','live music','country','singer','muso'],
  comedy:    ['comedy','stand-up','standup','improv','laugh','comic'],
  spokenword:['spoken word','poetry','slam','storytelling','narrative'],
  festival:  ['festival','fest'],
  market:    ['market','artisan','craft','bazaar'],
  workshop:  ['workshop','class','lesson','masterclass'],
};

// ── Demo event seed data ────────────────────────────
// Dates are computed relative to "now" at render time so sections stay correct
const _calDemoRaw = [
  { id:'demo_feat', name:'Bellingen Winter Solstice Festival',
    config:{ venue:'Bellingen Showground, NSW', genres:'Folk, World Music, Electronic, Acoustic',
             postcode:'2454', state:'NSW', _cat:'festival', _sub:'Folk', _featured:true,
             _daysFromNow:3, _distance:'385 km from Sydney',
             _bg:'linear-gradient(160deg,#1a0533 0%,#3d1a6e 35%,#1a3a0a 65%,#0a2a0a 100%)',
             _accent:'#9D4EDD', _textAccent:'#c084fc' } },
  { id:'demo_t1', name:'Open Mic Night',
    config:{ venue:'The Chippo Hotel, Sydney', genres:'Acoustic, Singer-Songwriter, Folk',
             _cat:'band', _sub:'Acoustic', _daysFromNow:0,
             _bg:'linear-gradient(135deg,#081a10,#122a1a)', _accent:'#00E5A0' } },
  { id:'demo_t2', name:'Friday Night Laughs',
    config:{ venue:'Comedy Republic, Melbourne', genres:'Stand-Up, Observational, Dark Comedy',
             _cat:'comedy', _sub:'Stand Up', _daysFromNow:0,
             _bg:'linear-gradient(135deg,#1a1005,#2a1a08)', _accent:'#FF8C42' } },
  { id:'demo_t3', name:'House Sessions',
    config:{ venue:'Midnight Club, Melbourne', genres:'House, Deep House, Disco',
             _cat:'dj', _sub:'House', _daysFromNow:0,
             _bg:'linear-gradient(135deg,#050a1a,#0a0520)', _accent:'#00E5FF' } },
  { id:'demo_w1', name:'Winter Solstice Festival',
    config:{ venue:'Centennial Park, Sydney', genres:'Electronic, Folk, World Music',
             _cat:'festival', _sub:'Multi-Genre', _daysFromNow:3,
             _bg:'linear-gradient(135deg,#1b0d3a,#0d200d)', _accent:'#9D4EDD' } },
  { id:'demo_w2', name:'Local Band Showcase',
    config:{ venue:'The Lansdowne, Sydney', genres:'Indie, Rock, Alternative',
             _cat:'band', _sub:'Indie', _daysFromNow:4,
             _bg:'linear-gradient(135deg,#0a1a0a,#142a14)', _accent:'#00E5A0' } },
  { id:'demo_w3', name:'Comedy Club Takeover',
    config:{ venue:'The Factory Theatre, Sydney', genres:'Stand-Up, Improv, Observational',
             _cat:'comedy', _sub:'Improvised', _daysFromNow:4,
             _bg:'linear-gradient(135deg,#1a0a08,#2a1008)', _accent:'#FF8C42' } },
  { id:'demo_c1', name:'Dune Rats',
    config:{ venue:'Manning Bar, Sydney', genres:'Punk, Alternative, Rock',
             _cat:'band', _sub:'Punk', _daysFromNow:8,
             _bg:'linear-gradient(135deg,#1a0808,#100a0a)', _accent:'#FF2D78' } },
  { id:'demo_c2', name:'Folk Collective',
    config:{ venue:'Newtown Social Club, Sydney', genres:'Folk, Acoustic, Indie',
             _cat:'band', _sub:'Folk', _daysFromNow:10,
             _bg:'linear-gradient(135deg,#081505,#0a1a10)', _accent:'#00E5A0' } },
  { id:'demo_c3', name:'Spoken Word Night',
    config:{ venue:'Red Rattler Theatre, Sydney', genres:'Spoken Word, Poetry, Storytelling',
             _cat:'spokenword', _sub:'Poetry', _daysFromNow:12,
             _bg:'linear-gradient(135deg,#05050f,#100510)', _accent:'#FFD700' } },
  { id:'demo_c4', name:'Midnight Techno',
    config:{ venue:'Club 77, Sydney', genres:'Techno, Industrial, Dark Minimal',
             _cat:'dj', _sub:'Techno', _daysFromNow:14,
             _bg:'linear-gradient(135deg,#050505,#0a050f)', _accent:'#00E5FF' } },
  { id:'demo_c5', name:'Carriageworks Night Market',
    config:{ venue:'Carriageworks, Sydney', genres:'Food, Craft, Artisan Goods',
             _cat:'market', _sub:'Night Market', _daysFromNow:7,
             _bg:'linear-gradient(135deg,#1a0f08,#0f1a08)', _accent:'#FFB830' } },
  { id:'demo_c6', name:'DnB Sundown',
    config:{ venue:'Venue 505, Sydney', genres:'Drum & Bass, Liquid, Neurofunk',
             _cat:'dj', _sub:'Drum & Bass', _daysFromNow:16,
             _bg:'linear-gradient(135deg,#05100a,#050a12)', _accent:'#00E5FF' } },
];

function _calGetDemoEvents() {
  const now = new Date();
  return _calDemoRaw.map(ev => {
    const d = new Date(now);
    d.setDate(d.getDate() + (ev.config._daysFromNow || 0));
    // Use ISO noon format — parses reliably on all browsers/platforms
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${dd}T12:00:00`;
    return { ...ev, config: { ...ev.config, date: dateStr }, _isDemo: true };
  });
}

function _calAllEvents() {
  const demo = _calGetDemoEvents();
  const realNames = new Set(_calEvents.map(e => (e.name || '').toLowerCase().trim()));
  const filteredDemo = demo.filter(d => !realNames.has((d.name || '').toLowerCase().trim()));
  return [..._calEvents, ...filteredDemo];
}

function _calCatMatchesEvent(ev) {
  if (!_calCategoryFilter) return true;
  const cat = ev.config?._cat || '';
  // Demo events have explicit _cat
  if (ev._isDemo) {
    if (cat !== _calCategoryFilter) return false;
    if (_calSubGenreFilter) {
      const sub  = (ev.config?._sub || '').toLowerCase();
      const gen  = (ev.config?.genres || '').toLowerCase();
      const q    = _calSubGenreFilter.toLowerCase();
      return sub === q || gen.includes(q);
    }
    return true;
  }
  // Real events: match via genre keywords
  const genres = (ev.config?.genres || ev.genres || '').toLowerCase();
  const keys   = _calCatKeywords[_calCategoryFilter] || [];
  const matches = keys.some(k => genres.includes(k));
  if (!matches) return false;
  if (_calSubGenreFilter) return genres.includes(_calSubGenreFilter.toLowerCase());
  return true;
}

function calSetCategory(cat) {
  _calCategoryFilter = cat;
  _calSubGenreFilter = '';
  document.querySelectorAll('.cal-cat-btn').forEach(btn => {
    const active = btn.dataset.cat === cat;
    btn.style.background    = active ? 'rgba(255,255,255,.15)' : '';
    btn.style.color         = active ? 'var(--text)' : '';
    btn.style.borderColor   = active ? 'rgba(255,255,255,.4)'  : '';
  });
  const subRow = document.getElementById('calSubgenreRow');
  if (subRow) {
    const subs = cat ? (_calSubGenreMap[cat] || []) : [];
    if (subs.length) {
      subRow.style.display = 'flex';
      subRow.innerHTML = subs.map(s =>
        `<button onclick="calSetSubGenre('${s.replace(/'/g,'\\\'')}')" data-sub="${s}" class="cal-sub-btn"
          style="flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:5px 12px;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;white-space:nowrap;">${s}</button>`
      ).join('');
    } else {
      subRow.style.display = 'none';
      subRow.innerHTML = '';
    }
  }
  renderCalContent();
}

function calSetSubGenre(sub) {
  _calSubGenreFilter = _calSubGenreFilter === sub ? '' : sub;
  document.querySelectorAll('.cal-sub-btn').forEach(btn => {
    const active = btn.dataset.sub === _calSubGenreFilter;
    btn.style.background  = active ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.04)';
    btn.style.color       = active ? 'var(--text)'           : 'var(--muted)';
    btn.style.borderColor = active ? 'rgba(255,255,255,.3)'  : '';
  });
  renderCalContent();
}

// Haversine distance in km
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _calFilterEvent(ev) {
  if (ev._isDemo) return true; // demo events always pass legacy filters
  const cfg = ev.config || {};

  if (_calGenreFilter) {
    const genres = (cfg.genres || ev.genres || '').toLowerCase();
    if (!genres.includes(_calGenreFilter.toLowerCase())) return false;
  }
  if (_calStateFilter) {
    const venue = (cfg.venue || cfg.state || '').toLowerCase();
    if (!venue.includes(_calStateFilter.toLowerCase())) return false;
  }
  if (_calPostcodeLat !== null && _calPostcodeLng !== null) {
    const evLat = parseFloat(cfg.lat);
    const evLng = parseFloat(cfg.lng);
    if (!isNaN(evLat) && !isNaN(evLng)) {
      // Geocoded — use Haversine radius check
      const dist = _haversineKm(_calPostcodeLat, _calPostcodeLng, evLat, evLng);
      if (dist > _calPostcodeKm) return false;
    } else {
      // No coords — fall back to plain postcode string match on venue/postcode fields
      const pcQuery = document.getElementById('calPostcodeInput')?.value.trim() || '';
      if (pcQuery) {
        const haystack = [cfg.postcode, cfg.venue, cfg.state, ev.name].filter(Boolean).join(' ');
        if (!haystack.includes(pcQuery)) return false;
      }
    }
  }
  return true;
}

// ── Postcode input handler ─────────────────────────
function calPostcodeInput(inputEl) {
  const val = inputEl.value.trim();
  const statusEl = document.getElementById('calPostcodeStatus');
  const radiusSel = document.getElementById('calRadiusFilter');

  clearTimeout(_calPostcodeTimer);

  if (!val || val.length < 4) {
    // Clear postcode filter
    _calPostcodeLat = null;
    _calPostcodeLng = null;
    if (statusEl) statusEl.style.display = 'none';
    if (radiusSel) radiusSel.style.display = 'none';
    inputEl.style.borderColor = '';
    calApplyFilters();
    return;
  }

  if (statusEl) { statusEl.textContent = '…'; statusEl.style.display = ''; }

  _calPostcodeTimer = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(val)}&country=AU&format=json&limit=1`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (!data.length) {
        if (statusEl) { statusEl.textContent = '?'; statusEl.style.color = 'var(--neon)'; statusEl.style.display = ''; }
        _calPostcodeLat = null; _calPostcodeLng = null;
        inputEl.style.borderColor = 'rgba(255,45,120,.5)';
        calApplyFilters();
        return;
      }
      _calPostcodeLat = parseFloat(data[0].lat);
      _calPostcodeLng = parseFloat(data[0].lon);
      _calPostcodeKm  = parseInt(document.getElementById('calRadiusFilter')?.value || '50');
      if (statusEl) { statusEl.textContent = '✓'; statusEl.style.color = 'var(--neon2)'; statusEl.style.display = ''; }
      if (radiusSel) radiusSel.style.display = '';
      inputEl.style.borderColor = 'var(--neon2)';
      // Save to localStorage for next visit
      try { localStorage.setItem('yp_cal_postcode', val); } catch(e) {}
      calApplyFilters();
    } catch(e) {
      if (statusEl) statusEl.style.display = 'none';
      _calPostcodeLat = null; _calPostcodeLng = null;
      calApplyFilters();
    }
  }, 600);
}

function calApplyFilters() {
  _calGenreFilter = document.getElementById('calGenreFilter')?.value  || '';
  _calStateFilter = document.getElementById('calStateFilter')?.value  || '';
  _calPostcodeKm  = parseInt(document.getElementById('calRadiusFilter')?.value || '50');
  const hasFilter = !!(_calGenreFilter || _calStateFilter || _calPostcodeLat !== null);
  const clearBtn  = document.getElementById('calFilterClear');
  const countEl   = document.getElementById('calFilterCount');
  if (clearBtn) clearBtn.style.display = hasFilter ? '' : 'none';
  renderCalContent();
  if (countEl) {
    const visible = _calEvents.filter(_calFilterEvent).length;
    if (hasFilter) { countEl.textContent = `${visible} event${visible!==1?'s':''}`; countEl.style.display = ''; }
    else countEl.style.display = 'none';
  }
}

function calClearFilters() {
  _calGenreFilter = '';
  _calStateFilter = '';
  _calPostcodeLat = null;
  _calPostcodeLng = null;
  const gf = document.getElementById('calGenreFilter');
  const sf = document.getElementById('calStateFilter');
  const pf = document.getElementById('calPostcodeInput');
  const rf = document.getElementById('calRadiusFilter');
  const st = document.getElementById('calPostcodeStatus');
  if (gf) gf.value = '';
  if (sf) sf.value = '';
  if (pf) { pf.value = ''; pf.style.borderColor = ''; }
  if (rf) rf.style.display = 'none';
  if (st) st.style.display = 'none';
  try { localStorage.removeItem('yp_cal_postcode'); } catch(e) {}
  const clearBtn = document.getElementById('calFilterClear');
  const countEl  = document.getElementById('calFilterCount');
  if (clearBtn) clearBtn.style.display = 'none';
  if (countEl)  countEl.style.display  = 'none';
  renderCalContent();
}

// Restore saved postcode on calendar open
function calRestorePostcode() {
  try {
    const saved = localStorage.getItem('yp_cal_postcode');
    const inputEl = document.getElementById('calPostcodeInput');
    if (saved && inputEl) {
      inputEl.value = saved;
      calPostcodeInput(inputEl);
    }
  } catch(e) {}
}

// ── Data loading ───────────────────────────────────
async function loadCalEvents() {
  if (DEMO) { _calEvents = []; _calLoaded = true; return; }
  try {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const now = Date.now() - 86400000 * 1; // include yesterday
    _calEvents = (data || []).filter(ev => {
      const d = calParseDate(ev);
      return d && d.getTime() >= now;
    }).sort((a, b) => calParseDate(a) - calParseDate(b));
    _calLoaded = true;
  } catch(e) {
    console.warn('loadCalEvents:', e);
    _calEvents = [];
    _calLoaded = true;
  }
}

// ── Date utilities ─────────────────────────────────
function calParseDate(ev) {
  const s = ev?.config?.date;
  if (!s) return null;
  // Try ISO / standard parse first
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  // Handle "June 20 / 21" style (multi-day) — take first date
  const multiDay = s.match(/([A-Za-z]+)\s+(\d+)\s*[\/\-&]\s*\d+/);
  if (multiDay) {
    const now = new Date();
    d = new Date(`${multiDay[1]} ${multiDay[2]} ${now.getFullYear()}`);
    if (!isNaN(d.getTime())) {
      // Roll to next year if date has already passed by more than a week
      if (d < new Date(now - 7 * 86400000)) d.setFullYear(now.getFullYear() + 1);
      return d;
    }
  }

  // Handle "19 October" or "October 19" style (no year)
  const noYear = s.match(/(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2})/);
  if (noYear) {
    const now = new Date();
    d = new Date(`${s} ${now.getFullYear()}`);
    if (!isNaN(d.getTime())) {
      if (d < new Date(now - 7 * 86400000)) d.setFullYear(now.getFullYear() + 1);
      return d;
    }
  }

  return null;
}

function calDateStr(ev) {
  const d = calParseDate(ev);
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

function calEventsByDate(dateStr) {
  return _calEvents.filter(ev => calDateStr(ev) === dateStr);
}

function calEventsThisWeek() {
  const now = new Date(); now.setHours(0,0,0,0);
  const end = new Date(now); end.setDate(end.getDate() + 7);
  return _calEvents.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= now && d <= end && _calFilterEvent(ev);
  });
}

function calEventsUpcoming(days = 90) {
  const now = new Date(); now.setHours(0,0,0,0);
  const end = new Date(now); end.setDate(end.getDate() + days);
  return _calEvents.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= now && d <= end && _calFilterEvent(ev);
  });
}

// Get artist names from an event's slot claims
function calGetArtists(ev) {
  const names = [];
  (ev.days || []).forEach(day => {
    (day.slots || []).forEach(slot => {
      if (slot.claim?.name) names.push(slot.claim.name);
    });
  });
  return [...new Set(names)];
}

// Days in _calViewMonth that have events
function calEventDatesInMonth() {
  const y = _calViewMonth.getFullYear();
  const m = _calViewMonth.getMonth();
  const set = new Set();
  _calEvents.forEach(ev => {
    const d = calParseDate(ev);
    if (d && d.getFullYear() === y && d.getMonth() === m) {
      set.add(d.getDate());
    }
  });
  return set;
}

// Artists playing 2+ upcoming events
function calArtistsOnTour() {
  const map = {};
  calEventsUpcoming(120).forEach(ev => {
    const d = calParseDate(ev);
    if (!d) return;
    calGetArtists(ev).forEach(name => {
      if (!map[name]) map[name] = [];
      map[name].push({
        evName: ev.name || 'Event',
        date: d,
        evId: ev.id
      });
    });
  });
  return Object.entries(map)
    .filter(([, gigs]) => gigs.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6);
}

// Group events by location for scene map
function calSceneMap() {
  const map = {};
  _calEvents.forEach(ev => {
    // Try state field, then parse venue string, then postcode prefix
    const venue = ev.config?.venue || '';
    const state = ev.config?.state || '';
    let region = state;
    if (!region) {
      // Try to extract state from venue string "Venue, City NSW"
      const parts = venue.split(',');
      const last = parts[parts.length - 1]?.trim() || '';
      // Match AU state codes
      const stateMatch = last.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/);
      if (stateMatch) {
        region = stateMatch[1];
        // Also try to get city
        const city = parts[parts.length - 2]?.trim();
        if (city && city.length < 30) region = city + ', ' + stateMatch[1];
      } else if (last.length > 1 && last.length < 30) {
        region = last;
      } else {
        region = venue.split(',')[0]?.trim() || 'Other';
      }
    }
    if (!region || region.length < 2) region = 'Other';
    if (!map[region]) map[region] = [];
    map[region].push(ev);
  });
  return Object.entries(map)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
}

// ── Clash detection ────────────────────────────────
function calDetectClashes(targetDate, targetLat, targetLng, genre) {
  const R = 6371; // Earth radius km
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  if (!targetLat || !targetLng) return [];
  return _calEvents.filter(ev => {
    if (!ev.lat || !ev.lng) return false;
    const d = calParseDate(ev);
    if (!d) return false;
    const tgt = new Date(targetDate);
    if (Math.abs(d - tgt) > 86400000) return false; // must be same day
    const dist = haversine(parseFloat(targetLat), parseFloat(targetLng), parseFloat(ev.lat), parseFloat(ev.lng));
    return dist <= 50; // within 50km
  });
}

// ── Render: Header ─────────────────────────────────
function renderCalHeader() {
  const label = document.getElementById('calMonthLabel');
  if (label) {
    label.textContent = _calViewMonth.toLocaleString('default', {
      month: 'long', year: 'numeric'
    }).toUpperCase();
  }
  renderDateStrip();
}

function renderDateStrip() {
  const strip = document.getElementById('calDateStrip');
  if (!strip) return;
  const y     = _calViewMonth.getFullYear();
  const m     = _calViewMonth.getMonth();
  const total = new Date(y, m + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];
  const eventDays = calEventDatesInMonth();
  const DAY_NAMES = ['S','M','T','W','T','F','S'];

  let html = '';
  for (let d = 1; d <= total; d++) {
    const ds      = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = ds === today;
    const isSel   = ds === _calSelDate;
    const hasEvs  = eventDays.has(d);
    const dow     = new Date(ds).getDay();

    let bg, textCol;
    if (isSel) {
      bg = 'background:var(--neon2);';
      textCol = 'color:#0a0a0f;';
    } else if (isToday) {
      bg = 'background:rgba(0,229,255,.12);border:1.5px solid var(--neon2);';
      textCol = 'color:var(--neon2);';
    } else {
      bg = 'background:var(--card2);';
      textCol = 'color:var(--text);';
    }

    const dot = hasEvs
      ? `<div style="width:5px;height:5px;border-radius:50%;background:${isSel ? '#0a0a0f' : 'var(--neon)'};margin:2px auto 0;flex-shrink:0;"></div>`
      : `<div style="height:7px;"></div>`;

    html += `<div onclick="calSelectDate('${ds}')" style="flex-shrink:0;width:40px;text-align:center;cursor:pointer;border-radius:10px;padding:6px 4px 4px;${bg}${textCol}transition:all .15s;box-sizing:border-box;">
      <div style="font-size:9px;opacity:.55;margin-bottom:2px;font-family:'DM Sans',sans-serif;">${DAY_NAMES[dow]}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:.5px;line-height:1;">${d}</div>
      ${dot}
    </div>`;
  }
  strip.innerHTML = html;

  // Scroll selected or today into view
  const target = _calSelDate || today;
  if (target.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)) {
    const day = parseInt(target.split('-')[2]) - 1;
    setTimeout(() => {
      const pills = strip.children;
      if (pills[day]) pills[day].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
    }, 60);
  }
}

// ── Render: Home ───────────────────────────────────
// ── Timeline bucket helpers ────────────────────────
function _calTimeBuckets() {
  const now     = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dow     = now.getDay(); // 0=Sun
  // This weekend = coming Fri/Sat/Sun (within 7 days)
  const daysToFri  = (5 - dow + 7) % 7 || 7;
  const weekendEnd = new Date(now); weekendEnd.setDate(now.getDate() + (daysToFri + 2));
  const weekEnd    = new Date(now); weekEnd.setDate(now.getDate() + 7);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of this month
  const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const buckets = [
    { key: 'today',      label: 'TODAY',           color: 'var(--neon2)', test: d => d.toISOString().split('T')[0] === todayStr },
    { key: 'weekend',    label: 'THIS WEEKEND',     color: 'var(--neon)',  test: d => d > now && d <= weekendEnd },
    { key: 'week',       label: 'THIS WEEK',        color: 'var(--gold)',  test: d => d > weekendEnd && d <= weekEnd },
    { key: 'month',      label: 'THIS MONTH',       color: '#9D4EDD',      test: d => d > weekEnd && d <= monthEnd },
    { key: 'nextmonth',  label: nextMonth.toLocaleString('en-AU',{month:'long'}).toUpperCase(), color: 'var(--neon2)', test: d => d >= nextMonth && d <= nextMonthEnd },
    { key: 'beyond',     label: 'FURTHER OUT',      color: 'var(--muted)', test: d => d > nextMonthEnd },
  ];
  return buckets;
}

// ── Featured hero card ────────────────────────────
function calFeaturedCard(ev) {
  const d       = calParseDate(ev);
  const name    = esc(ev.name || 'EVENT');
  const venue   = esc(ev.config?.venue || '');
  const genres  = (ev.config?.genres || '').split(',').map(g => g.trim()).filter(Boolean);
  const poster  = ev.config?.poster || ev.poster_url || '';
  const dist    = esc(ev.config?._distance || '');
  const accent  = ev.config?._accent || '#9D4EDD';
  const bg      = poster
    ? `url('${poster}') center/cover no-repeat`
    : (ev.config?._bg || `linear-gradient(135deg,#1a0533,#3d1a6e,#0a2a0a)`);
  const dateStr = d ? d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' }).toUpperCase() : (ev.config?.date || '').toUpperCase();

  return `<div onclick="calOpenEvent('${ev.id}')" style="position:relative;margin:16px 16px 0;border-radius:20px;overflow:hidden;cursor:pointer;height:280px;background:${bg};box-shadow:0 8px 40px rgba(0,0,0,.6);">
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.05) 0%,rgba(0,0,0,.15) 30%,rgba(0,0,0,.75) 75%,rgba(0,0,0,.9) 100%);"></div>
    <!-- Featured badge -->
    <div style="position:absolute;top:16px;left:16px;background:${accent};color:#fff;border-radius:6px;padding:4px 10px;font-size:9px;font-weight:700;letter-spacing:1.2px;font-family:'DM Sans',sans-serif;">FEATURED</div>
    <!-- Content -->
    <div style="position:absolute;bottom:0;left:0;right:0;padding:20px 20px 22px;">
      ${dateStr ? `<div style="font-size:10px;color:rgba(255,255,255,.65);letter-spacing:1.5px;margin-bottom:6px;font-family:'DM Sans',sans-serif;font-weight:600;">${dateStr}</div>` : ''}
      <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(26px,6vw,36px);letter-spacing:1px;line-height:1;margin-bottom:8px;text-shadow:0 2px 12px rgba(0,0,0,.6);">${name}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        ${venue ? `<span style="font-size:12px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${venue}</span>` : ''}
        ${dist ? `<span style="font-size:11px;color:rgba(255,255,255,.5);">${dist}</span>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${genres.slice(0,4).map(g => `<span style="background:rgba(255,255,255,.12);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.18);border-radius:20px;padding:3px 9px;font-size:10px;color:rgba(255,255,255,.85);">${esc(g)}</span>`).join('')}
      </div>
    </div>
    <!-- Buttons -->
    <div style="position:absolute;bottom:18px;right:16px;display:flex;gap:8px;align-items:center;">
      ${!ev._isDemo ? `<button onclick="event.stopPropagation();shareItem('event','${ev.id}',${JSON.stringify(ev.name||'').replace(/'/g,'\\\'')
})" style="width:34px;height:34px;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;" title="Share">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>` : ''}
      <div style="width:36px;height:36px;background:${accent};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,.4);">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>
  </div>`;
}

// ── What's On: category badge ──────────────────────
function calEventCategory(ev) {
  const text = ((ev.name || '') + ' ' + (ev.config?.genres || '')).toLowerCase();
  if (/comedy|standup|stand.up|open.mic|improv/i.test(text)) return { label: 'COMEDY',     color: '#FF8C42', dark: true };
  if (/festival|fest\b/i.test(text))                          return { label: 'FESTIVAL',   color: '#9D4EDD', dark: false };
  if (/dj.set|dj set|house|techno|dnb|drum|dubstep|garage|electronic|psytrance|breaks/i.test(text)) return { label: 'DJ SET', color: '#00E5FF', dark: true };
  if (/open.mic|acoustic|folk|singer/i.test(text))            return { label: 'OPEN MIC',   color: '#FFD700', dark: true };
  if (/party\b/i.test(text))                                   return { label: 'PARTY',      color: '#FF2D78', dark: false };
  return { label: 'LIVE MUSIC', color: '#FF2D78', dark: false };
}

// ── What's On: horizontal scroll card ──────────────
function calWhatsOnCard(ev, size) {
  const d      = calParseDate(ev);
  const name   = esc(ev.name || 'EVENT');
  const venue  = esc(ev.config?.venue || '');
  const genres = (ev.config?.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);
  const poster = ev.config?.poster || ev.poster_url || '';
  const cat    = calEventCategory(ev);
  const dateStr = d ? d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }) : '';
  const w      = size === 'lg' ? '210px' : '160px';
  const imgH   = size === 'lg' ? '210px' : '165px';
  const bg     = poster ? `url('${poster}') center/cover no-repeat` : `linear-gradient(135deg,rgba(255,45,120,.5),rgba(157,78,221,.4),rgba(0,229,255,.3))`;

  return `<div onclick="calOpenEvent('${ev.id}')" style="flex-shrink:0;width:${w};border-radius:16px;overflow:hidden;background:var(--card2);cursor:pointer;transition:transform .15s;" onmouseenter="this.style.transform='translateY(-3px)'" onmouseleave="this.style.transform=''">
    <div style="position:relative;height:${imgH};background:${bg};">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.1) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,.4) 100%);"></div>
      <div style="position:absolute;top:10px;left:10px;background:${cat.color};color:${cat.dark?'#0a0a0f':'#fff'};border-radius:6px;padding:3px 8px;font-size:9px;font-weight:700;letter-spacing:.8px;font-family:'DM Sans',sans-serif;">${cat.label}</div>
      <div style="position:absolute;top:8px;right:8px;width:28px;height:28px;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </div>
    </div>
    <div style="padding:10px 10px 12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:.5px;line-height:1.1;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
      ${venue ? `<div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-bottom:3px;overflow:hidden;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${venue}</span></div>` : ''}
      ${dateStr ? `<div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-bottom:6px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateStr}</div>` : ''}
      ${genres.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">${genres.map(g => `<span style="background:rgba(255,255,255,.07);border-radius:6px;padding:2px 7px;font-size:9px;color:var(--muted);letter-spacing:.3px;">${esc(g)}</span>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

// ── What's On: list row card ────────────────────────
function calListCard(ev) {
  const d      = calParseDate(ev);
  const name   = esc(ev.name || 'EVENT');
  const venue  = esc(ev.config?.venue || '');
  const poster = ev.config?.poster || ev.poster_url || '';
  const cat    = calEventCategory(ev);
  const dayStr = d ? d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }) : '';

  const bg = poster ? `url('${poster}') center/cover no-repeat` : `linear-gradient(135deg,rgba(255,45,120,.5),rgba(0,229,255,.3))`;

  return `<div onclick="calOpenEvent('${ev.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='rgba(255,255,255,.03)'" onmouseleave="this.style.background=''">
    <div style="width:60px;height:60px;border-radius:10px;background:${bg};flex-shrink:0;"></div>
    <div style="flex:1;min-width:0;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;line-height:1;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
      <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${venue ? `<span style="display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${venue}</span>` : ''}
        <span style="background:${cat.color};color:${cat.dark?'#0a0a0f':'#fff'};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;">${cat.label}</span>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;min-width:72px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
      <div style="font-size:11px;color:var(--text);font-weight:600;white-space:nowrap;">${dayStr}</div>
      ${!ev._isDemo ? `<button onclick="event.stopPropagation();shareItem('event','${ev.id}',${JSON.stringify(ev.name||'')})" style="background:none;border:1px solid var(--border);border-radius:20px;padding:4px 10px;font-size:10px;color:var(--muted);cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share
      </button>` : ''}
    </div>
  </div>`;
}

// ── What's On: section block ────────────────────────
function calWhatsOnSection(sectionId, label, dateBadge, badgeColor, evs, style) {
  if (!evs.length) return '';

  const header = `<div id="${sectionId}" style="display:flex;align-items:center;justify-content:space-between;padding:20px 16px 12px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">${label}</div>
      ${dateBadge ? `<div style="background:${badgeColor}22;border:1px solid ${badgeColor}66;border-radius:20px;padding:3px 10px;font-size:10px;letter-spacing:1px;color:${badgeColor};font-family:'DM Sans',sans-serif;font-weight:600;white-space:nowrap;">${dateBadge}</div>` : ''}
    </div>
    <div style="font-size:12px;color:var(--neon);cursor:pointer;display:flex;align-items:center;gap:3px;white-space:nowrap;" onclick="calToggleFullView()">View all <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><path d='M9 18l6-6-6-6'/></svg></div>
  </div>`;

  let content;
  if (style === 'list') {
    content = `<div>${evs.map(ev => calListCard(ev)).join('')}</div>`;
  } else {
    content = `<div style="display:flex;gap:12px;overflow-x:auto;padding:0 16px 16px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
      ${evs.map(ev => calWhatsOnCard(ev, style)).join('')}
    </div>`;
  }

  return header + content;
}

function renderCalContent() {
  const el = document.getElementById('calContent');
  if (!el) return;

  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dow      = now.getDay();

  // Weekend = coming Fri–Sun (or this Fri–Sun if today is Fri/Sat/Sun)
  const daysToFri  = dow === 5 ? 0 : dow === 6 ? 6 : dow === 0 ? 5 : (5 - dow);
  const fri = new Date(now); fri.setDate(now.getDate() + daysToFri); fri.setHours(0,0,0,0);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2); sun.setHours(23,59,59,999);

  // Update month tab label
  const monthEl    = document.getElementById('calTabMonthLabel');
  const monthSubEl = document.getElementById('calTabMonthSub');
  if (monthEl)    monthEl.textContent    = now.toLocaleString('en-AU', { month:'long' }).toUpperCase();
  if (monthSubEl) monthSubEl.textContent = now.toLocaleString('en-AU', { month:'long', year:'numeric' });

  const all = _calAllEvents();

  const passes = ev => _calFilterEvent(ev) && _calCatMatchesEvent(ev);

  const featured = all.filter(ev => ev.config?._featured && passes(ev)).slice(0, 1);

  const tonight  = all.filter(ev => {
    const d = calParseDate(ev);
    return d && d.toISOString().split('T')[0] === todayStr && passes(ev) && !ev.config?._featured;
  });

  const weekend  = all.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= fri && d <= sun && passes(ev) && !ev.config?._featured
        && d.toISOString().split('T')[0] !== todayStr;
  });

  const twoWeeks = new Date(now); twoWeeks.setDate(now.getDate() + 14);
  const comingUp = all.filter(ev => {
    const d = calParseDate(ev);
    if (!d || !passes(ev) || ev.config?._featured) return false;
    if (d.toISOString().split('T')[0] === todayStr) return false;
    if (d >= fri && d <= sun) return false;
    return d > now && d <= twoWeeks;
  }).sort((a,b) => calParseDate(a) - calParseDate(b));

  const todayBadge   = now.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'long' }).toUpperCase();
  const weekendBadge = `${fri.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})} – ${sun.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})}`.toUpperCase();

  let html = '';

  // ── FEATURED ──
  if (featured.length) {
    html += `<div id="calSecFeatured">`;
    html += `<div style="display:flex;align-items:center;gap:8px;padding:16px 16px 0;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:var(--muted);">FEATURED EVENT</div>
    </div>`;
    html += featured.map(ev => calFeaturedCard(ev)).join('');
    html += `</div>`;
  }

  // ── TONIGHT ──
  html += calWhatsOnSection('calSecTonight', 'TONIGHT', todayBadge, '#FF2D78', tonight, 'sm');

  // ── THIS WEEKEND ──
  html += calWhatsOnSection('calSecWeekend', 'THIS WEEKEND', weekendBadge, '#9D4EDD', weekend, 'lg');

  // ── COMING UP ──
  html += calWhatsOnSection('calSecWeek', 'COMING UP', 'NEXT TWO WEEKS', 'var(--gold)', comingUp, 'list');

  // ── SIGN UP NUDGE (between sections, not at bottom) ──
  if (!currentUser?.id || currentUser.id === 'guest') {
    html += `<div style="margin:8px 16px 4px;padding:18px 20px;border:1px solid rgba(157,78,221,.3);border-radius:16px;background:rgba(157,78,221,.06);display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1.5px;margin-bottom:3px;">SAVE EVENTS · GET NOTIFIED</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.4;">Create a free account to follow events, apply to gigs and get alerts.</div>
      </div>
      <button onclick="showSignup()" style="flex-shrink:0;background:#9D4EDD;border:none;color:#fff;border-radius:20px;padding:9px 16px;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;cursor:pointer;white-space:nowrap;">SIGN UP FREE</button>
    </div>`;
  }

  // If category filter active and nothing matched
  const total = featured.length + tonight.length + weekend.length + comingUp.length;
  if (total === 0) {
    html = `<div style="text-align:center;padding:60px 16px 40px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:3px;color:var(--muted);margin-bottom:10px;">NOTHING MATCHING</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:20px;">No events match your current filter.<br>Try a different category.</div>
      <button onclick="calSetCategory('')" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:20px;padding:10px 24px;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;cursor:pointer;">SHOW ALL EVENTS</button>
    </div>`;
  }

  el.innerHTML = html;
}

// ── Bucket accordion toggle ───────────────────────
function calToggleBucket(key) {
  const body    = document.getElementById('calBucketBody_' + key);
  const chevron = document.getElementById('calChevron_' + key);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display    = isOpen ? 'none' : '';
  body.style.paddingTop = isOpen ? '0' : '12px';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : '';
}

// ── Scroll to a What's On section by ID ───────────
function calScrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Toggle full calendar panel (both always visible now) ─
function calToggleFullView() {
  const el = document.getElementById('calFullPanel');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Render: Day View ───────────────────────────────
function renderDayView(dateStr, el) {
  if (!el) el = document.getElementById('calContent');
  const evs = calEventsByDate(dateStr);
  const d   = new Date(dateStr + 'T12:00:00');
  const dayLabel = d.toLocaleDateString('en-AU', {
    weekday:'long', day:'numeric', month:'long'
  }).toUpperCase();

  let html = `
    <div style="display:flex;align-items:center;gap:12px;margin:16px 0 20px;">
      <button onclick="calClearDate()" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:20px;padding:7px 16px;font-size:12px;letter-spacing:1px;font-family:'Bebas Neue',sans-serif;cursor:pointer;">← BACK</button>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:var(--neon2);line-height:1;">${dayLabel}</div>
    </div>`;

  if (!evs.length) {
    html += `<div style="text-align:center;padding:60px 0;color:var(--muted);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;margin-bottom:8px;">QUIET NIGHT</div>
      <div style="font-size:13px;line-height:1.6;">No events on this date.<br>Try a nearby day.</div>
    </div>`;
  } else {
    html += evs.map(ev => calDayCard(ev)).join('');
  }

  el.innerHTML = html;
}

// ── Card builders ──────────────────────────────────
function calBigCard(ev) {
  const d       = calParseDate(ev);
  const name    = esc(ev.name || 'EVENT');
  const venue   = esc(ev.config?.venue || '');
  const artists = calGetArtists(ev);
  const poster  = ev.poster_url || '';
  const dateStr = d ? d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }).toUpperCase() : '';

  const cardBg = poster
    ? `url('${poster}') center/cover no-repeat`
    : `linear-gradient(135deg,rgba(255,45,120,.35) 0%,rgba(157,78,221,.25) 50%,rgba(0,229,255,.2) 100%)`;

  return `<div class="cal-big-card" onclick="calOpenEvent('${ev.id}')" style="background:${cardBg};">
    <div class="cal-big-card-overlay"></div>
    <div class="cal-big-card-content">
      ${dateStr ? `<div class="cal-card-date">${dateStr}</div>` : ''}
      <div class="cal-card-name">${name}</div>
      <div class="cal-card-meta">
        ${venue ? `<span class="cal-card-venue">${venue}</span>` : ''}
        ${artists.length ? `<span class="cal-card-pill">${artists.length} ARTIST${artists.length>1?'S':''}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function calSmallCard(ev) {
  const d      = calParseDate(ev);
  const name   = esc(ev.name || 'EVENT');
  const poster = ev.poster_url || '';
  const date   = d ? d.toLocaleDateString('en-AU', { day:'numeric', month:'short' }).toUpperCase() : '';
  const artists = calGetArtists(ev);

  const cardBg = poster
    ? `url('${poster}') center/cover no-repeat`
    : `linear-gradient(135deg,rgba(255,45,120,.4) 0%,rgba(0,229,255,.3) 100%)`;

  return `<div class="cal-small-card" onclick="calOpenEvent('${ev.id}')" style="background:${cardBg};">
    <div class="cal-small-card-overlay"></div>
    <div class="cal-small-card-content">
      ${date ? `<div style="font-size:10px;letter-spacing:1px;color:var(--neon2);margin-bottom:3px;">${date}</div>` : ''}
      <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;color:#fff;line-height:1.1;">${name}</div>
      ${artists.length ? `<div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:4px;">${artists.length} artists</div>` : ''}
    </div>
  </div>`;
}

function calTourCard(name, gigs) {
  const sorted = [...gigs].sort((a,b) => a.date - b.date);
  const gigsHtml = sorted.slice(0,4).map(g => {
    const dl = g.date.toLocaleDateString('en-AU', { day:'numeric', month:'short' }).toUpperCase();
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:11px;color:var(--neon2);font-family:'Bebas Neue',sans-serif;letter-spacing:1px;width:52px;flex-shrink:0;">${dl}</div>
      <div style="font-size:13px;color:var(--text);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(g.evName)}</div>
    </div>`;
  }).join('');

  return `<div class="cal-tour-card" onclick="calFocusArtist('${esc(name)}')">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <div style="width:38px;height:38px;border-radius:50%;background:rgba(157,78,221,.18);border:1.5px solid #9D4EDD;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9D4EDD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;color:var(--text);">${esc(name)}</div>
        <div style="font-size:11px;color:#9D4EDD;letter-spacing:1.5px;font-family:'Bebas Neue',sans-serif;">${gigs.length} UPCOMING SHOW${gigs.length>1?'S':''}</div>
      </div>
    </div>
    ${gigsHtml}
  </div>`;
}

function calDayCard(ev) {
  const name    = esc(ev.name || 'EVENT');
  const venue   = esc(ev.config?.venue || '');
  const poster  = ev.poster_url || '';
  const artists = calGetArtists(ev);

  const cardBg = poster
    ? `url('${poster}') center/cover no-repeat`
    : `linear-gradient(135deg,rgba(255,45,120,.35) 0%,rgba(0,229,255,.2) 100%)`;

  const lineupHtml = artists.slice(0, 8).map(a =>
    `<span style="font-size:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:3px 12px;color:var(--text);">${esc(a)}</span>`
  ).join('');
  const extra = artists.length > 8
    ? `<span style="font-size:12px;color:var(--muted);">+${artists.length-8} more</span>` : '';

  return `<div style="border-radius:16px;overflow:hidden;margin-bottom:16px;cursor:pointer;border:1px solid rgba(255,255,255,.07);" onclick="calOpenEvent('${ev.id}')">
    <div style="height:200px;background:${cardBg};position:relative;">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,15,0) 30%,rgba(10,10,15,.95) 100%);"></div>
      <div style="position:absolute;bottom:0;left:0;right:0;padding:16px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,6vw,38px);letter-spacing:2px;color:#fff;line-height:.95;text-shadow:0 2px 12px rgba(0,0,0,.8);">${name}</div>
        ${venue ? `<div style="font-size:13px;color:rgba(255,255,255,.65);margin-top:4px;">${venue}</div>` : ''}
      </div>
    </div>
    ${artists.length ? `
    <div style="background:var(--card);padding:14px 16px;">
      <div style="font-size:10px;letter-spacing:2px;color:var(--neon2);margin-bottom:10px;font-family:'Bebas Neue',sans-serif;">LINEUP</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${lineupHtml}${extra}</div>
    </div>` : ''}
  </div>`;
}

function calSectionHeader(title, color) {
  return `<div style="display:flex;align-items:center;gap:12px;margin:28px 0 14px;">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:3px;color:${color};">${title}</div>
    <div style="flex:1;height:1px;background:linear-gradient(to right,${color}50,transparent);"></div>
  </div>`;
}

// ── Interactions ───────────────────────────────────
function calSelectDate(dateStr) {
  _calSelDate = (_calSelDate === dateStr) ? null : dateStr;
  renderDateStrip();
  renderCalContent();
}

function calClearDate() {
  _calSelDate = null;
  renderDateStrip();
  renderCalContent();
}

function calPrevMonth() {
  _calViewMonth = new Date(_calViewMonth.getFullYear(), _calViewMonth.getMonth() - 1, 1);
  renderCalHeader();
}

function calNextMonth() {
  _calViewMonth = new Date(_calViewMonth.getFullYear(), _calViewMonth.getMonth() + 1, 1);
  renderCalHeader();
}

function calOpenEvent(evId) {
  if (evId && evId.startsWith('demo_')) {
    showToast('Sign up free to see full event details and save events you love', 'success');
    return;
  }
  const ev = _calEvents.find(e => e.id === evId);
  if (!ev) return;
  isReadOnly = true;
  openEventSetTimes(ev);
}

function calFocusArtist(name) {
  // Filter day view to events containing this artist
  const evs = _calEvents.filter(ev => calGetArtists(ev).includes(name));
  if (!evs.length) return;
  // Show a summary toast for now; full artist drill-down in phase 2
  showToast(`${name} — ${evs.length} upcoming show${evs.length>1?'s':''}`, 'success');
}

function calFilterRegion(region) {
  const evs = _calEvents.filter(ev => {
    const v = (ev.config?.venue || '') + ' ' + (ev.config?.state || '');
    return v.toLowerCase().includes(region.toLowerCase());
  });
  showToast(`${region}: ${evs.length} event${evs.length!==1?'s':''}`, 'success');
}

// ══════════════════════════════════════════════════
//  ARTIST AVAILABILITY — Phase 2
// ══════════════════════════════════════════════════

// ── State ──────────────────────────────────────────
let _myAvailDates   = new Set(); // 'YYYY-MM-DD' strings
let _availViewMonth = new Date();

// ── Supabase helpers ───────────────────────────────
async function loadMyAvailability() {
  if (DEMO || !currentUser?.id) { _myAvailDates = new Set(); return; }
  try {
    const { data, error } = await supabase
      .from('artist_availability')
      .select('available_date')
      .eq('user_id', currentUser.id);
    if (error) throw error;
    _myAvailDates = new Set((data || []).map(r => r.available_date));
  } catch(e) {
    console.warn('loadMyAvailability:', e);
    _myAvailDates = new Set();
  }
  renderAvailSummary();
}

async function toggleAvailabilityDate(dateStr) {
  if (!currentUser?.id) return;
  const had = _myAvailDates.has(dateStr);
  if (had) {
    _myAvailDates.delete(dateStr);
    try {
      await supabase.from('artist_availability')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('available_date', dateStr);
    } catch(e) { console.warn('avail delete:', e); _myAvailDates.add(dateStr); }
  } else {
    _myAvailDates.add(dateStr);
    try {
      await supabase.from('artist_availability')
        .upsert({ user_id: currentUser.id, available_date: dateStr }, { onConflict: 'user_id,available_date' });
    } catch(e) { console.warn('avail upsert:', e); _myAvailDates.delete(dateStr); }
  }
  renderAvailGrid();
  renderAvailList();
  renderAvailSummary();
}

// ── Load another artist's availability (promoter view) ──
async function loadArtistAvailability(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('artist_availability')
      .select('available_date')
      .eq('user_id', userId)
      .gte('available_date', new Date().toISOString().split('T')[0]);
    if (error) throw error;
    return (data || []).map(r => r.available_date).sort();
  } catch(e) {
    console.warn('loadArtistAvailability:', e);
    return [];
  }
}

// ── Availability summary in artist dash ───────────
function renderAvailSummary() {
  const el = document.getElementById('artistAvailSummary');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  const upcoming = [..._myAvailDates].filter(d => d >= today).sort().slice(0, 5);
  if (!upcoming.length) {
    el.innerHTML = `<span style="color:var(--muted);">No upcoming dates marked — tap MANAGE to add your availability.</span>`;
    return;
  }
  el.innerHTML = upcoming.map(d => {
    const dt = new Date(d + 'T12:00:00');
    const label = dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<span style="display:inline-block;background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.3);color:var(--neon2);border-radius:16px;padding:4px 12px;font-size:12px;margin:3px 4px 3px 0;letter-spacing:.5px;">${label}</span>`;
  }).join('') + (([..._myAvailDates].filter(d=>d>=today).length > 5) ? `<span style="font-size:11px;color:var(--muted);margin-left:4px;">+${[..._myAvailDates].filter(d=>d>=today).length-5} more</span>` : '');
}

// ── Open / close overlay ───────────────────────────
async function openAvailabilityManager() {
  _availViewMonth = new Date(_availViewMonth.getFullYear(), _availViewMonth.getMonth(), 1);
  // reset to current month on open
  const now = new Date();
  _availViewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById('availabilityOverlay').classList.add('open');
  await loadMyAvailability();
  renderAvailMonthLabel();
  renderAvailGrid();
  renderAvailList();
}

function closeAvailabilityManager() {
  document.getElementById('availabilityOverlay').classList.remove('open');
}

function availPrevMonth() {
  _availViewMonth = new Date(_availViewMonth.getFullYear(), _availViewMonth.getMonth() - 1, 1);
  renderAvailMonthLabel();
  renderAvailGrid();
}

function availNextMonth() {
  _availViewMonth = new Date(_availViewMonth.getFullYear(), _availViewMonth.getMonth() + 1, 1);
  renderAvailMonthLabel();
  renderAvailGrid();
}

// ── Render helpers ─────────────────────────────────
function renderAvailMonthLabel() {
  const el = document.getElementById('availMonthLabel');
  if (!el) return;
  el.textContent = _availViewMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
}

function renderAvailGrid() {
  const grid = document.getElementById('availCalGrid');
  if (!grid) return;
  const year  = _availViewMonth.getFullYear();
  const month = _availViewMonth.getMonth();
  const today = new Date().toISOString().split('T')[0];

  // Day of week that month starts on (0=Sun)
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';

  // Leading empty cells
  for (let i = 0; i < firstDow; i++) {
    html += `<div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;
    const isPast  = dateStr < today;
    const isAvail = _myAvailDates.has(dateStr);
    const isToday = dateStr === today;

    let bg     = isPast ? 'rgba(255,255,255,.03)' : 'var(--card)';
    let color  = isPast ? 'rgba(255,255,255,.2)'  : 'var(--text)';
    let border = 'transparent';
    let cursor = isPast ? 'default' : 'pointer';

    if (isToday)  { border = 'var(--neon2)'; }
    if (isAvail && !isPast) {
      bg     = 'var(--neon2)';
      color  = '#0a0a0f';
      border = 'var(--neon2)';
    }

    html += `<div onclick="${isPast ? '' : `toggleAvailabilityDate('${dateStr}')`}"
      style="
        aspect-ratio:1;display:flex;align-items:center;justify-content:center;
        border-radius:8px;font-size:13px;font-weight:600;
        background:${bg};color:${color};
        border:1.5px solid ${border};
        cursor:${cursor};
        transition:background .15s,border .15s;
        position:relative;
      ">${d}</div>`;
  }

  grid.innerHTML = html;
}

function renderAvailList() {
  const el = document.getElementById('availList');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  const upcoming = [..._myAvailDates].filter(d => d >= today).sort();
  if (!upcoming.length) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0;">No dates marked yet. Tap any date above to mark yourself available.</div>`;
    return;
  }
  el.innerHTML = upcoming.map(d => {
    const dt = new Date(d + 'T12:00:00');
    const label = dt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:13px;color:var(--text);">${label}</div>
      <button onclick="toggleAvailabilityDate('${d}')" style="background:none;border:1px solid rgba(255,80,80,.4);color:rgba(255,80,80,.8);border-radius:6px;font-size:10px;letter-spacing:1px;padding:4px 10px;cursor:pointer;font-family:'Bebas Neue',sans-serif;">REMOVE</button>
    </div>`;
  }).join('');
}

// ── Show availability on public profile (promoter view) ──
async function renderProfileAvailability(userId, containerEl) {
  if (!containerEl) return;
  const dates = await loadArtistAvailability(userId);
  if (!dates.length) { containerEl.style.display = 'none'; return; }
  containerEl.style.display = '';
  const pills = dates.slice(0, 8).map(d => {
    const dt = new Date(d + 'T12:00:00');
    const label = dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<span style="display:inline-block;background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.3);color:var(--neon2);border-radius:16px;padding:5px 13px;font-size:12px;margin:3px 4px 3px 0;">${label}</span>`;
  }).join('');
  const extra = dates.length > 8 ? `<span style="font-size:11px;color:var(--muted);margin-left:4px;">+${dates.length-8} more</span>` : '';
  containerEl.innerHTML = `
    <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--neon2);margin-bottom:10px;">AVAILABLE DATES</div>
    <div>${pills}${extra}</div>`;
}

// ── Clash detection (called from event form) ───────
function checkEventClashes(lat, lng, date, evId) {
  const clashes = calDetectClashes(date, lat, lng, '');
  const others  = clashes.filter(ev => ev.id !== evId);
  if (!others.length) return;

  const warn = document.getElementById('calClashWarning');
  if (!warn) return;
  warn.style.display = '';
  warn.innerHTML = `
    <div style="background:rgba(255,184,48,.08);border:1px solid rgba(255,184,48,.35);border-radius:10px;padding:12px 14px;margin-top:8px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1.5px;color:var(--gold);margin-bottom:8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        ${others.length} COMPETING EVENT${others.length>1?'S':''} NEARBY
      </div>
      ${others.slice(0,3).map(ev => `<div style="font-size:12px;color:var(--muted);padding:3px 0;">${esc(ev.name||'Event')} · ${esc(ev.config?.venue||'')} · ${calParseDate(ev)?.toLocaleDateString('en-AU',{day:'numeric',month:'short'})||''}</div>`).join('')}
    </div>`;
}
