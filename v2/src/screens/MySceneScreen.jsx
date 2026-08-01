import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import EventCard from '../components/EventCard';
import FeaturedEventCard from '../components/FeaturedEventCard';
import HeartBtn from '../components/HeartBtn';
// ⚠ styles from ./heartStyles, not ./HeartBtn — this file reads them at MODULE
// level (SPOTLIGHT_HEART / HEART_STYLE below), which is precisely where the
// import cycle through App threw "Cannot access before initialization".
import { HEART_OVERLAY_STYLE, HEART_BARE_STYLE } from '../components/heartStyles';
import FollowHeartBtn from '../components/FollowHeartBtn';
import PortraitCard from '../components/PortraitCard';
import ProfileCard from '../components/ProfileCard';
import { SkeletonRow, SkeletonEventCard } from '../components/Skeleton';
import s from './MySceneScreen.module.css';
import { useDragScroll } from '../hooks/useDragScroll';
import { haversineKm, profileCoords, postcodeCoords, isKnownPostcode } from '../lib/geo';
import { useEvents } from '../lib/useEvents';
import { weekendRange } from '../lib/dates';
import { trackFiltered } from '../lib/analytics';
import { getPersonalProfileId } from '../lib/actingProfile';
import {
  buildSceneFloor, SCENE_RADIUS_STEPS, SCENE_CATEGORIES, DEFAULT_SCENE_RADIUS,
  toggleSceneGenre, isValidSceneToken,
} from '../lib/sceneFloor';
import { buildSpotlight } from '../lib/spotlight';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';
import { PROFILE_TYPES, PROFILE_TYPE_ORDER } from '../lib/profileTypes';
import UnclaimedBadge from '../components/UnclaimedBadge';
import MessengerAvatar from '../components/MessengerAvatar';

let _discoverCache = [];

// 'event' isn't a profile type — kept as its own literal; every profile type
// derives from the one canonical PROFILE_TYPES definition.
const TYPE_COLORS = { ...Object.fromEntries(PROFILE_TYPE_ORDER.map(t => [t, PROFILE_TYPES[t].accent])), event: '#BF5FFF' };
const TYPE_LABELS = { ...Object.fromEntries(PROFILE_TYPE_ORDER.map(t => [t, PROFILE_TYPES[t].shortLabel])), event: 'EVENT' };
const TYPE_UPDATES = { artist:'Updated their profile', venue:'Updated event listings', host:'Updated their events', band:'Updated their profile', standup:'Updated their profile' };

