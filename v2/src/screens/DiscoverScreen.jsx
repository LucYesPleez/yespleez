import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import ProfileCard, { TYPE_STYLES } from '../components/ProfileCard';
import { SkeletonRow } from '../components/Skeleton';
import s from './DiscoverScreen.module.css';

const TYPE_OPTIONS = [
  { value: 'all',     label: 'Everything' },
  { value: 'artist',  label: 'Artists / DJs' },
  { value: 'band',    label: 'Bands / Musos' },
  { value: 'standup', label: 'Comedy / Standup' },
  { value: 'venue',   label: 'Venues' },
  { value: 'host',    label: 'Hosts / Promoters' },
  { value: 'event',   label: 'Events' },
];

const GENRE_OPTIONS = [
  'Techno','House','Drum & Bass','Breaks','Trance','Psytrance',
  'Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore',
  'Ambient / Downtempo','Electronica','Funk / Soul / Disco',
  'Hip-Hop','Reggae / Dancehall','World / Global','Experimental','Multi Genre',
];

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];


async function fetchDefault() {
  const [profileRes, evRes] = await Promise.all([
    supabase.from('profiles')
      .select('user_id, name, type, avatar, location, state, sound, genre_string, bio, updated_at')
      .in('type', ['artist','host','band','standup','venue'])
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
  const [type,     setType]     = useState('all');
  const [genre,    setGenre]    = useState('');
  const [state,    setState]    = useState('');
  const [postcode, setPostcode] = useState('');
  const [radius,   setRadius]   = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching,     setSearching]     = useState(false);
  const debounce = useRef(null);

  const isFiltered = !!(query || type !== 'all' || genre || state);

  // Default view — cached by React Query
  const { data: defaultItems = [], isLoading: defaultLoading } = useQuery({
    queryKey: ['discover', 'default'],
    queryFn: fetchDefault,
  });

  const runSearch = useCallback(async (q, t, g, st) => {
    setSearching(true);
    const searches = [];

    if (t !== 'event') {
      let profileQ = supabase.from('profiles')
        .select('user_id, name, type, avatar, location, state, sound, genre_string, bio, venue_type, updated_at')
        .in('type', t !== 'all' ? [t] : ['artist','host','band','standup','venue'])
        .order('updated_at', { ascending: false })
        .limit(30);
      if (q)  profileQ = profileQ.or(`name.ilike.%${q}%,sound.ilike.%${q}%,genre_string.ilike.%${q}%,location.ilike.%${q}%,bio.ilike.%${q}%,venue_type.ilike.%${q}%`);
      if (st) profileQ = profileQ.or(`state.ilike.%${st}%,location.ilike.%${st}%`);
      searches.push(profileQ.then(({ data }) => (data || []).map(p => ({ ...p, _kind: 'profile' }))));
    }

    if (t === 'all' || t === 'event') {
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
    debounce.current = setTimeout(() => runSearch(query, type, genre, state), 300);
    return () => clearTimeout(debounce.current);
  }, [query, type, genre, state, isFiltered, runSearch]);

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

        {/* Filters */}
        <div className={s.filters}>
          <select className={s.filterPill} value={type} onChange={e => setType(e.target.value)}>
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={s.filterPill} value={genre} onChange={e => setGenre(e.target.value)}>
            <option value="">Genre</option>
            {GENRE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className={s.filterPill} value={state} onChange={e => setState(e.target.value)}>
            <option value="">State</option>
            {STATE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            className={s.filterPill}
            type="text"
            placeholder="Postcode"
            maxLength={4}
            inputMode="numeric"
            value={postcode}
            onChange={e => setPostcode(e.target.value.replace(/\D/g, ''))}
          />
          <select className={s.filterPill} value={radius} onChange={e => setRadius(e.target.value)}>
            <option value="">Radius</option>
            <option value="5">5km</option>
            <option value="10">10km</option>
            <option value="25">25km</option>
            <option value="50">50km</option>
            <option value="100">100km</option>
          </select>
        </div>

        {/* Results */}
        <div className={s.results}>
          {loading && [0,1,2,3,4].map(i => <SkeletonRow key={i} />)}

          {!loading && (
            <>
              {isDefault && profiles.length > 0 && (
                <>
                  <div className={s.sectionLabel}>RECENTLY ACTIVE</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {profiles.map(p => <ProfileCard key={p.user_id} item={p} />)}
                  </div>
                </>
              )}
              {isDefault && events.length > 0 && (
                <>
                  <div className={s.sectionLabel} style={{ marginTop: profiles.length ? 20 : 0 }}>UPCOMING EVENTS</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {events.map(e => <EventCard key={e.id} event={e} />)}
                  </div>
                </>
              )}

              {!isDefault && items.length === 0 && (
                <p className={s.hint}>No results found. Try a different search or filter.</p>
              )}
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {!isDefault && items.map(r =>
                  r._kind === 'event'
                    ? <EventCard key={r.id} event={r} />
                    : <ProfileCard key={r.user_id} item={r} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


