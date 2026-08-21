import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import EventCard from '../components/EventCard';
import LocalsRails from '../components/LocalsRails';
import ProfileCard, { TYPE_STYLES } from '../components/ProfileCard';
import PortraitCard from '../components/PortraitCard';
import FollowHeartBtn from '../components/FollowHeartBtn';
import { SkeletonRow } from '../components/Skeleton';
import { useDragScroll } from '../hooks/useDragScroll';
import s from './DiscoverScreen.module.css';
import { resolveLocationToPostcodes, suggestLocations } from '../lib/auLocations';
import { BAND_GENRES, SHARED_PERFORMANCE_TAGS, ROLE_TAGS } from '../lib/profileTaxonomy';
import { STATE_OPTIONS } from '../lib/auLocations';
import { useSession } from '../App';
import { getOwnedProfileOfType } from '../lib/actingProfile';
import ShortlistToEventSheet from '../components/ShortlistToEventSheet';
import { isBookableAct } from '../lib/shortlistFromArtist';
import { trackFiltered } from '../lib/analytics';
import {
  RADIUS_STEPS, eventCoords, profileCoords, postcodeCoords, withinRadius,
} from '../lib/geo';
import { today, dateStr, weekendRange } from '../lib/dates';
import { readDate } from './event/eventViewModel';
import {
  tokenise, rankEvents, rankProfiles, profileOrFilter,
} from '../lib/discoverSearch';

// Venue-first, matching the shared canonical role order (SCENE_ROLE_ORDER
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
 * MATCHING EVENTS MUST SURVIVE THE INITIAL LIMIT.
 *
 * Results arrive profiles-first, then events, and the list renders only the
 * first `count` of them. So any search matching 3+ profiles pushed EVERY event
 * behind "View more" — a search for a genre showed venues and bands and looked
 * like there were no gigs on at all. Reported 2026-08-02.
 *
 * Still one mixed list, same order, no sections: this only reserves part of the
 * opening window for events when both kinds matched, so some are always there.
 * Once `count` covers everything the split stops mattering and the full list is
 * returned untouched.
 */
function withEventsVisible(items, count) {
  if (items.length <= count) return items;
  const events   = items.filter(r => r._kind === 'event');
  const profiles = items.filter(r => r._kind !== 'event');
  // Only one kind matched — nothing can crowd anything out.
  if (!events.length || !profiles.length) return items.slice(0, count);
  const eventSlots = Math.min(events.length, Math.max(1, Math.floor(count / 2)));
  return [...profiles.slice(0, count - eventSlots), ...events.slice(0, eventSlots)];
}

/**
 * Does this event fall inside the chosen date window?
 *
 * Profiles have no date, so they are never date-filtered — see the note where
 * this is applied.
 */
function matchesDate(item, dateFilter) {
  if (!dateFilter) return true;
  // ⚠ readDate, NOT `config.date` — a date is stored as `date` OR `start_date`
  // depending on which generation of the schema wrote the row, so reading one
  // spelling silently treats the other as undated and drops the event from
  // every date filter. Same reader the event page uses.
  const d = readDate(item.config || {});
  if (!d) return false;                 // an undated event cannot match a date ask
  if (dateFilter === 'weekend') {
    const { from, to } = weekendRange();
    return d >= from && d <= to;
  }
  if (dateFilter === '7days')  return d >= today() && d <= dateStr(7);
  if (dateFilter === '30days') return d >= today() && d <= dateStr(30);
  return true;
}


/** How many profiles the RECENTLY ADDED / ACTIVE rail shows. */
const DEFAULT_RAIL_SIZE = 20;

/**
 * How many profiles are FETCHED to build that rail.
 *
 * The rail used to fetch exactly what it showed, so the twenty cards were the
 * same twenty cards on every open — the screen read as stale even while the
 * catalogue grew. Randomising needs something to choose FROM, so the pool is
 * deliberately wider than the rail and the order is drawn from it per open.
 */
const POOL_SIZE = 60;

/**
 * One default-image profile per five cards.
 *
 * Owner, 2026-08-08: "i dont mind if it has 1:5 new roles that dont have images
 * … but pepper new profiles with default images through the top 20". So the
 * rail is 16 profiles using their own picture and 4 using a type default, in
 * fixed slots, rather than a ratio that drifts with whatever the query returned.
 */
