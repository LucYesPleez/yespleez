import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import EventCard from '../components/EventCard';
import FeaturedEventCard from '../components/FeaturedEventCard';
import PortraitCard from '../components/PortraitCard';
import { SkeletonRow, SkeletonEventCard } from '../components/Skeleton';
import s from './MySceneScreen.module.css';
import { useDragScroll } from '../hooks/useDragScroll';
import AU_POSTCODES from '../lib/postcodes';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';

let _discoverCache = [];

const TYPE_COLORS = { artist:'#00E5FF', band:'#FF8C42', venue:'#00E5A0', standup:'#FF88AA', host:'#FF3399', event:'#BF5FFF' };
const TYPE_LABELS = { artist:'DJ / PRODUCER', band:'BAND', venue:'VENUE', standup:'COMEDY', host:'PROMOTER', event:'EVENT' };
const TYPE_UPDATES = { artist:'Updated their profile', venue:'Updated event listings', host:'Updated their events', band:'Updated their profile', standup:'Updated their profile' };

function timeAgo(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`;
}

const DEMO_UPCOMING = [
  { name:'Friends of Owl',    venue:'Bellingen Brewery', badge:'ATTENDING', badgeColor:'#FF2D78', dayName:'SUN', dayNum:14, mon:'JUN', timeStr:'8:00 PM' },
  { name:'Subsonic Sessions', venue:'The Loft',          badge:'MY EVENT',  badgeColor:'#9D4EDD', dayName:'FRI', dayNum:20, mon:'JUN', timeStr:'10:00 PM' },
  { name:'Lucious',           venue:'The Basement',      badge:'PLAYING',   badgeColor:'#BF5FFF', dayName:'SAT', dayNum:28, mon:'JUN', timeStr:'11:30 PM' },
];
const DEMO_FOLLOWING = [
  { name:'Lucious',              type:'artist', update:'Added a new show',    ago:'2h ago' },
  { name:'Bellingen Brewery',    type:'venue',  update:'Updated their event', ago:'6h ago' },
  { name:'Deliverance Festival', type:'host',   update:'Released set times',  ago:'12h ago' },
];

export default function MySceneScreen({ isGuest, onSignOut }) {
  const navigate = useNavigate();
  const { session } = useSession();

  // Date strip state
  const [viewMonth,  setViewMonth]  = useState(new Date());
  const [selDate,    setSelDate]    = useState(null);
  const [showEdit,   setShowEdit]   = useState(false);
  const [editName,   setEditName]   = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Add personal event sheet
  const [showAddEvent,    setShowAddEvent]    = useState(false);

  // Month picker
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear,      setPickerYear]      = useState(() => new Date().getFullYear());
  const [pickerMonth,     setPickerMonth]     = useState(() => new Date().getMonth());
  const [addEventDate,    setAddEventDate]    = useState('');
  const [addEventTitle,   setAddEventTitle]   = useState('');
  const [addEventTime,    setAddEventTime]    = useState('');
  const [addEventNotes,   setAddEventNotes]   = useState('');
  const [addEventPrivate, setAddEventPrivate] = useState(true);
  const [addEventSaving,  setAddEventSaving]  = useState(false);
  const [dayArtists,       setDayArtists]       = useState([]);
  const [discoverProfiles, setDiscoverProfiles] = useState(_discoverCache);
  const [profileName,    setProfileName]    = useState('');
  const [profileConfig,  setProfileConfig]  = useState({});
  const [updatedFollows, setUpdatedFollows] = useState([]);
  const [followProfiles, setFollowProfiles] = useState({});
  const [followAvatars,  setFollowAvatars]  = useState({});
  const [followTab,       setFollowTab]       = useState('following');
  const [followRoleFilter,setFollowRoleFilter] = useState(null);
  const [followShowAll,   setFollowShowAll]   = useState(false);
  const [followSearch,    setFollowSearch]    = useState('');
  const [followRadius,    setFollowRadius]    = useState(null);
  const [userPostcode,    setUserPostcode]    = useState(() => localStorage.getItem('_userPostcode') || '');
  const [savedTab,        setSavedTab]        = useState('saved');
  const [savedLimit,      setSavedLimit]      = useState(3);
  const [pastLimit,       setPastLimit]       = useState(3);
  const [eventsExpanded,  setEventsExpanded]  = useState(false);
  const [pastEventSearch, setPastEventSearch] = useState('');
  const upcomingRef = useRef(null);

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function profileCoords(p) {
    if (p.lat && p.lng) return { lat: p.lat, lng: p.lng };
    if (p.postcode) {
      const c = AU_POSTCODES[String(p.postcode)];
      return c ? { lat: c[0], lng: c[1] } : null;
    }
    return null;
  }

  function postcodeCoords(pc) {
    if (!pc) return null;
    const c = AU_POSTCODES[String(pc)];
    return c ? { lat: c[0], lng: c[1] } : null;
  }
  const discoverDrag   = useDragScroll('myscene-discover-strip');
  const stripDrag      = useDragScroll('myscene-date-strip');
  const stripRef       = stripDrag.ref;
  const updatesDrag    = useDragScroll('myscene-updated-follows');
  const followingDrag  = useDragScroll('myscene-following');

  const uid = session?.user?.id;
  const queryClient = useQueryClient();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['myScene', uid],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
        const [fRes, aRes, myEvRes, profRes, claimsRes, peRes] = await Promise.all([
        supabase.from('follows').select('entity_id,entity_type,entity_name,created_at,target_profile_id').eq('user_id', uid).order('created_at', { ascending: false }),
        supabase.from('applications').select('event_id,status').eq('artist_id', uid),
        supabase.from('events').select('id,name,config,created_at').eq('host_id', uid).order('created_at', { ascending: false }),
        supabase.from('profiles').select('name').eq('user_id', uid).eq('type', 'punter').limit(1),
        supabase.from('lineup_members').select('event_id').eq('artist_id', uid).neq('status', 'removed'),
        supabase.from('personal_events').select('*').eq('user_id', uid),
      ]);

      const follows    = fRes.data    || [];
      const apps       = aRes.data    || [];
      const claimsData = claimsRes.data || [];

      // IDs needed for step 2
      // M5.1 (D5): followed profiles resolve by target_profile_id; the legacy
      // entity_id join is kept only for rows without one.
      const profileFollows   = follows.filter(f => f.entity_type !== 'event');
      const followedPids     = [...new Set(profileFollows.filter(f => f.target_profile_id).map(f => f.target_profile_id))];
      const legacyFollowIds  = [...new Set(profileFollows.filter(f => !f.target_profile_id).map(f => f.entity_id).filter(Boolean))];
      const followedEventIds = new Set(follows.filter(f => f.entity_type === 'event').map(f => f.entity_id));
      const claimEventIds    = [...new Set(claimsData.map(c => c.event_id).filter(Boolean))];
      const appEventIds      = [...new Set(apps.map(a => a.event_id).filter(Boolean))];

      // Step 2: parallel fetches — date-windowed events (indexed, ~50 rows)
      const threeMonthsAgo = new Date(Date.now() - 90  * 86400000).toISOString().slice(0, 10);
      const sixMonthsAhead = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
      const followCols = 'id,user_id,name,type,location,suburb,postcode,lat,lng,sound,updated_at';
      const [evRes, profFollowRes, legacyFollowRes, claimEvRes] = await Promise.all([
        supabase.from('events').select('id,name,config,host_id,created_at').gte('config->>date', threeMonthsAgo).lte('config->>date', sixMonthsAhead).order('config->>date', { ascending: true }).limit(150),
        followedPids.length
          ? supabase.from('profiles').select(followCols).in('id', followedPids)
          : Promise.resolve({ data: [] }),
        legacyFollowIds.length
          ? supabase.from('profiles').select(followCols).in('user_id', legacyFollowIds)
          : Promise.resolve({ data: [] }),
        claimEventIds.length
          ? supabase.from('events').select('id,name,config').in('id', claimEventIds)
          : Promise.resolve({ data: [] }),
      ]);

      // Build follow profiles map and detect updates. The map stays keyed by
      // f.entity_id — the renderer's lookup key (M5.1 §3.2 discipline).
      const pidProfiles    = profFollowRes.data || [];
      const legacyProfiles = legacyFollowRes.data || [];
      const rawProfiles    = [...pidProfiles, ...legacyProfiles];
      const followedById = {};
      pidProfiles.forEach(p => { followedById[p.id] = p; });
      const legacyByUid = {};
      legacyProfiles.forEach(p => {
        if (!legacyByUid[p.user_id] || p.type !== 'punter') legacyByUid[p.user_id] = p;
      });
      const followProfileMap = {};
      profileFollows.forEach(f => {
        const p = f.target_profile_id ? followedById[f.target_profile_id] : legacyByUid[f.entity_id];
        if (p) followProfileMap[f.entity_id] = p;
      });
      const lastVisited    = localStorage.getItem('_mySceneLastVisited');
      const updatedFollows = lastVisited ? rawProfiles.filter(p => p.updated_at > lastVisited) : [];
      localStorage.setItem('_mySceneLastVisited', new Date().toISOString());

      return {
        follows,
        apps,
        events:         evRes.data || [],
        myEvents:       myEvRes.data || [],
        punterName:     profRes.data?.[0]?.name || '',
        personalEvents: peRes.data   || [],
        playingEvents:  claimEvRes.data || [],
        followProfiles: followProfileMap,
        updatedFollows,
      };
    },
    enabled: !!uid,
  });

  const follows        = data?.follows        || [];
  const apps           = data?.apps           || [];
  const events         = data?.events         || [];
  const myEvents       = data?.myEvents       || [];
  const playingEvents  = data?.playingEvents  || [];
  const personalEvents = data?.personalEvents || [];

  // Sync profileName from query result
  useEffect(() => {
    if (data?.punterName) setProfileName(data.punterName);
  }, [data?.punterName]);

  // Sync followProfiles + updatedFollows from query result (computed inside queryFn)
  useEffect(() => {
    if (!data) return;
    if (data.followProfiles) setFollowProfiles(data.followProfiles);
    if (data.updatedFollows) setUpdatedFollows(data.updatedFollows);
  }, [data]);

  // Lazy-load avatars for followed profiles after main data is ready.
  // M5.1 (D5): fetch by the resolved profiles' own ids; the avatar map stays
  // keyed by user_id — the consumers' lookup key.
  useEffect(() => {
    if (!data?.followProfiles) return;
    const pids = [...new Set(Object.values(data.followProfiles).map(p => p.id).filter(Boolean))];
    if (!pids.length) return;
    supabase.from('profiles').select('id,user_id,avatar').in('id', pids).then(({ data: rows }) => {
      if (!rows) return;
      const map = {};
      rows.forEach(r => { if (r.avatar) map[r.user_id] = r.avatar; });
      setFollowAvatars(map);
    });
  }, [data?.followProfiles]);

  // Scroll today into view on mount
  useEffect(() => {
    if (!stripRef.current) return;
    const today = new Date().getDate();
    const pills = stripRef.current.children;
    if (pills[today - 1]) {
      setTimeout(() => pills[today - 1].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 100);
    }
  }, [viewMonth, loading]);

  const displayName = profileName || session?.user?.user_metadata?.name || (loading ? '' : session?.user?.email?.split('@')[0] || 'MY PROFILE');

  // Which events have a config.date
  const datedEvents = events.filter(ev => ev.config?.date);

  // Days in this month that have events
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Followed event IDs
  const followedEventIds = new Set(follows.filter(f => f.entity_type === 'event').map(f => f.entity_id));

  // App map
  const appMap = {};
  apps.forEach(a => { appMap[a.event_id] = a.status; });

  // Which days have events
  const eventDaySet = new Set();
  const sceneDaySet = new Set();
  datedEvents.forEach(ev => {
    const ds = ev.config.date;
    if (ds.slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}`) {
      const day = parseInt(ds.slice(8, 10));
      eventDaySet.add(day);
      if (followedEventIds.has(ev.id) || appMap[ev.id]) sceneDaySet.add(day);
    }
  });
  // Personal events always get a scene dot
  personalEvents.forEach(pe => {
    const ds = pe.event_date;
    if (ds && ds.slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}`) {
      sceneDaySet.add(parseInt(ds.slice(8, 10)));
    }
  });

  // All events I'm involved in
  const attendingEvents  = datedEvents.filter(ev => followedEventIds.has(ev.id) && ev.config?.date >= todayStr);

  // Featured event: manual pin → playing → hosting → attending (all by nearest date)
  const upcomingHosted    = myEvents.filter(ev => ev.config?.date >= todayStr).sort((a,b) => a.config.date.localeCompare(b.config.date));
  const upcomingPlaying   = playingEvents.filter(ev => ev.config?.date >= todayStr).sort((a,b) => a.config.date.localeCompare(b.config.date));
  const upcomingAttending = attendingEvents.sort((a,b) => a.config.date.localeCompare(b.config.date));

  const pinnedId = profileConfig?.featured_event_id;
  const pinnedEvent = pinnedId
    ? [...myEvents, ...playingEvents, ...datedEvents].find(ev => ev.id === pinnedId && ev.config?.date >= todayStr)
    : null;

  const featuredEvent = pinnedEvent || upcomingPlaying[0] || upcomingHosted[0] || upcomingAttending[0] || null;
  const featuredLabel = pinnedEvent ? 'FEATURED'
    : upcomingPlaying[0]   ? 'PLAYING'
    : upcomingHosted[0]    ? 'MY EVENT'
    : 'ATTENDING';

  // Feed sections
  const twoWeeksStr = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const upcomingForYou = [];
  const seen = new Set();

  // ATTENDING: followed events within next 2 weeks
  datedEvents.forEach(ev => {
    const d = ev.config?.date;
    if (followedEventIds.has(ev.id) && d && d >= todayStr && d <= twoWeeksStr && !seen.has(ev.id)) {
      seen.add(ev.id);
      upcomingForYou.push({ ev, badge: 'ATTENDING', badgeColor: '#FF2D78' });
    }
  });

  // MY EVENT: hosted events within next 2 weeks
  myEvents.forEach(ev => {
    const d = ev.config?.date;
    if (d && d >= todayStr && d <= twoWeeksStr && !seen.has(ev.id)) {
      seen.add(ev.id);
      upcomingForYou.push({ ev, badge: 'MY EVENT', badgeColor: '#9D4EDD' });
    }
  });

  // PLAYING: accepted applications within next 2 weeks
  datedEvents.forEach(ev => {
    const d = ev.config?.date;
    if (appMap[ev.id] === 'accepted' && d && d >= todayStr && d <= twoWeeksStr && !seen.has(ev.id)) {
      seen.add(ev.id);
      upcomingForYou.push({ ev, badge: 'PLAYING', badgeColor: 'var(--neon2)' });
    }
  });

  upcomingForYou.sort((a, b) => (a.ev.config?.date || '').localeCompare(b.ev.config?.date || ''));

  // SAVED EVENTS: followed/hosted/played events beyond 2 weeks
  const savedEventsSet = new Set();
  const savedEvents = [];
  [...datedEvents, ...myEvents].forEach(ev => {
    const d = ev.config?.date;
    if (!d || savedEventsSet.has(ev.id)) return;
    const isAttending = followedEventIds.has(ev.id);
    const isHosted    = myEvents.some(m => m.id === ev.id);
    const isPlaying   = appMap[ev.id] === 'accepted';
    if ((isAttending || isHosted || isPlaying) && d >= todayStr && d > twoWeeksStr) {
      savedEventsSet.add(ev.id);
      savedEvents.push({ ev, badge: isHosted ? 'MY EVENT' : isPlaying ? 'PLAYING' : 'ATTENDING', badgeColor: isHosted ? '#9D4EDD' : isPlaying ? 'var(--neon2)' : '#FF2D78' });
    }
  });
  savedEvents.sort((a, b) => (a.ev.config?.date || '').localeCompare(b.ev.config?.date || ''));

  // PAST EVENTS: attended/hosted/played events before today
  const pastEventsSet = new Set();
  const pastEvents = [];
  [...datedEvents, ...myEvents].forEach(ev => {
    const d = ev.config?.date;
    if (!d || pastEventsSet.has(ev.id)) return;
    const isAttending = followedEventIds.has(ev.id);
    const isHosted    = myEvents.some(m => m.id === ev.id);
    const isPlaying   = appMap[ev.id] === 'accepted';
    if ((isAttending || isHosted || isPlaying) && d < todayStr) {
      pastEventsSet.add(ev.id);
      pastEvents.push({ ev, badge: isHosted ? 'MY EVENT' : isPlaying ? 'PLAYED' : 'ATTENDED', badgeColor: isHosted ? '#9D4EDD' : isPlaying ? 'var(--neon2)' : '#FF2D78' });
    }
  });
  pastEvents.sort((a, b) => (b.ev.config?.date || '').localeCompare(a.ev.config?.date || ''));
  const filteredPastEvents = filterPastEvents(pastEvents, pastEventSearch);

  // Events for selected day
  const dayEvents = selDate ? datedEvents.filter(ev => ev.config?.date === selDate) : [];
  const dayPersonalEvents = selDate ? personalEvents.filter(pe => pe.event_date === selDate) : [];

  // Profile follows
  const profileFollows = follows.filter(f => f.entity_type !== 'event');
  const availableTypes = [...new Set(profileFollows.map(f => f.entity_type).filter(Boolean))];
  const filteredFollows = followRoleFilter
    ? profileFollows.filter(f => f.entity_type === followRoleFilter)
    : profileFollows;

  function prevMonth() {
    setSelDate(null);
    setViewMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setSelDate(null);
    setViewMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  function selectDate(ds) {
    const next = selDate === ds ? null : ds;
    setSelDate(next);
    if (next) {
      loadDayArtists(next);
      const dayEvs = datedEvents.filter(ev => ev.config?.date === ds);
      if (!dayEvs.length) loadDiscoverProfiles();
      else setDiscoverProfiles([]);
    } else {
      setDayArtists([]);
      setDiscoverProfiles([]);
    }
  }

  async function loadDiscoverProfiles() {
    if (_discoverCache.length) return;
    const { data } = await supabase.from('profiles')
      .select('user_id, name, type, avatar, location, suburb, sound, genre_string')
      .in('type', ['artist','host','band','standup','venue'])
      .order('updated_at', { ascending: false })
      .limit(10);
    _discoverCache = data || [];
    setDiscoverProfiles(_discoverCache);
  }

  async function loadDayArtists(dateStr) {
    setDayArtists([]);
    const dayEvs = datedEvents.filter(ev => ev.config?.date === dateStr);
    if (!dayEvs.length) return;
    const evIds = dayEvs.map(ev => ev.id);
    const { data: membersData } = await supabase.from('lineup_members').select('event_id, artist_name, genre, sound, artist_id, artist_profile_id').in('event_id', evIds).neq('status', 'removed');
    if (!membersData?.length) return;
    // M5.1 (D8): avatars resolve by artist_profile_id; legacy artist_id join
    // only for rows without one.
    const pidMs = membersData.filter(c => c.artist_profile_id);
    const uidMs = membersData.filter(c => !c.artist_profile_id && c.artist_id);
    const [aPid, aUid] = await Promise.all([
      pidMs.length ? supabase.from('profiles').select('id, user_id, avatar').in('id', pidMs.map(c => c.artist_profile_id)) : Promise.resolve({ data: [] }),
      uidMs.length ? supabase.from('profiles').select('id, user_id, avatar').in('user_id', uidMs.map(c => c.artist_id)) : Promise.resolve({ data: [] }),
    ]);
    const avById = {}; (aPid.data || []).forEach(p => { avById[p.id] = p; });
    const avByUid = {}; (aUid.data || []).forEach(p => { avByUid[p.user_id] = p; });
    const profFor = c => (c.artist_profile_id ? avById[c.artist_profile_id] : avByUid[c.artist_id]) || null;
    const evMap = {};
    dayEvs.forEach(ev => { evMap[ev.id] = ev.name; });
    setDayArtists(membersData.map(c => ({
      name: c.artist_name, genre: c.genre, sound: c.sound,
      avatar: profFor(c)?.avatar, eventName: evMap[c.event_id],
    })));
  }

  function openAddEvent(date) {
    setAddEventDate(date || todayStr);
    setAddEventTitle('');
    setAddEventTime('');
    setAddEventNotes('');
    setAddEventPrivate(true);
    setShowAddEvent(true);
  }

  async function savePersonalEvent() {
    if (!addEventTitle.trim() || !uid || addEventSaving) return;
    setAddEventSaving(true);
    await supabase.from('personal_events').insert({
      user_id:    uid,
      title:      addEventTitle.trim(),
      event_date: addEventDate,
      time_start: addEventTime || null,
      notes:      addEventNotes.trim() || null,
      is_private: addEventPrivate,
    });
    setAddEventSaving(false);
    setShowAddEvent(false);
    queryClient.invalidateQueries({ queryKey: ['myScene', uid] });
  }

  async function saveProfile() {
    if (!session?.user?.id || !editName.trim()) return;
    setEditSaving(true);
    await supabase.from('profiles').upsert({ user_id: session.user.id, type: 'punter', name: editName.trim() }, { onConflict: 'user_id,type' });
    setProfileName(editName.trim());
    setShowEdit(false);
    setEditSaving(false);
  }

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <div>
          <div className={s.title}>MY SCENE</div>
          <div className={s.sub}>Your gigs · Your artists · Your world</div>
        </div>
        {session && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div className={s.profilePill} onClick={() => { setEditName(profileName); setShowEdit(true); }} style={{ cursor: 'pointer' }}>
              <div className={s.profileIcon}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/>
                </svg>
              </div>
              <span className={s.profileName}>{displayName.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', paddingRight: 2 }}>{session.user.email}</div>
          </div>
        )}
      </div>

      {/* Guest gate */}
      {(isGuest || !session) && (
        <div className={s.guestGate}>
          <div className={s.gateIcon}>⭐</div>
          <h2 className={s.gateTitle}>YOUR SCENE AWAITS</h2>
          <p className={s.gateSub}>Sign in to save events, follow artists and build your scene.</p>
          <button className={s.gateBtn} onClick={onSignOut}>SIGN IN / CREATE ACCOUNT</button>
        </div>
      )}

      {/* Date strip — always visible, dots populate once data arrives */}
      {session && !isGuest && (
        <div className={s.dateStripWrap}>
          <div className={s.dateStripTop}>
            <button className={s.monthLabel} onClick={() => { setPickerYear(viewMonth.getFullYear()); setPickerMonth(viewMonth.getMonth()); setMonthPickerOpen(true); }}>
              <span>{viewMonth.toLocaleString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div className={s.monthNav}>
              <button className={s.navBtn} onClick={prevMonth}>←</button>
              <button className={s.navBtn} onClick={nextMonth}>→</button>
              {!loading && (
                <button className={s.addBtn} onClick={() => openAddEvent(selDate || todayStr)} title="Add to your scene">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className={s.strip} ref={stripDrag.ref} onMouseDown={stripDrag.onMouseDown} onMouseMove={stripDrag.onMouseMove} onMouseUp={stripDrag.onMouseUp} onMouseLeave={stripDrag.onMouseLeave}>
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const ds  = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = ds === todayStr;
              const isSel   = ds === selDate;
              const hasEvs  = eventDaySet.has(day);
              const isScene = sceneDaySet.has(day);
              const dow = ['S','M','T','W','T','F','S'][new Date(ds).getDay()];
              const dotColor = isSel ? '#fff' : '#FF2D78';
              return (
                <button key={ds} className={s.dayPill + (isSel ? ' ' + s.dayPillSel : isToday ? ' ' + s.dayPillToday : '')}
                  onClick={() => !loading && selectDate(ds)}>
                  <div className={s.dayName}>{dow}</div>
                  <div className={s.dayNum}>{day}</div>
                  {(hasEvs || isScene)
                    ? <div className={s.dot} style={{ background: dotColor }} />
                    : <div className={s.dotEmpty} />
                  }
                </button>
              );
            })}
          </div>
        </div>
      )}

      {session && loading && (
        <div style={{ padding:'14px 16px 20px', maxWidth:680, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <div className={s.sectionHead}>FEATURED EVENT</div>
            <div className={s.gradientLine} />
          </div>
          <SkeletonEventCard />
          <div className={s.v1Section} style={{ marginTop:24 }}>
            <div className={s.v1Head}>
              <div className={s.sectionHead}>UPCOMING FOR YOU</div>
              <div className={s.gradientLine} />
            </div>
            <div style={{ marginTop:10 }}>
              {[0,1,2].map(i => <SkeletonRow key={i} />)}
            </div>
          </div>
          <div className={s.v1Section}>
            <div className={s.v1Head}>
              <div className={s.sectionHead}>FOLLOWING</div>
              <div className={s.gradientLine} />
            </div>
            <div style={{ marginTop:10 }}>
              {[0,1].map(i => <SkeletonRow key={i} />)}
            </div>
          </div>
        </div>
      )}

      {/* Profile edit sheet */}
      {showEdit && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 600 }} onClick={() => setShowEdit(false)} />
          <div style={{ position: 'fixed', bottom: 'var(--yp-safe-bottom)', left: '50%', transform: 'translateX(-50%)', width: 'min(100%, 680px)', background: 'var(--card)', borderRadius: '18px 18px 0 0', padding: '20px 20px 24px', zIndex: 601 }}>
            <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 20px' }} />
            <p style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)', marginBottom: 16 }}>EDIT PROFILE</p>
            <label style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1, fontFamily: "'Bebas Neue'", display: 'block', marginBottom: 6 }}>DISPLAY NAME</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Your name or username"
              style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)', fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
            />
            <button
              onClick={saveProfile}
              disabled={editSaving || !editName.trim()}
              style={{ width: '100%', background: '#BF5FFF', color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2, padding: 14, borderRadius: 10, opacity: editSaving ? .6 : 1 }}
            >
              {editSaving ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </>
      )}

      {/* Add personal event sheet */}
      {showAddEvent && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', zIndex:10000 }} onClick={() => setShowAddEvent(false)} />
          <div style={{ position:'fixed', bottom:'var(--yp-safe-bottom)', left:'50%', transform:'translateX(-50%)', width:'min(100%,476px)', background:'var(--card)', borderRadius:'18px 18px 0 0', padding:'20px 20px 24px', zIndex:10001, boxSizing:'border-box' }}>
            {/* Drag handle */}
            <div style={{ width:36, height:4, background:'var(--border)', borderRadius:2, margin:'0 auto 20px' }} />

            <p style={{ fontFamily:"'Bebas Neue'", fontSize:20, letterSpacing:2.5, color:'var(--text)', marginBottom:4 }}>ADD TO YOUR SCENE</p>
            <p style={{ fontSize:11, color:'#BF5FFF', fontFamily:"'Bebas Neue'", letterSpacing:1.5, marginBottom:20 }}>
              {new Date(addEventDate + 'T12:00:00').toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase()}
            </p>

            <label style={{ fontSize:11, color:'var(--muted)', letterSpacing:1, fontFamily:"'Bebas Neue'", display:'block', marginBottom:6 }}>WHAT'S HAPPENING?</label>
            <input
              value={addEventTitle}
              onChange={e => setAddEventTitle(e.target.value)}
              placeholder="e.g. Night out, Birthday, Gig with mates"
              autoFocus
              style={{ width:'100%', background:'var(--card2)', border:'1px solid var(--neon2)', borderRadius:10, padding:'12px 14px', color:'var(--text)', fontSize:14, outline:'none', boxSizing:'border-box', marginBottom:14 }}
            />

            <label style={{ fontSize:11, color:'var(--muted)', letterSpacing:1, fontFamily:"'Bebas Neue'", display:'block', marginBottom:6 }}>TIME <span style={{ opacity:.5 }}>(OPTIONAL)</span></label>
            <input
              type="time"
              value={addEventTime}
              onChange={e => setAddEventTime(e.target.value)}
              style={{ width:'100%', background:'var(--card2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', color:'var(--text)', fontSize:14, outline:'none', boxSizing:'border-box', marginBottom:14 }}
            />

            <label style={{ fontSize:11, color:'var(--muted)', letterSpacing:1, fontFamily:"'Bebas Neue'", display:'block', marginBottom:6 }}>NOTES <span style={{ opacity:.5 }}>(OPTIONAL)</span></label>
            <textarea
              value={addEventNotes}
              onChange={e => setAddEventNotes(e.target.value)}
              placeholder="Any details, venue, who's coming…"
              rows={3}
              style={{ width:'100%', background:'var(--card2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', color:'var(--text)', fontSize:14, outline:'none', boxSizing:'border-box', resize:'none', marginBottom:14 }}
            />

            {/* Private — bordered card */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:'1px solid var(--border)', borderRadius:12, padding:'12px 14px', marginBottom:20 }}>
              <div>
                <p style={{ fontFamily:"'Bebas Neue'", fontSize:15, letterSpacing:1, color:'var(--text)' }}>PRIVATE</p>
                <p style={{ fontSize:11, color:'var(--muted)', marginTop:1 }}>Only you can see this</p>
              </div>
              <button
                onClick={() => setAddEventPrivate(v => !v)}
                style={{ width:50, height:28, borderRadius:14, border:'none', cursor:'pointer', position:'relative', background: addEventPrivate ? '#BF5FFF' : 'var(--card2)', transition:'background .2s', flexShrink:0 }}
              >
                <span style={{ position:'absolute', top:3, left: addEventPrivate ? 24 : 3, width:22, height:22, borderRadius:'50%', background:'#fff', transition:'left .2s' }} />
              </button>
            </div>

            <button
              onClick={savePersonalEvent}
              disabled={addEventSaving}
              style={{
                width:'100%', border:'none', borderRadius:12, padding:16,
                background:'linear-gradient(135deg,#00E5FF,#BF5FFF)',
                color:'#fff', fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:2, cursor:'pointer',
                opacity: addEventSaving ? .6 : 1,
              }}
            >
              {addEventSaving ? 'SAVING…' : 'SAVE TO YOUR SCENE →'}
            </button>
          </div>
        </>
      )}

      {/* Month picker */}
      {monthPickerOpen && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:600 }} onClick={() => setMonthPickerOpen(false)} />
          <div style={{ position:'fixed', bottom:'var(--yp-safe-bottom)', left:'50%', transform:'translateX(-50%)', width:'min(100%,480px)', background:'var(--card)', borderRadius:'18px 18px 0 0', padding:'16px 20px 20px', zIndex:601, boxSizing:'border-box' }}>
            <div style={{ width:36, height:4, background:'var(--border)', borderRadius:2, margin:'0 auto 16px' }} />

            {/* Month/year selects */}
            <div style={{ display:'flex', gap:8, marginBottom:14 }}>
              <select value={pickerMonth} onChange={e => setPickerMonth(+e.target.value)}
                style={{ flex:2, background:'var(--card2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', color:'var(--text)', fontSize:15, outline:'none', fontFamily:"'Bebas Neue', sans-serif", letterSpacing:'1px', appearance:'none' }}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((mn,i) => <option key={i} value={i}>{mn}</option>)}
              </select>
              <select value={pickerYear} onChange={e => setPickerYear(+e.target.value)}
                style={{ flex:'0 0 100px', background:'var(--card2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', color:'var(--text)', fontSize:15, outline:'none', fontFamily:"'Bebas Neue', sans-serif", letterSpacing:'1px', appearance:'none' }}>
                {[2024,2025,2026,2027,2028].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Prev / label / Next */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <button onClick={() => { if (pickerMonth===0){setPickerMonth(11);setPickerYear(py=>py-1);}else setPickerMonth(pm=>pm-1); }}
                style={{ background:'var(--card2)', border:'1px solid var(--border)', borderRadius:8, width:36, height:36, color:'var(--text)', cursor:'pointer', fontSize:16 }}>←</button>
              <span style={{ fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:2, color:'#BF5FFF' }}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'][pickerMonth]} {pickerYear}
              </span>
              <button onClick={() => { if (pickerMonth===11){setPickerMonth(0);setPickerYear(py=>py+1);}else setPickerMonth(pm=>pm+1); }}
                style={{ background:'var(--card2)', border:'1px solid var(--border)', borderRadius:8, width:36, height:36, color:'var(--text)', cursor:'pointer', fontSize:16 }}>→</button>
            </div>

            {/* Day-of-week headers */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', textAlign:'center', marginBottom:4 }}>
              {['S','M','T','W','T','F','S'].map((d,i) => (
                <div key={i} style={{ fontFamily:"'Bebas Neue'", fontSize:12, color:'var(--muted)', letterSpacing:1, padding:'4px 0' }}>{d}</div>
              ))}
            </div>

            {/* Date grid */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
              {(() => {
                const pickerMonthStr = `${pickerYear}-${String(pickerMonth+1).padStart(2,'0')}`;
                // Compute scene dots for picker month dynamically
                const pickerSceneDays = new Set();
                datedEvents.forEach(ev => {
                  if (ev.config?.date?.startsWith(pickerMonthStr) && (followedEventIds.has(ev.id) || appMap[ev.id])) {
                    pickerSceneDays.add(parseInt(ev.config.date.slice(8,10)));
                  }
                });
                myEvents.forEach(ev => {
                  if (ev.config?.date?.startsWith(pickerMonthStr)) pickerSceneDays.add(parseInt(ev.config.date.slice(8,10)));
                });
                personalEvents.forEach(pe => {
                  if (pe.event_date?.startsWith(pickerMonthStr)) pickerSceneDays.add(parseInt(pe.event_date.slice(8,10)));
                });
                const pickerEventDays = new Set();
                datedEvents.forEach(ev => {
                  if (ev.config?.date?.startsWith(pickerMonthStr)) pickerEventDays.add(parseInt(ev.config.date.slice(8,10)));
                });

                const firstDay = new Date(pickerYear, pickerMonth, 1).getDay();
                const daysInPicker = new Date(pickerYear, pickerMonth+1, 0).getDate();
                const cells = [];
                for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
                for (let d = 1; d <= daysInPicker; d++) {
                  const iso = `${pickerMonthStr}-${String(d).padStart(2,'0')}`;
                  const isToday = iso === todayStr;
                  const isSel   = iso === selDate;
                  const isScene = pickerSceneDays.has(d);
                  const hasEvs  = pickerEventDays.has(d);
                  const dotColor = isSel ? '#fff' : '#FF2D78';
                  cells.push(
                    <button key={d}
                      onClick={() => {
                        setSelDate(iso);
                        setViewMonth(new Date(pickerYear, pickerMonth, 1));
                        setMonthPickerOpen(false);
                        loadDayArtists(iso);
                      }}
                      style={{
                        background: isSel ? '#BF5FFF' : isToday ? 'rgba(191,95,255,.15)' : (isScene || hasEvs) ? 'var(--card2)' : 'transparent',
                        border: isToday && !isSel ? '1px solid #BF5FFF' : '1px solid transparent',
                        borderRadius: 8,
                        color: isSel ? '#fff' : isToday ? '#BF5FFF' : (isScene || hasEvs) ? 'var(--text)' : 'var(--muted)',
                        fontFamily:"'Bebas Neue'",
                        fontSize: 14,
                        cursor: (isScene || hasEvs || isToday) ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        aspectRatio: '1',
                      }}
                    >
                      {d}
                      {(isScene || hasEvs)
                        ? <span style={{ width:4, height:4, borderRadius:'50%', background: dotColor, display:'block', flexShrink:0 }} />
                        : <span style={{ width:4, height:4, display:'block' }} />
                      }
                    </button>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        </>
      )}

      {session && !loading && (
        <>
          {/* Day view */}
          {selDate && (
            <div className={s.dayView}>

              {dayPersonalEvents.map(pe => (
                <div key={pe.id} style={{ display:'flex', alignItems:'center', gap:12, background:'rgba(191,95,255,.08)', border:'1px solid rgba(191,95,255,.25)', borderRadius:12, padding:'12px 14px', marginBottom:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Bebas Neue'", fontSize:15, letterSpacing:1, color:'var(--text)' }}>{pe.title}</div>
                    {pe.time_start && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{pe.time_start}</div>}
                    {pe.notes && <div style={{ fontSize:12, color:'var(--muted)', marginTop:3 }}>{pe.notes}</div>}
                  </div>
                  <span style={{ fontFamily:"'Bebas Neue'", fontSize:10, letterSpacing:1, color:'#BF5FFF', border:'1px solid rgba(191,95,255,.4)', borderRadius:6, padding:'2px 8px', flexShrink:0 }}>
                    {pe.is_private ? 'PRIVATE' : 'MY SCENE'}
                  </span>
                </div>
              ))}
              {dayEvents.length === 0 && dayPersonalEvents.length === 0 && (() => {
                const selD = new Date(selDate + 'T12:00:00');
                const nearby = datedEvents.filter(ev => {
                  const d = ev.config?.date;
                  if (!d) return false;
                  return Math.abs(new Date(d + 'T12:00:00') - selD) / 86400000 <= 7 && d !== selDate;
                }).sort((a, b) => Math.abs(new Date(a.config.date + 'T12:00:00') - selD) - Math.abs(new Date(b.config.date + 'T12:00:00') - selD)).slice(0, 6);

                const TYPE_STYLES = { host:'#FF3399', artist:'var(--neon2)', band:'#FF8C42', standup:'#FF88AA', venue:'#00E5A0' };

                return (
                  <>
                    {/* Nothing announced */}
                    <div style={{ fontFamily:"'Bebas Neue'", fontSize:19, letterSpacing:2, color:'var(--muted)', textAlign:'center', marginBottom:24 }}>NOTHING ANNOUNCED YET</div>

                    {/* Nearby nights */}
                    {nearby.length > 0 && (
                      <>
                        <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 12px' }}>
                          <div style={{ fontFamily:"'Bebas Neue'", fontSize:17, letterSpacing:2, background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>NEARBY NIGHTS</div>
                          <div style={{ flex:1, height:1, background:'linear-gradient(to right,#00E5FF,#BF5FFF,transparent)' }} />
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:24 }}>
                          {nearby.map(ev => <EventCard key={ev.id} event={ev} />)}
                        </div>
                      </>
                    )}

                    {/* Discover profiles */}
                    {discoverProfiles.length > 0 && (
                      <>
                        <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 12px' }}>
                          <div style={{ fontFamily:"'Bebas Neue'", fontSize:17, letterSpacing:2, background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>DISCOVER</div>
                          <div style={{ flex:1, height:1, background:'linear-gradient(to right,#00E5FF,#BF5FFF,transparent)' }} />
                        </div>
                        <div ref={discoverDrag.ref} onMouseDown={discoverDrag.onMouseDown} onMouseMove={discoverDrag.onMouseMove} onMouseUp={discoverDrag.onMouseUp} onMouseLeave={discoverDrag.onMouseLeave} style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8, WebkitOverflowScrolling:'touch', scrollbarWidth:'none', cursor:'grab' }}>
                          {discoverProfiles.map(p => (
                            <PortraitCard key={p.user_id} profile={p} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
              {dayEvents.map(ev => <EventCard key={ev.id} event={ev} badge={appMap[ev.id] ? appMap[ev.id].toUpperCase() : followedEventIds.has(ev.id) ? 'SAVED' : null} badgeColor={appMap[ev.id] === 'accepted' ? 'var(--neon2)' : '#FF2D78'} />)}
              {dayArtists.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className={s.sectionHead} style={{ fontSize: 12, marginBottom: 8 }}>ARTISTS PLAYING</div>
                  {dayArtists.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                      {a.avatar
                        ? <img src={a.avatar} alt={a.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bebas Neue'", fontSize: 16, color: 'var(--neon2)', flexShrink: 0 }}>{(a.name || '?')[0]}</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || 'Unknown Artist'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{a.genre || a.sound || ''}{a.eventName ? ` · ${a.eventName}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Feed — hidden while day selected */}
          {!selDate && (
            <div className={s.feed}>

              {/* FEATURED EVENT */}
              {featuredEvent && (
                <div className={s.section}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                    <div className={s.sectionHead}>FEATURED EVENT</div>
                    <div className={s.gradientLine} />
                  </div>
                  <FeaturedEventCard
                    event={featuredEvent}
                    label={featuredLabel}
                    onClick={() => navigate(`/event/${featuredEvent.id}`)}
                  />
                </div>
              )}

              {/* UPCOMING FOR YOU */}
              <div className={s.v1Section}>
                <div className={s.v1Head}>
                  <div className={s.sectionHead}>UPCOMING FOR YOU</div>
                  <div className={s.gradientLine} />
                  <span className={upcomingForYou.length > 3 ? s.seeAll : s.seeAllMuted} onClick={() => upcomingForYou.length > 3 && navigate('/')}>View all &gt;</span>
                </div>
                <div className={s.hScroll} ref={upcomingRef} onMouseDown={e=>{const el=upcomingRef.current;el._drag=true;el._x=e.pageX;el._sl=el.scrollLeft;el.style.cursor='grabbing';e.preventDefault();}} onMouseMove={e=>{const el=upcomingRef.current;if(!el._drag)return;el.scrollLeft=el._sl-(e.pageX-el._x);}} onMouseUp={e=>{const el=upcomingRef.current;el._drag=false;el.style.cursor='grab';}} onMouseLeave={e=>{const el=upcomingRef.current;el._drag=false;el.style.cursor='grab';}}>
                  {upcomingForYou.length > 0
                    ? upcomingForYou.map(({ ev, badge, badgeColor }) => (
                        <EventCard key={ev.id} variant="scroll" event={ev} badge={badge} badgeColor={badgeColor} onClick={() => navigate(`/event/${ev.id}`)} />
                      ))
                    : DEMO_UPCOMING.map((d, i) => <DemoUpcomingCard key={i} {...d} />)
                  }
                </div>
              </div>

              {/* SAVED / PAST EVENTS — tabbed */}
              <div className={s.v1Section}>
                <div className={s.v1Head} style={{ marginBottom:8 }}>
                  <div className={s.followTabs} style={{ margin:0 }}>
                    <button
                      className={s.followTab + (savedTab === 'saved' ? ' ' + s.followTabActive : '')}
                      onClick={() => { setSavedTab('saved'); setSavedLimit(3); setEventsExpanded(false); }}
                    >
                      SAVED
                      {savedEvents.length > 0 && <span className={s.followCountBadge}>{savedEvents.length}</span>}
                    </button>
                    <button
                      className={s.followTab + (savedTab === 'past' ? ' ' + s.followTabActive : '')}
                      onClick={() => { setSavedTab('past'); setPastLimit(3); setEventsExpanded(false); }}
                    >
                      PAST
                      {pastEvents.length > 0 && <span className={s.followCountBadge}>{pastEvents.length}</span>}
                    </button>
                  </div>
                  <div className={s.gradientLine} />
                  {(() => {
                    const hasMore = savedTab === 'saved' ? savedEvents.length >= 4 : pastEvents.length > 3;
                    return <span className={hasMore ? s.seeAll : s.seeAllMuted} onClick={() => hasMore && setEventsExpanded(v => !v)}>{eventsExpanded ? 'View less' : 'View all >'}</span>;
                  })()}
                </div>
                {savedTab === 'saved' ? (
                  savedEvents.length === 0 ? <DemoSavedRow /> : (
                    <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10, ...(!eventsExpanded && savedEvents.length >= 4 ? { maxHeight:315, overflowY:'scroll', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : { overflowY:'visible' }) }}>
                      {savedEvents.map(({ ev, badge, badgeColor }) => (
                        <EventCard key={ev.id} event={ev} badge={badge} badgeColor={badgeColor} onClick={() => navigate(`/event/${ev.id}`)} />
                      ))}
                    </div>
                  )
                ) : (
                  <>
                    {pastEvents.length > 0 && (
                      <PastEventsSearch query={pastEventSearch} onChange={setPastEventSearch} />
                    )}
                    {pastEvents.length === 0
                    ? <div className={s.empty}>No past events yet — get out there!</div>
                    : filteredPastEvents.length === 0
                    ? <div className={s.empty}>No past events match your search.</div>
                    : <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10, ...(!eventsExpanded ? { maxHeight:315, overflowY:'scroll', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : { overflowY:'visible' }) }}>
                        {filteredPastEvents.map(({ ev, badge, badgeColor }) => (
                          <EventCard key={ev.id} event={ev} badge={badge} badgeColor={badgeColor} onClick={() => navigate(`/event/${ev.id}`)} />
                        ))}
                      </div>}
                  </>
                )}
              </div>

              {/* FOLLOWING & UPDATES — tabbed */}
              <div className={s.v1Section}>
                <div className={s.v1Head} style={{ marginBottom:8 }}>
                  <div className={s.followTabs} style={{ margin:0 }}>
                    <button
                      className={s.followTab + (followTab === 'following' ? ' ' + s.followTabActive : '')}
                      onClick={() => setFollowTab('following')}
                    >
                      FOLLOWING
                      {profileFollows.length > 0 && <span className={s.followCountBadge}>{profileFollows.length}</span>}
                    </button>
                    <button
                      className={s.followTab + (followTab === 'updates' ? ' ' + s.followTabActive : '')}
                      onClick={() => setFollowTab('updates')}
                    >
                      UPDATES
                      {updatedFollows.length > 0
                        ? <span className={s.updateBadge}>{updatedFollows.length}</span>
                        : <span className={s.updateBadgeMuted}>3</span>
                      }
                    </button>
                  </div>
                  <div className={s.gradientLine} />
                  {(() => {
                    const tabCount = followTab === 'updates' ? updatedFollows.length : filteredFollows.length;
                    const hasMore = followShowAll || tabCount > 3;
                    return (
                      <span className={hasMore ? s.seeAll : s.seeAllMuted} onClick={() => hasMore && (setFollowShowAll(v => !v), setFollowSearch(''), setFollowLocFilter(null))}>
                        {followShowAll ? 'View less' : 'View all >'}
                      </span>
                    );
                  })()}
                </div>

                {/* Updates panel — horizontal preview */}
                {!followShowAll && followTab === 'updates' && (
                  <div ref={updatesDrag.ref} onMouseDown={updatesDrag.onMouseDown} onMouseMove={updatesDrag.onMouseMove} onMouseUp={updatesDrag.onMouseUp} onMouseLeave={updatesDrag.onMouseLeave} style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8, WebkitOverflowScrolling:'touch', scrollbarWidth:'none', marginTop:12, cursor:'grab' }}>
                    {updatedFollows.length > 0
                      ? updatedFollows.map(p => <PortraitCard key={p.user_id} profile={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }} />)
                      : DEMO_FOLLOWING.map((d, i) => (
                          <PortraitCard key={i} profile={{ user_id: null, name: d.name, type: d.type, avatar: null, location: null, sound: d.update }} onClick={() => {}} />
                        ))
                    }
                  </div>
                )}

                {/* Following panel — horizontal preview */}
                {!followShowAll && followTab === 'following' && (
                  <>
                    {availableTypes.length > 1 && (
                      <div className={s.roleFilters}>
                        <button className={s.rolePill + (!followRoleFilter ? ' ' + s.rolePillActive : '')} onClick={() => setFollowRoleFilter(null)}>ALL</button>
                        {availableTypes.map(t => (
                          <button key={t} className={s.rolePill + (followRoleFilter === t ? ' ' + s.rolePillActive : '')} onClick={() => setFollowRoleFilter(followRoleFilter === t ? null : t)}>
                            {TYPE_LABELS[t] || t.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>
                      {filteredFollows.length === 0 ? (
                        <div className={s.empty}>
                          {followRoleFilter
                            ? `No ${TYPE_LABELS[followRoleFilter] || followRoleFilter}s in your following list.`
                            : "Follow artists and venues from their profiles — you'll get notified when they play."
                          }
                        </div>
                      ) : (
                        <div ref={followingDrag.ref} onMouseDown={followingDrag.onMouseDown} onMouseMove={followingDrag.onMouseMove} onMouseUp={followingDrag.onMouseUp} onMouseLeave={followingDrag.onMouseLeave} style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8, WebkitOverflowScrolling:'touch', scrollbarWidth:'none', cursor:'grab' }}>
                          {filteredFollows.map(f => {
                            const p = followProfiles[f.entity_id];
                            return p ? <PortraitCard key={f.entity_id} profile={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }} /> : null;
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Expanded "View all" grid with search + postcode radius filter */}
                {followShowAll && (() => {
                  const allProfiles = followTab === 'following'
                    ? filteredFollows.map(f => followProfiles[f.entity_id]).filter(Boolean)
                    : updatedFollows.length > 0 ? updatedFollows : [];
                  const searchLower = followSearch.toLowerCase();
                  const RADII = [5, 10, 20, 50, 100, 250];
                  const originCoords = postcodeCoords(userPostcode);
                  const visible = allProfiles.filter(p => {
                    if (searchLower && !['name','location','sound','type'].some(k => p[k]?.toLowerCase().includes(searchLower))) return false;
                    if (followRadius !== null && originCoords) {
                      if (followRadius === 0) {
                        if (String(p.postcode) !== String(userPostcode)) return false;
                      } else {
                        const pc = profileCoords(p);
                        if (!pc) return false;
                        if (haversineKm(originCoords.lat, originCoords.lng, pc.lat, pc.lng) > followRadius) return false;
                      }
                    }
                    return true;
                  });
                  const postcodeValid = userPostcode.length === 4 && !!originCoords;
                  return (
                    <div style={{ marginTop: 12 }}>
                      {/* Search */}
                      <input
                        value={followSearch}
                        onChange={e => setFollowSearch(e.target.value)}
                        placeholder="Search name, location, vibe..."
                        style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)', borderRadius:10, padding:'10px 14px', color:'#fff', fontFamily:"'DM Sans',sans-serif", fontSize:13, marginBottom:10, outline:'none' }}
                      />
                      {/* Postcode + radius */}
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
                        <input
                          value={userPostcode}
                          onChange={e => { const v = e.target.value.replace(/\D/g,'').slice(0,4); setUserPostcode(v); localStorage.setItem('_userPostcode', v); setFollowRadius(v.length === 4 && !!AU_POSTCODES[v] ? 0 : null); }}
                          placeholder="Postcode"
                          maxLength={4}
                          style={{ width:80, background:'rgba(0,229,255,.06)', border:`1px solid ${postcodeValid ? 'rgba(0,229,255,.6)' : userPostcode.length===4 ? 'rgba(255,45,120,.5)' : 'rgba(0,229,255,.25)'}`, borderRadius:10, padding:'7px 12px', color:'#fff', fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:'none', caretColor:'#fff' }}
                        />
                        {postcodeValid && (
                          <button
                            onClick={() => setFollowRadius(0)}
                            className={`${s.radiusPill} ${followRadius === 0 ? s.radiusPillActive : ''}`}
                          >+0km</button>
                        )}
                        {RADII.map(r => (
                          <button key={r}
                            disabled={!postcodeValid}
                            onClick={() => setFollowRadius(followRadius === r ? 0 : r)}
                            className={`${s.radiusPill} ${followRadius === r ? s.radiusPillActive : ''}`}
                          >+{r}km</button>
                        ))}
                      </div>
                      {/* Grid */}
                      {visible.length === 0
                        ? <div className={s.empty}>{followRadius && !postcodeValid ? 'Enter a valid postcode to filter by distance.' : 'No results.'}</div>
                        : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
                            {visible.map(p => <PortraitCard key={p.user_id} profile={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }} />)}
                          </div>
                      }
                    </div>
                  );
                })()}
              </div>

              {/* Sign out */}
              <button className={s.signOut} onClick={onSignOut}>SIGN OUT</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DemoUpcomingCard({ name, venue, badge, badgeColor, dayName, dayNum, mon, timeStr }) {
  const textCol = badge === 'PLAYING' ? '#0a0a0f' : 'white';
  return (
    <div style={{ flexShrink:0, width:195, borderRadius:16, overflow:'hidden', background:'var(--card2)', border:'1px solid rgba(255,255,255,.08)', opacity:.55 }}>
      <div style={{ height:120, background:'linear-gradient(135deg,rgba(255,45,120,.2),rgba(157,78,221,.2))', position:'relative' }}>
        <div style={{ position:'absolute', top:8, left:8 }}><span style={{ background:badgeColor, color:textCol, fontFamily:"'Bebas Neue'", fontSize:10, letterSpacing:1, padding:'3px 8px', borderRadius:6 }}>{badge}</span></div>
        <div style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,.65)', borderRadius:8, padding:'4px 8px', textAlign:'center', minWidth:36 }}>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:9, color:'rgba(255,255,255,.7)' }}>{dayName}</div>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, color:'white', lineHeight:1 }}>{dayNum}</div>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:9, color:'rgba(255,255,255,.7)' }}>{mon}</div>
        </div>
      </div>
      <div style={{ padding:'10px 12px 12px' }}>
        <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:.5, marginBottom:5 }}>{name}</div>
        <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4, marginBottom:3 }}><svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>{venue}</div>
        <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4 }}><svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>{timeStr}</div>
      </div>
    </div>
  );
}

