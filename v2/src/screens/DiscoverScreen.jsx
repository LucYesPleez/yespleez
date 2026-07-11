import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import ProfileCard, { TYPE_STYLES } from '../components/ProfileCard';
import PortraitCard from '../components/PortraitCard';
import { SkeletonRow } from '../components/Skeleton';
import { useDragScroll } from '../hooks/useDragScroll';
import s from './DiscoverScreen.module.css';
import { resolveLocationToPostcodes, suggestLocations } from '../lib/auLocations';

const TYPE_OPTIONS = [
  { value: 'artist',  label: 'DJ / Producer' },
  { value: 'band',    label: 'Band' },
  { value: 'standup', label: 'Comedy / Poet' },
  { value: 'host',    label: 'Host' },
  { value: 'venue',   label: 'Venue' },
  { value: 'event',   label: 'Event' },
];

const GENRE_BY_TYPE = {
  artist:  ['Techno','House','Drum & Bass','Breaks','Trance','Psytrance','Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore','Ambient / Downtempo','Electronica','Funk / Soul / Disco','Hip-Hop','Reggae / Dancehall','World / Global','Experimental','Multi Genre'],
  band:    ['Rock','Alternative','Indie','Blues','Jazz','Funk / Soul / Disco','Hip-Hop','Reggae / Dancehall','Country','Folk / Acoustic','Metal','Pop','World / Global','Experimental','Multi Genre'],
  standup: ['Stand-up Comedy','Improv','Poetry Slam','Spoken Word','Cabaret','Storytelling','Roast','Dark Comedy','Political Comedy','Character Comedy'],
  event:   ['Techno','House','Drum & Bass','Trance','Rock','Blues','Jazz','Hip-Hop','Comedy','Arts & Culture','Multi Genre'],
};

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const RADIUS_STEPS = [0, 5, 10, 20, 50, 100, 250, 500];