const PLAIN_EVERY = 5;

/**
 * Fisher–Yates against a SEEDED generator, not Math.random.
 *
 * The seed is minted once per mount and threaded through, so the order is
 * stable for the life of the screen — re-renders (typing, opening filters,
 * VIEW MORE) must not reshuffle the cards under the reader's thumb. A fresh
 * mount mints a fresh seed, which is what makes each open different.
 */
function seededShuffle(rows, seed) {
  const out = rows.slice();
  let s = seed >>> 0;
  const next = () => {
    // mulberry32 — small, deterministic, and no dependency.
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * THE RAIL: shuffled photos, with new default-image profiles peppered through.
 *
 * `withPhoto` is shuffled outright — every profile using its own picture is
 * equally worth showing, so recency stopping the rest from ever surfacing is
 * the thing being fixed.
 *
 * `plain` is NOT shuffled outright. The ask is to pepper NEW profiles through,
 * and the pool arrives `updated_at DESC`, so only the newest slice is eligible
 * and the shuffle happens inside it — otherwise "peppered" would mean a random
 * draw from the whole imported catalogue, which is the grey directory the
 * two-query split already exists to avoid.
 *
 * ⚠ SHORTFALL FILLS FROM THE OTHER BUCKET. Neither ratio nor rail length is
 * worth a hole: if there are fewer than four eligible defaults the rail is
 * completed with photos, and vice versa.
 */
function composeRail(pool, seed) {
  const withPhoto = seededShuffle(pool.filter(p => p._ownPhoto), seed);
  const plainCount = Math.floor(DEFAULT_RAIL_SIZE / PLAIN_EVERY);
  const plainPool  = pool.filter(p => !p._ownPhoto);
  const newWindow  = Math.max(plainCount * 3, 12);
  // Shuffled NEW window first, then the rest in plain recency order. The tail
  // is never reached while there are photos to show — it exists only so a thin
  // photo pool still fills twenty cards instead of leaving the rail short.
  const plain = [
    ...seededShuffle(plainPool.slice(0, newWindow), seed ^ 0x9e3779b9),
    ...plainPool.slice(newWindow),
  ];

  const rail = [];
  let pi = 0, qi = 0;
  for (let slot = 0; slot < DEFAULT_RAIL_SIZE; slot++) {
    const wantPlain = (slot + 1) % PLAIN_EVERY === 0;
    const first  = wantPlain ? plain : withPhoto;
    const second = wantPlain ? withPhoto : plain;
    const firstI  = wantPlain ? qi : pi;
    if (firstI < first.length) {
      rail.push(first[firstI]);
      if (wantPlain) qi++; else pi++;
    } else {
      const secondI = wantPlain ? pi : qi;
      if (secondI >= second.length) break;   // pool exhausted — a short rail, not a padded one
      rail.push(second[secondI]);
      if (wantPlain) pi++; else qi++;
    }
  }
  return rail;
}

/**
 * M5: id included — cards navigate by the canonical profile.id, which is what
 * makes unclaimed profiles (user_id NULL) navigable at all.
 * postcode/suburb/lat/lng are selected so the radius filter has something to
 * place a profile with — without them every record is unplaceable and a
 * distance filter empties the screen.
 */
const PROFILE_COLS =
  'id, user_id, name, type, avatar, location, suburb, state, postcode, lat, lng, sound, genre_string, bio, updated_at';
const DISCOVER_TYPES = ['artist', 'host', 'band', 'standup', 'venue'];

async function fetchDefault() {
  /**
   * ⚠ TWO PROFILE QUERIES, NOT ONE ORDER-BY — AND WHY IT HAS TO BE THIS WAY.
   *
   * The rail was one query ordered `updated_at DESC`, and Studio-imported
   * placeholders dominate recency so completely that the newest SIXTY rows
   * contained zero claimed profiles and zero real photos (measured against
   * live data, 2026-08-03). Discover opened on four grey UNCLAIMED venues and
   * read as a directory full of bots.
   *
   * Ranking the rows client-side cannot fix that: the 50 claimed profiles and
   * 18 with photos sit far outside any recency window worth fetching, so
   * reordering the window only reshuffles placeholders. The registered ones
   * have to be ASKED FOR, which is what the first query does.
   *
   * `registered` = claimed (user_id present) AND using their own picture —
   * empty and 'N/A' both mean PortraitCard paints the type's default image, so
   * both are excluded. That is exactly "not a placeholder, not a default pic".
   *
   * ⚠ STILL A PREFERENCE, NEVER A FILTER. The second query is unchanged, and
   * the merge appends it — an unclaimed profile keeps its place further along
   * the same rail, still labelled UNCLAIMED. Hiding them would strand the
   * imported catalogue precisely when provoking a claim is the point (N3).
   */
  const [registeredRes, recentRes, evRes] = await Promise.all([
    supabase.from('profiles')
      .select(PROFILE_COLS)
      .in('type', DISCOVER_TYPES)
      .or('is_live.is.null,is_live.neq.false')
      .not('user_id', 'is', null)
      .not('avatar', 'is', null)
      .neq('avatar', '')
      .neq('avatar', 'N/A')
      .order('updated_at', { ascending: false })
      .limit(POOL_SIZE),
    supabase.from('profiles')
      // The original rail, kept whole: whatever is genuinely newest, claimed
      // or not. Fills the rail behind the registered ones.
      .select(PROFILE_COLS)
      .in('type', DISCOVER_TYPES)
      .or('is_live.is.null,is_live.neq.false')
      .order('updated_at', { ascending: false })
      .limit(POOL_SIZE),
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
  // Registered-with-own-photo first, then the newest of everything else.
  // Deduped by id: the two queries overlap by design (a registered profile
  // that IS genuinely recent appears in both), and the Map keeps the first
  // insertion — which is the registered one, so the preference survives.
  //
  // ⚠ THIS IS THE POOL, NOT THE RAIL. It is deliberately NOT sliced to 20 and
  // its order is only a preference: composeRail() draws the twenty cards from
  // it per open. Slicing here would put the randomiser back where it started,
  // choosing twenty out of twenty.
  const merged = new Map();
  for (const p of [...(registeredRes.data || []), ...(recentRes.data || [])]) {
    if (!merged.has(p.id)) merged.set(p.id, p);
  }
  return [
    // `_ownPhoto` is decided ONCE, here, against the same rule the queries use
    // ('', null and 'N/A' all mean PortraitCard paints the type default) so the
    // ratio the rail promises cannot drift from what the reader actually sees.
    ...[...merged.values()].map(p => ({
      ...p,
      _kind: 'profile',
      _ownPhoto: !!p.avatar && p.avatar !== 'N/A',
    })),
    ...(evRes.data || []).map(e => ({ ...e, _kind: 'event' })),
  ];
}

/**
 * Which profile columns a word is matched against.
 *
 * ⚠ Kept in step with profileHaystack in lib/discoverSearch: the query fetches
 * the candidates and the haystack scores them, so a field in one and not the
 * other either fetches rows that can never score, or scores a field it never
 * asked the database for.
 */
const PROFILE_MATCH_FIELDS = [
  'name', 'sound', 'genre_string', 'location', 'suburb', 'state', 'bio', 'venue_type',
];

/**
 * THE SEARCH CORPUS — every event a visitor is allowed to see, plus the bills.
 *
 * Fetched lazily (the first time someone actually searches) and cached for the
 * screen, so the cost is paid once rather than per keystroke.
 *
 * ⚠⚠ POSTGREST CAPS EVERY RESPONSE AT 1,000 ROWS whatever `limit` says. Both
 * queries below sit far under it today (88 events, ~220 bill rows) and the cap
 * degrades quietly rather than erroring — an event past the cap would simply
 * stop being findable. ⭐ If either count approaches 1,000, this has to page or
 * move server-side; see the note in runSearch.
 *
 * ⚠ `status`/`is_public` are belt and braces, not the boundary. RLS is what
 * actually withholds drafts from anon (SEC-1/SEC-2) — verified 2026-08-17, the
 * anon key returns the same 88 rows with or without these filters.
 */
async function fetchSearchCorpus() {
  const [evRes, billRes] = await Promise.all([
    supabase.from('events')
      // The venue embed carries NAME and SUBURB as well as the geo fields the
      // default query needs — matching a gig by its room is the whole point.
      .select('id, name, config, created_at, venue_profile_id, postcode, lat, lng, venue:venue_profile_id(id, name, suburb, location, state, postcode, lat, lng)')
      .eq('status', 'live')
      .or('is_public.eq.true,is_public.is.null')
      .limit(500),
    // ⚠ `artist_name` IS A PLAIN COLUMN on lineup_members, so this covers
    // hand-entered acts that have no profile at all — the same names the event
    // page prints. on_bill only: an offer nobody accepted is not a lineup.
    supabase.from('lineup_members')
      .select('event_id, artist_name')
      .eq('status', 'on_bill')
      .limit(1000),
  ]);

  const artistNamesByEvent = {};
  for (const m of billRes.data || []) {
    if (!m.event_id || !m.artist_name) continue;
    (artistNamesByEvent[m.event_id] ||= []).push(m.artist_name);
  }
  return { events: evRes.data || [], artistNamesByEvent };
}

export default function DiscoverScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const userId = session?.user?.id || null;
  /**
   * ⭐⭐ CAN THIS VIEWER SHORTLIST ANYBODY? Only if they host events.
   *
   * ⛔⛔ THE HOST PROFILE ID, ⛔ NOT JUST THE ACCOUNT. `ownedByFilter` needs
   * both arms: `host_id` is NULL on 82 of 92 events, so an account-only filter
   * would match almost nothing and the picker would report that you host no
   * events. Resolved through `getOwnedProfileOfType`, the same route the rest
   * of the app uses.
   *
   * ⚠ It is `.limit(1)`, so an account holding several HOST profiles resolves
   * to one of them. That is the limitation HostDashboard already has, and the
   * two agreeing matters more than either being clever.
   */
  const [hostProfileId, setHostProfileId] = useState(null);
  const [shortlisting, setShortlisting] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!userId) { setHostProfileId(null); return; }
    getOwnedProfileOfType(userId, 'host').then(pr => { if (!cancelled) setHostProfileId(pr?.id || null); });
  return () => { cancelled = true; };
  }, [userId]);

    /**
   * ⭐ THE SHORTLIST CONTROL, only where it makes sense.
   *
   * ⛔ HOSTS ONLY — no `hostProfileId`, no button. A viewer who runs no events
   * has nothing to shortlist anyone TO, and offering it would open a sheet
   * saying so.
   *
   * ⛔ PERFORMERS ONLY. `lineup_members` is a bill of acts; a venue or another
   * host is not something you put on one. Excluded by type rather than by
   * guessing from the card.
   */
  const canShortlist = r => !!hostProfileId && isBookableAct(r);
  const shortlistBtn = r => canShortlist(r) ? (
    <button
      onClick={e => { e.stopPropagation(); setShortlisting(r); }}
      title={`Shortlist ${r.name || 'this artist'} for one of your events`}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2,
        padding: '6px 10px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
        /* ⚠ LIFTED CLEAR OF THE HEART. `followAction` is absolutely positioned
           at bottom:8/right:10, while this sits in `actions`, which ProfileCard
           centres vertically — so on a 72px row the two overlapped in the
           bottom-right corner. Raised here rather than by realigning
           ProfileCard's actions slot, because FollowingSection uses that slot
           too and has no heart to avoid. */
        marginBottom: 28,
        /* ⭐ THE GRADIENT-BORDER TECHNIQUE ALREADY IN THE APP — two backgrounds,
           one clipped to the padding box for the fill and one to the border box
           for the edge, with a transparent border to reveal it. Same as the
           FOLLOW control on a slot card, so the brand edge means one thing.
           ⛔ The border must stay `transparent`; a colour would paint over the
           gradient and the edge would silently go flat. */
        border: '1.5px solid transparent',
        background: 'linear-gradient(var(--card),var(--card)) padding-box, linear-gradient(135deg,#00E5FF,#BF5FFF) border-box',
        /* ⚠ WHITE INK, not the accent. Thin Bebas at 10px in a saturated cyan is
           the least legible thing on a card — the same reason the enquiry
           status chip puts white text inside a coloured edge. */
        color: '#fff',
      }}
    >+ SHORTLIST</button>
  ) : null;

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

  /**
   * ONE SEED PER OPEN — minted at mount, never during a render.
   *
   * The cache and the shuffle are deliberately separated. The query key stays
   * ['discover','default'] so returning to Discover does not refetch, and the
   * ORDER still changes because the seed is component state: a new mount is a
   * new seed, a re-render is not. Reseeding on every render would reshuffle the
   * rail while the reader was looking at it.
   */
  const [railSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));

  // Default view — cached by React Query
  const { data: defaultPool = [], isLoading: defaultLoading } = useQuery({
    queryKey: ['discover', 'default'],
    queryFn: fetchDefault,
  });

  // Events are not shuffled — they carry a date, and "what's on soonest" is an
  // answer, not a preference. Only the profile rail is drawn.
  const defaultItems = useMemo(() => [
    ...composeRail(defaultPool.filter(r => r._kind === 'profile'), railSeed),
    ...defaultPool.filter(r => r._kind === 'event'),
  ], [defaultPool, railSeed]);

  const queryClient = useQueryClient();

  const runSearch = useCallback(async (q, t, g, st, pc) => {
    setSearching(true);
    const tokens = tokenise(q);
    const searches = [];
    const resolvedPostcodes = resolveLocationToPostcodes(pc);

    if (t !== 'event') {
      let profileQ = supabase.from('profiles')
        // M5: id included; is_live hides only explicit false (see fetchDefault)
        .select('id, user_id, name, type, avatar, location, suburb, state, postcode, lat, lng, sound, genre_string, bio, venue_type, updated_at')
        .in('type', t ? [t] : ['artist','host','band','standup','venue'])
        .or('is_live.is.null,is_live.neq.false')
        .order('updated_at', { ascending: false })
        // Wider than it used to be (30) because the database now returns
        // ANY-word candidates and rankProfiles does the narrowing — a
        // two-word query has more to choose from, and the best match must not
        // fall outside the window before it is ever scored.
        .limit(60);
      // ⭐ ONE CLAUSE PER WORD PER FIELD. The old filter interpolated the whole
      // query string into one ilike, so "techno bellingen" asked for a single
      // field containing that exact phrase and matched nothing — the genre is
      // on one column and the town on another.
      if (tokens.length) profileQ = profileQ.or(profileOrFilter(tokens, PROFILE_MATCH_FIELDS));
      if (st) profileQ = profileQ.or(`state.ilike.%${st}%,location.ilike.%${st}%`);
      if (pc) {
        // Match on suburb/city text OR any resolved postcodes
        const locFilters = [`location.ilike.%${pc}%`, `suburb.ilike.%${pc}%`];
        if (resolvedPostcodes.length) resolvedPostcodes.forEach(p => locFilters.push(`postcode.eq.${p}`));
        profileQ = profileQ.or(locFilters.join(','));
      }
      searches.push(profileQ.then(({ data }) => rankProfiles(data || [], tokens)
        .map(p => ({ ...p, _kind: 'profile' }))));
    }

    if (!t || t === 'event') {
      /**
       * ⭐⭐ EVENTS ARE MATCHED IN THE CLIENT, AGAINST THE WHOLE CORPUS.
       *
       * The old query was `ilike('name', …)` — an event was findable only by
       * its own title, so searching a venue found the venue's profile and none
       * of its gigs (reported by the owner, 2026-08-17). Everything worth
       * matching on lives somewhere the database cannot cheaply reach in one
       * filter: the blurb and genres are inside `config` jsonb, the venue is
       * behind `venue_profile_id`, and the bill is a different table entirely.
       *
       * ⚠ THIS IS ONLY REASONABLE BECAUSE THE CORPUS IS SMALL — 88 live public
       * events, ~115 kB, measured 2026-08-17. It is fetched ONCE per screen and
       * reused for every keystroke, which is fewer bytes than the per-keystroke
       * queries it replaces. ⛔ If events reach the low thousands this has to
       * move back to the database (a tsvector column, or an RPC); the ranking
       * in lib/discoverSearch is already pure so only the fetch would change.
       */
      const corpus = await queryClient.fetchQuery({
        queryKey: ['discover', 'searchCorpus'],
        queryFn:  fetchSearchCorpus,
        staleTime: 5 * 60 * 1000,
      });
      searches.push(Promise.resolve(
        rankEvents(corpus.events, tokens, {
          todayStr: today(),
          artistNamesByEvent: corpus.artistNamesByEvent,
        }).map(e => ({ ...e, _kind: 'event' })),
      ));
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
  }, [queryClient]);

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

  // Order comes from fetchDefault (registered-with-own-photo first) and is
  // preserved through applyLocalFilters, which filters without reordering.
  // Search results keep their own relevance order untouched — demoting an
  // unclaimed venue whose name someone just typed would answer a different
  // question than the one they asked.
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
              {/* ⚠ EVERY `s.sectionHead` DIV BELOW ALSO CARRIES
                  `data-tour="discover-section"` — same mechanism as
                  WhatsOnScreen's waypoints: the tour's Discover step scrolls
                  the real page stop-to-stop through whichever of these are
                  actually rendered right now, found by querying this shared
                  attribute rather than hardcoding which sections exist. */}
              {isDefault && profiles.length > 0 && (
                <>
                  <div className={s.sectionRow}>
                    <div data-tour="discover-section" className={s.sectionHead}>RECENTLY ADDED / ACTIVE</div>
                    <div className={s.gradientLine} />
                  </div>
                  {/* `data-tour` is the guided tour's anchor for auto-scrolling this
                      rail during its Discover step — a CSS-module class is
                      content-hashed and unreachable from outside this file. */}
                  <div data-tour="discover-rail" className={s.hScroll} ref={profilesDrag.ref} onMouseDown={profilesDrag.onMouseDown} onMouseMove={profilesDrag.onMouseMove} onMouseUp={profilesDrag.onMouseUp} onMouseLeave={profilesDrag.onMouseLeave}>
                    {profiles.map(p => (
                      <PortraitCard key={p.id ?? p.user_id} profile={p}
                        followAction={<FollowHeartBtn profile={p} />} />
                    ))}
                  </div>
                </>
              )}
              {isDefault && events.length > 0 && (
                <>
                  <div className={s.sectionRow} style={{ marginTop: profiles.length ? 20 : 0 }}>
                    <div data-tour="discover-section" className={s.sectionHead}>RECENTLY ADDED EVENTS</div>
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
              {/* ⭐ LOCALS — moved here from What's On (owner, 2026-08-21:
                  "under the recently added events"). The pool is THIS page's
                  event list, so the rails still only show people with
                  something coming up — Discover's search stays the directory,
                  and this stays the shortlist. */}
              {isDefault && events.length > 0 && (
                <LocalsRails events={events} originCoords={originCoords} radiusKm={radiusKm} />
              )}

              {!isDefault && items.length === 0 && (
                <p className={s.hint}>No results found. Try a different search or filter.</p>
              )}
              {!isDefault && (
                <>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, ...(visibleCount < items.length ? { maskImage:'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage:'linear-gradient(to bottom, black 75%, transparent 100%)' } : {}) }}>
                    {withEventsVisible(items, visibleCount).map(r =>
                      r._kind === 'event'
                        ? <EventCard key={r.id} event={r} />
                        : <ProfileCard key={r.id ?? r.user_id} item={r} actions={shortlistBtn(r)} followAction={<FollowHeartBtn profile={r} />} />
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
                    <div data-tour="discover-section" className={s.sectionHead}>LOCATION UNAVAILABLE</div>
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
                        : <ProfileCard key={r.id ?? r.user_id} item={r} actions={shortlistBtn(r)} followAction={<FollowHeartBtn profile={r} />} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {/* ⚠ INSIDE THE ROOT. It sits at the end of the tree rather than beside
          it — a sibling of the root needs a fragment, and the sheet is
          position:fixed so its place in the DOM changes nothing visually. */}
      {shortlisting && (
        <ShortlistToEventSheet
          artist={shortlisting}
          userId={userId}
          hostProfileId={hostProfileId}
          onClose={() => setShortlisting(null)}
        />
      )}
    </div>
  );
}