function DemoSavedRow() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:12, background:'var(--card2)', border:'1px solid rgba(255,255,255,.08)', borderRadius:14, marginBottom:8, opacity:.55 }}>
      <div style={{ width:64, height:64, borderRadius:10, background:'linear-gradient(135deg,rgba(0,229,160,.2),rgba(0,229,255,.2))', flexShrink:0 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:.5, marginBottom:4 }}>Jazz in the Garden</div>
        <div style={{ fontSize:12, color:'var(--muted)', marginBottom:3 }}>Sun, 22 Jun · 2:00 PM</div>
        <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4 }}><svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>Never Never Garden</div>
      </div>
    </div>
  );
}

function DemoFollowRow({ name, type, update, ago }) {
  const col = TYPE_COLORS[type] || 'var(--neon2)';
  const label = TYPE_LABELS[type] || type?.toUpperCase();
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)', borderRadius:14, marginBottom:8, opacity:.55 }}>
      <div style={{ position:'relative', flexShrink:0 }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Bebas Neue'", fontSize:18, color:col }}>{name[0]}</div>
        <div style={{ position:'absolute', bottom:0, left:0, width:11, height:11, borderRadius:'50%', background:'#00E5A0', border:'2px solid var(--dark)' }} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
          <span style={{ fontFamily:"'Bebas Neue'", fontSize:15, color:'var(--text)' }}>{name}</span>
          <span style={{ background:'rgba(255,255,255,.08)', borderRadius:6, fontSize:9, letterSpacing:1, color:col, fontFamily:"'Bebas Neue'", padding:'2px 6px' }}>{label}</span>
        </div>
        <div style={{ fontSize:12, color:'var(--muted)' }}>{update}</div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginTop:2 }}>{ago}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--muted)', flexShrink:0 }}><path d="M9 18l6-6-6-6"/></svg>
    </div>
  );
}

