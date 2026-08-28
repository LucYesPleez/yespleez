import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId, getOwnerProfiles } from '../lib/actingProfile';
import { writeNotification } from '../lib/writeNotification';
import { track, EVENTS } from '../lib/analytics';
import { today } from '../lib/dates';
import { useSession, usePlayer } from '../App';
import { useParticipation } from '../components/ParticipationGate';
import EventCard from '../components/EventCard';
import DateBox from '../components/DateBox';
import FestivalApply from './event/FestivalApply';
import { eventCategoryBadges } from '../lib/eventBadges';
import { eventCardImage } from '../lib/eventImage';
import s from './ProfileScreen.module.css';
import ClaimDialog from '../components/ClaimDialog';
import InviteSheet from '../components/InviteSheet';
import { resolveProfileRoute, profileUrl } from '../lib/profileResolution';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';
import { useDragScroll } from '../hooks/useDragScroll';
import { formatLocation } from '../lib/formatLocation';
import { socialProfileUrl, ensureHttps } from '../lib/socialLinks';
import ProfileSocialLinks from '../components/ProfileSocialLinks';
import AvailabilityCalendar from '../components/AvailabilityCalendar';
import { selectedPerformanceRoleLabels, selectedArtistRoleLabels, ARTIST_ROLES, HOST_CATEGORIES } from '../lib/profileTaxonomy';
import { PROFILE_TYPES, profileIdentity } from '../lib/profileTypes';
import ProfileCard from '../components/ProfileCard';
import { openDirectConversation, sendableProfiles } from '../lib/messaging';
import { evaluate, columnsFor } from '@yespleez/requirements';
import { RequirementsVerdict } from '@yespleez/requirements/checklist';
import { canSendEnquiry, enquirySnapshot } from '../lib/enquiryRequirements';
import { ENQUIRY_PREVIEW_COLUMNS, buildEnquiryPreview } from '../lib/enquiryPreview';
import { resolveAskCategory } from '../lib/askCategoryResolver';
import { askCategoryLabel } from '@yespleez/ask-categories';
import { shouldShowPrompt, suppressPrompt, ENQUIRY_PRE_SEND_CHECK } from '../lib/promptPreferences';
import PreSendCheckSheet from '../components/PreSendCheckSheet';
import { listAssets } from '../lib/profileAssetStore';
import MessageAsSheet from '../components/MessageAsSheet';
import { useConversationUi } from '../lib/conversationUi';
import { isProfileUnclaimed } from '../lib/profileClaim';
import UnclaimedBadge from '../components/UnclaimedBadge';
import UnclaimedNotice from '../components/UnclaimedNotice';

const OLD_CATS = new Set(['ELECTRONIC','BANDS','SPOKEN','SPOKEN WORD','RAVE','FESTIVAL']);
// Host genre_string leads with broad category KEYS (ELECTRONIC/BANDS/…); filter
// them out of the public "WE BOOK" list so it reads as actual programming genres.
const HOST_CAT_KEYS = new Set(HOST_CATEGORIES.map(c => c.key));

// Who a venue can book. Hosts/promoters and other venues aren't performers, so
// they never get the enquire action.
const BOOKABLE_TYPES = ['artist', 'band', 'standup'];

/**
 * ⭐⭐ THE HERO PHOTO'S RESTING ZOOM — ONE SOURCE OF TRUTH.
 *
 * ⚠⚠ IT WAS TWO, AND THE PHOTO VISIBLY JUMPED. The element rendered at a
 * hard-coded `124%` while the scroll handler's own resting value was 168% on
 * phones (144% on desktop). Nothing reconciled them, so a profile opened at
 * 124%, sat there looking correct, and snapped to 168% the instant the reader
 * scrolled a single pixel — a photo that lurches as soon as you touch it.
 *
 * ⛔ Never write this number anywhere else. The render and the scroll handler
 * must ask the same function or they will drift apart again.
 */
function heroRestZoom() {
  return window.innerWidth < 640 ? 168 : 144;
}

