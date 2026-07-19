import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId } from '../lib/actingProfile';
import { writeNotification } from '../lib/writeNotification';
import { useSession, usePlayer } from '../App';
import EventCard from '../components/EventCard';
import { getEventBadges, resolveCategoryBadge, OPEN_MIC_BADGE } from '../lib/eventBadges';
import s from './ProfileScreen.module.css';
import ClaimDialog from '../components/ClaimDialog';
import InviteSheet from '../components/InviteSheet';
import { resolveProfileRoute, profileUrl } from '../lib/profileResolution';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';
import { formatLocation } from '../lib/formatLocation';
import { socialProfileUrl, ensureHttps } from '../lib/socialLinks';
import ProfileSocialLinks from '../components/ProfileSocialLinks';
import AvailabilityCalendar from '../components/AvailabilityCalendar';
import { selectedPerformanceRoleLabels, selectedArtistRoleLabels, ARTIST_ROLES, HOST_CATEGORIES } from '../lib/profileTaxonomy';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { isProfileUnclaimed } from '../lib/profileClaim';
import UnclaimedBadge from '../components/UnclaimedBadge';

const OLD_CATS = new Set(['ELECTRONIC','BANDS','SPOKEN','SPOKEN WORD','RAVE','FESTIVAL']);
// Host genre_string leads with broad category KEYS (ELECTRONIC/BANDS/…); filter
// them out of the public "WE BOOK" list so it reads as actual programming genres.
const HOST_CAT_KEYS = new Set(HOST_CATEGORIES.map(c => c.key));

// Who a venue can book. Hosts/promoters and other venues aren't performers, so
// they never get the enquire action.
const BOOKABLE_TYPES = ['artist', 'band', 'standup'];