function FollowUpdateRow({ profile: p, onClick }) {
  const col = TYPE_COLORS[p.type] || 'var(--neon2)';
  const label = TYPE_LABELS[p.type] || p.type?.toUpperCase();
  const update = TYPE_UPDATES[p.type] || 'Recently updated';
  const ago = timeAgo(p.updated_at);
  return (
    <div onClick={onClick} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)', borderRadius:14, marginBottom:8, cursor:'pointer' }}>
      <div style={{ position:'relative', flexShrink:0 }}>
        {p.avatar
          ? <img src={p.avatar} alt="" style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover' }} />
          : <div style={{ width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Bebas Neue'", fontSize:18, color:col }}>{(p.name||'?')[0]}</div>
        }
        <div style={{ position:'absolute', bottom:0, left:0, width:11, height:11, borderRadius:'50%', background:'#00E5A0', border:'2px solid var(--dark)' }} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
          <span style={{ fontFamily:"'Bebas Neue'", fontSize:15, letterSpacing:.5, color:'var(--text)' }}>{p.name||'Unknown'}</span>
          <span style={{ background:'rgba(255,255,255,.08)', borderRadius:6, fontSize:9, letterSpacing:1, color:col, fontFamily:"'Bebas Neue'", padding:'2px 6px' }}>{label}</span>
        </div>
        <div style={{ fontSize:12, color:'var(--muted)' }}>{update}</div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginTop:2 }}>{ago}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color:'var(--muted)', flexShrink:0 }}><path d="M9 18l6-6-6-6"/></svg>
    </div>
  );
}

