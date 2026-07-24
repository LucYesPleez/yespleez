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
import { BAND_GENRES, SHARED_PERFORMANCE_TAGS, ROLE_TAGS } from '../lib/profileTaxonomy';
import { STATE_OPTIONS } from '../lib/auLocations';
import { trackFiltered } from '../lib/analytics';
import {
  RADIUS_STEPS, eventCoords, profileCoords, postcodeCoords, withinRadius,
} from '../lib/geo';
import { today, dateStr, weekendRange } from '../lib/dates';

// Venue-first, matching the shared canonical role order (PROFILE_TYPE_ORDER
// in profileTypes.js). 'event' isn't a profile role, so it stays last.
// Deliberate sentence-case renderings of PROFILE_TYPES' ALL-CAPS canonical
// labels — this filter row uses prose-style chips (DM Sans, not the Bebas
// Neue ALL-CAPS treatment badges/pills use elsewhere), so the words are kept
// in sync with canonical content by hand rather than mechanically
// upper/lower-cased (which would mangle the "DJ" acronym).
const TYPE_OPTIONS = [
  { value: 'venue',   label: 'Venue' },
  { value: 'host',    label: 'Host' },
  { value: 'artist',  label: 'DJ / Producer' },
  { value: 'band',    label: 'Band' },
  { value: 'standup', label: 'Comedy / Poetry' },
  { value: 'event',   label: 'Event' },
];

const GENRE_BY_TYPE = {
  artist:  ['Techno','House','Drum & Bass','Breaks','Trance','Psytrance','Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore','Ambient / Downtempo','Electronica','Funk / Soul / Disco','Hip-Hop','Reggae / Dancehall','World / Global','Experimental','Multi Genre'],
  band:    BAND_GENRES,
  standup: [...SHARED_PERFORMANCE_TAGS, ...Object.values(ROLE_TAGS).flat()],
  event:   ['Techno','House','Drum & Bass','Trance','Rock','Blues','Jazz','Hip-Hop','Comedy','Arts & Culture','Multi Genre'],
};

/**
 * DATE AND DISTANCE, APPLIED — the single source for both the screen and the
 * analytics count.
 *
 * ⚠ IT HAS TO BE ONE FUNCTION. The count reported to analytics must be the
 * number the user actually saw. When the render filtered and the analytics
 * reported `runSearch`'s raw total, a row read
 * `{radius_km: 50, results: 38}` while the screen showed a handful — the row
 * asserting that fifty kilometres returned thirty-eight results, which is
 * exactly the kind of plausible-and-wrong number this whole split exists to
 * prevent. Caught live, not by a test.
 *
 * Returns the survivors AND the unplaceable separately: a record with no
 * location is not far away, its distance is unknown, and the caller shows it
 * under its own heading rather than dropping it.
 */
function applyLocalFilters(rows, { dateFilter, radiusKm, originCoords, originPostcode }) {
  const dated = rows.filter(r => r._kind !== 'event' || matchesDate(r, dateFilter));
  if (!radiusKm) return { items: dated, unplaceable: [] };

  const near = [], unknown = [];
  for (const r of dated) {
    const coords = itemCoords(r);
    if (!coords) { unknown.push(r); continue; }
    if (withinRadius(originCoords, coords, radiusKm, originPostcode, itemPostcode(r))) near.push(r);
  }
  return { items: near, unplaceable: unknown };
}

/**
 * The postcode a typed location means, for use as a distance ORIGIN.
 *
 * Prefix matching is right for the search box (it narrows results while you
 * type) and wrong for an origin, where a half-typed word would silently place
 * the user in whichever suburb happens to sort first. So: a 4-digit postcode
 * passes through, a name must resolve, and anything ambiguous resolves to the
 * lowest matching code rather than an arbitrary one.
 */
function originFromText(input) {
  const t = String(input ?? '').trim();
  if (!t) return '';
  if (/^\d{4}$/.test(t)) return t;
  const codes = resolveLocationToPostcodes(t);
  return codes.length ? [...codes].sort()[0] : '';
}

/**
 * WHERE A RESULT IS — profiles and events answered by the same function.
 *
 * A profile carries its own location; an event borrows its venue's, falling
 * back to its own only when it has no venue (see geo.eventCoords). Keeping
 * both behind one call is what stops the two kinds drifting apart as filters
 * are added.
 */
function itemCoords(item) {
  return item._kind === 'event'
    ? eventCoords(item, item.venue)
    : profileCoords(item);
}

/** The postcode a result should be compared against for the radius-0 step. */
function itemPostcode(item) {
  if (item._kind !== 'event') return item.postcode;
  return item.venue_profile_id ? item.venue?.postcode : item.postcode;
}