export default function ProfileScreen() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type');
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [bioExpanded,   setBioExpanded]   = useState(false);
  const [heroLoaded,    setHeroLoaded]    = useState(false);
  const heroImgRef = useRef(null);
  const [followed,    setFollowed]    = useState(false);
  const [followBusy,  setFollowBusy]  = useState(false);
  const { player, setPlayer } = usePlayer();
  const [availOpen,     setAvailOpen]     = useState(false);
  const [availDates,    setAvailDates]    = useState(null);
  const [eventDates,    setEventDates]    = useState(new Set());
  const [availMonth,    setAvailMonth]    = useState(() => { const d = new Date(); d.setDate(1); return d; });
  // 11C.3: read-only public performer availability (artist/band/standup).
  const [perfAvailOpen,  setPerfAvailOpen]  = useState(false);
  const [perfAvailDates, setPerfAvailDates] = useState(null);
  const [showPast,      setShowPast]      = useState(false);
  const [showAllUp,     setShowAllUp]     = useState(false);
  const [showAllPast,   setShowAllPast]   = useState(false);
  const [pastGigSearch, setPastGigSearch] = useState('');
  const [gigsView,      setGigsView]      = useState('portrait'); // 'portrait' | 'list'
  const [pickerDate,    setPickerDate]    = useState(null);
  const [pickerProfs,   setPickerProfs]   = useState([]);
  const [enquiryProf,   setEnquiryProf]   = useState(null);
  const [enquiryNote,   setEnquiryNote]   = useState('');
  const [enquirySending,setEnquirySending]= useState(false);
  const [enquiryLoading,setEnquiryLoading]= useState(false);
  const [claimOpen,         setClaimOpen]         = useState(false);
  const [inviteOpen,        setInviteOpen]        = useState(false);
  const [inviteDate,        setInviteDate]        = useState(null); // 11C.3: date tapped on the availability calendar, prefilled into InviteSheet
  // Set only when the viewer owns a venue and is looking at someone bookable —
  // gates the profile's primary "enquire" action. { id, events }.
  const [venueCtx,          setVenueCtx]          = useState(null);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['profile', id, typeFilter],
    queryFn: async () => {
      // M5: canonical resolution by profiles.id, with the permanent legacy
      // shim (profiles.user_id) behind it — see lib/profileResolution.js.
      // The placeholder_profiles fallback is retired: staging rows are not
      // publicly navigable (spec S1); every live placeholder was promoted
      // into profiles by M3.
      const preferPerformer = searchParams.get('prefer') === 'performer';
      const { profile: ownedProfile, isLegacyHit } = await resolveProfileRoute(id, { typeFilter, preferPerformer });

      if (!ownedProfile) return { profile: null, events: [], isLegacyHit: false };

      let events = [];
      if (ownedProfile.type === 'venue') {
        // Attribution split (M1/M5): public attribution reads venue_profile_id,
        // never the auth-only host_id.
        const eRes = await supabase.from('events').select('id,name,config').eq('venue_profile_id', ownedProfile.id).in('status', ['live','completed']).order('created_at', { ascending: false }).limit(100);
        events = eRes.data || [];
      } else if (ownedProfile.type === 'host') {
        // 11C.6: a host's HOSTED events — events.host_id is the promoter's
        // account (see CreateEventScreen / HostDashboard). NOT lineup_members:
        // a host doesn't perform, so the performer query below returned nothing,
        // leaving every host's event sections empty.
        //
        // Phase 16 §14 — ask the PROFILE-shaped question, not the account one.
        // `host_id` is AUTHORSHIP (which human created the row, O-R4). An
        // imported event has no author and never will, so matching ownership on
        // host_id could never surface Studio-imported listings — and an
        // unclaimed host has no user_id at all, so this branch returned nothing
        // for exactly the profiles custodial publication creates.
        //
        // `owner_profile_id` is AUTHORITY and works for claimed and unclaimed
        // alike. host_id is kept as a compatibility arm so events created before
        // owner_profile_id was populated still appear.
        const ownerFilters = ['owner_profile_id.eq.' + ownedProfile.id];
        if (ownedProfile.user_id) ownerFilters.push('host_id.eq.' + ownedProfile.user_id);
        const eRes = await supabase.from('events').select('id,name,config')
          .or(ownerFilters.join(','))
          .in('status', ['live','completed'])
          .order('created_at', { ascending: false }).limit(100);
        events = eRes.data || [];
      } else {
        // Compatibility read until M8: newer/unclaimed-linked rows carry the
        // canonical artist_profile_id; only genuinely un-migrated rows (null
        // artist_profile_id) fall back to the legacy artist_id (account) key.
        // The account key alone is NOT profile-specific — a multi-profile
        // account would otherwise inherit every sibling profile's gigs (e.g. a
        // Comedy/Poetry profile showing a DJ set booked under the same
        // account) — so the legacy fallback stays scoped to 'artist' only,
        // the one type it originally existed for; every other type requires a
        // genuine artist_profile_id-linked row.
        const legs = [`artist_profile_id.eq.${ownedProfile.id}`];
        if (ownedProfile.user_id && ownedProfile.type === 'artist') legs.push(`and(artist_id.eq.${ownedProfile.user_id},artist_profile_id.is.null)`);
        const claimsRes = await supabase.from('lineup_members').select('event_id').or(legs.join(',')).neq('status', 'removed');
        const eventIds = [...new Set((claimsRes.data || []).map(c => c.event_id).filter(Boolean))];
        if (eventIds.length) {
          const eRes = await supabase.from('events').select('id,name,config').in('id', eventIds).order('id', { ascending: true }).limit(10);
          events = eRes.data || [];
        }
      }
      return { profile: ownedProfile, events, isLegacyHit };
    },
    enabled: !!id,
    staleTime: 0,
  });

  const profile     = data?.profile || null;
  const events      = data?.events  || [];
  // M5: unclaimed state is a property of the row, not of which table answered.
  // M15: this test is now the canonical predicate — the same one every other
  // surface uses. `profile` here comes from profileResolution's select('*'),
  // so user_id is always present and the answer is unchanged.
  const isUnclaimed = isProfileUnclaimed(profile);
  // Legacy entity key for the follows table's mixed keyspace: account id for
  // claimed targets (byte-identical to pre-M5 rows), profile id for unclaimed.
  const legacyEntityId = profile ? (profile.user_id ?? profile.id) : null;

  // M5 legacy redirect shim (permanent): a /profile/<user_id> URL resolves,
  // then pins to the canonical /profile/<profiles.id> URL.
  useEffect(() => {
    if (!data?.isLegacyHit || !data?.profile) return;
    const prefer = searchParams.get('prefer');
    navigate(profileUrl(data.profile) + (prefer ? `&prefer=${prefer}` : ''), { replace: true });
  }, [data?.isLegacyHit, data?.profile?.id]);

  useEffect(() => {
    const heroUrl = profile?.avatar_hero;
    if (!heroUrl) {
      // No separate hero — just show whatever image we have, unblurred
      if (profile?.avatar_thumb || profile?.avatar) setHeroLoaded(true);
      return;
    }
    setHeroLoaded(false);
    const img = new window.Image();
    img.onload = () => setHeroLoaded(true);
    img.src = heroUrl;
  }, [profile?.avatar_hero, profile?.avatar_thumb, profile?.avatar]);

  // Scroll-driven hero zoom-out — pulls the photo back inside its frame as
  // the user scrolls one viewport height, then holds. Animates background-
  // size (144% -> 104%) rather than transform: scale() on the element: the
  // box itself never resizes, so there's no gap at the edges revealing the
  // separately-cropped/blurred .heroBg layer underneath. Written straight to
  // the DOM (not React state) so it doesn't trigger a re-render per scroll
  // tick. Skipped for the placeholder-avatar case, which sets its own fixed
  // background-size.
  useEffect(() => {
    function handleScroll() {
      const el = heroImgRef.current;
      if (!el || el.dataset.zoomable === 'false') return;
      const progress = Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1);
      // Mobile only: scale the resting photo up (168% vs the original 144%) so its
      // bottom edge clears where the content layer goes solid — a square/short
      // image otherwise ended mid-frame with a hard sharp→blur line at its foot.
      // On desktop the frame is capped at 680px wide, so 144% already renders the
      // image tall enough that its foot falls off-screen; it keeps the original.
      // Both ease back to a framed 104% over one viewport of scroll.
      const base = window.innerWidth < 640 ? 168 : 144;
      el.style.backgroundSize = `${base - progress * (base - 104)}% auto`;
    }
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Load follow state once profile is known (M5: keyed on the resolved
  // profile, covering both the legacy entity_id keyspace and the canonical
  // target_profile_id)
  useEffect(() => {
    if (!profile?.id || !session?.user?.id) return;
    supabase.from('follows').select('id')
      .eq('user_id', session.user.id)
      .or(`target_profile_id.eq.${profile.id},entity_id.eq.${legacyEntityId}`)
      .limit(1)
      .then(({ data: fol }) => setFollowed(!!(fol && fol.length)));
  }, [profile?.id, session?.user?.id]);

  // Booking runs both ways, so the profile is the front door both ways: an
  // artist enquires from a venue's profile (CHECK AVAILABILITY, below), and a
  // venue enquires from a performer's profile (this). Previously the only way
  // in from the venue side was an INVITE button buried in the dashboard's
  // Regulars list — and only in its non-default list view — so the whole
  // invitation flow was effectively unreachable.
  useEffect(() => {
    if (!session?.user?.id || !profile?.id) return;
    if (!BOOKABLE_TYPES.includes(profile.type)) return;
    // NOTE: no "skip my own account" guard here (IA-01). The enquiry actor is
    // always your VENUE profile and the target is always a PERFORMER profile —
    // two different profiles, even when the same login owns both. So a venue
    // enquiring to its own act is a legitimate profile-to-profile booking, and
    // it goes through the identical InviteSheet flow. This is the one venue-
    // initiated case that already passes RLS today (applicant_user_id === you),
    // so it works pre-M6. Attribution ≠ authorization.
    if (isUnclaimed) return;                           // nobody to receive it
    let cancelled = false;
    (async () => {
      const { data: venue } = await supabase.from('profiles')
        .select('id, user_id').eq('user_id', session.user.id).eq('type', 'venue').maybeSingle();
      if (cancelled || !venue) return;
      // Events are attributed by host_id on this table (see VenueDashboard).
      const { data: evs } = await supabase.from('events')
        .select('id, name, status, config').eq('host_id', session.user.id)
        .neq('status', 'completed').order('created_at', { ascending: false }).limit(20);
      if (!cancelled) setVenueCtx({ id: venue.id, events: evs || [] });
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id, profile?.id, profile?.type, isUnclaimed]);

  // 11C.3: load this performer's public availability. Artist/Band/Comedy all
  // share one account-keyed table (artist_availability, by user_id) — the same
  // single source of truth the dashboard editor writes to. Read-only here: no
  // write path, no enquiry change. Cleared for non-performers so stale dates
  // never leak across a client-side profile→profile navigation (cf. S40).
  useEffect(() => {
    if (!profile?.id || !BOOKABLE_TYPES.includes(profile.type) || !profile.user_id) { setPerfAvailDates(null); return; }
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data: rows } = await supabase.from('artist_availability')
        .select('available_date').eq('user_id', profile.user_id).gte('available_date', today).order('available_date');
      if (!cancelled) setPerfAvailDates(new Set((rows || []).map(r => r.available_date)));
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.type, profile?.user_id]);

  async function openEnquiry(dateStr) {
    if (!session?.user?.id) return;
    setEnquiryLoading(true);
    const { data: profs } = await supabase.from('profiles')
      .select('id, user_id, type, name, avatar, location, genre_string, sound')
      .eq('user_id', session.user.id)
      .neq('type', 'punter').neq('type', 'venue');
    if (!profs?.length) return;
    const mapped = profs.map(p => ({ ...p, label: PROFILE_TYPES[p.type]?.label || p.type.toUpperCase() }));
    setEnquiryLoading(false);
    setPickerDate(dateStr);
    if (mapped.length === 1) { setEnquiryProf(mapped[0]); setPickerProfs([]); }
    else { setPickerProfs(mapped); setEnquiryProf(null); }
  }

  async function sendEnquiry() {
    if (!enquiryProf || !pickerDate || enquirySending) return;
    setEnquirySending(true);
    // Dual-write (M2 invariant): both sides are already-resolved profiles rows,
    // so the profile ids are direct assignments, not lookups. The enquiry UI only
    // renders for isVenue && !isUnclaimed, so `profile` is a real claimed venue
    // row. M5: identity values derive from the loaded row, never the route param.
    const { error } = await supabase.from('venue_enquiries').insert({
      venue_user_id:        profile.user_id,
      applicant_user_id:    session.user.id,
      applicant_type:       enquiryProf.type,
      venue_profile_id:     profile?.id ?? null,
      applicant_profile_id: enquiryProf.id ?? null,
      date_requested:       pickerDate,
      note:                 enquiryNote.trim() || null,
      // Absolute, not viewer-relative: this flow is the applicant approaching a
      // venue. InviteSheet writes 'venue' for the mirror case. The UI derives
      // incoming/outgoing from this — see enquiryUtils.deriveDirection.
      initiated_by:         'applicant',
      status:               'pending',
    });
    setEnquirySending(false);
    if (error && !error.message?.includes('duplicate') && !error.message?.includes('unique')) {
      console.error('venue_enquiries insert failed:', error.code, error.message, error.details, error.hint);
    }
    if (!error || error.message?.includes('duplicate') || error.message?.includes('unique')) {
      setEnquiryProf(null); setPickerDate(null); setEnquiryNote('');
    }
  }

  if (loading) return (
    <div className={s.screen}>
      <p className={s.loading}>LOADING…</p>
    </div>
  );

  if (!profile) return (
    <div className={s.screen}>
      <p className={s.loading}>Profile not found.</p>
    </div>
  );

  async function toggleFollow() {
    if (!session?.user?.id || followBusy) return;
    if (followed) {
      setFollowBusy(true);
      // M5: cover both keyspaces — legacy rows keyed by entity_id, canonical
      // rows by target_profile_id.
      await supabase.from('follows').delete()
        .eq('user_id', session.user.id)
        .or(`target_profile_id.eq.${profile.id},entity_id.eq.${legacyEntityId}`);
      setFollowed(false);
      setFollowBusy(false);
      return;
    }
    // Following is a USER-level relationship, not a per-profile one: who you
    // follow is the same on every screen, whichever of your profiles you are
    // looking at. So there is nothing to choose and no picker to show.
    //
    // A "follow from which profile?" picker used to appear here for accounts
    // with more than one profile. It was removed because it could not work:
    // it collected profile TYPES ('artist', 'band') and passed them to
    // doFollow(), which expects ACCOUNT ids and resolves
    // getPersonalProfileId(uid) regardless — so the selection was discarded
    // and every follow was written from Personal anyway. The UI offered a
    // choice the write path could not honour, and its "FOLLOW FROM 2 PROFILES"
    // label described something that never happened.
    //
    // Personal is now the single, honest answer. If per-profile following is
    // ever wanted, it needs the follows table and doFollow() reworked first —
    // not a picker bolted back onto a user-level write.
    await doFollow(session.user.id);
  }

  async function doFollow(userIds) {
    setFollowBusy(true);
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    // M5: identity values derive from the loaded profile row, never the route
    // param. Written columns are unchanged (entity_id + dual-written
    // target_profile_id); for claimed targets the values are byte-identical
    // to pre-M5 rows.
    // M6 (R6.1): stamp attribution at write time. Resolved per uid — this
    // path can write for more than one account, and a shared lookup would
    // attribute one human's follow to another's profile.
    // Supabase RETURNS errors, it does not throw them. This result was
    // previously discarded, so a rejected insert was indistinguishable from a
    // successful one: the UI set followed=true, wrote a "new follower"
    // notification, and the row never existed. That is exactly how a broken
    // follow picker went unnoticed — three notifications were delivered to a
    // real person for a follow that never happened. Never discard it again.
    const results = await Promise.all(ids.map(async uid =>
      // entity_type is the FOLLOWED PROFILE'S TYPE — 'artist' / 'venue' /
      // 'host' / 'band' / 'standup' — not the literal string 'profile'.
      // A CHECK constraint (follows_entity_type_check) permits only the
      // profile types, so 'profile' was rejected with 23514 on every insert.
      // Every pre-existing row stores the type, so this restores the original
      // convention rather than inventing one.
      supabase.from('follows').insert({ user_id: uid, from_profile_id: await getPersonalProfileId(uid), entity_id: legacyEntityId, entity_type: profile.type, entity_name: profile.name, target_profile_id: profile.id })
    ));
    const failed = results.filter(r => r?.error);
    if (failed.length) {
      // Printed as text, not as an object: a collapsed [{…}] in the console
      // hides the one thing worth reading — code, message, details, hint.
      failed.forEach(f => console.error(
        '[follow] insert rejected —',
        `code=${f.error?.code}`,
        `message=${f.error?.message}`,
        `details=${f.error?.details}`,
        `hint=${f.error?.hint}`,
      ));
      setFollowBusy(false);
      setFollowed(false);
      return;   // no optimistic success, and no notification for a follow that did not happen
    }
    // Bust the My Scene cache so the new follow appears immediately
    queryClient.invalidateQueries({ queryKey: ['myScene'] });
    // Notify the profile owner that someone followed them
    // §A7: no inference needed here — both identities are known outright.
    // to = the profile that was followed (this page). about = the follower's
    // Personal profile, the same one the follow rows were attributed to.
    if (profile.user_id) await writeNotification({
      toUserId:       profile.user_id,
      toProfileId:    profile.id,
      aboutProfileId: await getPersonalProfileId(session.user.id),
      type:    'new_follower',
      message: `Someone followed your profile${profile.name ? ` — ${profile.name}` : ''}.`,
      data:    { follower_id: session.user.id },
    });
    setFollowed(true);
    setFollowBusy(false);
  }

  // Sharing lives in the header (GlobalHeader's Share icon) as the single
  // share action — see 11C.1 revision. No profile-local share() here.

  const pt      = PROFILE_TYPES[profile.type] || PROFILE_TYPES.artist;
  const col     = pt.accent;
  const rgb     = pt.rgb;
  const grad2   = pt.accent2;
  const isHost    = profile.type === 'host';
  const isVenue   = profile.type === 'venue';
  const isStandup = profile.type === 'standup';
  // A Band's link is an EPK / Spotify / Bandcamp URL (BandProfileScreen's field is
  // literally "LINK TO MUSIC OR PRESS KIT"), stored in the DJ-named mix_link column.
  // "DEMO MIX" is DJ vocabulary and was showing on every Band profile.
  const isBand    = profile.type === 'band';
  const isArtist  = profile.type === 'artist';
  const isPerformer = isArtist || isBand || isStandup;
  // M5: always a profiles-shaped row; any profile (claimed or not) falls back
  // to the generic type imagery (never a real likeness) when it has no avatar.
  const hasRealAvatar = !!(profile.avatar_hero || profile.avatar_thumb || profile.avatar);
  const heroUrl = profile.avatar_hero || profile.avatar_thumb || profile.avatar
    || pt.defaultImage || null;
  // The type pill states WHAT THIS PROFILE IS, always from PROFILE_TYPES — the
  // canonical source — for every type. VENUE / HOST / PROMOTER / DJ / PROD. /
  // BAND / COMEDY / POETRY.
  //
  // It previously fell through to band_type or act_type first, which put a
  // SUBTYPE where the type belongs: a band read "Jazz / Blues" instead of
  // "BAND", and a Studio-imported artist read "DJs" — Studio's internal
  // taxonomy rendered verbatim on a public profile. Genre already has a home
  // in the STYLE section directly below, so the pill was also duplicating it.
  //
  // act_type is written by nothing in this app and defined by no taxonomy;
  // band_type is user-set in BandProfileScreen and still stored, just no longer
  // mistaken for the profile's type.
  const label   = pt.label;
  // Standup: one pill per selected "what do you perform?" role (Comedy/
  // Poetry). Artist: same concept for DJ/Producer/MC. Both data-driven so a
  // future role works with no call-site change. Falls back to the generic
  // label above until roles have been selected.
  const roleLabels = isStandup ? selectedPerformanceRoleLabels(profile.genre_string)
    : isArtist ? selectedArtistRoleLabels(profile.genre_string)
    : [];
  const badgeLabels = roleLabels.length ? roleLabels : [label];
  // Postcode dropped from this header line specifically — town + state reads
  // cleaner here; formatLocation still returns the full "Suburb, STATE
  // POSTCODE" for every other call site (event cards, dashboards, etc).
  const loc     = formatLocation({ ...profile, postcode: undefined });
  const mixLink = ensureHttps(profile.mix_link) || socialProfileUrl('soundcloud', profile.soundcloud) || socialProfileUrl('mixcloud', profile.mixcloud) || '';

  const tagline = (() => {
    const tl = (profile.tagline || '').trim();
    if (!tl) return '';
    const isOld = tl.split(' · ').every(t => OLD_CATS.has(t.trim().toUpperCase()));
    return isOld ? '' : tl;
  })();

  // Standup stores performance roles as tokens inside genre_string alongside
  // every style tag picked in the "PERFORMANCE STYLE" step — neither of those
  // belongs in the public "tags" pill list. Show only the curated "YOUR STYLE
  // TAGS" selection (card_pills) instead, same concept as every other type's
  // card_pills-based compact display, just applied to this section too.
  // Artist stores its DJ/Producer/MC roles inside genre_string the same way
  // (alongside genres/subs/vibes) — filter those role tokens back out so
  // they never show up as if they were genre tags.
  const ARTIST_ROLE_KEYS = new Set(ARTIST_ROLES.map(r => r.key));
  const genres = isStandup
    ? (profile.card_pills || '').split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean)
    : (profile.genre_string ? profile.genre_string.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean).filter(g => !isArtist || !ARTIST_ROLE_KEYS.has(g)).filter(g => !isHost || !HOST_CAT_KEYS.has(g)) : []);
  // card_pills is the curated "Your 5 Tags" — the collapsed view shows those
  // specifically, not just the first 5 tokens of the broader genre_string.
  // "+N more" then reveals whatever's left in genre_string that isn't
  // already one of the 5. Standup already sources `genres` straight from
  // card_pills (its roles live separately in genre_string), so there's no
  // separate broader list to fall back to there — same slice/expand as before.
  const cardTags = (!isStandup && profile.card_pills)
    ? profile.card_pills.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean)
    : [];
  const remainingGenres = cardTags.length ? genres.filter(g => !cardTags.includes(g)) : genres.slice(5);
  const defaultVisibleGenres = cardTags.length ? cardTags : genres.slice(0, 5);
  const visibleGenres = genreExpanded ? [...defaultVisibleGenres, ...remainingGenres] : defaultVisibleGenres;

  const na = v => !v || v === 'N/A';
  // M5: the placeholder row-shape branch (social_links JSONB) is gone — the
  // resolver only returns profiles rows, whose socials are flat columns
  // (M3's promotion unpacked social_links into them).
  const socials = [
        !na(profile.instagram)  && { href: socialProfileUrl('instagram', profile.instagram),   col: '#E1306C',     icon: 'instagram' },
        !na(profile.facebook)   && { href: socialProfileUrl('facebook', profile.facebook),     col: '#1877F2',     icon: 'facebook' },
        !na(profile.tiktok)     && { href: socialProfileUrl('tiktok', profile.tiktok),         col: '#fff',        icon: 'tiktok' },
        !na(profile.youtube)    && { href: socialProfileUrl('youtube', profile.youtube),       col: '#FF0000',     icon: 'youtube' },
        !na(profile.soundcloud) && { href: socialProfileUrl('soundcloud', profile.soundcloud), col: '#FF5500',     icon: 'soundcloud' },
        !na(profile.spotify)    && { href: socialProfileUrl('spotify', profile.spotify),       col: '#1DB954',     icon: 'spotify' },
        !na(profile.mixcloud)   && { href: socialProfileUrl('mixcloud', profile.mixcloud),     col: '#52aad8',     icon: 'mixcloud' },
        !na(profile.website)    && { href: ensureHttps(profile.website),                       col: 'var(--neon2)', icon: 'globe' },
        !na(profile.contact_email) && { href: `mailto:${profile.contact_email}`, col: '#aaaacc', icon: 'email' },
      ].filter(Boolean);

  return (
    <div className={s.screen}>
      {/* Fixed blurred background */}
      <div
        className={s.heroBg}
        style={heroUrl
          ? { backgroundImage: `url(${heroUrl})`, filter: 'blur(28px)' }
          : { background: `linear-gradient(135deg, rgba(${rgb},.6) 0%, rgba(0,0,0,.85) 55%, rgba(${rgb},.35) 100%)` }
        }
      />

      {/* Hero photo */}
      {heroUrl && (
        <div
          ref={heroImgRef}
          className={s.heroImg}
          data-zoomable={hasRealAvatar ? 'true' : 'false'}
          style={{
            backgroundImage: `url(${heroUrl})`,
            ...(hasRealAvatar
              ? { backgroundSize: '124% auto' }
              // Default (no photo yet — §09 requires a generic avatar pre-claim).
              // Was `auto 80%`, which sizes by HEIGHT: fine at phone width, but
              // .heroImg is capped at max-width 680px, so on desktop a portrait
              // placeholder (defaultdj.png is 941x1672, ratio 0.56) rendered only
              // ~405px wide inside a 680px frame — 137px of dead space each side,
              // which read as a broken image rather than a placeholder.
              // `cover` fills the frame at every width, exactly as a real photo
              // does, and works for the landscape defaults (band/mic, ratio ~1.5)
              // too.
              //
              // Anchored BOTTOM, overriding .heroImg's `center top`. These
              // placeholders put their subject low in the frame — defaultdj.png
              // is silhouette, hands and decks across its bottom ~55%, with the
              // top 40% only lights and haze. At 680px wide the image renders
              // 1208px tall in a 917px frame, so `top` cropped 291px off the
              // foot and threw away the entire subject, leaving a photo of an
              // empty ceiling. Anchoring to the bottom keeps the figure and
              // decks and discards the haze instead.
              //
              // Portrait-only concern: at phone width the frame is narrower than
              // the art, so height fills exactly and there is no vertical crop —
              // this changes nothing there. The landscape defaults crop
              // horizontally, where the anchor is still centred.
              // Lifted off the bottom edge by 9dvh. Bottom-anchoring alone is
              // enough on desktop, where cover leaves ~291px of vertical
              // overflow to give back — but at phone width the frame is
              // narrower than the art, so height fills EXACTLY, there is no
              // overflow, and `bottom` has nothing left to surrender. The decks
              // do render, flush to the foot of the viewport, underneath the
              // content layer and nav bar. Raising the image clears them into
              // view. On desktop this simply spends a little of the existing
              // overflow, so it costs nothing there.
              : { backgroundSize: 'cover', backgroundPosition: 'center calc(100% - 9dvh)' }),
          }}
        />
      )}

      {/* Gradient fade at top of hero — keeps header icons readable */}
      <div className={s.heroTopFade} />

      {/* Gradient fade at bottom of hero */}
      <div className={s.heroFade} />

      {/* Scrollable content */}
      <div className={s.scroll}>
        {/* Spacer = hero height */}
        <div className={s.heroSpacer} />

        {/* Name + badge row */}
        <div className={s.nameBlock}>
          <div className={s.name}>{profile.name}</div>
          <div className={s.metaRow}>
            {badgeLabels.map((l, i) => (
              <span key={i} className={s.badge} style={{ color: col, background: `rgba(${rgb},.15)`, borderColor: `rgba(${rgb},.35)` }}>{l}</span>
            ))}
            <UnclaimedBadge profile={profile} />
            {loc && (
              <span className={s.location}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 2 }}>
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {loc}
              </span>
            )}
            {(profile.years || profile.established_year) && <span className={s.est}>Est. {profile.years || profile.established_year}</span>}
          </div>
        </div>

        <div className={s.cards}>
          {/* Tagline */}
          {tagline && (
            <div className={s.tagline} style={{ background: `linear-gradient(135deg,${col},${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {tagline}
            </div>
          )}

          {/* Demo mix / sound */}
          {!isHost && !isVenue && (
            mixLink
              ? <>
                  <span style={{ display: 'block', padding: 1, borderRadius: 12, marginBottom: 12, background: `linear-gradient(135deg, ${col}, ${grad2})` }}>
                    <button className={s.mixBtn} style={{ borderColor: 'transparent', background: 'rgba(19,19,31,.92)', width: '100%', margin: 0 }}
                      onClick={() => {
                        if (mixLink.includes('soundcloud.com') || mixLink.includes('mixcloud.com')) {
                          if (player?.url === mixLink) { setPlayer(null); } else { setPlayer({ url: mixLink, artistName: profile.name }); }
                        } else {
                          window.open(mixLink, '_blank', 'noopener');
                        }
                      }}>
                      <span dangerouslySetInnerHTML={{ __html: seededWaveSvg(profile.name || '', rgb) }} />
                      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center' }}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill={col} style={{ verticalAlign: 'middle', marginRight: 6, flexShrink: 0 }}><polygon points="6,3 20,12 6,21"/></svg>
                        <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                          {player?.url === mixLink ? 'CLOSE PLAYER' : (isStandup ? 'PLAY DEMO' : isBand ? 'PLAY MUSIC' : 'PLAY DEMO MIX')}
                        </span>
                      </span>
                    </button>
                  </span>
                </>
              : <div className={s.mixPlaceholder}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 5, opacity: .5 }}>
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                  </svg>
                  {isStandup ? 'DEMO COMING SOON' : isBand ? 'MUSIC COMING SOON' : 'DEMO MIX COMING SOON'}
                </div>
          )}

          {/* Genre — non-venue. The sound descriptor sits inline next to the
              STYLE heading as an italic gradient-clip line (same technique as
              the tagline above); the genre list below renders as the shared
              simple tag pills — same quiet pill every profile type uses now,
              venue VIBE included (11C.4). Collapses to the first 5 with a
              "+N more" pill; tapping the block expands. */}
          {genres.length > 0 && !isVenue && (
            <div style={{ marginBottom: 12, cursor: remainingGenres.length > 0 ? 'pointer' : 'default' }} onClick={() => remainingGenres.length > 0 && setGenreExpanded(e => !e)}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div className={s.cardLabel} style={{ color: 'rgba(232,232,240,.5)', marginBottom: 0 }}>{isHost ? 'WE BOOK' : 'STYLE'}</div>
                {profile.sound && (
                  <div style={{ fontSize: 14, fontStyle: 'italic', lineHeight: 1.5, opacity: .9, background: `linear-gradient(135deg,${col},${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    {profile.sound}
                  </div>
                )}
              </div>
              <div className={s.tagPills}>
                {visibleGenres.map(g => <span key={g} className={s.tagPill}>{g}</span>)}
                {!genreExpanded && remainingGenres.length > 0 && (
                  <span className={`${s.tagPill} ${s.tagPillMore}`}>+{remainingGenres.length} more</span>
                )}
              </div>
            </div>
          )}

          {genres.length > 0 && !isVenue && (
            <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0 20px' }} />
          )}

          {/* Bio - non-venue only. Same de-chromed treatment as Genres: no
              card box, just a label and body text, with a standalone "READ
              MORE" line (not an inline "...see more") below the preview. */}
          {profile.bio && !isVenue && (
            <div style={{ marginBottom: 12 }}>
              <div className={s.cardLabel} style={{ color: 'rgba(232,232,240,.5)' }}>ABOUT</div>
              <div className={s.bioText}>
                {profile.bio.length <= 150 || bioExpanded ? profile.bio : `${profile.bio.slice(0, 150).trimEnd()}…`}
              </div>
              {profile.bio.length > 150 && (
                <div onClick={() => setBioExpanded(v => !v)} style={{ marginTop: 10, cursor: 'pointer', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1.5, color: col }}>
                  {bioExpanded ? 'READ LESS' : 'READ MORE'} <span style={{ marginLeft: 2 }}>&rsaquo;</span>
                </div>
              )}
            </div>
          )}

          {profile.bio && !isVenue && (
            <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0 20px' }} />
          )}

          {/* Venue: de-chromed to match the performer STYLE/ABOUT layout — no
              card box. VIBE section (neutral label + inline gradient sound +
              centred pills), then the VENUE INFO dropdown, each followed by the
              same divider line the performer sections use. */}
          {isVenue && (() => {
            const vibeTags = profile.card_pills
              ? profile.card_pills.split(' · ').map(t => t.trim()).filter(Boolean).slice(0, 5)
              : [];
            return (
              <>
                {vibeTags.length > 0 && (
                  <div className={s.tagPills} style={{ marginBottom: 20 }}>
                    {vibeTags.map(t => <span key={t} className={s.tagPill}>{t}</span>)}
                  </div>
                )}
                {/* Always a divider before VENUE INFO so an empty-vibe venue
                    (no tags) isn't cramped straight under the tagline. */}
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0 20px' }} />
                <VenueInfoDropdown bare profile={profile} col={col} rgb={rgb} grad2={grad2} socials={socials} />
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0 20px' }} />
              </>
            );
          })()}

          {/* Action buttons — Follow + Message first, then the booking CTA
              (Check Availability / Enquire) below, then the socials row.
              Share is not here — it lives as the header icon (GlobalHeader),
              the single share action (11C.1 revision). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, display: 'inline-block', padding: 1, borderRadius: 12, background: `linear-gradient(135deg, ${col}, ${grad2})` }}>
                <button
                  className={s.followBtn}
                  style={followed
                    ? { borderColor: 'transparent', color: '#0a0a0f', background: `linear-gradient(135deg, ${col}, ${grad2})`, width: '100%', margin: 0 }
                    : { borderColor: 'transparent', background: 'rgba(19,19,31,.92)', width: '100%', margin: 0 }}
                  onClick={toggleFollow}
                  disabled={followBusy || !session}
                >
                  {followed ? '✓ FOLLOWING' : <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>+ FOLLOW</span>}
                </button>
              </span>
              {/* Message — placeholder only. In-app messaging doesn't exist
                  yet, so the button is disabled and tagged SOON: it signals a
                  future capability without shipping dead UI or any backend
                  (11C.1 revision). Claimed profiles only — an unclaimed profile
                  has no user to message — matching the pre-11C.1 behaviour. The
                  muted border wrapper mirrors Follow's gradient wrapper so the
                  two buttons stay the same size, but reads inactive. */}
              {!isUnclaimed && (
                <span style={{ flex: 1, minWidth: 0, display: 'inline-block', padding: 1, borderRadius: 12, background: 'var(--border)' }}>
                  <button
                    type="button"
                    className={s.followBtn}
                    disabled
                    aria-label="Message — coming soon"
                    style={{ borderColor: 'transparent', background: 'rgba(19,19,31,.55)', width: '100%', margin: 0, cursor: 'not-allowed', opacity: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxSizing: 'border-box' }}
                  >
                    <span style={{ color: 'var(--muted)' }}>MESSAGE</span>
                    <span style={{ fontSize: 9, letterSpacing: 1, padding: '2px 6px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", lineHeight: 1 }}>SOON</span>
                  </button>
                </span>
              )}
            </div>
            {isVenue && !isUnclaimed && (
              <button
                className={s.followBtn}
                style={{ background: `linear-gradient(135deg, ${col}, ${grad2})`, color: '#0a0a14', borderColor: 'transparent', width: '100%' }}
                onClick={async () => {
                  setAvailOpen(true);
                  if (!availDates) {
                    const today = new Date().toISOString().split('T')[0];
                    // M5: availability keys on profile_id, event overlay on the
                    // attribution column — never the route param.
                    const [availRes, evRes] = await Promise.all([
                      supabase.from('venue_availability').select('available_date').eq('profile_id', profile.id).gte('available_date', today).order('available_date'),
                      supabase.from('events').select('config').eq('venue_profile_id', profile.id).eq('status', 'live'),
                    ]);
                    setAvailDates(new Set((availRes.data || []).map(r => r.available_date)));
                    const evDays = new Set((evRes.data || []).map(e => e.config?.date).filter(Boolean));
                    setEventDates(evDays);
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle', marginTop: -2 }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>CHECK AVAILABILITY
              </button>
            )}
            {/* 11C.3 revision: one CHECK AVAILABILITY button for performers.
                Opens the shared availability calendar. A venue-owning viewer can
                tap an available date to enquire (existing InviteSheet flow, date
                prefilled); everyone else sees it read-only. If the performer has
                no published availability, a venue owner's button opens the
                enquiry sheet directly — no lost enquiry path. */}
            {isPerformer && !isUnclaimed && ((perfAvailDates && perfAvailDates.size > 0) || venueCtx) && (
              <button
                className={s.followBtn}
                style={{ background: `linear-gradient(135deg, ${col}, ${grad2})`, color: '#0a0a14', borderColor: 'transparent', width: '100%' }}
                onClick={() => {
                  if (perfAvailDates && perfAvailDates.size > 0) setPerfAvailOpen(true);
                  else { setInviteDate(null); setInviteOpen(true); }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle', marginTop: -2 }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>CHECK AVAILABILITY
              </button>
            )}
            {/* Shared social links row beneath the action buttons — now on
                every profile type, venue included (11C.4: the venue's socials
                used to be buried inside the VENUE INFO dropdown). */}
            <div style={{ paddingTop: 12 }}><ProfileSocialLinks socials={socials} justify="center" /></div>
          </div>

          {/* Claim this profile — unclaimed profiles only (keyed on the row's
              claim state since M5; claiming is spec §7's manual-review flow) */}
          {isUnclaimed && (
            <div style={{ textAlign: 'center', marginTop: -4, marginBottom: 14 }}>
              {profile.claim_status === 'pending'
                ? <span style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2 }}>Claim under review</span>
                : <button
                    onClick={() => setClaimOpen(true)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.32)', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2, textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.15)', padding: '6px 2px' }}
                  >
                    Is this you? Claim this profile
                  </button>
              }
            </div>
          )}

          {/* Events sheet */}
          {(() => {
            const todayStr = new Date().toISOString().split('T')[0];
            const upcoming = events.filter(ev => (ev.config?.date || '9999') >= todayStr).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
            const past     = events.filter(ev => (ev.config?.date || '9999') <  todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
            const list     = showPast ? filterPastEvents(past, pastGigSearch) : upcoming;
            const showAll  = showPast ? showAllPast : showAllUp;
            const setAll   = showPast ? setShowAllPast : setShowAllUp;
            if (!upcoming.length && !past.length) return null;
            return (
              <div style={{ marginTop: 10, position: 'relative', padding: '30px 0 20px', marginLeft: -16, marginRight: -16, paddingLeft: 16, paddingRight: 16, background: 'linear-gradient(to bottom, transparent 0%, rgba(10,10,20,.7) 20%, rgba(10,10,20,.7) 80%, transparent 100%)' }}>
                {/* Tab pills + see all */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowPast(false); setShowAllUp(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${!showPast ? 'rgba(255,255,255,.4)' : 'var(--border)'}`, background: !showPast ? 'rgba(255,255,255,.1)' : 'none', color: !showPast ? '#fff' : 'rgba(255,255,255,.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      UPCOMING GIGS
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, background: !showPast ? 'rgba(255,255,255,.2)' : 'var(--card2)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: 0 }}>{upcoming.length}</span>
                    </button>
                    {past.length > 0 && <button onClick={() => { setShowPast(true); setShowAllPast(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${showPast ? 'rgba(255,255,255,.4)' : 'var(--border)'}`, background: showPast ? 'rgba(255,255,255,.1)' : 'none', color: showPast ? '#fff' : 'rgba(255,255,255,.8)' }}>PAST GIGS</button>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', background: 'var(--card2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {[['portrait', '▦'], ['list', '☰']].map(([v, icon]) => (
                        <button key={v} onClick={() => setGigsView(v)} style={{ background: gigsView === v ? 'rgba(255,255,255,.12)' : 'none', border: 'none', color: gigsView === v ? '#fff' : 'var(--muted)', padding: '5px 10px', cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'background .15s, color .15s' }}>{icon}</button>
                      ))}
                    </div>
                    {list.length > 0 && (
                      <span
                        onClick={() => setAll(v => !v)}
                        style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', opacity: 0.6, transition: 'opacity .15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                      >{showAll ? 'View less' : 'View all >'}</span>
                    )}
                  </div>
                </div>
                {showPast && past.length > 0 && (
                  <PastEventsSearch query={pastGigSearch} onChange={setPastGigSearch} />
                )}
                {list.length === 0
                  ? <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{showPast && pastGigSearch.trim() ? 'No past gigs match your search.' : `No ${showPast ? 'past' : 'upcoming'} gigs.`}</p>
                  : gigsView === 'portrait'
                  ? <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
                      {list.map(ev => {
                        const cfg = ev.config || {};
                        const poster = cfg.poster || cfg.posterUrl || '';
                        const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);
                        const dateObj = cfg.date ? new Date(cfg.date + 'T12:00:00') : null;
                        const dateStr = dateObj ? dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
                        const dateDay = dateObj ? dateObj.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase() : '';
                        const dateNum = dateObj ? dateObj.getDate() : '';
                        const dateMon = dateObj ? dateObj.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase() : '';
                        return (
                          <div key={ev.id} onClick={() => navigate(`/event/${ev.id}`)} style={{ position: 'relative', flexShrink: 0, width: 148, borderRadius: 12, overflow: 'hidden', background: '#0e0e18', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'transform .2s' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = ''}
                          >
                            {/* Image area */}
                            <div style={{ position: 'relative', height: 155, background: poster ? `url(${poster}) center/cover` : 'linear-gradient(135deg,#1a0533,#2d1b69)', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to bottom, transparent, #0e0e18)' }} />
                              {dateObj && <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: '4.5px 8px', textAlign: 'center', minWidth: 35 }}>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dateDay}</div>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: '#fff', lineHeight: 1 }}>{dateNum}</div>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dateMon}</div>
                              </div>}
                              {(() => { let badges = cfg.categoryBadge ? [resolveCategoryBadge(cfg.categoryBadge)] : getEventBadges(cfg.genres || '', ev.name || ''); if (cfg.openMicBadge && !badges.find(b => b.label === OPEN_MIC_BADGE.label)) { badges = [...badges, OPEN_MIC_BADGE]; } return badges.length > 0 && (
                                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {badges.slice(0,1).map(p => <span key={p.label} style={{ fontFamily: "'DM Sans'", fontSize: 9, fontWeight: 700, letterSpacing: .8, padding: '3px 8px', borderRadius: 6, background: p.bg, color: p.col }}>{p.label}</span>)}
                                </div>
                              ); })()}
                            </div>
                            {/* Info area */}
                            <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {(() => {
                                const sep = ev.name.match(/ [–\-] /);
                                if (sep) {
                                  const idx = ev.name.indexOf(sep[0]);
                                  const artist = ev.name.slice(0, idx);
                                  const show = ev.name.slice(idx + sep[0].length);
                                  return <>
                                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: '#fff', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{artist}</div>
                                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,.55)', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{show}</div>
                                  </>;
                                }
                                return <div style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: '#fff', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ev.name}</div>;
                              })()}
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.45)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <svg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' style={{ flexShrink: 0 }}><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>
                                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{cfg.venueName || cfg.venue || profile.name}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <div style={showAll
                      ? { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }
                      : { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, maxHeight: 315, overflowY: 'scroll', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)' }
                    }>
                      {list.map(ev => <EventCard key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />)}
                    </div>
                }
              </div>
            );
          })()}
        </div>
      </div>

      {/* Availability modal — shared AvailabilityCalendar (11C.2). View mode:
          available future dates tap through to openEnquiry; event days show a
          pink dot. Month stays controlled here so it's remembered across
          reopens, exactly as before. */}
      {availOpen && (
        <AvailabilityCalendar
          onClose={() => setAvailOpen(false)}
          title="VENUE AVAILABILITY"
          subtitle="Dates this venue is available for hire."
          accent="#00E5A0"
          accentRgb="0,229,160"
          availableDates={availDates}
          eventDates={eventDates}
          mode="view"
          onSelectDate={openEnquiry}
          month={availMonth}
          onMonthChange={setAvailMonth}
          footer={
            <>
              {availDates === null && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
              {enquiryLoading && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
              {availDates !== null && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(0,229,160,.18)', border: '1px solid rgba(0,229,160,.5)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>TAP DATE TO ENQUIRE</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#FF2D78', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>EVENT BOOKED</span>
                  </div>
                </div>
              )}
            </>
          }
        />
      )}

      {/* Performer availability modal — read-only shared calendar (11C.3).
          Same AvailabilityCalendar, view mode + readOnly: available dates are
          highlighted in the performer's own accent, nothing is tappable, no
          enquiry. Uncontrolled month (opens on the current month). */}
      {perfAvailOpen && (
        <AvailabilityCalendar
          onClose={() => setPerfAvailOpen(false)}
          title="AVAILABILITY"
          subtitle={venueCtx ? `Tap an available date to enquire with ${profile.name}.` : `Dates ${profile.name} is available.`}
          accent={col}
          accentRgb={rgb}
          availableDates={perfAvailDates}
          mode="view"
          readOnly={!venueCtx}
          onSelectDate={venueCtx ? (ds) => { setInviteDate(ds); setPerfAvailOpen(false); setInviteOpen(true); } : undefined}
          footer={
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: `rgba(${rgb},.18)`, border: `1px solid rgba(${rgb},.5)`, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>{venueCtx ? 'TAP DATE TO ENQUIRE' : 'AVAILABLE'}</span>
            </div>
          }
        />
      )}


      {pickerDate && pickerProfs.length > 0 && (
        <div onClick={() => { setPickerDate(null); setPickerProfs([]); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: col, marginBottom: 4 }}>ENQUIRING ABOUT</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 1, marginBottom: 4 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Who are you enquiring as?</div>
            {pickerProfs.map((p, i) => {
              const ptp = PROFILE_TYPES[p.type];
              const tc = ptp ? { col: ptp.accent, rgb: ptp.rgb } : { col: '#00E5A0', rgb: '0,229,160' };
              return (
                <button key={i} onClick={() => { setEnquiryProf(p); setPickerProfs([]); }} style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', background: `rgba(${tc.rgb},.06)`, border: `1px solid rgba(${tc.rgb},.25)`, borderRadius: 12, padding: 12, cursor: 'pointer', textAlign: 'left', marginBottom: 8 }}>
                  <img src={p.avatar || ptp?.defaultImage || PROFILE_TYPES.artist.defaultImage} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: `1.5px solid rgba(${tc.rgb},.5)`, flexShrink: 0 }} alt={p.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: tc.col, marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, color: '#e8e8f0' }}>{p.name}</div>
                    {p.genre_string && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{p.genre_string.split(' · ').slice(0,3).join(' · ')}</div>}
                  </div>
                  <div style={{ color: tc.col, fontSize: 18 }}>›</div>
                </button>
              );
            })}
            <button onClick={() => { setPickerDate(null); setPickerProfs([]); }} style={{ marginTop: 4, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Enquiry sheet */}
      {enquiryProf && pickerDate && (
        <div onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: col, marginBottom: 4 }}>ENQUIRE ABOUT THIS DATE</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1, marginBottom: 16 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            {/* Profile preview */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.05)', border: `1px solid rgba(${rgb},.25)`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <img src={enquiryProf.avatar || PROFILE_TYPES[enquiryProf.type]?.defaultImage || PROFILE_TYPES.artist.defaultImage} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: `2px solid ${col}`, flexShrink: 0 }} alt={enquiryProf.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1 }}>{enquiryProf.name}</div>
                {formatLocation(enquiryProf) && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{formatLocation(enquiryProf)}</div>}
                {enquiryProf.genre_string && <div style={{ fontSize: 11, color: col, marginTop: 2 }}>{enquiryProf.genre_string.split(' · ').slice(0,3).join(' · ')}</div>}
              </div>
            </div>
            <textarea
              value={enquiryNote}
              onChange={e => setEnquiryNote(e.target.value)}
              placeholder="Add a message — anything extra the venue should know…"
              style={{ width: '100%', minHeight: 90, background: 'rgba(255,255,255,.06)', border: `1px solid rgba(${rgb},.35)`, borderRadius: 12, color: '#e8e8f0', fontSize: 14, padding: 12, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <button
              onClick={sendEnquiry}
              disabled={enquirySending}
              style={{ marginTop: 12, width: '100%', background: `linear-gradient(135deg,${col},${grad2})`, color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, padding: 16, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: enquirySending ? .6 : 1 }}
            >{enquirySending ? 'SENDING…' : 'SEND ENQUIRY →'}</button>
            <button onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <ClaimDialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        profile={profile}
        session={session}
      />

      {inviteOpen && venueCtx && (
        <InviteSheet
          artist={profile}
          events={venueCtx.events}
          venueUserId={session.user.id}
          initialDate={inviteDate || ''}
          onClose={() => { setInviteOpen(false); setInviteDate(null); }}
        />
      )}
    </div>
  );
}

function VenueInfoDropdown({ profile, col, rgb, grad2, bare = false, socials = [] }) {
  const [open, setOpen] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const entertain  = profile.genre_string  ? profile.genre_string.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean) : [];
  const tech       = Array.isArray(profile.tech_features) ? profile.tech_features : (profile.tech_features ? String(profile.tech_features).split(',').map(t => t.trim()) : []);
  const nights     = Array.isArray(profile.live_nights)   ? profile.live_nights   : (profile.live_nights   ? String(profile.live_nights).split(',').map(d => d.trim())   : []);
  const atmosphere = profile.atmosphere  ? profile.atmosphere.split(',').map(t => t.trim()).filter(Boolean) : [];
  const perfectFor = profile.perfect_for ? profile.perfect_for.split(',').map(t => t.trim()).filter(Boolean) : [];
  const hasInfo    = profile.venue_type || profile.capacity || entertain.length || atmosphere.length || perfectFor.length || tech.length || nights.length || profile.stage_dims;
  if (!hasInfo) return null;

  const rowStyle   = { display: 'flex', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' };
  const labelStyle = { fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 90, paddingTop: 3, flexShrink: 0 };

  const inner = (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: 'relative', width: '100%', background: 'none', border: 'none', padding: '0 0 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, color: col }}>VENUE INFO</span>
        {/* Vibe descriptor absolutely centred to the row (true screen centre),
            neutral off-white italics; pointer-events off so the row still
            toggles. Ellipsis if it would reach the label/chevron. */}
        {profile.sound && (
          <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', maxWidth: '60%', textAlign: 'center', fontStyle: 'italic', fontSize: 13, color: 'rgba(235,235,240,.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{profile.sound}</span>
        )}
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, color: col }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 0 6px' }}>
          {profile.venue_type && (
            <div style={rowStyle}>
              <div style={labelStyle}>VENUE TYPE</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{profile.venue_type}</div>
            </div>
          )}
          {profile.capacity && (
            <div style={rowStyle}>
              <div style={labelStyle}>CAPACITY</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{profile.capacity}</div>
            </div>
          )}
          {atmosphere.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>ATMOSPHERE</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{atmosphere.join(', ')}</div>
            </div>
          )}
          {entertain.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>WE BOOK</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{entertain.join(', ')}</div>
            </div>
          )}
          {perfectFor.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>PERFECT FOR</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{perfectFor.join(', ')}</div>
            </div>
          )}
          {profile.bio && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>ABOUT</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>
                {profile.bio.length <= 150
                  ? profile.bio
                  : bioExpanded
                    ? <>{profile.bio} <span onClick={() => setBioExpanded(false)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see less</span></>
                    : <>{profile.bio.slice(0, 150).trimEnd()}… <span onClick={() => setBioExpanded(true)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see more</span></>
                }
              </div>
            </div>
          )}
          {tech.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>STAGE & TECH</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{tech.join(', ')}</div>
                {profile.stage_dims && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}><span style={{ fontFamily: "'Bebas Neue'", letterSpacing: 1.5, fontSize: 11 }}>STAGE</span> — {profile.stage_dims}</div>}
              </div>
            </div>
          )}
          {nights.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>LIVE NIGHTS</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{nights.join(', ')}</div>
            </div>
          )}
          {/* Socials also live here in the full info panel (labelled, to match the
              other rows) — a deliberate duplicate of the quick-access icon row up
              top under the action buttons. */}
          {socials.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'center', borderBottom: 'none' }}>
              <div style={labelStyle}>SOCIALS / LINKS</div>
              <div style={{ flex: 1 }}>
                <ProfileSocialLinks socials={socials} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (bare) return inner;

  return (
    <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      {inner}
    </div>
  );
}

function seededWaveSvg(name, rgb) {
  let s = name.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x9e3779b9);
  const rng = () => { s = (s ^ (s << 13)) | 0; s = (s ^ (s >>> 17)) | 0; s = (s ^ (s << 5)) | 0; return (s >>> 0) / 0xffffffff; };
  const N = 32, W = 300, H = 40, bW = (W / N) * 0.55;
  const bars = Array.from({ length: N }, (_, i) => {
    const h = 4 + rng() * (H - 8);
    const x = (i / N) * W + (W / N) * 0.225;
    const y = (H - h) / 2;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:38%;height:100%;opacity:.32;mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);-webkit-mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);" fill="rgba(${rgb},1)">${bars}</svg>`;
}

// SocialSvg moved to src/components/ProfileSocialLinks.jsx (shared with the
// non-venue action-area social row below).