function FollowRow({ follow, profile, onUnfollow }) {
  const [hovered, setHovered] = useState(false);
  const col      = TYPE_COLORS[follow.entity_type] || 'var(--neon2)';
  const label    = TYPE_LABELS[follow.entity_type] || follow.entity_type?.toUpperCase();
  const avatar   = profile?.avatar || null;
  const location = profile?.location || null;
  return (
    <div className={s.followRow} style={{ borderColor: `${col}88` }}>
      {avatar
        ? <img src={avatar} alt={follow.entity_name} className={s.followAvatar} style={{ objectFit:'cover' }} />
        : <div className={s.followAvatar} style={{ color: col, background: `${col}22` }}>{(follow.entity_name || '?')[0].toUpperCase()}</div>
      }
      <div className={s.followInfo}>
        <div className={s.followName}>{follow.entity_name || 'Unknown'}</div>
        {location && <div style={{ fontSize:11, color:'var(--muted)', marginTop:1 }}>{location}</div>}
        <div className={s.followType} style={{ color: col }}>{label}</div>
      </div>
      <button
        className={s.followingBtn}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onUnfollow(follow.entity_id)}
        style={hovered ? { background:'rgba(255,45,120,.15)', borderColor:'rgba(255,45,120,.5)', color:'#FF2D78' } : {}}
      >
        {hovered ? 'UNFOLLOW' : 'FOLLOWING'}
      </button>
    </div>
  );
}