export default function ProfileScreen() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { session } = useSession();
  const requestParticipation = useParticipation();
  const { open: openConversation } = useConversationUi();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type');
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [bioExpanded,   setBioExpanded]   = useState(false);
  const [heroLoaded,    setHeroLoaded]    = useState(false);
  const heroImgRef = useRef(null);
  const [followed,    setFollowed]    = useState(false);
  const [followBusy,  setFollowBusy]  = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [senderChoices, setSenderChoices] = useState(null);
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
  /* The gigs rail was the one horizontal rail in the app you could not drag —
     What's On, My Scene, Discover, the event lineup, the Messenger contacts
     rail and every dashboard's Following rail all use this hook, and this
     screen scrolled by wheel or touch only. Same hook, so it inherits the 1:1
     tracking, the drag-is-not-a-click guard, and the first-visits nudge that
     tells a reader the rail moves at all. */
  const gigsDrag = useDragScroll('profile-gigs');
  const [pickerDate,    setPickerDate]    = useState(null);
  const [pickerProfs,   setPickerProfs]   = useState([]);
  const [enquiryProf,   setEnquiryProf]   = useState(null);
  const [enquiryNote,   setEnquiryNote]   = useState('');
  const [enquirySending,setEnquirySending]= useState(false);
  const [enquiryLoading,setEnquiryLoading]= useState(false);
  /**
   * P6/P7 — THE ENQUIRY GATE.
   *
   * `reqEval` is the verdict for the pair (this venue's standing requirements
   * × the act the enquirer chose). It is a property of the PAIR, not of either
   * side, which is why it is recomputed when the acting profile changes: a
   * band may hold a press kit the same person's solo act does not.
   *
   * ⛔ This gates ONE direction — an artist asking a venue about a date. The
   * venue-initiated path (InviteSheet) is never gated: when the venue is doing
   * the asking, requiring the artist to satisfy the venue's own checklist
   * would let a venue make itself unable to invite anyone.
   */
  /**
   * ⚠ null, NOT []. `[]` is a real answer — "this venue asks for nothing" —
   * and initialising to it made UNKNOWN indistinguishable from NONE, so an
   * enquiry sent before the fetch returned skipped the gate entirely and was
   * stored with a null snapshot forever. null means unread, and unread blocks.
   */
  const [venueRequired, setVenueRequired] = useState(null);
  const [reqEval,       setReqEval]       = useState(null);
  const [reqEvaluating, setReqEvaluating] = useState(false);
  /**
   * WHICH ACT `reqEval` DESCRIBES. A verdict is a property of the pair, so it
   * stops being true the instant the enquirer switches profile — and for the
   * render between the switch and the effect, the old verdict is still there.
   * Carrying the id lets the gate notice.
   */
  const [reqEvalFor,    setReqEvalFor]    = useState(null);
  /**
   * P8 — the pre-send check. Open when the person has not suppressed it.
   *
   * ⛔ A CONFIRMATION, NEVER A GATE. It opens only AFTER `canSendEnquiry` has
   * already passed, so dismissing it forever skips the confirmation and can
   * never skip the P6 requirements.
   */
  const [preSendOpen, setPreSendOpen] = useState(false);
  /**
   * Why an enquiry did not send. Empty means nothing to report — never a
   * lingering message from a previous attempt, which is why every path that
   * changes WHAT is being sent clears it.
   */
  const [enquiryError, setEnquiryError] = useState('');
  /**
   * P12 — the Ask Category the enquirer has settled on.
   *
   * ⭐ Derived from the acting profile, but held in state rather than computed
   * at send time, because the "several applicable" branch makes it a CHOICE.
   * Null covers both "nothing applies" (host, festival) and "not chosen yet";
   * `askChoiceNeeded` is what tells those apart — see the resolver's contract.
   */
  const [askCategory, setAskCategory] = useState(null);
  const [askChoiceNeeded, setAskChoiceNeeded] = useState(false);
  const [askOptions, setAskOptions] = useState([]);
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
      } else if (ownedProfile.type === 'host' || ownedProfile.type === 'festival') {
        // 11C.6: a host's HOSTED events — events.host_id is the promoter's
        // account (see CreateEventScreen / HostDashboard). NOT lineup_members:
        // a host doesn't perform, so the performer query below returned nothing,
        // leaving every host's event sections empty.
        //
        // ⭐ A FESTIVAL READS THE SAME WAY (2026-08-26). It owns its events via
        // `owner_profile_id` and is never on a bill, so the performer query
        // below returned nothing for it too — measured: Echo Valley owns one
        // live event and has ZERO `lineup_members` rows, so its profile showed
        // no events at all. Same defect as the host one this branch was
        // written for, and the same fix.
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
        // ⚠ `applications_open` rides along so a festival profile can offer
        // APPLICATIONS OPEN without a second query. It is the organiser's
        // master switch only — whether anything is actually accepting people
        // is decided by the open CATEGORIES, which FestivalApply reads.
        const eRes = await supabase.from('events').select('id,name,config,applications_open')
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
        const claimsRes = await supabase.from('lineup_members').select('event_id').or(legs.join(',')).eq('status', 'on_bill');
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

  /**
   * ⭐ THE EVENT A VISITOR CAN APPLY TO — a festival profile only.
   *
   * A festival is an organisation that runs for years; only an OCCURRENCE
   * takes applications, so the profile's button has to name one. The soonest
   * upcoming event with the organiser's switch on wins.
   *
   * ⚠ `applications_open` is the master switch and NOT the whole answer: an
   * event can have it on with no category open, in which case nobody can
   * actually apply. FestivalApply resolves that (it renders nothing when no
   * applyable category is open), which is why the button is not gated on the
   * flag alone here.
   */
  const applyEvent = profile?.type === 'festival'
    ? events
        .filter(ev => ev.applications_open && (ev.config?.date || '9999') >= today())
        .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''))[0] || null
    : null;

  /**
   * ⭐ QR1 · a scanned What's On code lands here with `?focus=whats-on` and is
   * scrolled to the gig list.
   *
   * ⚠ IT WAITS FOR THE EVENTS. The section does not exist in the DOM until they
   * have loaded, so scrolling on mount would scroll to nothing and the reader
   * would be left at the top of a profile wondering what the code did.
   *
   * ⛔ A HINT, NEVER THE ADDRESS. Identity is in the path; a scanner that drops
   * the query string still lands on the right venue, one scroll away.
   */
  const focusParam = searchParams.get('focus');
  const whatsOnFocused = useRef(false);
  useEffect(() => {
    /**
     * ⚠⚠ ONCE, AND KEYED ON THE STRING. `useSearchParams` hands back a NEW
     * URLSearchParams every render, so an effect that depends on the object
     * re-runs on every render — and a cleanup that cancels a pending timer
     * then cancels it forever while the profile is still loading. Measured:
     * the scroll never happened. The ref makes it fire once; the string
     * dependency stops the identity churn.
     */
    if (focusParam !== 'whats-on' || !events.length || whatsOnFocused.current) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById('section-whats-on');
      if (!el) return;
      whatsOnFocused.current = true;
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior: 'smooth' });
    }, 160);
    return () => clearTimeout(t);
  }, [focusParam, events.length]);
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
      const base = heroRestZoom();
      el.style.backgroundSize = `${base - progress * (base - 104)}% auto`;
    }
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
    /**
     * ⚠⚠ KEYED ON THE AVATAR, ⛔ NOT `[]`.
     *
     * With an empty dependency list this ran exactly once, on mount — before
     * the profile query had returned, so `heroUrl` was still falsy, the hero
     * element did not exist yet, and `handleScroll`'s own `if (!el) return`
     * threw the call away. Nothing ever re-applied it. The photo then sat at
     * whatever the render hard-coded until the reader's first scroll event
     * finally reached the handler, and jumped.
     *
     * Re-running when the avatar resolves is what makes the initial call land
     * on an element that is actually there.
     */
  }, [profile?.avatar_hero, profile?.avatar_thumb, profile?.avatar]);

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
      /**
       * ⭐⭐ HOST **OR** VENUE — THE SAME CHOICE EVENT CREATION ALREADY ASKS
       * (owner, 2026-08-14: "just as event creation is a choice of who is
       * creating the event host or venue, it needs to be the same. i need to
       * be able to choose me the venue or me the host").
       *
       * ⚠ `getOwnerProfiles` IS THAT QUESTION'S EXISTING ANSWER — the same
       * function CreateEventScreen uses to ask which profile owns an event
       * (OWNER_ELIGIBLE_TYPES = venue + host). ⛔ Never a second local query
       * filtered to one type: this used to read `.eq('type','venue')`, so a
       * promoter offering their own night was silently attributed to whichever
       * venue they happened to own.
       *
       * ⚠⚠ AND NEVER `.maybeSingle()`. It does not return the first of
       * several — it ERRORS on more than one row and hands back null, which
       * removed the invite button entirely from any account running two
       * venues. More than one profile is a supported shape.
       */
      const owners = await getOwnerProfiles(session.user.id);
      if (cancelled || !owners.length) return;
      /**
       * ⚠ EVENTS BY OWNING PROFILE, NOT BY ACCOUNT. This read `host_id` — the
       * human — so the sheet listed every event the login owns while claiming
       * the offer came from one venue. A promoter's night at someone else's
       * room could be offered "from Elbows Rest", which is a false statement
       * to the artist, not merely an untidy one.
       *
       * `owner_profile_id` is the column that answers WHO IS ACCOUNTABLE
       * (M14b / identity v1.3 O-R4); the sheet filters these by the chosen
       * sender, so the events on offer always belong to the profile making
       * the offer.
       */
      /**
       * ⚠⚠ TWO READS, BECAUSE 34 OF 88 EVENTS HAVE NO OWNER (measured live,
       * 2026-08-14). `owner_profile_id` arrived with M14b; everything created
       * before it is NULL, and filtering on it alone emptied the picker
       * completely — a correctness fix that deleted the feature.
       *
       * ⭐ AN UNOWNED EVENT IS AMBIGUOUS, NOT MINE-AS-ANYONE. Nothing records
       * which profile ran it, so it is offered under whichever identity the
       * sender picks — and that is now an explicit choice they made, not the
       * silent substitution this replaced.
       */
      const [ownedRes, legacyRes] = await Promise.all([
        supabase.from('events')
          .select('id, name, status, config, owner_profile_id')
          .in('owner_profile_id', owners.map(o => o.id))
          .neq('status', 'completed').order('created_at', { ascending: false }).limit(40),
        supabase.from('events')
          .select('id, name, status, config, owner_profile_id')
          .is('owner_profile_id', null).eq('host_id', session.user.id)
          .neq('status', 'completed').order('created_at', { ascending: false }).limit(40),
      ]);
      const evs = [...(ownedRes.data || []), ...(legacyRes.data || [])];
      // `id` stays the first owner so existing readers keep working; `owners`
      // is what InviteSheet uses to state — or ask — who is sending.
      if (!cancelled) setVenueCtx({ id: owners[0].id, venues: owners, events: evs || [] });
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id, profile?.id, profile?.type, isUnclaimed]);

  // 11C.3: load THIS PROFILE's public availability, from the same single
  // source of truth the dashboard editor writes to. Read-only here: no write
  // path, no enquiry change. Cleared for non-performers so stale dates never
  // leak across a client-side profile→profile navigation (cf. S40).
  //
  // Keyed on `profile.id`, not `profile.user_id`. artist_availability serves
  // artist, band, standup and host, so reading by account showed one person's
  // DJ dates on their comedy profile — and a promoter enquiring about a date
  // the comedian had never offered.
  useEffect(() => {
    if (!profile?.id || !BOOKABLE_TYPES.includes(profile.type)) { setPerfAvailDates(null); return; }
    let cancelled = false;
    (async () => {
      /* ⛔⛔ WAS the UTC date. It is the `gte` bound on an availability QUERY, so
         every AU morning it fetched from YESTERDAY. See lib/dates.js. */
      const todayStr = today();
      const { data: rows } = await supabase.from('artist_availability')
        .select('available_date').eq('profile_id', profile.id).gte('available_date', todayStr).order('available_date');
      if (!cancelled) setPerfAvailDates(new Set((rows || []).map(r => r.available_date)));
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.type]);

  async function openEnquiry(dateStr) {
    if (!session?.user?.id) return;
    setEnquiryLoading(true);
    /**
     * ⚠ WIDENED FOR THE PRE-SEND CHECK. The picker itself needs only enough to
     * draw a chooser row, but the confirmation shows what the VENUE will see,
     * and it can only be honest about fields it actually has. The list is
     * declared in enquiryPreview.js beside the projection that consumes it, so
     * a field added there cannot be left unfetched here.
     */
    /**
     * ⛔ WHO MAY ASK — and it is not "everything that is not a punter".
     *
     * `punter` cannot: a Personal profile does not perform or promote (§A9).
     * `venue` cannot: a venue asking a venue about a date is not a thing this
     * flow models.
     * ⭐ `festival` cannot, as of 2026-08-11, and the reason is the platform
     * boundary rather than the flow: a festival is administered in the Portal,
     * `PROFILE_TYPES.festival.dashPath` is null, and Scene has nowhere for a
     * festival to SEE an enquiry it sent. It could send one perfectly well and
     * then never hear about it again — a write into a void. Scene renders
     * festivals; it does not act as one. The capability returns in the Festival
     * app, where it has somewhere to live.
     *
     * ⚠ Everything left is an act or a promoter, and BOTH have an outgoing
     * surface: performers on ArtistDashboard, hosts on HostDashboard. That is
     * the standing rule — ⛔ do not widen this list to a profile type with
     * nowhere to read the reply.
     */
    const { data: profs } = await supabase.from('profiles')
      .select(ENQUIRY_PREVIEW_COLUMNS.join(', '))
      .eq('user_id', session.user.id)
      .neq('type', 'punter').neq('type', 'venue').neq('type', 'festival');
    if (!profs?.length) return;
    const mapped = profs.map(p => ({ ...p, label: PROFILE_TYPES[p.type]?.label || p.type.toUpperCase() }));
    setEnquiryLoading(false);
    setPickerDate(dateStr);
    // A new date is a new attempt — a message about the last one is a lie here.
    setEnquiryError('');
    if (mapped.length === 1) { setEnquiryProf(mapped[0]); setPickerProfs([]); }
    else { setPickerProfs(mapped); setEnquiryProf(null); }
  }

  /**
   * The venue's STANDING requirements (P6). Read separately from the profile
   * row for the same reason ApplyButton reads an event's separately: it is a
   * gate input, never rendered on the public profile, and pulling it through
   * the shared profile fetch would put a requirement list into every screen
   * that shows a venue.
   *
   * Read on the venue's own profile page regardless of who is looking, because
   * the enquiry sheet needs it the instant a date is tapped.
   */
  useEffect(() => {
    // Not a venue: there is no enquiry path at all, so nothing is pending.
    // `[]` is honest here — it is a settled answer, not an unread one.
    if (!profile?.id || profile.type !== 'venue') { setVenueRequired([]); return; }
    let cancelled = false;
    // ⛔ Back to UNREAD while a different venue loads, so the previous venue's
    // requirements can never gate this one.
    setVenueRequired(null);
    supabase.from('profiles').select('required_items').eq('id', profile.id).maybeSingle()
      // ⚠ The DATABASE's NULL means "asks for nothing" — collapsed to `[]`
      // HERE, at the boundary, so that in memory null only ever means unread.
      // An ERROR must NOT collapse: leaving it null keeps the gate closed
      // rather than treating a failed read as permission.
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setVenueRequired(data?.required_items || []);
      });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.type]);

  /**
   * Evaluate the ACTING profile against those requirements. Mirrors
   * ApplyButton's effect deliberately — same engine, same column projection,
   * same asset lookup — because "can this act ask for this" must have one
   * answer however it is asked.
   *
   * Only the columns the requirements actually reference are fetched
   * (`columnsFor`), so a venue asking for a bio does not pull a commercial
   * record. `id` is included because assets resolve by profile id.
   */
  useEffect(() => {
    if (!venueRequired?.length || !enquiryProf?.id) { setReqEval(null); setReqEvalFor(null); return; }
    let cancelled = false;
    const forProfileId = enquiryProf.id;
    // ⛔ Drop the previous act's verdict BEFORE fetching the next one. Left in
    // place it would answer for the wrong profile until the round trip
    // returned — and a stale pass is a real bypass, not a flicker.
    setReqEval(null);
    setReqEvalFor(null);
    setReqEvaluating(true);
    (async () => {
      const cols = [...new Set(['id', ...columnsFor(venueRequired)])].join(', ');
      const [{ data: prof }, assets] = await Promise.all([
        supabase.from('profiles').select(cols).eq('id', forProfileId).maybeSingle(),
        listAssets(forProfileId).catch(() => []),
      ]);
      if (cancelled) return;
      setReqEval(evaluate(venueRequired, { profile: prof || {}, assets: assets || [] }));
      // Stamped with the act it describes, so the gate can tell a current
      // verdict from a leftover one.
      setReqEvalFor(forProfileId);
      setReqEvaluating(false);
    })();
    return () => { cancelled = true; };
  }, [venueRequired, enquiryProf?.id]);

  /**
   * P8 — what the SEND button now does.
   *
   * ⭐ THE ORDER IS THE DESIGN: gate first, confirmation second. The P6 check
   * runs before the dialog can open, so someone who has said "don't ask again"
   * is still refused when they do not meet the venue's requirements. If these
   * were the other way round, dismissing a prompt would dismiss a rule.
   *
   * The preference read is awaited rather than prefetched so a person who
   * suppresses it on their laptop is not asked again on their phone in the
   * same session. It fails toward SHOWING the dialog — see promptPreferences.
   */
  /**
   * P12 — resolve the Ask Category when the acting profile changes.
   *
   * ⭐ ONE CALL, THREE STATES. `resolveAskCategory` hands back
   * `{ category, needsChoice, applicable }` precisely so the two nulls cannot
   * collapse: "no category applies" and "the asker must choose" are different
   * facts, and a caller that stored a bare null would silently skip a question.
   *
   * ⚠ `needsChoice` cannot be true today — no profile spans two categories. The
   * branch exists so that the day one does, the enquiry asks instead of
   * guessing.
   */
  useEffect(() => {
    const { category, needsChoice, applicable } = resolveAskCategory(enquiryProf);
    setAskCategory(category);
    setAskChoiceNeeded(needsChoice);
    setAskOptions(applicable);
    // ⚠ Depends on the profile OBJECT, not its fields: it is state set from one
    // fetch, so its identity is stable between selections, and listing fields
    // while reading the whole object is what exhaustive-deps rightly objects to.
  }, [enquiryProf]);

  async function requestSendEnquiry() {
    if (!enquiryProf || !pickerDate || enquirySending) return;
    /**
     * ⛔ A CHOICE THAT WAS NEVER MADE MUST NOT BE SENT. When several categories
     * apply, the resolver deliberately returns null rather than picking one —
     * sending here would freeze "no category" onto a record that had one, and
     * `ask_category` is never revisited after creation.
     */
    if (askChoiceNeeded && !askCategory) {
      setEnquiryError('Choose what you are enquiring about before sending.');
      return;
    }
    if (!canSendEnquiry({ required: venueRequired, evaluation: reqEval, evaluating: reqEvaluating,
                          actingProfileId: enquiryProf?.id ?? null, evaluatedProfileId: reqEvalFor })) return;
    const show = await shouldShowPrompt(session?.user?.id, ENQUIRY_PRE_SEND_CHECK);
    if (show) { setPreSendOpen(true); return; }
    sendEnquiry();
  }

  /** "Don't ask me this again" — record it, then send either way. */
  async function sendEnquiryAndSuppress() {
    // ⚠ The send does NOT depend on the preference write succeeding. Failing to
    // store a UI preference must never cost someone the enquiry they came to
    // make; the worst case is being asked once more.
    await suppressPrompt(session?.user?.id, ENQUIRY_PRE_SEND_CHECK);
    sendEnquiry();
  }

  async function sendEnquiry() {
    if (!enquiryProf || !pickerDate || enquirySending) return;
    setPreSendOpen(false);
    /**
     * ⛔ THE GATE, IN THE WRITE PATH — not only in the button's styling.
     * A disabled button is a suggestion; this is the rule. Mirrors
     * ApplyButton's identical guard.
     *
     * `reqEvaluating` blocks too: sending while the verdict is still being
     * computed would write an enquiry whose snapshot is null against a venue
     * that does have requirements.
     */
    if (!canSendEnquiry({ required: venueRequired, evaluation: reqEval, evaluating: reqEvaluating, actingProfileId: enquiryProf?.id ?? null, evaluatedProfileId: reqEvalFor })) return;
    setEnquirySending(true);
    // Dual-write (M2 invariant): both sides are already-resolved profiles rows,
    // so the profile ids are direct assignments, not lookups. The enquiry UI only
    // renders for isVenue && !isUnclaimed, so `profile` is a real claimed venue
    // row. M5: identity values derive from the loaded row, never the route param.
    const { data: inserted, error } = await supabase.from('venue_enquiries').insert({
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
      /**
       * P12 — what this enquiry is asking FOR, frozen at creation.
       *
       * ⭐ `askCategory` is resolved from the acting profile's ROLE before the
       * send (see `requestSendEnquiry`), never re-derived here — a category
       * computed at write time and again at read time is two answers waiting to
       * disagree.
       *
       * ⛔ NULL is a real answer: a host or festival has no applicable category
       * at all. It is stored as null and renders no chip.
       */
      ask_category:         askCategory,
      // P7 — the VERDICT at enquiry creation, never a copy of the profile.
      // NULL when the venue declared nothing, exactly as P5 does for
      // applications: no requirements is not the same fact as 0/0.
      requirements_snapshot: enquirySnapshot({ required: venueRequired, evaluation: reqEval }),
    })
      // Returning the id is safe on this leg: "Profile owner can read their
      // enquiries" (M4) grants SELECT to EITHER side by profile ownership, so
      // the applicant can read back the row they just wrote. The id is needed
      // for the notification's N4 expiry key below.
      .select('id')
      .maybeSingle();
    /**
     * ⚠⚠ AN ENQUIRY THAT DID NOT SEND MUST NOT LOOK LIKE ONE THAT DID.
     *
     * `venue_enquiries` carries UNIQUE (venue_user_id, applicant_user_id,
     * date_requested), so a second enquiry for the same date is rejected. This
     * used to be swallowed as noise AND the sheet was closed on that path, so
     * the screen behaved exactly as it does on success: an artist believed they
     * had enquired, no row existed, no notification fired, and they waited on a
     * reply the venue was never told to make. Found 2026-08-10 by reading the
     * database after a send that looked perfect.
     *
     * Keyed on SQLSTATE 23505 first, not the message text: the string is a
     * Postgres/PostgREST detail that can change between versions, whereas the
     * code is the contract. The message check stays as a fallback.
     *
     * ⭐ "You have already enquired" is not an error, it is USEFUL INFORMATION —
     * the person's own past action, which they may simply have forgotten.
     */
    const isDuplicate = error && (
      error.code === '23505' ||
      error.message?.includes('duplicate') ||
      error.message?.includes('unique')
    );
    if (error) {
      if (!isDuplicate) {
        console.error('venue_enquiries insert failed:', error.code, error.message, error.details, error.hint);
      }
      setEnquiryError(isDuplicate
        ? `You have already enquired about ${new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}. Check your enquiries for the reply.`
        : 'That did not send. Check your connection and try again.');
      setEnquirySending(false);
      // ⛔ The sheet STAYS OPEN and the note is kept. Closing it is what made
      // the failure invisible, and it would also throw away what they wrote.
      return;
    }
    /**
     * Tell the venue. Until now this was the ONE transition in the enquiry
     * chain that notified nobody — every response the venue makes writes one
     * (VenueDashboard.handleEnquiryRespond), but the enquiry that starts the
     * chain arrived in silence, discoverable only by opening the dashboard.
     *
     * `availability_request` rather than a new type: it is already in the N4
     * registry with policy 'enquiry', which expires a HELD copy once
     * date_requested has passed — precisely this notice's shelf life. Adding
     * an unregistered type would produce a notification that never expires,
     * silently (a type absent from the policy table fails the sweep's join).
     *
     * §A7: `about` is the applicant (whose act this is), `to` is the venue.
     * The enquiry UI renders only for a claimed venue, so to_user_id is always
     * present here and the row is delivered, never held.
     */
    if (inserted?.id) {
      await writeNotification({
        toUserId:       profile.user_id ?? null,
        toProfileId:    profile.id ?? null,
        aboutProfileId: enquiryProf.id ?? null,
        type:    'availability_request',
        message: `${enquiryProf.name} enquired about ${new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}.`,
        data:    { enquiry_id: inserted.id, date_requested: pickerDate, venue_name: profile.name || null },
      });
    }
    // Only ever reached on a real success — every failure returned above.
    setEnquirySending(false);
    setEnquiryProf(null); setPickerDate(null); setEnquiryNote(''); setEnquiryError('');
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

  /**
   * M8h — open a direct conversation with this profile.
   *
   * MESSAGING IDENTITY (canonical, 20 Jul 2026): conversations are between
   * PROFILES. The human authenticates and operates a profile via can_act_as;
   * the visible identity is always the participating profile. from_user_id
   * stays audit-only and is never displayed — §A3 unchanged.
   *
   * The sender profile is chosen ONCE, when the conversation is created. §2.1
   * freezes the participant set, so there is nothing to re-ask afterwards and
   * no "speak as" selector on every message. If the user can act as exactly
   * one profile there is no ambiguity, so no prompt is shown at all.
   *
   * Opens the DOCK rather than navigating — the visitor stays on the profile
   * they were reading.
   */
  async function handleMessage() {
    if (!session?.user?.id || messageBusy || !profile?.id) return;
    setMessageBusy(true);
    try {
      const { profiles } = await sendableProfiles(session.user.id);
      const options = profiles.filter(p => p.id !== profile.id);

      if (options.length === 0) { setMessageBusy(false); return; }
      if (options.length === 1) { await startConversationAs(options[0].id); return; }

      // More than one identity is genuinely ambiguous — ask, once.
      setSenderChoices(options);
      setMessageBusy(false);
    } catch {
      setMessageBusy(false);
    }
  }

  async function startConversationAs(fromProfileId) {
    setSenderChoices(null);
    setMessageBusy(true);
    try {
      const { conversationId, error } = await openDirectConversation(fromProfileId, profile.id);
      if (error || !conversationId) return;
      openConversation(conversationId, {
        profile: { id: profile.id, name: profile.name, type: profile.type },
      });
    } finally {
      setMessageBusy(false);
    }
  }

  async function toggleFollow() {
    if (followBusy) return;
    /**
     * ⭐ O2 — the profile page's FOLLOW is the artist-follow conversion
     * moment, and for a guest it was a greyed `disabled` button with no
     * explanation. It now opens the ParticipationGate on the same contract
     * FollowHeartBtn uses: profile id only in the intent, type for copy.
     */
    if (!session?.user?.id) {
      requestParticipation('follow_profile', {
        context: { profileId: profile?.id },
        display: { type: profile?.type },
      });
      return;
    }
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
    // A1 · one event per row actually written, not one per click. This path
    // can follow on behalf of several accounts at once, and emitting a single
    // event with a count would make COUNT(*) disagree with the follows table
    // for exactly the multi-id case. Every result here is a success — the
    // failure branch above already returned.
    results.forEach(() => track(EVENTS.FOLLOWED, { entity_type: profile.type }));

    // Bust the My Scene cache so the new follow appears immediately
    queryClient.invalidateQueries({ queryKey: ['myScene'] });
    // Notify the profile owner that someone followed them
    // §A7: no inference needed here — both identities are known outright.
    // to = the profile that was followed (this page). about = the follower's
    // Personal profile, the same one the follow rows were attributed to.
    //
    // N1: no `if (profile.user_id)` guard. An unclaimed profile has no owner
    // yet, so this writes a HELD row — recipient set, delivery identity null —
    // which is delivered on claim (N3). Guarding here discarded exactly the
    // rows N4 says never expire and N3 calls the payoff of the whole model:
    // the venue that claims its profile and finds twelve followers waiting.
    await writeNotification({
      toUserId:       profile.user_id ?? null,   // null ⇒ held (N1)
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

  // ⛔ WAS `PROFILE_TYPES[profile.type] || PROFILE_TYPES.artist`, which is the
  // hand-written fallback 10F introduced profileIdentity() to replace — and
  // this copy survived that pass. It is not a harmless default: an unrecognised
  // type inherited a DJ's ENTIRE identity here, so the public profile page
  // rendered it in cyan, labelled "DJ / PROD.", wearing a DJ's placeholder
  // photo, confidently and with nothing in the console. A festival hit exactly
  // that until `festival` joined PROFILE_TYPES. Unknown must look unknown.
  const pt      = profileIdentity(profile.type);
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
        !na(profile.bandcamp)   && { href: socialProfileUrl('bandcamp', profile.bandcamp),     col: '#629AA9',     icon: 'bandcamp' },
        !na(profile.beatport)   && { href: socialProfileUrl('beatport', profile.beatport),     col: '#01FF95',     icon: 'beatport' },
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
              /* ⭐ The SAME resting zoom the scroll handler settles on, so the
                 first paint and the first scroll agree. ⛔ Never a literal here
                 — see heroRestZoom. */
              ? { backgroundSize: `${heroRestZoom()}% auto` }
              // Default (no photo yet — §09 requires a generic avatar pre-claim).
              // Was `auto 80%`, which sizes by HEIGHT: fine at phone width, but
              // .heroImg is capped at max-width 680px, so on desktop a portrait
              // placeholder (defaultdj.webp, then 941x1672, ratio 0.56) rendered only
              // ~405px wide inside a 680px frame — 137px of dead space each side,
              // which read as a broken image rather than a placeholder.
              // `cover` fills the frame at every width, exactly as a real photo
              // does, and works for the landscape defaults (band/mic, ratio ~1.5)
              // too.
              //
              // Anchored BOTTOM, overriding .heroImg's `center top`. These
              // placeholders put their subject low in the frame — defaultdj.webp
              // is silhouette, hands and decks across its lower half, with only
              // lights and haze above. When it was 941x1672 it rendered 1208px
              // tall in a 917px frame at 680px wide, so `top` cropped 291px off
              // the foot and threw away the entire subject, leaving a photo of
              // an empty ceiling. Anchoring to the bottom keeps the figure and
              // decks and discards the haze instead.
              //
              // ⚠ THE NUMBERS ABOVE ARE HISTORY, THE ANCHOR IS NOT. That
              // artwork is now 941x1280 (ratio 0.74) — the owner cropped the
              // haze off at source — so at 680px it renders ~925px in a 917px
              // frame and there is only ~8px of vertical overflow left to crop.
              // Bottom-anchoring costs nothing in that case and remains correct
              // the moment any future placeholder is tall again. Do not
              // "simplify" it away on the grounds that today's image barely
              // overflows; that is an argument about one file, not about the
              // rule, and it is the exact crop that ate the subject last time.
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

          {/* ⭐⭐ APPLICATIONS OPEN — THE PAGE'S PRIMARY ACTION (owner,
              2026-08-26: "it's just kind of a big deal"). It sits FIRST in the
              column, immediately under the identity, and is the one FILLED
              control on the page — Follow and Message stay outlined further
              down, which is what makes this one read as the answer to "what am
              I meant to do here".

              ⚠ It was beneath Follow and Message, in the same colours, and the
              owner was right that it disappeared: the most valuable thing a
              festival profile offers was wearing a utility's clothes.

              ⚠ Renders NOTHING when the festival has no event taking
              applications, so a between-rounds festival simply shows its
              tagline. ⛔ Never a disabled button announcing that applications
              are closed — a dead control for a state nobody can act on. */}
          {applyEvent && (
            <FestivalApply
              eventId={applyEvent.id}
              userId={session?.user?.id ?? null}
              renderTrigger={({ open, toggle, panelId }) => (
                <button
                  type="button"
                  className={s.applyCta}
                  onClick={toggle}
                  aria-expanded={open}
                  aria-controls={panelId}
                  style={{
                    /* ⚠ TWO LAYERS, and the top one is not decoration. The
                       wash deepens along the same 135° axis as the colour, so
                       it lands hardest on the bright end of the gradient —
                       which is what lets the white label read evenly across
                       the whole button instead of fading out on one side. */
                    background: `linear-gradient(135deg, rgba(0,0,0,.20), rgba(0,0,0,.46)), linear-gradient(135deg, ${col}, ${grad2})`,
                    boxShadow: `0 10px 32px rgba(${rgb},.30)`,
                  }}
                >
                  <span className={s.applyCtaDot} aria-hidden="true" />
                  Applications open
                  <span className={`${s.applyCtaChev} ${open ? s.applyCtaChevOpen : ''}`} aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>
              )}
            />
          )}

          {/* Demo mix / sound
              ⚠ AN ALLOWLIST, AND IT MUST STAY ONE. This read
              `!isHost && !isVenue` — correct while five types existed, and
              silently wrong the moment a sixth did: a FESTIVAL is neither a
              host nor a venue, so it was offered a DJ's player and told
              "DEMO MIX COMING SOON" about music it will never have.
              Every type added from here is a performer or it is not; naming
              who this is FOR cannot rot the way naming who it is not does. */}
          {isPerformer && (
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
          {/* ⚠ `marginTop` — a buffer above the heading (owner, 2026-08-26).
              ABOUT was butting up against whatever sat above it, which on a
              festival is the applications panel. */}
          {profile.bio && !isVenue && (
            <div style={{ marginTop: 26, marginBottom: 12 }}>
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
                  /* O2 · live for a guest — it opens the gate rather than
                     sitting greyed out with nothing to say. */
                  disabled={followBusy}
                >
                  {followed ? '✓ FOLLOWING' : <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>+ FOLLOW</span>}
                </button>
              </span>
              {/* Message — LIVE as of M8h. `C17` (no cold DM) was amended by the
                  owner on 20 Jul 2026: any profile may open a conversation with
                  any other. Opens the ConversationDock rather than navigating,
                  so the visitor stays on the profile they were reading.

                  Claimed profiles only — an unclaimed profile has no human, so
                  a message would sit held with nobody able to reply. Following
                  an unclaimed profile IS supported (N1); messaging one is not.

                  Styled exactly as Follow — gradient wrapper as the border,
                  dark interior, gradient text. It was muted only while the
                  feature was a placeholder; now it is a real action and reads
                  as Follow's equal rather than its lesser. */}
              {!isUnclaimed && (
                <span style={{ flex: 1, minWidth: 0, display: 'inline-block', padding: 1, borderRadius: 12, background: `linear-gradient(135deg, ${col}, ${grad2})` }}>
                  <button
                    type="button"
                    className={s.followBtn}
                    disabled={!session || messageBusy}
                    onClick={handleMessage}
                    aria-label={`Message ${profile?.name ?? 'this profile'}`}
                    style={{ borderColor: 'transparent', background: 'rgba(19,19,31,.92)', width: '100%', margin: 0 }}
                  >
                    <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      {messageBusy ? 'OPENING…' : 'MESSAGE'}
                    </span>
                  </button>
                </span>
              )}

              {/* "Message as…" — shown ONCE, only when the sender genuinely has
                  more than one identity. §2.1 freezes the participant set at
                  creation, so this is never asked again for this conversation.

                  This list is the SENDER'S OWN. It is never shown to a
                  recipient: they see the participating profile and nothing
                  else, so messaging cannot reveal that one person runs a
                  venue, a festival and an artist alias. */}
              {senderChoices && (
                <MessageAsSheet
                  profiles={senderChoices}
                  onConfirm={startConversationAs}
                  onCancel={() => setSenderChoices(null)}
                />
              )}
            </div>

            {/* N2 · action-time disclosure. Follow is the ONE action reachable
                against an unclaimed profile — the button above is gated on
                `followBusy || !session`, never on claim state — so following
                writes a held notification and, until now, said nothing about
                it. Renders itself only when unclaimed, so the claimed flow is
                untouched by construction. */}
            <UnclaimedNotice profile={profile} context="follow" />
            {isVenue && !isUnclaimed && (
              <button
                className={s.followBtn}
                style={{ background: `linear-gradient(135deg, ${col}, ${grad2})`, color: '#0a0a14', borderColor: 'transparent', width: '100%' }}
                onClick={async () => {
                  setAvailOpen(true);
                  if (!availDates) {
                    /* ⛔⛔ WAS the UTC date — the `gte` bound on the VENUE
                       availability query. See lib/dates.js. */
                    const todayStr = today();
                    // M5: availability keys on profile_id, event overlay on the
                    // attribution column — never the route param.
                    const [availRes, evRes] = await Promise.all([
                      supabase.from('venue_availability').select('available_date').eq('profile_id', profile.id).gte('available_date', todayStr).order('available_date'),
                      supabase.from('events').select('config').eq('venue_profile_id', profile.id).eq('status', 'live'),
                    ]);
                    setAvailDates(new Set((availRes.data || []).map(r => r.available_date)));
                    const evDays = new Set((evRes.data || []).map(e => e.config?.date).filter(Boolean));
                    setEventDates(evDays);
                  }
                }}
              >
                {/* ⚠ THE LABEL TELLS THE TRUTH ABOUT WHAT OPENS. A private
                    calendar has no availability to check — the sheet it opens
                    is a date picker for an enquiry, so the button says so. */}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle', marginTop: -2 }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>{profile.availability_private ? 'ENQUIRE' : 'CHECK AVAILABILITY'}
              </button>
            )}
            {/* 11C.3 revision: one CHECK AVAILABILITY button for performers.
                Opens the shared availability calendar. A venue-owning viewer can
                tap an available date to enquire (existing InviteSheet flow, date
                prefilled); everyone else sees it read-only. If the performer has
                no published availability, a venue owner's button opens the
                enquiry sheet directly — no lost enquiry path. */}
            {/* ⚠ The flag outranks the data here too: without it, the OWNER of
                a private calendar (whose own rows RLS still returns) got a
                button that opened nothing — the read-only calendar path is
                for published dates, and the InviteSheet path needs venueCtx. */}
            {isPerformer && !isUnclaimed && ((!profile.availability_private && perfAvailDates && perfAvailDates.size > 0) || venueCtx) && (
              <button
                className={s.followBtn}
                style={{ background: `linear-gradient(135deg, ${col}, ${grad2})`, color: '#0a0a14', borderColor: 'transparent', width: '100%' }}
                onClick={() => {
                  /* ⚠ THE FLAG OUTRANKS THE DATA — deliberately, because for
                     one viewer they disagree: S3's RLS hides a private
                     calendar from everyone EXCEPT its owner (can_act_as), so
                     the owner's own view still loads dates. Checking size
                     first showed the owner a published-state button nobody
                     else sees. The flag is what the WORLD sees; render from
                     it, and the owner's view stops lying about their public
                     face. Same precedence the venue branch already uses. */
                  if (!profile.availability_private && perfAvailDates && perfAvailDates.size > 0) setPerfAvailOpen(true);
                  else { setInviteDate(null); setInviteOpen(true); }
                }}
              >
                {/* ⚠ Same truth-telling as the venue button: with no published
                    dates the tap goes straight to the enquiry sheet, so
                    CHECK AVAILABILITY would name a step that does not happen. */}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle', marginTop: -2 }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>{(!profile.availability_private && perfAvailDates && perfAvailDates.size > 0) ? 'CHECK AVAILABILITY' : 'ENQUIRE'}
              </button>
            )}
            {/* ⚠ WITHHELD ≠ UNKNOWN, SAID OUT LOUD (ratified 2026-08-14). A
                performer who keeps their calendar private used to be
                indistinguishable from one who never filled it in — both
                rendered as NO BUTTON, a visual hole with no explanation. For
                viewers with no enquiry path (no venue profile), this line is
                the difference between "nothing here" and "not published, on
                purpose". Viewers WITH a venue get the ENQUIRE button above
                instead, which says it better. */}
            {isPerformer && !isUnclaimed && !venueCtx && profile.availability_private && (
              <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', margin: '2px 0 0', letterSpacing: 0.3 }}>
                Availability isn&rsquo;t published for this profile.
              </p>
            )}
            {/* Shared social links row beneath the action buttons — now on
                every profile type, venue included (11C.4: the venue's socials
                used to be buried inside the VENUE INFO dropdown). */}
            <div style={{ paddingTop: 12 }}><ProfileSocialLinks socials={socials} justify="center" /></div>
          </div>

          {/* Claim this profile — unclaimed profiles only (keyed on the row's
              claim state since M5; claiming is spec §7's manual-review flow) */}
          {/**
            * ⭐⭐ THIS IS AN OFFER, NOT A FOOTNOTE (owner, 2026-08-26).
            *
            * It was 12px at 32% white with a 15% underline — quieter than the
            * disclaimers around it, on the one control that hands somebody
            * back their own history. An unclaimed profile carries the act's
            * gigs and the audience already following them; the person it
            * belongs to has to be able to SEE the way in.
            *
            * ⚠ Louder, not shouty. It reads as an invitation the owner can act
            * on, and stays ignorable by the ninety-nine visitors who are not
            * them — a full-width banner would tax every one of those to serve
            * the one.
            */}
          {isUnclaimed && (
            <div style={{ textAlign: 'center', marginTop: -4, marginBottom: 14 }}>
              {profile.claim_status === 'pending'
                ? <span style={{ fontSize: 13, color: 'rgba(255,255,255,.42)', fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2 }}>Claim under review</span>
                : <button
                    onClick={() => setClaimOpen(true)}
                    style={{
                      background: 'rgba(255,184,48,.09)',
                      border: '1px solid rgba(255,184,48,.36)',
                      borderRadius: 999,
                      color: '#FFB830',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                      letterSpacing: 0.2,
                      padding: '9px 18px',
                    }}
                  >
                    Is this you? Claim this profile
                  </button>
              }
            </div>
          )}

          {/* Events sheet */}
          {(() => {
            /* ⛔⛔ WAS the UTC date, and it is the UPCOMING / PAST split — so an
               event happening TODAY fell into PAST for every AU user until
               mid-morning. See lib/dates.js. */
            const todayStr = today();
            const upcoming = events.filter(ev => (ev.config?.date || '9999') >= todayStr).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
            const past     = events.filter(ev => (ev.config?.date || '9999') <  todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
            const list     = showPast ? filterPastEvents(past, pastGigSearch) : upcoming;
            const showAll  = showPast ? showAllPast : showAllUp;
            const setAll   = showPast ? setShowAllPast : setShowAllUp;
            if (!upcoming.length && !past.length) return null;
            return (
              /* ⭐ QR1 · `section-whats-on` is the landing point of a venue's
                 permanent What's On QR (`/q/whats-on/{profileId}`), which
                 arrives as `?focus=whats-on` and scrolls here. ⛔ The id is part
                 of a printed destination now — renaming it silently breaks
                 every code already on a wall into a plain profile visit. */
              <div id="section-whats-on" style={{ marginTop: 10, position: 'relative', padding: '30px 0 20px', marginLeft: -16, marginRight: -16, paddingLeft: 16, paddingRight: 16, background: 'linear-gradient(to bottom, transparent 0%, rgba(10,10,20,.7) 20%, rgba(10,10,20,.7) 80%, transparent 100%)' }}>
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
                  ? <div ref={gigsDrag.ref} onMouseDown={gigsDrag.onMouseDown} onMouseMove={gigsDrag.onMouseMove} onMouseUp={gigsDrag.onMouseUp} onMouseLeave={gigsDrag.onMouseLeave}
                      style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 4, cursor: 'grab' }}>
                      {list.map(ev => {
                        const cfg = ev.config || {};
                        // Cover first, poster as the fallback — lib/eventImage.js.
                        const poster = eventCardImage(ev) || '';
                        const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);
                        const dateObj = cfg.date ? new Date(cfg.date + 'T12:00:00') : null;
                        const dateStr = dateObj ? dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
                        return (
                          <div key={ev.id} onClick={() => navigate(`/event/${ev.id}`)} style={{ position: 'relative', flexShrink: 0, width: 148, borderRadius: 12, overflow: 'hidden', background: '#0e0e18', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'transform .2s' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = ''}
                          >
                            {/* Image area */}
                            <div style={{ position: 'relative', height: 155, background: poster ? `url(${poster}) center/cover` : 'linear-gradient(135deg,#1a0533,#2d1b69)', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to bottom, transparent, #0e0e18)' }} />
                              {/* ⭐ The SHARED pill, not a fourth inline copy of it. This
                                  was a near-duplicate of DateBox, which is why a past
                                  event's year pill appeared on event cards and not here.
                                  `portrait` reproduces this card's exact metrics. */}
                              {cfg.date && <div style={{ position: 'absolute', top: 8, right: 8 }}>
                                <DateBox date={cfg.date} size="portrait" />
                              </div>}
                              {(() => { const badges = eventCategoryBadges(cfg, ev.name); return badges.length > 0 && (
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
          reopens, exactly as before.

          ⛔ NO SUBTITLE. "Dates this venue is available for hire" restated the
          title directly above it and the key directly below it, which already
          says TAP DATE TO ENQUIRE — three lines to explain a calendar of
          dates. */}
      {availOpen && (
        <AvailabilityCalendar
          onClose={() => setAvailOpen(false)}
          title="VENUE AVAILABILITY"
          accent="#00E5A0"
          accentRgb="0,229,160"
          availableDates={availDates}
          eventDates={eventDates}
          /* ⭐ THE THREE PUBLIC STATES (ratified 2026-08-14). Published keeps
             the old behaviour: view mode, only green dates tappable. PRIVATE
             (the owner keeps a calendar but does not publish it — S3 RLS means
             the rows never even arrive here) and NOT SET both switch to edit
             mode, where ANY future date is tappable — the enquirer names the
             date they are asking about instead of hitting a calendar with
             nothing to tap. ⛔ An empty calendar must never read as booked
             out, and it must never be a dead end: availability is optional
             public information, not the gate for contact. */
          mode={(profile.availability_private || (availDates && availDates.size === 0)) ? 'edit' : 'view'}
          /* ⚠ A SUBTITLE ONLY IN THE NON-PUBLISHED STATES. The published case
             keeps its deliberate no-subtitle rule (it restated the title);
             these two carry information the calendar cannot: WHY there are no
             green dates, and that this is not a refusal. Withheld ≠ unknown,
             so the two states say different things. */
          subtitle={profile.availability_private
            ? "This venue doesn't publish availability. Pick the date you're asking about."
            : (availDates && availDates.size === 0)
              ? "Availability isn't published yet. Pick the date you're asking about."
              : undefined}
          onSelectDate={openEnquiry}
          month={availMonth}
          onMonthChange={setAvailMonth}
          footer={
            <>
              {availDates === null && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
              {enquiryLoading && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
              {availDates !== null && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* The green-square key describes published dates; in the
                      private/not-set states there are none, and every future
                      date is tappable, so the key would point at nothing. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!profile.availability_private && availDates.size > 0 && (
                      <span style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(0,229,160,.18)', border: '1px solid rgba(0,229,160,.5)', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
                      {(profile.availability_private || availDates.size === 0) ? 'TAP ANY DATE TO ENQUIRE' : 'TAP DATE TO ENQUIRE'}
                    </span>
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
            {/* ⭐ The canonical card here too. Choosing WHICH ACT to enquire as
                is the same act of recognising a profile that Discover and
                Messenger's contact list ask for, and ProfileCard is already the
                compact row both of those use. A third bespoke row on the same
                screen was the last of them. */}
            {pickerProfs.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <ProfileCard item={p} onClick={() => { setEnquiryProf(p); setPickerProfs([]); }} />
              </div>
            ))}
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
            {/* ⭐ THE APP'S OWN CARD (owner, 2026-08-10: "the profile cards in
                the availability still aren't the canonical cards").
                This was a hand-rolled avatar + name + location + genres row —
                the same information the shared card already renders, in a shape
                that existed only here. Discover, the dashboards, Messenger and
                the pre-send check all use ProfileCard; this was the last place
                that did not.
                ⛔ onClick is a no-op — you are looking at yourself, and
                navigating away mid-enquiry would lose the note. */}
            <div style={{ marginBottom: 16 }}>
              <ProfileCard item={enquiryProf} onClick={() => {}} />
            </div>
            <textarea
              value={enquiryNote}
              onChange={e => setEnquiryNote(e.target.value)}
              placeholder="Add a message — anything extra the venue should know…"
              style={{ width: '100%', minHeight: 90, background: 'rgba(255,255,255,.06)', border: `1px solid rgba(${rgb},.35)`, borderRadius: 12, color: '#e8e8f0', fontSize: 14, padding: 12, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            {/* P6 — what this venue asks for, BEFORE the send button rather
                than after a rejection. A checklist revealed on refusal is a
                post-mortem; shown here it is something the enquirer can still
                go and fix. Renders only when the venue asks for something —
                a venue with no requirements shows nothing at all, never an
                empty "0/0" card (Rendering Contract R3). */}
            {venueRequired?.length > 0 && (
              <RequirementsVerdict
                evaluation={reqEval}
                title="WHAT THIS VENUE ASKS FOR"
                /* The editor for the profile they are ENQUIRING AS, resolved
                   from that profile's own type — a comedian switching to their
                   band profile gets the band editor. Same resolution as
                   ApplyButton's, because the gap is closed in the same place. */
                editPath={enquiryProf?.type ? `/industry/${enquiryProf.type}/setup` : null}
                style={{ marginTop: 12, marginBottom: 0 }}
              />
            )}
            {/* P12 — ⛔ THE CHOICE PATH. Rendered only when several Ask
                Categories apply to the acting profile, which no profile can do
                today. It exists because the alternative is a resolver that
                guesses, and a guess here is frozen onto the record forever:
                `ask_category` is written once at creation and never revisited.
                ⚠ If this ever appears on screen, a profile has started spanning
                two categories — that is information, not a bug. */}
            {askChoiceNeeded && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 6 }}>
                  WHAT ARE YOU ENQUIRING ABOUT?
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {askOptions.map(key => {
                    const on = askCategory === key;
                    return (
                      <button key={key} type="button" onClick={() => setAskCategory(key)}
                        style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
                                 padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                                 border: `1px solid ${on ? col : 'rgba(255,255,255,.2)'}`,
                                 background: on ? `rgba(${rgb},.15)` : 'transparent',
                                 color: on ? col : 'var(--muted)' }}>
                        {/* ⛔ The registry owns the label — never the raw key. */}
                        {askCategoryLabel(key) || key}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ⚠ WHY AN ENQUIRY DID NOT SEND, said on the screen rather than in
                the console. A duplicate used to close this sheet exactly as a
                success does; the artist believed they had enquired and waited
                on a reply nobody had been asked for. */}
            {enquiryError && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,215,0,.08)',
                            border: '1px solid rgba(255,215,0,.35)', borderRadius: 8,
                            fontSize: 13, color: '#FFD700', lineHeight: 1.5 }}>
                {enquiryError}
              </div>
            )}
            <button
              onClick={requestSendEnquiry}
              disabled={enquirySending || !canSendEnquiry({ required: venueRequired, evaluation: reqEval, evaluating: reqEvaluating, actingProfileId: enquiryProf?.id ?? null, evaluatedProfileId: reqEvalFor })}
              style={{ marginTop: 12, width: '100%', background: `linear-gradient(135deg,${col},${grad2})`, color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, padding: 16, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: (enquirySending || !canSendEnquiry({ required: venueRequired, evaluation: reqEval, evaluating: reqEvaluating, actingProfileId: enquiryProf?.id ?? null, evaluatedProfileId: reqEvalFor })) ? .6 : 1 }}
            >{/* The label names the PROFILE GAP rather than saying "blocked" —
                  the fix is one screen away and the button should say so. */}
              {enquirySending ? 'SENDING…'
                /* Requirements unread, or the verdict still in flight, or the
                   verdict describing the act they just switched away from —
                   all three are "we don't know yet", and all three say so
                   rather than claiming the profile is incomplete. */
                : venueRequired === null ? 'CHECKING…'
                : venueRequired.length > 0 && (reqEvaluating || reqEvalFor !== (enquiryProf?.id ?? null)) ? 'CHECKING…'
                : venueRequired.length > 0 && !reqEval?.canSubmit ? 'COMPLETE YOUR PROFILE FIRST'
                : 'SEND ENQUIRY →'}</button>
            <button onClick={() => { setEnquiryProf(null); setEnquiryNote(''); setPreSendOpen(false); setEnquiryError(''); }} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* P8 — the pre-send check. Rendered ABOVE the enquiry sheet rather than
          inside it, so cancelling returns to a sheet that still holds the note
          and the chosen act: "let me fix something" has to leave the something
          intact, or the check costs more than it saves. */}
      {preSendOpen && enquiryProf && pickerDate && (
        <PreSendCheckSheet
          profile={enquiryProf}
          // The projection belongs to the CALLER — only this screen knows what
          // a venue can read about an act.
          rows={buildEnquiryPreview(enquiryProf)}
          note={enquiryNote.trim() || null}
          accent={col} accent2={grad2}
          busy={enquirySending}
          subtitle={`This is what ${profile.name || 'this venue'} will see about you, along with your enquiry for ${new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}.`}
          onSend={sendEnquiry}
          onSendAndSuppress={sendEnquiryAndSuppress}
          onCancel={() => setPreSendOpen(false)}
        />
      )}

      <ClaimDialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        profile={profile}
        session={session}
        // Submission just flipped the row's claim_status to 'pending' via the
        // database trigger — refetch so the underline link becomes "Claim
        // under review" (Q7 5.2) without a reload.
        onSubmitted={() => queryClient.invalidateQueries({ queryKey: ['profile', id] })}
      />

      {inviteOpen && venueCtx && (
        <InviteSheet
          artist={profile}
          events={venueCtx.events}
          venueUserId={session.user.id}
          // venueCtx.id IS the viewer's venue profile — passing it stops
          // InviteSheet re-deriving a fact this screen already knows.
          venueProfileId={venueCtx.id}
          /* U4: one venue is stated, several are asked. See InviteSheet. */
          venueProfiles={venueCtx.venues}
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