async function fetchDefault() {
  const [profileRes, evRes] = await Promise.all([
    supabase.from('profiles')
      // M5: id included — cards navigate by the canonical profile.id, which is
      // what makes unclaimed profiles (user_id NULL) navigable at all. The
      // is_live filter hides only explicit false; NULL passes.
      .select('id, user_id, name, type, avatar, location, state, sound, genre_string, bio, updated_at')
      .in('type', ['artist','host','band','standup','venue'])
      .or('is_live.is.null,is_live.neq.false')
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase.from('events')
      .select('id, name, config, created_at')
      .eq('status', 'live')
      .or('is_public.eq.true,is_public.is.null')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  return [
    ...(profileRes.data || []).map(p => ({ ...p, _kind: 'profile' })),
    ...(evRes.data     || []).map(e => ({ ...e, _kind: 'event'   })),
  ];
}

export default function DiscoverScreen() {
  const navigate = useNavigate();
  const [query,    setQuery]    = useState('');
  const [type,     setType]     = useState('');
  const [genre,    setGenre]    = useState('');
  const [state,    setState]    = useState('');
  const [postcode, setPostcode] = useState('');
  const [radius,   setRadius]   = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching,     setSearching]     = useState(false);
  const [visibleCount,       setVisibleCount]       = useState(3);
  const [visibleEventsCount, setVisibleEventsCount] = useState(3);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nearMe,      setNearMe]      = useState(false);
  const [dateFilter,  setDateFilter]  = useState('');
  const [radiusIdx,   setRadiusIdx]   = useState(0);
  const [genreOpen,   setGenreOpen]   = useState(false);
  const [stateOpen,   setStateOpen]   = useState(false);
  const debounce    = useRef(null);
  const profilesDrag = useDragScroll();

  const radiusKm = RADIUS_STEPS[radiusIdx];
  const genreOptions = GENRE_BY_TYPE[type] || [...new Set(Object.values(GENRE_BY_TYPE).flat())].sort();
  const locationSuggestions = suggestLocations(postcode);

  const isFiltered = !!(query || type || genre || state || postcode || nearMe || dateFilter);
  const activeFilterCount = [type, genre, state, postcode || nearMe, dateFilter].filter(Boolean).length;

  // Reset genre when type changes to avoid stale selection
  useEffect(() => { setGenre(''); setGenreOpen(false); }, [type]);
  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(3); setVisibleEventsCount(3); }, [query, type, genre, state, postcode]);

  // Default view — cached by React Query
  const { data: defaultItems = [], isLoading: defaultLoading } = useQuery({
    queryKey: ['discover', 'default'],
    queryFn: fetchDefault,
  });

  const runSearch = useCallback(async (q, t, g, st, pc) => {
    setSearching(true);
    const searches = [];
    const resolvedPostcodes = resolveLocationToPostcodes(pc);

    if (t !== 'event') {
      let profileQ = supabase.from('profiles')
        // M5: id included; is_live hides only explicit false (see fetchDefault)
        .select('id, user_id, name, type, avatar, location, state, sound, genre_string, bio, venue_type, updated_at')
        .in('type', t ? [t] : ['artist','host','band','standup','venue'])
        .or('is_live.is.null,is_live.neq.false')
        .order('updated_at', { ascending: false })
        .limit(30);
      if (q)  profileQ = profileQ.or(`name.ilike.%${q}%,sound.ilike.%${q}%,genre_string.ilike.%${q}%,location.ilike.%${q}%,bio.ilike.%${q}%,venue_type.ilike.%${q}%`);
      if (st) profileQ = profileQ.or(`state.ilike.%${st}%,location.ilike.%${st}%`);
      if (pc) {
        // Match on suburb/city text OR any resolved postcodes
        const locFilters = [`location.ilike.%${pc}%`, `suburb.ilike.%${pc}%`];
        if (resolvedPostcodes.length) resolvedPostcodes.forEach(p => locFilters.push(`postcode.eq.${p}`));
        profileQ = profileQ.or(locFilters.join(','));
      }
      searches.push(profileQ.then(({ data }) => (data || []).map(p => ({ ...p, _kind: 'profile' }))));
    }

    if (!t || t === 'event') {
      let evQ = supabase.from('events')
        .select('id, name, config, created_at')
        .eq('status', 'live')
        .or('is_public.eq.true,is_public.is.null')
        .order('created_at', { ascending: false })
        .limit(20);
      if (q) evQ = evQ.ilike('name', `%${q}%`);
      searches.push(evQ.then(({ data }) => (data || []).map(e => ({ ...e, _kind: 'event' }))));
    }

    const groups = await Promise.all(searches);
    let all = groups.flat();
    if (g) all = all.filter(r => r._kind !== 'profile' || (r.genre_string || '').toLowerCase().includes(g.toLowerCase()));
    setSearchResults(all);
    setSearching(false);
  }, []);

  // Debounce search when filters are active
  useEffect(() => {
    if (!isFiltered) { setSearchResults(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(query, type, genre, state, postcode), 300);
    return () => clearTimeout(debounce.current);
  }, [query, type, genre, state, postcode, isFiltered, runSearch]);

  const loading  = isFiltered ? searching : defaultLoading;
  const items    = isFiltered ? (searchResults || []) : defaultItems;
  const isDefault = !isFiltered;

  const profiles = items.filter(r => r._kind === 'profile');
  const events   = items.filter(r => r._kind === 'event');

  return (
    <div className={s.screen}>
      <div className={s.inner}>
        <h1 className={s.title}>DISCOVER</h1>
        <p className={s.subtitle}>Your gigs · Your artists · Your world</p>

        {/* Search bar */}
        <div className={s.searchWrap}>
          <input
            className={s.searchInput}
            type="search"
            placeholder="Search DJs, promoters, genres, locations…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className={s.searchIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
        </div>

        {/* Filters button */}
        <button className={`${s.filtersBtn} ${filtersOpen ? s.filtersBtnOpen : ''}`} onClick={() => setFiltersOpen(v => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
          <span>FILTERS</span>
          {activeFilterCount > 0 && <span className={s.filtersBadge}>{activeFilterCount}</span>}
        </button>

        {/* Filter dropdown panel */}
        {filtersOpen && (
          <div className={s.dropdown}>

            {/* LOCATION */}
            <div className={s.sheetSection}>
              <div className={s.sheetSectionHead}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                LOCATION
              </div>
              <div className={s.locationRow}>
                <button className={`${s.nearMePill} ${nearMe ? s.nearMePillActive : ''}`} onClick={() => { setNearMe(v => !v); if (!nearMe) setPostcode(''); }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  Near me
                </button>
                <input className={s.sheetInput} style={{flex:1}} type="text" placeholder="City, suburb or postcode" value={postcode} onChange={e => { setPostcode(e.target.value); setNearMe(false); }} list="au-location-options" autoComplete="off" disabled={nearMe} />
                <datalist id="au-location-options">
                  {locationSuggestions.map(l => <option key={l} value={l} />)}
                </datalist>
              </div>
              <div className={s.radiusRow}>
                <span className={s.radiusLabel}>RADIUS</span>
                <span className={s.radiusValue}>{radiusKm} km</span>
              </div>
              <input type="range" className={s.slider} min="0" max="7" step="1" value={radiusIdx} onChange={e => setRadiusIdx(+e.target.value)} style={{ '--pct': `${radiusIdx / 7 * 100}%` }} />
              <div className={s.radiusTicks}>
                {RADIUS_STEPS.map((v, i) => (
                  <span key={v} style={{ left: `${i / 7 * 100}%` }}>{v}</span>
                ))}
              </div>
            </div>

            {/* CATEGORY */}
            <div className={s.sheetSection}>
              <div className={s.sheetSectionHead}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                CATEGORY
              </div>
              <div className={s.sheetPills}>
                {TYPE_OPTIONS.map(o => (
                  <button key={o.value} className={`${s.sheetPill} ${type === o.value ? s.sheetPillActive : ''}`} onClick={() => setType(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* GENRE */}
            <div className={s.sheetSection}>
                <button className={s.sheetExpandRow} onClick={() => setGenreOpen(v => !v)}>
                  <div className={s.sheetSectionHead} style={{marginBottom:0}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    GENRE
                  </div>
                  <span className={s.sheetExpandVal}>{genre || 'All genres'} ›</span>
                </button>
                {genreOpen && (
                  <div className={s.sheetPills} style={{marginTop:10}}>
                    <button className={`${s.sheetPill} ${!genre ? s.sheetPillActive : ''}`} onClick={() => setGenre('')}>All</button>
                    {genreOptions.map(g => (
                      <button key={g} className={`${s.sheetPill} ${genre === g ? s.sheetPillActive : ''}`} onClick={() => { setGenre(g); setGenreOpen(false); }}>{g}</button>
                    ))}
                  </div>
                )}
            </div>

            {/* DATE */}
            <div className={s.sheetSection}>
              <div className={s.sheetSectionHead}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                DATE
              </div>
              <div className={s.sheetPills}>
                {[['','Any time'],['weekend','This weekend'],['7days','Next 7 days'],['30days','Next 30 days']].map(([v,l]) => (
                  <button key={v} className={`${s.sheetPill} ${dateFilter === v ? s.sheetPillActive : ''}`} onClick={() => setDateFilter(v)}>{l}</button>
                ))}
              </div>
            </div>

            {/* STATE */}
            <div className={s.sheetSection} style={{marginBottom:0}}>
              <button className={s.sheetExpandRow} onClick={() => setStateOpen(v => !v)}>
                <div className={s.sheetSectionHead} style={{marginBottom:0}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  STATE
                </div>
                <span className={s.sheetExpandVal}>{state || 'All states'} ›</span>
              </button>
              {stateOpen && (
                <div className={s.sheetPills} style={{marginTop:10}}>
                  <button className={`${s.sheetPill} ${!state ? s.sheetPillActive : ''}`} onClick={() => setState('')}>All</button>
                  {STATE_OPTIONS.map(st => (
                    <button key={st} className={`${s.sheetPill} ${state === st ? s.sheetPillActive : ''}`} onClick={() => { setState(st); setStateOpen(false); }}>{st}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={s.sheetActions}>
              <button className={s.sheetClear} onClick={() => { setType(''); setGenre(''); setState(''); setPostcode(''); setRadius(''); setNearMe(false); setDateFilter(''); setRadiusIdx(0); }}>Reset all</button>
              <button className={s.sheetDone} onClick={() => setFiltersOpen(false)}>
                <span className={s.sheetDoneLabel}>{activeFilterCount > 0 ? `Apply filters (${activeFilterCount})` : 'Apply filters'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        <div className={s.results}>
          {loading && [0,1,2,3,4].map(i => <SkeletonRow key={i} />)}

          {!loading && (
            <>
              {isDefault && profiles.length > 0 && (
                <>
                  <div className={s.sectionRow}>
                    <div className={s.sectionHead}>RECENTLY ADDED / ACTIVE</div>
                    <div className={s.gradientLine} />
                  </div>
                  <div className={s.hScroll} ref={profilesDrag.ref} onMouseDown={profilesDrag.onMouseDown} onMouseMove={profilesDrag.onMouseMove} onMouseUp={profilesDrag.onMouseUp} onMouseLeave={profilesDrag.onMouseLeave}>
                    {profiles.map(p => <PortraitCard key={p.id ?? p.user_id} profile={p} />)}
                  </div>
                </>
              )}
              {isDefault && events.length > 0 && (
                <>
                  <div className={s.sectionRow} style={{ marginTop: profiles.length ? 20 : 0 }}>
                    <div className={s.sectionHead}>UPCOMING EVENTS</div>
                    <div className={s.gradientLine} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, ...(visibleEventsCount < events.length ? { maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : {}) }}>
                    {events.slice(0, visibleEventsCount).map(e => <EventCard key={e.id} event={e} />)}
                  </div>
                  <button className={s.viewMore} style={{ opacity: visibleEventsCount < events.length ? 1 : 0, pointerEvents: visibleEventsCount < events.length ? 'auto' : 'none' }} onClick={() => setVisibleEventsCount(v => v + 10)}>
                    <span className={s.viewMoreText}>VIEW MORE</span>
                  </button>
                </>
              )}

              {!isDefault && items.length === 0 && (
                <p className={s.hint}>No results found. Try a different search or filter.</p>
              )}
              {!isDefault && (
                <>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, ...(visibleCount < items.length ? { maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : {}) }}>
                    {items.slice(0, visibleCount).map(r =>
                      r._kind === 'event'
                        ? <EventCard key={r.id} event={r} />
                        : <ProfileCard key={r.id ?? r.user_id} item={r} />
                    )}
                  </div>
                  <button className={s.viewMore} style={{ opacity: visibleCount < items.length ? 1 : 0, pointerEvents: visibleCount < items.length ? 'auto' : 'none' }} onClick={() => setVisibleCount(v => v + 10)}>
                    <span className={s.viewMoreText}>VIEW MORE</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