function timeAgo(iso) {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`;
}

/* The demo placeholder rows that used to fill empty sections are GONE, not
 * moved. Stage A (my-scene-anti-stagnation): sections with nothing real hide
 * entirely, and the catalogue floor below — real events, radius + genre
 * personalised — is what keeps the page alive. The lesson the placeholders
 * encoded (fake content must never be mistakable for real activity) is
 * satisfied better by having no placeholders at all. Do not reintroduce demo
 * content here.
 */

/** Stable fallback for query-data arrays — see the destructuring block. */
const EMPTY = [];

/** Must match the `gap` on .hScroll — the dot index is derived from it. */
const SPOTLIGHT_RAIL_GAP = 12;

/* How long a Spotlight card holds before the rail moves on. Long enough to
   read a poster, a title and a venue without feeling hurried — this is a
   thing to look at, not a slideshow to sit through. The timer restarts on
   every movement, so this is "quiet time before it advances", not a
   metronome. */
const SPOTLIGHT_AUTOPLAY_MS = 6000;

/* ⛔ SPOT_ARROW_STYLE DELETED 2026-08-01 (owner) — the circular ‹ › edge
   controls on the Spotlight rail are gone, along with the card's own open
   arrow. Three ways to move the rail remain: drag, the position dots, and
   autoplay. ⚠ `stepSpotlight` SURVIVES and must not be deleted with them —
   autoplay calls it every 6s. */

/* Spotlight badge colours, keyed by the rule that fired. The badge text is
 * the explanation; colour only groups the KIND of reason — your own
 * involvement (pink/purple), your explicit favourites (cyan/violet), and the
 * catalogue's own news (muted). Any rule without an entry falls back to the
 * house accent, so adding a rung never requires touching this map. */
const SPOTLIGHT_BADGE_COLORS = {
  pinned:        '#FF2D78',
  my_event:      '#9D4EDD',
  playing:       '#BF5FFF',
  saved:         '#FF2D78',
  fav_venue:     '#00E5FF',
  fav_host:      '#BF5FFF',
  fav_genre:     '#00E5A0',
  just_announced:'#00E5FF',
  this_weekend:  '#00E5A0',
  spotlight:     '#9D4EDD',
};

/* ⚠ TWO heart styles on this screen, and which one a card gets is a decision:
   SPOTLIGHT_HEART keeps the ring because its heart sits over poster artwork of
   unpredictable brightness; HEART_STYLE (bare) is for every other card here,
   where the heart landed on a dark panel and the ring was the only thing
   drawing it. Owner's call, 2026-08-01. */
const SPOTLIGHT_HEART = HEART_OVERLAY_STYLE;

/* The overlay heart style now lives on HeartBtn (HEART_OVERLAY_STYLE) so
   What's On's cards and these share one definition. */
const HEART_STYLE = HEART_BARE_STYLE;

export default function MySceneScreen({ isGuest, onSignOut }) {
  const navigate = useNavigate();
  const { session } = useSession();

  // Date strip state
  const [viewMonth,  setViewMonth]  = useState(new Date());
  const [selDate,    setSelDate]    = useState(null);
  // showEdit/editName/editSaving removed with the rename sheet (MI1) — the
  // rename now lives on /me.

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
  const [followView,      setFollowView]      = useState('portrait');
  const [followRoleFilter,setFollowRoleFilter] = useState(null);
  const [followShowAll,   setFollowShowAll]   = useState(false);
  const [followSearch,    setFollowSearch]    = useState('');
  const [followRadius,    setFollowRadius]    = useState(null);
  const [userPostcode,    setUserPostcode]    = useState(() => localStorage.getItem('_userPostcode') || '');
  // ── Catalogue-floor prefs (Stage A) ──
  // localStorage is the instant-boot cache; the punter profile row is the
  // cross-device source of truth and wins whenever it has a value.
  const [sceneRadius, setSceneRadius] = useState(() => {
    const raw = localStorage.getItem('_sceneRadiusKm');
    if (raw === 'any') return null; // null = Anywhere
    const n = parseInt(raw, 10);
    return SCENE_RADIUS_STEPS.includes(n) ? n : DEFAULT_SCENE_RADIUS;
  });
  const [sceneGenres, setSceneGenres] = useState(() => {
    try {
      const g = JSON.parse(localStorage.getItem('_sceneGenres') || '[]');
      return Array.isArray(g) ? g.filter(isValidSceneToken) : [];
    } catch { return []; }
  });
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [spotIndex,  setSpotIndex]  = useState(0);
  const [spotPaused, setSpotPaused] = useState(false);
  const prefersReducedMotion = useMemo(
    () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  /* YOUR SCENE is COLLAPSED BY DEFAULT — always, including for a punter who
   * has tuned nothing. It used to open itself when there were no genres yet,
   * which put a full editor in the middle of the page and made the lower half
   * read as feed → configuration → feed. Owner, 2026-07-31: "I don't think
   * the lower half is wrong anymore — I think it's carrying too much visual
   * weight."
   *
   * The summary is not a settings preview: it is the user's scene stated back
   * to them, which is worth seeing daily. The editor is a place you choose to
   * go. Scene-building otherwise happens contextually — hearts on cards,
   * favourites, QR follows — so nothing depends on this being open. */
  const [tuneOpen, setTuneOpen] = useState(false);
  const [expandedCat, setExpandedCat] = useState(null);
  // Events saved from the floor THIS visit. They stay on the floor with a
  // filled heart + SAVED pill instead of vanishing mid-tap — the card changing
  // in place is the feedback that a relationship was created.
  const [justSaved, setJustSaved] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [savedTab,        setSavedTab]        = useState('saved');
  // Same two views FOLLOWING offers, same icons, same default — a toggle that
  // behaved differently in two places would be two toggles.
  const [upcomingView,    setUpcomingView]    = useState('landscape');
  const [savedLimit,      setSavedLimit]      = useState(3);
  const [pastLimit,       setPastLimit]       = useState(3);
  const [eventsExpanded,  setEventsExpanded]  = useState(false);
  const [pastEventSearch, setPastEventSearch] = useState('');
  /* YOUR AREA carries the same pair. It defaults to 'portrait' — unlike
     COMING UP's 'landscape' — because the floor is a BROWSING surface: the
     poster is the reason you stop on a card, and the rail is what the section
     has always been. The list is the opt-in density view, not the entry point. */
  const [areaView,        setAreaView]        = useState('portrait');
  const [areaExpanded,    setAreaExpanded]    = useState(false);

  // Distance helpers now live in lib/geo.js — this screen held the app's only
  // working implementation and Discover/What's On need the same one. Behaviour
  // is unchanged; geo.js additionally refuses NZ/International postcodes,
  // which AU_POSTCODES would otherwise answer with an Australian point.
  const discoverDrag   = useDragScroll('myscene-discover-strip');
  const stripDrag      = useDragScroll('myscene-date-strip');
  const stripRef       = stripDrag.ref;
  const updatesDrag    = useDragScroll('myscene-updated-follows');
  const followingDrag  = useDragScroll('myscene-following');
  /* ⚠ NO discoveryId for the Spotlight rail, deliberately.
     useDragScroll's first-visit "bump" nudges a rail 46px and back to teach
     that it scrolls. Spotlight now ADVANCES ON ITS OWN, which teaches the
     same thing better — and the hook's own warning applies: two writers on
     one scrollLeft fight, and the reader sees a shove mid-glide. The other
     rails keep their bump; this one earns its discoverability. */
  const upcomingDrag   = useDragScroll('myscene-upcoming-portrait');
  const spotlightDrag  = useDragScroll();
  const genreDrag      = useDragScroll('myscene-genre-chips');
  const aroundDrag     = useDragScroll('myscene-around-you');
  const announcedDrag  = useDragScroll('myscene-just-announced');
  const weekendDrag    = useDragScroll('myscene-this-weekend');

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
        // MI1 · avatar comes from the SAME punter row as the name, so the face
        // in this pill and the face in Messages are one value, not two that
        // happen to agree. postcode + genre_string carry the scene-floor prefs
        // (existing columns — scene_radius_km alone needs the Stage A
        // migration and is fetched separately so its absence can't 400 this
        // whole query).
        supabase.from('profiles').select('name,avatar_thumb,avatar,postcode,genre_string').eq('user_id', uid).eq('type', 'punter').limit(1),
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
      // `state` is selected so geo.js can refuse NZ/International postcodes —
      // without it the guard has nothing to test and AU_POSTCODES happily
      // answers "Wellington 6011" with Perth.
      const followCols = 'id,user_id,name,type,location,suburb,postcode,state,lat,lng,sound,updated_at';
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
        punterAvatar:   profRes.data?.[0]?.avatar_thumb || profRes.data?.[0]?.avatar || '',
        punterPostcode: profRes.data?.[0]?.postcode || '',
        punterGenreString: profRes.data?.[0]?.genre_string || '',
        personalEvents: peRes.data   || [],
        playingEvents:  claimEvRes.data || [],
        followProfiles: followProfileMap,
        updatedFollows,
      };
    },
    enabled: !!uid,
  });

  // One shared empty array, not a fresh [] per fallback — the floor's
  // useMemo takes these as deps, and a new identity every render would make
  // it recompute continuously.
  const follows        = data?.follows        || EMPTY;
  const apps           = data?.apps           || EMPTY;
  const events         = data?.events         || EMPTY;
  const myEvents       = data?.myEvents       || EMPTY;
  const playingEvents  = data?.playingEvents  || EMPTY;
  const personalEvents = data?.personalEvents || EMPTY;

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

  // ── Scene-floor prefs · profile wins over the localStorage cache ──
  // Every local change also writes the profile (persistScenePrefs), so
  // adopting the profile value here is last-write-wins across devices, not a
  // clobber. An empty genre_string is "cleared everywhere" and stays cleared.
  useEffect(() => {
    if (!data) return;
    const pc = String(data.punterPostcode || '');
    if (/^\d{4}$/.test(pc) && pc !== userPostcode) {
      setUserPostcode(pc);
      localStorage.setItem('_userPostcode', pc);
    }
    if (data.punterGenreString) {
      const parsed = data.punterGenreString.split(',').map(t => t.trim()).filter(isValidSceneToken);
      if (parsed.length) setSceneGenres(parsed);
    }
  }, [data]);

  // scene_radius_km lives behind the Stage A migration — fetched alone so a
  // pre-migration 400 lands HERE (ignored) instead of failing the main query.
  useEffect(() => {
    if (!uid) return;
    supabase.from('profiles').select('scene_radius_km').eq('user_id', uid).eq('type', 'punter').limit(1)
      .then(({ data: rows, error }) => {
        if (error || !rows?.length) return;
        const raw = rows[0].scene_radius_km;
        if (raw === null || raw === undefined) return;     // never set — keep default/local
        setSceneRadius(raw === 0 ? null : raw);            // 0 = Anywhere (see migration comment)
      });
  }, [uid]);

  function persistScenePrefs({ postcode, radiusKm, genres }) {
    if (postcode !== undefined) localStorage.setItem('_userPostcode', postcode);
    if (radiusKm !== undefined) localStorage.setItem('_sceneRadiusKm', radiusKm === null ? 'any' : String(radiusKm));
    if (genres   !== undefined) localStorage.setItem('_sceneGenres', JSON.stringify(genres));
    if (!uid) return;
    const upd = {};
    if (postcode !== undefined) upd.postcode = postcode || null;
    if (genres   !== undefined) upd.genre_string = genres.join(', ');
    if (Object.keys(upd).length) {
      supabase.from('profiles').update(upd).eq('user_id', uid).eq('type', 'punter').then(() => {});
    }
    if (radiusKm !== undefined) {
      // Stored as 0 when "Anywhere" — NULL must keep meaning "never set".
      // Until the Stage A migration adds the column this update errors, which
      // is fine: localStorage above already carries the preference.
      supabase.from('profiles').update({ scene_radius_km: radiusKm === null ? 0 : radiusKm }).eq('user_id', uid).eq('type', 'punter').then(() => {});
    }
  }

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  // Favourite venues/hosts ARE follows — one relationship store, so the
  // Following section, Your Area's favourite-first ordering and Stage B's
  // "Your People" all read the same rows. Write pattern mirrors
  // ProfileScreen.doFollow (M5 dual-write, M6 attribution, error surfaced).
  async function addFavourite(profile) {
    const fromProfileId = await getPersonalProfileId(uid);
    const legacyEntityId = profile.user_id ?? profile.id;
    const { error } = await supabase.from('follows').insert({
      user_id: uid, from_profile_id: fromProfileId,
      entity_id: legacyEntityId, entity_type: profile.type, entity_name: profile.name,
      target_profile_id: profile.id,
    });
    if (error) {
      console.error('[favourite] insert rejected —', `code=${error.code}`, `message=${error.message}`, `details=${error.details}`);
      return;
    }
    showToast(`${profile.name} added to your scene.`);
    queryClient.invalidateQueries({ queryKey: ['myScene', uid] });
  }

  async function removeFavourite(f) {
    const { error } = await supabase.from('follows').delete().eq('user_id', uid).eq('entity_id', f.entity_id);
    if (error) {
      console.error('[favourite] delete rejected —', `code=${error.code}`, `message=${error.message}`);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['myScene', uid] });
  }

  /* A profile heart on FOLLOWING is almost always an UNfollow — the list is,
     by definition, people you already follow. Refetch so the row leaves rather
     than sitting there emptied, which would read as the tap not working. */
  function onFollowHeart(followed, profile) {
    if (!followed) showToast(`Unfollowed ${profile?.name || 'that profile'}.`);
    queryClient.invalidateQueries({ queryKey: ['myScene', uid] });
  }

  function onFloorHeart(ev, liked) {
    if (liked) {
      setJustSaved(prev => new Set(prev).add(ev.id));
      showToast('Saved to My Scene — find it under COMING UP.');
    } else {
      setJustSaved(prev => { const n = new Set(prev); n.delete(ev.id); return n; });
    }
    queryClient.invalidateQueries({ queryKey: ['myScene', uid] });
  }

  /* A toast that promises a save must only ever follow a save that happened.
     This fires instead when the write is rejected — HeartBtn now hands the
     error up rather than swallowing it, so the page can say the true thing. */
  function onFloorHeartError(_error, intent) {
    showToast(intent === 'save' ? "Couldn't save that one — try again." : "Couldn't remove that one — try again.");
  }

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

  // ── THE CATALOGUE FLOOR (Stage A · my-scene-anti-stagnation) ──
  // Same source + cache as What's On (useEvents), REAL events only — the demo
  // merge What's On does is deliberately absent here. Selection rules live in
  // lib/sceneFloor.js where they are tested; this screen only renders.
  const { events: catalogueEvents, loading: floorLoading } = useEvents(todayStr, new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));
  const wr = useMemo(() => weekendRange(), []);
  const newSinceIso = useMemo(() => new Date(Date.now() - 14 * 86400000).toISOString(), []);
  const originPostcode = /^\d{4}$/.test(userPostcode) && isKnownPostcode(userPostcode) ? userPostcode : '';
  const originCoords = useMemo(() => originPostcode ? postcodeCoords(originPostcode) : null, [originPostcode]);
  const floorExclude = useMemo(() => {
    // Events already in a personal section aren't re-pitched — EXCEPT ones
    // saved from the floor this visit, which stay put with a filled heart.
    const ids = new Set();
    follows.forEach(f => { if (f.entity_type === 'event' && !justSaved.has(f.entity_id)) ids.add(f.entity_id); });
    myEvents.forEach(ev => ids.add(ev.id));
    playingEvents.forEach(ev => ids.add(ev.id));
    apps.forEach(a => { if (a.event_id) ids.add(a.event_id); });
    return ids;
  }, [follows, myEvents, playingEvents, apps, justSaved]);
  // Followed profiles boost Your Area — favourites lead the section
  // (deterministic ordering rule, not a score; see buildSceneFloor).
  const favProfileIds = useMemo(
    () => new Set(follows.filter(f => f.entity_type !== 'event' && f.target_profile_id).map(f => f.target_profile_id)),
    [follows]);
  const favUserIds = useMemo(
    () => new Set(follows.filter(f => f.entity_type !== 'event' && f.entity_id).map(f => f.entity_id)),
    [follows]);
  const floor = useMemo(() => buildSceneFloor({
    events: catalogueEvents, todayIso: todayStr,
    weekendFrom: wr.from, weekendTo: wr.to, newSinceIso,
    originCoords, originPostcode, radiusKm: sceneRadius, genres: sceneGenres,
    excludeEventIds: floorExclude, favProfileIds, favUserIds,
  }), [catalogueEvents, todayStr, wr, newSinceIso, originCoords, originPostcode, sceneRadius, sceneGenres, floorExclude, favProfileIds, favUserIds]);

  // The curated fallback that used to live here is now the `spotlight` rule in
  // lib/spotlight.js's table — with its own longer horizon, so a quiet
  // fortnight still leaves a heartbeat.

  // A2/A3 · demand from the floor, same shape as What's On: the location and
  // radius keys are APPLIED (they genuinely filtered), and the radius sent is
  // the one that actually ran — the ladder's usedRadius, not the request.
  useEffect(() => {
    if (!uid || floorLoading) return;   // a count taken mid-fetch is a lie
    const t = setTimeout(() => {
      trackFiltered({
        surface: 'my_scene',
        ...(originPostcode ? { location: originPostcode, radiusKm: floor.aroundYou.usedRadius || undefined } : {}),
        results: floor.aroundYou.count,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [uid, floorLoading, originPostcode, floor.aroundYou.usedRadius, floor.aroundYou.count]);

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

  // The hand-rolled "featured event" chain that lived here (playing →
  // hosting → attending, by nearest date) is now the declared rules table in
  // lib/spotlight.js, which adds the horizon and cap it never had. The pin
  // below survives because an explicit user choice outranks any rule.
  const pinnedId = profileConfig?.featured_event_id;
  const pinnedEvent = pinnedId
    ? [...myEvents, ...playingEvents, ...datedEvents].find(ev => ev.id === pinnedId && ev.config?.date >= todayStr)
    : null;

  // ── SPOTLIGHT · the attention rail ──
  // Selection rules live in lib/spotlight.js as a declared table (badge ·
  // predicate · horizon · cap) so they are testable and readable; this screen
  // only renders. Up to five cards, never padded — the rail's length is the
  // honest readout of how well the punter has taught their scene.
  const spotlight = useMemo(() => buildSpotlight({
    events: catalogueEvents, todayIso: todayStr,
    myEventIds:      new Set(myEvents.map(ev => ev.id)),
    playingEventIds: new Set([
      ...playingEvents.map(ev => ev.id),
      ...apps.filter(a => a.status === 'accepted').map(a => a.event_id),
    ].filter(Boolean)),
    savedEventIds:   new Set(follows.filter(f => f.entity_type === 'event').map(f => f.entity_id)),
    favProfileIds, favUserIds,
    genres: sceneGenres,
    originCoords, originPostcode, radiusKm: sceneRadius,
    weekendFrom: wr.from, weekendTo: wr.to, newSinceIso,
  }), [catalogueEvents, todayStr, myEvents, playingEvents, apps, follows, favProfileIds, favUserIds, sceneGenres, originCoords, originPostcode, sceneRadius, wr, newSinceIso]);

  // A manual pin still outranks everything — an explicit choice by the user
  // beats any rule we could infer — so it is prepended and deduped rather
  // than competing inside the table.
  const spotlightItems = useMemo(() => {
    const rest = spotlight.items.filter(i => i.event.id !== pinnedEvent?.id);
    return (pinnedEvent ? [{ event: pinnedEvent, badge: 'FEATURED', ruleKey: 'pinned' }, ...rest] : rest).slice(0, 5);
  }, [spotlight, pinnedEvent]);

  /**
   * The badge a FLOOR card carries — only its own just-saved state.
   *
   * ⚠ FAVOURITE VENUE / HOST deliberately do NOT appear here (owner, 2026-07-31).
   * Two reasons it was wrong on these cards: EventCard's badge REPLACES the
   * genre pills, so the reason chip cost the card its "Techno / Live Band"
   * line — a bad trade on a browsing surface — and the section heading
   * already carries the explanation. Favourites still lead the ordering, and
   * the reason is still stated where it has room: the Spotlight hero badge.
   */
  function cardReason(ev) {
    return justSaved.has(ev.id) ? { badge: 'SAVED', color: '#FF2D78' } : null;
  }

  /** Which Spotlight card is centred, for the position dots. */
  function onSpotlightScroll(e) {
    const el = e.currentTarget;
    const first = el.firstElementChild;
    if (!first) return;
    const step = first.getBoundingClientRect().width + SPOTLIGHT_RAIL_GAP;
    const idx = Math.max(0, Math.min(spotlightItems.length - 1, Math.round(el.scrollLeft / step)));
    setSpotIndex(prev => (prev === idx ? prev : idx));
  }

  function scrollSpotlightTo(i) {
    const el = spotlightDrag.ref.current;
    const card = el?.children?.[i];
    if (!el || !card) return;
    // Measured from the live boxes rather than offsetLeft: these cards sit
    // inside a scroller whose offsetParent is not the rail, so offsetLeft
    // would be relative to the wrong element.
    el.scrollTo({ left: el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left, behavior: 'smooth' });
  }

  /** Step the rail, wrapping at both ends so it never dead-ends. */
  function stepSpotlight(delta) {
    const n = spotlightItems.length;
    if (n < 2) return;
    scrollSpotlightTo(((spotIndex + delta) % n + n) % n);
  }

  /**
   * SPOTLIGHT AUTOPLAY — the rail advances on its own.
   *
   * Keyed on `spotIndex`, which is set by the rail's own scroll handler, so
   * the timer RESTARTS on every movement — including the reader's. The
   * behaviour that falls out of that is the one worth having: it advances a
   * beat after things go still, and never fights a hand that is already
   * moving the rail. A plain fixed interval would yank the rail mid-drag.
   *
   * Paused while the pointer is over the rail (you are looking at that card)
   * and off entirely under prefers-reduced-motion, matching useDragScroll.
   *
   * ⚠ MUST STAY BELOW `spotlightItems`. The dependency array is evaluated
   * during render, so reading `spotlightItems.length` from above that `const`
   * threw "Cannot access 'spotlightItems' before initialization" and took the
   * whole screen to the error boundary. A hook's position in the body is not
   * cosmetic when its deps read a const declared later.
   *
   * ⚠ `stepSpotlight` is intentionally NOT a dependency. It is redeclared
   * every render, so listing it would clear and restart the timer on every
   * render — the timeout would never survive long enough to fire and the
   * rail would sit still forever. The deps are the state the timer genuinely
   * keys on; the function is only read when it fires.
   */
  useEffect(() => {
    if (spotlightItems.length < 2 || spotPaused || prefersReducedMotion) return;
    const t = setTimeout(() => stepSpotlight(1), SPOTLIGHT_AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [spotIndex, spotPaused, spotlightItems.length, prefersReducedMotion]);

  /* ── COMING UP · your diary ───────────────────────────────────────────
   *
   * Every upcoming event you are involved in — playing, hosting or attending
   * — in date order, COMPLETE. Owner, 2026-07-31: "your upcoming needs to
   * stay. that shows you events that are coming up that your playing at,
   * hosting or attending." Renamed YOUR UPCOMING → COMING UP the same day;
   * the section's job did not change, only its heading. Owner kept the words
   * ("i like coming up") — the two-line wrap was the complaint, and that is
   * fixed in CSS on .followTab, not by shortening the label.
   *
   * ⚠ IT IS NO LONGER CAPPED TO 14 DAYS, and that is what makes it a
   * different thing from Spotlight rather than a scruffier copy of it. The
   * old version showed commitments for the next fortnight, which is the same
   * pool AND roughly the same window Spotlight's MY EVENT / PLAYING / SAVED
   * rules draw from — so the two read as duplicates, correctly.
   *
   * The distinction that now holds is CURATION vs COMPLETENESS:
   *   SPOTLIGHT      up to 5 things that earned attention NOW — mixed
   *                  reasons, including events you have NOT committed to
   *                  (favourite venue, just announced, this weekend)
   *   COMING UP      every commitment you have, in order, however far out
   *
   * ⚠ AND IT ABSORBED "SAVED". A hearted event IS an attendance intent —
   * `follows` carries one bit, so saved and attending are the same row until
   * the Interested/Going split lands in Stage D. Listing it twice under two
   * headings was the redundancy, not the section itself. The heart's
   * destination is here, badged ATTENDING; PAST keeps its own tab below.
   */
  const upcomingSet = new Set();
  const upcomingEvents = [];
  [...datedEvents, ...myEvents].forEach(ev => {
    const d = ev.config?.date;
    if (!d || upcomingSet.has(ev.id)) return;
    const isAttending = followedEventIds.has(ev.id);
    const isHosted    = myEvents.some(m => m.id === ev.id);
    const isPlaying   = appMap[ev.id] === 'accepted';
    if ((isAttending || isHosted || isPlaying) && d >= todayStr) {
      upcomingSet.add(ev.id);
      upcomingEvents.push({ ev, badge: isHosted ? 'MY EVENT' : isPlaying ? 'PLAYING' : 'ATTENDING', badgeColor: isHosted ? '#9D4EDD' : isPlaying ? 'var(--neon2)' : '#FF2D78' });
    }
  });
  upcomingEvents.sort((a, b) => (a.ev.config?.date || '').localeCompare(b.ev.config?.date || ''));

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
      // M15: `id` is required, not cosmetic. PortraitCard navigates on
      // profile.id and only falls back to /profile/<user_id> when it is
      // absent — and an unclaimed row's user_id is NULL, so that fallback
      // builds /profile/undefined. Every other profile select here already
      // leads with id (see followCols above).
      .select('id, user_id, name, type, avatar, location, suburb, sound, genre_string')
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
    setDayArtists(membersData.map(c => {
      const prof = profFor(c);
      return {
        name: c.artist_name, genre: c.genre, sound: c.sound,
        avatar: prof?.avatar, eventName: evMap[c.event_id],
        user_id: c.artist_id || null,
        // M5: canonical link target — the lineup row's artist_profile_id, or the
        // resolved profile's id; user_id stays as the legacy-URL fallback.
        id: c.artist_profile_id || prof?.id || null,
        // M15: the resolved profiles row, carried whole rather than flattened.
        // `user_id` above is lineup_members.artist_id — a DIFFERENT column with
        // a different meaning — so testing it for claim state would be
        // confidently wrong. isProfileUnclaimed must be given a real profiles
        // row; null here means the bill was a typed name with no profile
        // behind it, which is not an unclaimed profile.
        profile: prof,
      };
    }));
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
            {/* MI1 · opens the Messenger identity screen. This used to open an
                inline rename sheet; the rename moved to that screen with it, so
                nothing was lost — see MessengerIdentityScreen. */}
            <div className={s.profilePill} onClick={() => navigate('/me')} style={{ cursor: 'pointer' }}>
              {/* MI1 · THE SAME COMPONENT MESSAGES USES, not a lookalike.
                  This was a generic person glyph, which meant My Scene and
                  Messenger showed different things for the same identity — and
                  no amount of uploading a photo would ever change this one.
                  Sharing MessengerAvatar is what makes them link: one source
                  for the image, one default when there isn't one. */}
              <MessengerAvatar src={data?.punterAvatar} size={26} />
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
            <div className={s.sectionHead}>SPOTLIGHT</div>
            <div className={s.gradientLine} />
          </div>
          <SkeletonEventCard />
          {/* Skeleton mirrors the REAL section list — a placeholder for a
              section that no longer exists promises a layout shift that never
              arrives. It said SAVED, which the loaded page stopped rendering
              when that tab absorbed the diary and became COMING UP. */}
          <div className={s.v1Section} style={{ marginTop:24 }}>
            <div className={s.v1Head}>
              <div className={s.sectionHead}>COMING UP</div>
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

      {/* The rename sheet that lived here now lives on /me — see the profile
          pill above. Removed rather than left unreachable. */}

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

                const TYPE_STYLES = Object.fromEntries(PROFILE_TYPE_ORDER.map(t => [t, PROFILE_TYPES[t].accent]));

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
                            <PortraitCard key={p.id} profile={p} />
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
                    <div key={i} onClick={() => (a.id || a.user_id) && navigate(a.id ? `/profile/${a.id}?prefer=performer` : `/profile/${a.user_id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, cursor: (a.id || a.user_id) ? 'pointer' : 'default' }}>
                      {a.avatar
                        ? <img src={a.avatar} alt={a.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bebas Neue'", fontSize: 16, color: 'var(--neon2)', flexShrink: 0 }}>{(a.name || '?')[0]}</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Badge pairs with the NAME, not the row. The name
                            already truncates (nowrap + ellipsis) so it yields
                            the width gracefully; the genre line below wraps
                            freely, and a trailing badge on the row stole ~76px
                            from it and grew a long-genre row by 28px. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.name || 'Unknown Artist'}</div>
                          <UnclaimedBadge profile={a.profile} />
                        </div>
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

              {/* SPOTLIGHT — the attention rail. UP TO five cards, never
                  padded: each one earned its slot under exactly one rule, and
                  its badge IS the reason. Hides entirely when nothing has
                  earned attention rather than manufacturing some. */}
              {spotlightItems.length > 0 && (
                <div className={s.v1Section}>
                  <div className={s.v1Head}>
                    <div className={s.sectionHead}>SPOTLIGHT</div>
                    <div className={s.gradientLine} />
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                    {spotlightItems.length === 1 ? 'What not to miss.' : `${spotlightItems.length} things worth your attention.`}
                  </div>
                  {/* Full hero cards, scrolled horizontally — the poster is
                      the point, so the rail keeps it at hero size rather than
                      shrinking five into a strip.

                      ⚠ snap is PROXIMITY, not mandatory. useDragScroll writes
                      scrollLeft on every mousemove, and mandatory snapping
                      fights that write for the whole drag — the rail sticks
                      and jerks. Proximity settles to the nearest card once the
                      hand stops, which is the part worth having. */}
                  <div style={{ position:'relative' }}
                    onMouseEnter={() => setSpotPaused(true)}
                    onMouseLeave={() => setSpotPaused(false)}
                    onTouchStart={() => setSpotPaused(true)}>
                    <div className={s.hScroll} style={{ scrollSnapType:'x proximity' }}
                      ref={spotlightDrag.ref} onScroll={onSpotlightScroll}
                      onMouseDown={spotlightDrag.onMouseDown} onMouseMove={spotlightDrag.onMouseMove}
                      onMouseUp={spotlightDrag.onMouseUp}
                      onMouseLeave={spotlightDrag.onMouseLeave}>
                      {spotlightItems.map(({ event: ev, badge, ruleKey }) => (
                        <FeaturedEventCard key={ev.id} event={ev}
                          label={badge} badgeColor={SPOTLIGHT_BADGE_COLORS[ruleKey]}
                          rail solo={spotlightItems.length === 1}
                          onClick={() => navigate(`/event/${ev.id}`)}
                          cornerAction={<HeartBtn event={ev} style={SPOTLIGHT_HEART} onChange={liked => onFloorHeart(ev, liked)} onError={onFloorHeartError} />}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Position dots — one per card, so the rail announces how
                      much there is before you touch it. Tappable, because on
                      a desktop mouse there is otherwise no way to move a
                      horizontal rail except dragging it. */}
                  {spotlightItems.length > 1 && (
                    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:7, marginTop:2 }}>
                      {spotlightItems.map(({ event: ev }, i) => (
                        <button key={ev.id}
                          onClick={() => scrollSpotlightTo(i)}
                          aria-label={`Spotlight ${i + 1} of ${spotlightItems.length}`}
                          style={{
                            width: i === spotIndex ? 20 : 7, height: 7, padding: 0,
                            borderRadius: 4, border: 'none', cursor: 'pointer',
                            background: i === spotIndex ? 'var(--neon2)' : 'rgba(255,255,255,.22)',
                            transition: 'width .22s ease, background .22s ease',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* COMING UP / PAST — tabbed. The tab that used to say
                  SAVED is this one: a hearted event is an attendance intent,
                  so it belongs in the diary badged ATTENDING rather than in a
                  second list of the same rows under another name. */}
              {(upcomingEvents.length > 0 || pastEvents.length > 0) && (
              <div className={s.v1Section}>
                <div className={s.v1Head} style={{ marginBottom:8 }}>
                  <div className={s.followTabs} style={{ margin:0 }}>
                    <button
                      className={s.followTab + (savedTab === 'saved' ? ' ' + s.followTabActive : '')}
                      onClick={() => { setSavedTab('saved'); setSavedLimit(3); setEventsExpanded(false); }}
                    >
                      COMING UP
                      {upcomingEvents.length > 0 && <span className={s.followCountBadge}>{upcomingEvents.length}</span>}
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
                  {/* View toggle — the SAME control FOLLOWING carries, so the
                      two icons mean the same thing everywhere on this page:
                      ▦ portrait cards, ☰ list rows. Sits in the heading row
                      immediately left of View all. */}
                  {savedTab === 'saved' && upcomingEvents.length > 0 && (
                    <div style={{ display:'flex', background:'var(--card2)', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)', flexShrink:0 }}>
                      {[['portrait','▦'],['landscape','☰']].map(([v, icon]) => (
                        <button key={v} onClick={() => setUpcomingView(v)}
                          aria-label={v === 'portrait' ? 'Card view' : 'List view'}
                          style={{ background: upcomingView===v ? 'rgba(0,229,255,.18)' : 'none', border:'none', color: upcomingView===v ? 'var(--neon2)' : 'var(--muted)', padding:'4px 9px', cursor:'pointer', fontSize:12, lineHeight:1, transition:'background .15s, color .15s' }}>{icon}</button>
                      ))}
                    </div>
                  )}
                  {(() => {
                    // "View all" lifts the LIST's height cap. The portrait
                    // rail has no cap — it already shows everything — so the
                    // control is inert there rather than lying about it.
                    const hasMore = savedTab === 'saved'
                      ? upcomingView === 'landscape' && upcomingEvents.length >= 4
                      : pastEvents.length > 3;
                    return <span className={hasMore ? s.seeAll : s.seeAllMuted} onClick={() => hasMore && setEventsExpanded(v => !v)}>{eventsExpanded ? 'View less' : 'View all >'}</span>;
                  })()}
                </div>
                {savedTab === 'saved' ? (
                  upcomingEvents.length === 0 ? <div className={s.empty}>Nothing coming up yet — tap the ♥ on any gig below.</div> : (
                    <>
                      {upcomingView === 'portrait' ? (
                        /* A horizontal rail, not a wrapped grid: the scroll
                           variant is a fixed 195px, which on a phone column
                           fits exactly one per row — a "grid" of one is just a
                           worse list. Same shape FOLLOWING's portrait view
                           uses, and it needs no height cap because it scrolls
                           sideways. */
                        <div className={s.hScroll} ref={upcomingDrag.ref}
                          onMouseDown={upcomingDrag.onMouseDown} onMouseMove={upcomingDrag.onMouseMove}
                          onMouseUp={upcomingDrag.onMouseUp} onMouseLeave={upcomingDrag.onMouseLeave}>
                          {upcomingEvents.map(({ ev, badge, badgeColor }) => (
                            <EventCard key={ev.id} variant="scroll" event={ev} badge={badge} badgeColor={badgeColor} onClick={() => navigate(`/event/${ev.id}`)}
                              cornerAction={<HeartBtn event={ev} style={HEART_STYLE} />} />
                          ))}
                        </div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10, ...(!eventsExpanded && upcomingEvents.length >= 4 ? { maxHeight:315, overflowY:'scroll', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : { overflowY:'visible' }) }}>
                          {upcomingEvents.map(({ ev, badge, badgeColor }) => (
                            <EventCard key={ev.id} event={ev} badge={badge} badgeColor={badgeColor} onClick={() => navigate(`/event/${ev.id}`)}
                              cornerAction={<HeartBtn event={ev} style={HEART_STYLE} />} />
                          ))}
                        </div>
                      )}
                    </>
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
              )}

              {/* FOLLOWING & UPDATES — tabbed. ALWAYS visible (owner call,
                  Stage A review §5): following needs an obvious destination
                  in the product. Empty state signposts the Tune favourites
                  below rather than nagging. */}
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
                      {/* No fake counts: the muted "3" that sat here was a
                          leftover hint from the demo-content era. */}
                      {updatedFollows.length > 0 && <span className={s.updateBadge}>{updatedFollows.length}</span>}
                    </button>
                  </div>
                  <div className={s.gradientLine} />
                  {/* Same control, same place as COMING UP's: heading row,
                      immediately left of View all. Hidden while expanded —
                      the "View all" grid is portrait-only, so a view toggle
                      there would offer a choice that does not exist. */}
                  {followTab === 'following' && !followShowAll && filteredFollows.length > 0 && (
                    <div style={{ display:'flex', background:'var(--card2)', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)', flexShrink:0 }}>
                      {[['portrait','▦'],['landscape','☰']].map(([v, icon]) => (
                        <button key={v} onClick={() => setFollowView(v)}
                          aria-label={v === 'portrait' ? 'Card view' : 'List view'}
                          style={{ background: followView===v ? 'rgba(0,229,255,.18)' : 'none', border:'none', color: followView===v ? 'var(--neon2)' : 'var(--muted)', padding:'4px 9px', cursor:'pointer', fontSize:12, lineHeight:1, transition:'background .15s, color .15s' }}>{icon}</button>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const tabCount = followTab === 'updates' ? updatedFollows.length : filteredFollows.length;
                    const hasMore = followShowAll || tabCount > 3;
                    return (
                      <span className={hasMore ? s.seeAll : s.seeAllMuted} onClick={() => hasMore && (setFollowShowAll(v => !v), setFollowSearch(''))}>
                        {followShowAll ? 'View less' : 'View all >'}
                      </span>
                    );
                  })()}
                </div>

                {/* Updates panel — horizontal preview */}
                {!followShowAll && followTab === 'updates' && (
                  updatedFollows.length > 0 ? (
                    <div ref={updatesDrag.ref} onMouseDown={updatesDrag.onMouseDown} onMouseMove={updatesDrag.onMouseMove} onMouseUp={updatesDrag.onMouseUp} onMouseLeave={updatesDrag.onMouseLeave} style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8, WebkitOverflowScrolling:'touch', scrollbarWidth:'none', marginTop:12, cursor:'grab' }}>
                      {updatedFollows.map(p => <PortraitCard key={p.user_id} profile={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }} />)}
                    </div>
                  ) : (
                    <div className={s.empty}>No updates since your last visit.</div>
                  )
                )}

                {/* Following panel — horizontal preview */}
                {!followShowAll && followTab === 'following' && (
                  <>
                    {/* The view toggle that sat on the right of this row is
                        now in the heading row beside View all. */}
                    {availableTypes.length > 1 && (
                      <div className={s.roleFilters} style={{ margin:0 }}>
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
                            : 'Nothing followed yet — add favourite venues & hosts in YOUR SCENE below, or follow anyone from their profile.'
                          }
                        </div>
                      ) : followView === 'portrait' ? (
                        <div ref={followingDrag.ref} onMouseDown={followingDrag.onMouseDown} onMouseMove={followingDrag.onMouseMove} onMouseUp={followingDrag.onMouseUp} onMouseLeave={followingDrag.onMouseLeave} style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8, WebkitOverflowScrolling:'touch', scrollbarWidth:'none', cursor:'grab' }}>
                          {filteredFollows.map(f => {
                            const p = followProfiles[f.entity_id];
                            return p ? <PortraitCard key={f.entity_id} profile={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }}
                              followAction={<FollowHeartBtn profile={p} onChange={onFollowHeart} />} /> : null;
                          })}
                        </div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          {filteredFollows.map(f => {
                            const p = followProfiles[f.entity_id];
                            return p ? <ProfileCard key={f.entity_id} item={{ ...p, avatar: followAvatars[p.user_id] || p.avatar }}
                              followAction={<FollowHeartBtn profile={p} onChange={onFollowHeart} />} /> : null;
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
                          onChange={e => { const v = e.target.value.replace(/\D/g,'').slice(0,4); setUserPostcode(v); localStorage.setItem('_userPostcode', v); setFollowRadius(v.length === 4 && isKnownPostcode(v) ? 0 : null); }}
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

              {/* ══ THE DISCOVERY HALF — Stage A (my-scene-anti-stagnation) ══
                  Personal sections above, discovery below: one clear mental
                  model. Real events, personalised by radius + genres +
                  favourites, never placeholders. Every card carries the save
                  heart, so every tap converts a catalogue item into a
                  relationship that feeds the personal half. */}
              {/* FOR YOU — deliberately NOT "Discover": that word already
                  names a bottom-nav destination, and everything below this
                  line is personalised rather than browsed. */}
              <div style={{ display:'flex', alignItems:'center', gap:12, margin:'26px 0 0' }}>
                <div style={{ flex:1, height:1, background:'linear-gradient(to right, transparent, rgba(0,229,255,.45))' }} />
                <span style={{ fontFamily:"'Bebas Neue'", fontSize:13, letterSpacing:3, color:'var(--muted)' }}>FOR YOU</span>
                <div style={{ flex:1, height:1, background:'linear-gradient(to left, transparent, rgba(191,95,255,.45))' }} />
              </div>

              {/* YOUR SCENE — a statement of identity, not a settings panel.
                  Collapsed to a summary by default; EDIT unfolds the same
                  progressive editor (categories → genres, favourite venues &
                  hosts) and Done folds it back. The editor is a place you
                  choose to go, so it never sits between two feeds. */}
              <div className={s.v1Section}>
                <div className={s.v1Head}>
                  <div className={s.sectionHead}>YOUR SCENE</div>
                  <div className={s.gradientLine} />
                  {tuneOpen && (
                    <span className={s.seeAll} onClick={() => { setTuneOpen(false); setExpandedCat(null); }}>Done</span>
                  )}
                </div>

                {!tuneOpen ? (
                  /* THE SUMMARY IS THE POINT — the user's scene said back to
                     them, which is worth seeing every day. Read it as "this is
                     your scene", never as "here are your settings". */
                  <div onClick={() => setTuneOpen(true)}
                    style={{ cursor:'pointer', border:'1px solid var(--border)', borderRadius:12, padding:'12px 14px', marginTop:10, display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      {SCENE_CATEGORIES.map(cat => {
                        const inCat = sceneGenres.includes(cat.key)
                          ? ['All ' + cat.label]
                          : cat.genres.filter(g => sceneGenres.includes(g));
                        if (!inCat.length) return null;
                        return (
                          <div key={cat.key} style={{ marginBottom:5 }}>
                            <div style={{ fontFamily:"'Bebas Neue'", fontSize:14, letterSpacing:1, color:'var(--text)' }}>{cat.label.toUpperCase()}</div>
                            <div style={{ fontSize:12, color:'var(--muted)', marginTop:1 }}>{inCat.join(' • ')}</div>
                          </div>
                        );
                      })}
                      {(() => {
                        const places = profileFollows
                          .filter(f => f.entity_type === 'venue' || f.entity_type === 'host')
                          .map(f => f.entity_name).filter(Boolean);
                        if (!places.length) return null;
                        // Capped: this is a summary, and an unbounded list of
                        // every favourite is the visual weight this section
                        // was collapsed to shed. The full list lives one tap
                        // away in the editor, and in FOLLOWING above.
                        const SHOWN = 4;
                        const rest = places.length - SHOWN;
                        return (
                          <div style={{ fontSize:12, color:'var(--muted)', marginTop: sceneGenres.length ? 6 : 0 }}>
                            {places.slice(0, SHOWN).join(' • ')}
                            {rest > 0 && <span style={{ opacity:.7 }}>{` +${rest} more`}</span>}
                          </div>
                        );
                      })()}
                      {sceneGenres.length === 0 && profileFollows.length === 0 && (
                        /* Invitation, not a nag: hearts and QR follows build
                           this on their own, so nothing here is required. */
                        <div style={{ fontSize:12, color:'var(--muted)' }}>
                          Your scene builds itself as you save gigs and favourite venues — or set it up here.
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily:"'Bebas Neue'", fontSize:13, letterSpacing:1.5, color:'var(--neon2)', flexShrink:0 }}>EDIT →</span>
                  </div>
                ) : (
                  <>
                    {sceneGenres.length === 0 && (
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>Choose what you're into — we'll shape this page around it.</div>
                    )}
                    {/* Category chips */}
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', padding:'10px 0 2px' }}>
                      {SCENE_CATEGORIES.map(cat => {
                        const hasSel = sceneGenres.includes(cat.key) || cat.genres.some(g => sceneGenres.includes(g));
                        const isOpen = expandedCat === cat.key;
                        return (
                          <button key={cat.key}
                            className={`${s.radiusPill} ${(hasSel || isOpen) ? s.radiusPillActive : ''}`}
                            style={{ flexShrink:0, whiteSpace:'nowrap' }}
                            onClick={() => setExpandedCat(isOpen ? null : cat.key)}>
                            {cat.label.toUpperCase()}{isOpen ? ' ▴' : ' ▾'}
                          </button>
                        );
                      })}
                    </div>
                    {/* Expanded category → its genres, led by an ALL chip */}
                    {expandedCat && (() => {
                      const cat = SCENE_CATEGORIES.find(c => c.key === expandedCat);
                      if (!cat) return null;
                      const applyToggle = (token, addedLabel) => {
                        const wasOn = sceneGenres.includes(token);
                        const next = toggleSceneGenre(sceneGenres, token, cat.key);
                        setSceneGenres(next);
                        persistScenePrefs({ genres: next });
                        if (!wasOn) showToast(`Showing more ${addedLabel} gigs.`);
                      };
                      return (
                        <div ref={genreDrag.ref} onMouseDown={genreDrag.onMouseDown} onMouseMove={genreDrag.onMouseMove} onMouseUp={genreDrag.onMouseUp} onMouseLeave={genreDrag.onMouseLeave}
                          style={{ display:'flex', gap:8, overflowX:'auto', padding:'8px 0 6px', WebkitOverflowScrolling:'touch', scrollbarWidth:'none', cursor:'grab' }}>
                          <button className={`${s.radiusPill} ${sceneGenres.includes(cat.key) ? s.radiusPillActive : ''}`}
                            style={{ flexShrink:0, whiteSpace:'nowrap' }}
                            onClick={() => applyToggle(cat.key, cat.label)}>
                            ALL {cat.label.toUpperCase()}
                          </button>
                          {cat.genres.map(g => (
                            <button key={g} className={`${s.radiusPill} ${sceneGenres.includes(g) ? s.radiusPillActive : ''}`}
                              style={{ flexShrink:0, whiteSpace:'nowrap' }}
                              onClick={() => applyToggle(g, g)}>
                              {g.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    {/* Favourite venues & hosts — follows in a Tune coat */}
                    <FavouriteGroup
                      label="FAVOURITE VENUES" type="venue"
                      follows={profileFollows.filter(f => f.entity_type === 'venue')}
                      onAdd={addFavourite} onRemove={removeFavourite}
                    />
                    <FavouriteGroup
                      label="FAVOURITE HOSTS" type="host"
                      follows={profileFollows.filter(f => f.entity_type === 'host')}
                      onAdd={addFavourite} onRemove={removeFavourite}
                    />
                  </>
                )}
              </div>

              {/* YOUR AREA — the distance label IS the radius control */}
              <div className={s.v1Section}>
                <div className={s.v1Head}>
                  <div className={s.sectionHead}>YOUR AREA</div>
                  <div className={s.gradientLine} />
                  {/* Same control, same place, same icons as COMING UP and
                      FOLLOWING carry — three sections, one toggle, so ▦ and ☰
                      mean exactly one thing across this page. Hidden entirely
                      when there is nothing to switch between. */}
                  {originPostcode && floor.aroundYou.items.length > 0 && (
                    <div style={{ display:'flex', background:'var(--card2)', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)', flexShrink:0 }}>
                      {[['portrait','▦'],['landscape','☰']].map(([v, icon]) => (
                        <button key={v} onClick={() => setAreaView(v)}
                          aria-label={v === 'portrait' ? 'Card view' : 'List view'}
                          style={{ background: areaView===v ? 'rgba(0,229,255,.18)' : 'none', border:'none', color: areaView===v ? 'var(--neon2)' : 'var(--muted)', padding:'4px 9px', cursor:'pointer', fontSize:12, lineHeight:1, transition:'background .15s, color .15s' }}>{icon}</button>
                      ))}
                    </div>
                  )}
                  {originPostcode && floor.aroundYou.items.length > 0 && (() => {
                    // Identical rule to COMING UP's: "View all" lifts the
                    // LIST's height cap, and the rail has no cap to lift — so
                    // in portrait the control is muted and inert rather than
                    // present and lying.
                    const hasMore = areaView === 'landscape' && floor.aroundYou.items.length >= 4;
                    return <span className={hasMore ? s.seeAll : s.seeAllMuted} onClick={() => hasMore && setAreaExpanded(v => !v)}>{areaExpanded ? 'View less' : 'View all >'}</span>;
                  })()}
                </div>
                {originPostcode ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, position:'relative' }}>
                      <span style={{ fontFamily:"'Bebas Neue'", fontSize:13, letterSpacing:1.5, color:'var(--muted)' }}>
                        {floor.aroundYou.count} {floor.aroundYou.count === 1 ? 'EVENT' : 'EVENTS'}
                      </span>
                      <span style={{ color:'var(--muted)', fontSize:11 }}>•</span>
                      <button onClick={() => setRadiusOpen(v => !v)}
                        style={{ background:'none', border:'none', cursor:'pointer', fontFamily:"'Bebas Neue'", fontSize:13, letterSpacing:1.5, color:'var(--neon2)', display:'flex', alignItems:'center', gap:4, padding:0 }}>
                        {sceneRadius === null ? 'ANYWHERE' : `WITHIN ${sceneRadius} KM`}
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                      {radiusOpen && (
                        <>
                          <div style={{ position:'fixed', inset:0, zIndex:699 }} onClick={() => setRadiusOpen(false)} />
                          <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:700, background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:6, minWidth:150, boxShadow:'0 10px 30px rgba(0,0,0,.5)' }}>
                            {SCENE_RADIUS_STEPS.map(r => {
                              const sel = r === sceneRadius;
                              return (
                                <button key={String(r)}
                                  onClick={() => { setSceneRadius(r); persistScenePrefs({ radiusKm: r }); setRadiusOpen(false); }}
                                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', background: sel ? 'rgba(0,229,255,.12)' : 'none', border:'none', borderRadius:8, padding:'9px 12px', cursor:'pointer', fontFamily:"'Bebas Neue'", fontSize:14, letterSpacing:1.5, color: sel ? 'var(--neon2)' : 'var(--text)', textAlign:'left' }}>
                                  <span style={{ width:6, height:6, borderRadius:'50%', background: sel ? 'var(--neon2)' : 'var(--border)', flexShrink:0 }} />
                                  {r === null ? 'ANYWHERE' : `${r} KM`}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Honest fallback lines — the selection is remembered, the
                        list only borrows a wider net. Never "0 EVENTS". */}
                    {floor.aroundYou.count > 0 && floor.aroundYou.usedRadius !== floor.aroundYou.requestedRadius && (
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>
                        {`None within ${floor.aroundYou.requestedRadius} km — showing ${floor.aroundYou.count} ${floor.aroundYou.usedRadius === null ? 'from across the whole guide' : `within ${floor.aroundYou.usedRadius} km`}.`}
                      </div>
                    )}
                    {floor.aroundYou.genresRelaxed && (
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>None matching your genres yet — showing everything nearby.</div>
                    )}
                    {floor.aroundYou.items.length > 0 ? (
                      areaView === 'portrait' ? (
                        <div className={s.hScroll} ref={aroundDrag.ref} onMouseDown={aroundDrag.onMouseDown} onMouseMove={aroundDrag.onMouseMove} onMouseUp={aroundDrag.onMouseUp} onMouseLeave={aroundDrag.onMouseLeave}>
                          {floor.aroundYou.items.map(ev => (
                            <EventCard key={ev.id} variant="scroll" event={ev}
                              badge={cardReason(ev)?.badge} badgeColor={cardReason(ev)?.color}
                              onClick={() => navigate(`/event/${ev.id}`)}
                              cornerAction={<HeartBtn event={ev} style={HEART_STYLE} onChange={liked => onFloorHeart(ev, liked)} onError={onFloorHeartError} />}
                            />
                          ))}
                        </div>
                      ) : (
                        /* ✅ The list rows now carry the heart too (owner,
                           2026-08-01), in the same bottom-right corner the
                           portrait cards use. EventCard renders it as a sibling
                           overlay here because this variant is a <button> —
                           see the note in EventCard.jsx. The floor's rule that
                           every card is a save affordance now holds in BOTH
                           views, which it did not when this toggle shipped. */
                        <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10, ...(!areaExpanded && floor.aroundYou.items.length >= 4 ? { maxHeight:315, overflowY:'scroll', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : { overflowY:'visible' }) }}>
                          {floor.aroundYou.items.map(ev => (
                            <EventCard key={ev.id} event={ev}
                              badge={cardReason(ev)?.badge} badgeColor={cardReason(ev)?.color}
                              onClick={() => navigate(`/event/${ev.id}`)}
                              cornerAction={<HeartBtn event={ev} style={HEART_STYLE} onChange={liked => onFloorHeart(ev, liked)} onError={onFloorHeartError} />}
                            />
                          ))}
                        </div>
                      )
                    ) : !floorLoading && (
                      <div className={s.empty}>Nothing announced out there yet — the newest gigs are just below.</div>
                    )}
                  </>
                ) : (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>Set your postcode to see gigs near you.</div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <input
                        value={userPostcode}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setUserPostcode(v);
                          if (v.length === 4 && isKnownPostcode(v)) persistScenePrefs({ postcode: v });
                          else localStorage.setItem('_userPostcode', v);
                        }}
                        placeholder="Postcode"
                        maxLength={4}
                        inputMode="numeric"
                        style={{ width:110, background:'rgba(0,229,255,.06)', border:`1px solid ${userPostcode.length === 4 && !isKnownPostcode(userPostcode) ? 'rgba(255,45,120,.5)' : 'rgba(0,229,255,.35)'}`, borderRadius:10, padding:'9px 12px', color:'#fff', fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:'none', caretColor:'#fff' }}
                      />
                      {userPostcode.length === 4 && !isKnownPostcode(userPostcode) && (
                        <span style={{ fontSize:11, color:'#FF2D78' }}>Postcode not recognised</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* JUST ANNOUNCED — no geo, so thin location coverage can never
                  empty the whole floor. */}
              {floor.justAnnounced.items.length > 0 && (
                <div className={s.v1Section}>
                  <div className={s.v1Head}>
                    <div className={s.sectionHead}>JUST ANNOUNCED</div>
                    <div className={s.gradientLine} />
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>Freshly added to the gig guide.</div>
                  <div className={s.hScroll} ref={announcedDrag.ref} onMouseDown={announcedDrag.onMouseDown} onMouseMove={announcedDrag.onMouseMove} onMouseUp={announcedDrag.onMouseUp} onMouseLeave={announcedDrag.onMouseLeave}>
                    {floor.justAnnounced.items.map(ev => (
                      <EventCard key={ev.id} variant="scroll" event={ev}
                        badge={cardReason(ev)?.badge} badgeColor={cardReason(ev)?.color}
                        onClick={() => navigate(`/event/${ev.id}`)}
                        cornerAction={<HeartBtn event={ev} style={HEART_STYLE} onChange={liked => onFloorHeart(ev, liked)} onError={onFloorHeartError} />}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* THIS WEEKEND — hides when no events fall Fri–Sun, same law
                  as What's On. */}
              {floor.thisWeekend.items.length > 0 && (
                <div className={s.v1Section}>
                  <div className={s.v1Head}>
                    <div className={s.sectionHead}>THIS WEEKEND</div>
                    <div className={s.gradientLine} />
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>Friday to Sunday.</div>
                  <div className={s.hScroll} ref={weekendDrag.ref} onMouseDown={weekendDrag.onMouseDown} onMouseMove={weekendDrag.onMouseMove} onMouseUp={weekendDrag.onMouseUp} onMouseLeave={weekendDrag.onMouseLeave}>
                    {floor.thisWeekend.items.map(ev => (
                      <EventCard key={ev.id} variant="scroll" event={ev}
                        badge={cardReason(ev)?.badge} badgeColor={cardReason(ev)?.color}
                        onClick={() => navigate(`/event/${ev.id}`)}
                        cornerAction={<HeartBtn event={ev} style={HEART_STYLE} onChange={liked => onFloorHeart(ev, liked)} onError={onFloorHeartError} />}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Sign out removed from My Scene — this is a browsing surface,
                  not an account screen. `onSignOut` is still used above for the
                  guest gate's SIGN IN / CREATE ACCOUNT action, so the prop stays. */}
            </div>
          )}
        </>
      )}

      {/* Save toast — fixed ABOVE the nav (--yp-safe-bottom, so the mini
          player is respected too); nothing ever renders over the bottom nav. */}
      {toast && (
        <div style={{ position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'calc(var(--yp-safe-bottom) + 14px)', background:'var(--card)', border:'1px solid rgba(0,229,255,.45)', borderRadius:12, padding:'10px 16px', zIndex:800, fontSize:13, color:'var(--text)', boxShadow:'0 8px 28px rgba(0,0,0,.55)', maxWidth:'85vw', textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * TUNE YOUR SCENE · favourites group — a follows writer in a Tune coat.
 * Lists the current follows of one type as removable chips, with a search to
 * add more. Not a second favourites store: onAdd/onRemove write the same
 * `follows` rows the Following section and Your Area's ordering read.
 */
function FavouriteGroup({ label, type, follows, onAdd, onRemove }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const followedIds = new Set(follows.map(f => f.target_profile_id).filter(Boolean));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let dead = false;
    const t = setTimeout(() => {
      supabase.from('profiles')
        .select('id,user_id,name,type,suburb,location')
        .eq('type', type)
        .ilike('name', `%${term}%`)
        .order('name')
        .limit(6)
        .then(({ data: rows }) => { if (!dead) setResults(rows || []); });
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [q, type]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontFamily:"'Bebas Neue'", fontSize:13, letterSpacing:1.5, color:'var(--muted)', marginBottom:8 }}>{label}</div>
      {follows.length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
          {follows.map(f => (
            <span key={f.entity_id} style={{ display:'inline-flex', alignItems:'center', gap:6, border:'1px solid rgba(0,229,255,.4)', borderRadius:16, padding:'5px 10px', fontSize:12, color:'var(--text)' }}>
              {f.entity_name || 'Unknown'}
              <button onClick={() => onRemove(f)} title="Remove" style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', padding:0, fontSize:13, lineHeight:1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={`+ Add ${type === 'venue' ? 'a venue' : 'a host or promoter'}`}
        style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)', borderRadius:10, padding:'9px 12px', color:'#fff', fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:'none' }}
      />
      {results.filter(p => !followedIds.has(p.id)).map(p => (
        <div key={p.id} onClick={() => { onAdd(p); setQ(''); setResults([]); }}
          style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'var(--card2)', border:'1px solid var(--border)', borderRadius:10, marginTop:6, cursor:'pointer' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
            {(p.suburb || p.location) && <div style={{ fontSize:11, color:'var(--muted)' }}>{p.suburb || p.location}</div>}
          </div>
          <span style={{ fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1, color:'var(--neon2)', flexShrink:0 }}>+ ADD</span>
        </div>
      ))}
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