/**
 * Does this event fall inside the chosen date window?
 *
 * Profiles have no date, so they are never date-filtered — see the note where
 * this is applied.
 */
function matchesDate(item, dateFilter) {
  if (!dateFilter) return true;
  const d = item.config?.date;
  if (!d) return false;                 // an undated event cannot match a date ask
  if (dateFilter === 'weekend') {
    const { from, to } = weekendRange();
    return d >= from && d <= to;
  }
  if (dateFilter === '7days')  return d >= today() && d <= dateStr(7);
  if (dateFilter === '30days') return d >= today() && d <= dateStr(30);
  return true;
}


async function fetchDefault() {
  const [profileRes, evRes] = await Promise.all([
    supabase.from('profiles')
      // M5: id included — cards navigate by the canonical profile.id, which is
      // what makes unclaimed profiles (user_id NULL) navigable at all. The
      // is_live filter hides only explicit false; NULL passes.
      // postcode/suburb/lat/lng are selected so the radius filter has something
      // to place a profile with — without them every record is unplaceable and
      // a distance filter empties the screen.
      .select('id, user_id, name, type, avatar, location, suburb, state, postcode, lat, lng, sound, genre_string, bio, updated_at')
      .in('type', ['artist','host','band','standup','venue'])
      .or('is_live.is.null,is_live.neq.false')
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase.from('events')
      // The embedded venue is how an event gets a location at all: the venue
      // owns it (docs/location-architecture-2026-07.md §4). `postcode`/`lat`
      // on the event itself are the venue-INDEPENDENT fallback — doofs,
      // showgrounds, multi-venue festivals — and are only read when there is
      // no venue link.
      .select('id, name, config, created_at, venue_profile_id, postcode, lat, lng, venue:venue_profile_id(postcode, state, lat, lng)')
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
  const profilesDrag = useDragScroll('discover-profiles');

  const radiusKm = RADIUS_STEPS[radiusIdx];
  const genreOptions = GENRE_BY_TYPE[type] || [...new Set(Object.values(GENRE_BY_TYPE).flat())].sort();
  const locationSuggestions = suggestLocations(postcode);

  /**
   * NEAR ME = the postcode the user already told us, NOT the GPS.
   *
   * Deliberate and ratified: no permission prompt, no battery drain, no
   * continuous tracking, and a result the user can predict. `_userPostcode` is
   * the same key My Scene's radius filter reads and writes, so the two screens
   * agree about where "here" is instead of each keeping their own idea.
   */
  const storedPostcode = (() => {
    try { return localStorage.getItem('_userPostcode') || ''; } catch { return ''; }
  })();

  // Typed location wins when present; Near Me falls back to the stored one.
  const originPostcode = nearMe ? storedPostcode : originFromText(postcode);
  const originCoords   = postcodeCoords(originPostcode);

  // ⚠ THE SLIDER'S FIRST STOP MEANS "ANY DISTANCE", NOT "0 KM".
  //
  // Everything here resolves to a postcode CENTROID, so a literal 0km test
  // would match only records sharing the exact same centroid — and 0 is also
  // the slider's default position, so treating it as a filter would silently
  // narrow every location search the moment someone typed a town. The radius
  // is therefore additive: it does nothing until the user moves it.
  const radiusActive = radiusIdx > 0 && originPostcode ? radiusKm : null;

  // Near Me with no stored postcode is a genuine dead end — say so rather than
  // quietly returning an unfiltered list that looks like it worked.
  const nearMeUnset = nearMe && !storedPostcode;

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
        .select('id, user_id, name, type, avatar, location, suburb, state, postcode, lat, lng, sound, genre_string, bio, venue_type, updated_at')
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
        // venue embedded for distance — see the note in fetchDefault
        .select('id, name, config, created_at, venue_profile_id, postcode, lat, lng, venue:venue_profile_id(postcode, state, lat, lng)')
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
    // The ROWS, not a count. The caller must run the same local filters the
    // screen runs before reporting a number, or the demand signal claims a
    // result set nobody saw — see applyLocalFilters.
    return all;
  }, []);

  // Debounce search when filters are active
  //
  // A3 · this is also the ONE place demand is recorded on this screen. It sits
  // here rather than inside runSearch because the intent-only filters
  // (dateFilter, nearMe) never reach runSearch — they are collected by the UI
  // and applied to nothing — so only this scope sees the complete ask. The
  // debounce means one row per settled input, not one per keystroke.
  //
  // The raw `query` and `postcode` are handed over deliberately: trackFiltered
  // derives has_query and a closed-vocabulary region from them and sends
  // neither string. See the note on its API.
  useEffect(() => {
    if (!isFiltered) { setSearchResults(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const rows = await runSearch(query, type, genre, state, postcode);
      // The same pipeline the screen renders, so the reported count is the
      // number the user actually saw.
      const { items: shown } = applyLocalFilters(rows, {
        dateFilter, radiusKm: radiusActive, originCoords, originPostcode,
      });
      // Discovery 2.1 · date/Near Me/radius now genuinely filter, so they are
      // reported as APPLIED. The `_intent` forms survive for exactly the cases
      // where the filter could not run — Near Me with no stored postcode, and
      // a date the user asked for while nothing was placeable. Sending both
      // forms for one facet is forbidden; each line below picks one.
      trackFiltered({
        surface: 'discover',
        query, type, genre, state, location: postcode,
        date:     dateFilter || undefined,
        nearMe:   nearMe && !nearMeUnset,
        radiusKm: radiusActive ?? undefined,
        nearMeIntent: nearMeUnset,
        results: shown.length,
      });
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query, type, genre, state, postcode, dateFilter, nearMe, radiusActive,
      originCoords, originPostcode, nearMeUnset, isFiltered, runSearch]);

  const loading  = isFiltered ? searching : defaultLoading;
  const rawItems = isFiltered ? (searchResults || []) : defaultItems;
  const isDefault = !isFiltered;

  /**
   * DATE AND DISTANCE, APPLIED CLIENT-SIDE — and the unplaceable kept.
   *
   * ⚠ AN UNPLACEABLE RESULT IS SHOWN, NOT DROPPED. Only 21 of 53 profiles
   * carry a postcode today, so a radius filter that silently discarded the
   * rest would hide most of the catalogue and read as "nothing on" rather than
   * "we don't know where these are". They are separated into their own
   * labelled section instead — the app never pretends to know a location it
   * does not have, and the gap stays visible to whoever can fix the data.
   *
   * Date applies to EVENTS ONLY. A profile has no date, so date-filtering one
   * would mean inventing a rule ("is this DJ available?") that no data
   * supports — a different feature, and one the availability calendar owns.
   */
  const { items, unplaceable } = applyLocalFilters(rawItems, {
    dateFilter, radiusKm: radiusActive, originCoords, originPostcode,
  });

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
              {/* The dead end, named. Near Me needs a postcode we have never
                  been given, and silence here would look like a broken filter. */}
              {nearMeUnset && (
                <p className={s.hint} style={{ margin: '6px 0 0' }}>
                  Add your postcode in My Scene to use Near me.
                </p>
              )}
              <div className={s.radiusRow}>
                <span className={s.radiusLabel}>RADIUS</span>
                {/* 0 is the slider's resting position, so it must read as "off",
                    not as a 0km filter nobody asked for. */}
                <span className={s.radiusValue}>{radiusKm === 0 ? 'Any distance' : `${radiusKm} km`}</span>
              </div>
              {radiusIdx > 0 && !originPostcode && (
                <p className={s.hint} style={{ margin: '6px 0 0' }}>
                  Enter a town or postcode to filter by distance.
                </p>
              )}
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
              <button className={s.sheetClear} onClick={() => { setType(''); setGenre(''); setState(''); setPostcode(''); setNearMe(false); setDateFilter(''); setRadiusIdx(0); }}>Reset all</button>
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
                    <div className={s.sectionHead}>RECENTLY ADDED EVENTS</div>
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

              {/* ⚠ SHOWN, NOT HIDDEN.
                  These matched every other filter but carry no location, so
                  the distance test could not be applied to them. Dropping them
                  would be the app claiming they are far away — which it does
                  not know. Saying so keeps the result honest and makes the
                  missing data visible to whoever can fill it in. */}
              {!isDefault && unplaceable.length > 0 && (
                <>
                  <div className={s.sectionRow} style={{ marginTop: 20 }}>
                    <div className={s.sectionHead}>LOCATION UNAVAILABLE</div>
                    <div className={s.gradientLine} />
                  </div>
                  <p className={s.hint} style={{ margin: '0 0 8px' }}>
                    {unplaceable.length} {unplaceable.length === 1 ? 'result has' : 'results have'} no
                    location set, so {unplaceable.length === 1 ? 'it' : 'they'} can’t be matched to your distance filter.
                  </p>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {unplaceable.slice(0, 10).map(r =>
                      r._kind === 'event'
                        ? <EventCard key={r.id} event={r} />
                        : <ProfileCard key={r.id ?? r.user_id} item={r} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


