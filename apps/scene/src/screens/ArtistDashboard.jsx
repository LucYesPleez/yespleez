import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { writeNotification, inferToProfileId } from '../lib/writeNotification';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import { eventRunsOn } from '../lib/eventDays';
import { withDirection } from '../lib/enquiryUtils';
import s from './ArtistDashboard.module.css';
import EventCard from '../components/EventCard';
import { useDragScroll } from '../hooks/useDragScroll';
import { useDashboardLanding } from '../lib/useDashboardLanding';
import DashboardHeader from '../components/DashboardHeader';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import OpportunityCard from '../components/OpportunityCard';
import BookingInvitation from '../components/BookingInvitation';
import AvailabilitySection from '../components/AvailabilitySection';
import OutgoingEnquiryRow from '../components/OutgoingEnquiryRow';
/* ⚠ `APP_TAB_COLOR` / `applicantLabel` DROPPED 2026-09-01 — the row badges were
   their last runtime caller and now read the canonical bucket instead. Both stay
   exported from the pipeline; see the note at the badge. */
import { OUT_EMPTY, fetchOutgoingEnquiries, isFadedDecline, DECLINE_FADE_DAYS } from '../lib/outgoingPipeline';
import { cancelEnquiry } from '../lib/cancelEnquiry';
import { DIR_TABS, EnquiryDirectionTabs, EnquiryStatusTabs, EnquirySearch } from '../components/EnquiryTabs';
import { normaliseStatus, STATUS_TAB_COLOR } from '../lib/enquiryUtils';
import EnquiryCalendar from '../components/EnquiryCalendar';
import { CalendarIconBtn } from '../components/DecisionButtons';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { completionFor, firstUnsettled } from '@yespleez/requirements';

// The artist's opportunity pipeline.
//
// NEW means UNDECIDED, not unread. Reading is metadata — opening an offer
// stores 'seen' purely to clear its NEW dot; it stays in NEW until the artist
// consciously decides Consider / Accept / Decline. There is deliberately no
// "Seen" bucket: looking at something isn't progress, and a read-but-undealt-
// with pile is how inboxes become graveyards. The pipeline advances only on
// intentional decisions.
// ACCEPTED rather than BOOKED: the four-bucket model calls this "Booked", but
// these buckets are scoped inside the INCOMING direction tab, which already
// sits alongside a top-level BOOKED tab for confirmed gigs. Two nested tabs
// sharing a name is worse than a slightly less pure label. Revisit if/when the
// dashboard's top-level navigation gets reworked.
/* ⛔ IN_STATUS_MAP AND IN_TABS ARE GONE (owner, 2026-08-14). They were a
   third and fourth mapping of one status set, and the reason this screen
   showed NEW / CONSIDERING / ACCEPTED / HISTORY where the venue and host
   showed NEW / SEEN / SHORTLISTED / ACCEPTED / DECLINED. The buckets now come
   from normaliseStatus, the same function every other surface uses.
   ⛔ Do not reintroduce a local vocabulary here. */
// Unread = never opened. Drives the NEW dot only, never the bucket.
const UNREAD_STATUSES = ['new', 'pending'];
// Calm by default — an empty bucket is a feature, not a gap.
const IN_EMPTY = {
  NEW:         'Nothing new right now.',
  CONSIDERING: "You haven't put anything on your maybe list.",
  ACCEPTED:    "You haven't accepted any invitations yet.",
  HISTORY:     'Nothing here yet.',
};

// Applicant-side (OUTGOING) pipeline — what the person who ASKED sees
// (asymmetric with the venue's own labels, deliberately).
//
// ⚠ THESE NOW LIVE IN lib/outgoingPipeline.js, unchanged. They moved the moment
// HostDashboard needed the same four buckets: a promoter asking a venue about a
// night is the same question as a DJ applying to an event, and two copies of a
// status vocabulary agree today and drift tomorrow.
/* ⛔ GIG_TABS (UPCOMING / PAST) IS GONE — owner, 2026-08-31. Those were sub-tabs
   under BOOKED, which buried twelve played gigs a level below one upcoming
   one. PAST is now the top-level HISTORY tab and BOOKED means what is coming
   up. ⛔ Do not reintroduce the pair: two ways to reach the same list is how
   one of them goes stale. */

// One application row: the event card, an "applied on" caption so it's always
// clear which event/date this application refers to, and — only for terminal
// (declined/rejected) applications — an optional delete affordance.
function ApplicationRow({ app, badge, badgeColor, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const deletable = badge === 'NOT SELECTED';
  const appliedOn = app.created_at ? formatDisplayDate(app.created_at.slice(0, 10)) : '';

  return (
    <div>
      <EventCard event={app.event} badge={badge} badgeColor={badgeColor} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 0' }}>
        {appliedOn && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>Applied {appliedOn}</span>}
        {deletable && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer' }}>
            DELETE
          </button>
        )}
      </div>
      {deletable && confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', background: 'rgba(255,45,45,.08)', border: '1px solid rgba(255,45,45,.3)', borderRadius: 10, padding: '10px 12px', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginRight: 'auto' }}>Delete this application?</span>
          <button onClick={() => setConfirming(false)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
            CANCEL
          </button>
          <button onClick={() => onDelete(app.id)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.5)', background: 'rgba(255,51,51,.15)', color: '#fff', cursor: 'pointer' }}>
            YES, DELETE
          </button>
        </div>
      )}
    </div>
  );
}

export default function ArtistDashboard({ userId: userIdProp, config }) {
  const { session } = useSession();
  const navigate    = useNavigate();
  const queryClient = useQueryClient();
  const userId      = userIdProp || session?.user?.id;

  // headingLine1/2 stay local (this dashboard's own heading copy);
  // gradient/accent/accentRgb derive from PROFILE_TYPES.artist.
  const cfg = config || {
    headingLine1: 'DJ /',
    headingLine2: 'PRODUCER',
    gradient:     PROFILE_TYPES.artist.gradient,
    accent:       PROFILE_TYPES.artist.accent,
    accentRgb:    PROFILE_TYPES.artist.rgb,
    profileType:  'artist',
    setupPath:    '/industry/artist/setup',
    browseLabel:  'BROWSE OPEN EVENTS →',
    setupPlaceholder: 'Set up your artist profile',
  };

  const [enqDirTab,     setEnqDirTab]     = useState('INCOMING');
  const [inStatusTab,   setInStatusTab]   = useState('NEW');
  const [openOffer,     setOpenOffer]     = useState(null);
  const [undoItem,      setUndoItem]      = useState(null);
  const undoTimer = useRef(null);
  /* AWAITING, not SUBMITTED — the shared OUTGOING sub-tabs (see EnquiryTabs). */
  const [outStatusTab,  setOutStatusTab]  = useState('AWAITING');
  const [calendarOpen,  setCalendarOpen]  = useState(false);
  const [enqSearch,     setEnqSearch]     = useState('');
  const [pastGigSearch, setPastGigSearch] = useState('');
  const [following,     setFollowing]     = useState([]);
  const [loadingFollow, setLoadingFollow] = useState(false);
  const [followView,    setFollowView]    = useState('portrait');
  const [followFilter,  setFollowFilter]  = useState('ALL');
  const [followShowAll, setFollowShowAll] = useState(false);
  const [followSearch,  setFollowSearch]  = useState('');
  const followDrag = useDragScroll('artist-dashboard-following');
  const [offers,        setOffers]        = useState([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const offersLoaded = useRef(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['artistDashboard', userId, cfg.profileType],
    queryFn: async () => {
      /**
       * ⚠ EVERY QUERY BELOW IS KEYED ON THE PROFILE, NOT THE ACCOUNT.
       *
       * They were all keyed on `userId` — the human — while only the profile
       * row itself was scoped by type. One human owns several performer
       * profiles, so a comedian's dashboard listed their DJ act's bookings,
       * applications and offers: the heading changed, the data did not. It
       * was reported as "the poet isn't in these set times but the set times
       * are on the poet's dashboard", which is exactly what it looks like.
       *
       * `cfg.profileType` is authoritative here (PerformerDashboard renders
       * this screen for band and comedy through a config), and it already
       * scopes the profile row and completionFor. The profile row's own `id`
       * is therefore the correct key, so the fetch is now sequenced: profile
       * first, everything else filtered by it.
       *
       * Verified before cutting over: 0 of 6 venue_enquiries and 0 of this
       * account's applications / lineup_members lack a profile id, so nothing
       * disappears. 3 applications and 22 lineup_members elsewhere in the
       * table are still unattributed — they belong to other accounts, are
       * addressed by the m6c backfill, and are deliberately NOT rescued here
       * with an `OR artist_id = userId` clause. That clause is the bug: it is
       * what shows one profile's work on another.
       */
      const { data: profileRow } = await supabase.from('profiles')
        .select('*').eq('user_id', userId).eq('type', cfg.profileType).maybeSingle();
      const profileId = profileRow?.id ?? null;

      // No profile of this type yet — there is nothing of theirs to list. An
      // empty result is correct; falling back to the account key here would
      // reinstate the cross-over for exactly the users most likely to notice.
      const profRes = { data: profileRow };
      /**
       * ⭐ THE THIRD QUERY IS THE ARTIST'S OWN ENQUIRIES, AND IT WAS MISSING.
       *
       * Both existing `venue_enquiries` reads on this screen filter to
       * `initiated_by: 'venue'` — those are OFFERS, a venue inviting you. There
       * was no query anywhere for `'applicant'`, the enquiries you SEND, so an
       * artist could enquire with a venue and then have no way to see that they
       * had: not the date, not the status, not the venue's reply. The row was
       * written correctly and the venue could see it; only the sender could not.
       *
       * The OUTGOING tab read `applications` alone, which is why it said "You
       * haven't applied to anything yet" — literally true of EVENTS, and
       * useless to someone who had just enquired with a venue.
       */
      const [appsRes, gigsRes, outgoingEnquiries] = profileId
        ? await Promise.all([
            supabase.from('applications').select('id, status, event_id, created_at').eq('from_profile_id', profileId).order('created_at', { ascending: false }).limit(50),
            supabase.from('lineup_members').select('event_id').eq('artist_profile_id', profileId).eq('status', 'on_bill'),
            // ⚠ The query and its venue join now live in lib/outgoingPipeline —
            // HostDashboard asks the identical question, and one asker's list
            // must not be able to answer it differently from another's.
            fetchOutgoingEnquiries(supabase, profileId),
          ])
        : [{ data: [] }, { data: [] }, []];

      const claimEventIds = [...new Set((gigsRes.data || []).map(c => c.event_id).filter(Boolean))];
      let allGigs = [];
      if (claimEventIds.length) {
        const { data: evs } = await supabase.from('events').select('id, name, config').in('id', claimEventIds);
        allGigs = evs || [];
      }
      const todayStr     = today();
      const upcomingGigs = allGigs.filter(ev => (ev.config?.date || '') >= todayStr);
      const pastGigs     = allGigs.filter(ev => (ev.config?.date || '') < todayStr)
                                  .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));

      const appEventIds = [...new Set((appsRes.data || []).map(a => a.event_id).filter(Boolean))];
      let appEvents = {};
      if (appEventIds.length) {
        const { data: evData } = await supabase.from('events').select('id, name, config').in('id', appEventIds);
        (evData || []).forEach(ev => { appEvents[ev.id] = ev; });
      }
      const applications = (appsRes.data || []).map(a => ({ ...a, event: appEvents[a.event_id] || null }));

      // Venue-initiated invites only. Without this filter the artist's own
      // enquiries to venues (ProfileScreen's availability flow, which stores
      // only a date + note and never an event/pitch/fee) get counted and
      // rendered here as if a venue had invited them.
      //
      // This used to filter `.eq('direction', 'outgoing')` — a column that has
      // never existed, so the query failed live with
      // `42703: column venue_enquiries.direction does not exist` and this count
      // was always 0. `initiated_by` says the same thing without the
      // viewer-relative riddle the old comment had to explain.
      // Profile-keyed for the same reason as the two above: `applicant_user_id`
      // counted every profile's offers on every profile's dashboard.
      const { count: offersCount } = profileId
        ? await supabase
            .from('venue_enquiries')
            .select('id', { count: 'exact', head: true })
            .eq('applicant_profile_id', profileId)
            .eq('initiated_by', 'venue')
        : { count: 0 };

      return { profile: profRes.data, applications, outgoingEnquiries, upcomingGigs, pastGigs, offersCount: offersCount || 0 };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const applications = data?.applications || [];
  const outgoingEnquiries = data?.outgoingEnquiries || [];
  const upcomingGigs = data?.upcomingGigs || [];
  const pastGigs     = data?.pastGigs     || [];
  const offersCount  = data?.offersCount  ?? 0;

  // Load offers lazily when INCOMING tab is first selected.
  // Waits on `profile` — this list is profile-keyed like the count it pairs
  // with, and reading it before the profile resolves would either fetch
  // nothing or (as it used to) fetch every profile's offers.
  useEffect(() => {
    // The guard stores WHICH profile was loaded, not merely that a load
    // happened. A bare boolean would keep the first profile's offers on screen
    // after switching to another performer profile of the same account — the
    // same cross-over this fix removes, reintroduced by a cache.
    if (enqDirTab !== 'INCOMING' || !profile?.id || offersLoaded.current === profile.id) return;
    offersLoaded.current = profile.id;
    setOffers([]);
    setLoadingOffers(true);
    (async () => {
      // Venue-initiated invites only — see the offersCount query above for why
      // the filter matters, and why it is `initiated_by`, not `direction`.
      const { data: rawRows } = await supabase.from('venue_enquiries')
        .select('*').eq('applicant_profile_id', profile.id).eq('initiated_by', 'venue')
        .order('created_at', { ascending: false }).limit(50);
      // This screen reads the table from the applicant's side, so a
      // venue-initiated row is incoming here.
      const rows = withDirection(rawRows, 'applicant');
      // M5.1 (D4): venue resolves by the enquiry row's venue_profile_id; legacy
      // user_id+type join only for rows without one.
      const venueCols = 'id, user_id, name, avatar, avatar_hero, avatar_thumb, type, bio, sound, genre_string, location, suburb, state, postcode, card_pills';
      const pidRows = (rows || []).filter(r => r.venue_profile_id);
      const uidRows = (rows || []).filter(r => !r.venue_profile_id && r.venue_user_id);
      const [vPid, vUid] = await Promise.all([
        pidRows.length ? supabase.from('profiles').select(venueCols).in('id', pidRows.map(r => r.venue_profile_id)) : Promise.resolve({ data: [] }),
        uidRows.length ? supabase.from('profiles').select(venueCols).in('user_id', uidRows.map(r => r.venue_user_id)).eq('type', 'venue') : Promise.resolve({ data: [] }),
      ]);
      const venueById = {}; (vPid.data || []).forEach(p => { venueById[p.id] = p; });
      const venueByUid = {}; (vUid.data || []).forEach(p => { venueByUid[p.user_id] = p; });
      setOffers((rows || []).map(r => {
        const vp = venueById[r.venue_profile_id] || venueByUid[r.venue_user_id] || null;
        return { ...r, venue_name: vp?.name || null, venueProfile: vp };
      }));
      setLoadingOffers(false);
    })();
    // Keyed on the PROFILE now, and on the tab that triggers the load. Leaving
    // `userId` here would not re-run when switching between two performer
    // profiles of the same account — which is the very case this fix is for.
  }, [enqDirTab, profile?.id]);

  // Load following on mount
  useEffect(() => {
    if (!userId) return;
    setLoadingFollow(true);
    (async () => {
      // M5.1 (D6): followed profiles resolve by target_profile_id; legacy
      // entity_id join only for rows without one.
      const { data: rows } = await supabase.from('follows').select('entity_id, target_profile_id').eq('user_id', userId).neq('entity_type', 'event');
      const fPids = [...new Set((rows || []).filter(r => r.target_profile_id).map(r => r.target_profile_id))];
      const fLegacy = [...new Set((rows || []).filter(r => !r.target_profile_id).map(r => r.entity_id).filter(Boolean))];
      if (!fPids.length && !fLegacy.length) { setLoadingFollow(false); return; }
      const fCols = 'id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location';
      const [fPidRes, fUidRes] = await Promise.all([
        fPids.length ? supabase.from('profiles').select(fCols).in('id', fPids) : Promise.resolve({ data: [] }),
        fLegacy.length ? supabase.from('profiles').select(fCols).in('user_id', fLegacy) : Promise.resolve({ data: [] }),
      ]);
      // ⚠ ONE KEYSPACE OUT — PROFILE ID. The two follow keyspaces resolve
      // differently (a modern row names a PROFILE, a legacy row names a USER),
      // and this map used to store them under both: `seen[p.id]` beside
      // `seen[p.user_id]`. A profile reachable both ways landed in it twice
      // under two different keys, and FollowingSection then rendered it twice.
      // Legacy rows still collapse per USER first — one legacy follow is one
      // card even when that account owns several profiles, preferring a
      // non-punter identity — and only the profile that wins goes into the map.
      const seen = {};
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      const legacyByUser = {};
      (fUidRes.data || []).forEach(p => { if (!legacyByUser[p.user_id] || p.type !== 'punter') legacyByUser[p.user_id] = p; });
      Object.values(legacyByUser).forEach(p => { seen[p.id] = p; });
      setFollowing(Object.values(seen));
      setLoadingFollow(false);
    })();
  }, [userId]);

  // User-initiated deletion is only ever offered for declined/rejected applications
  // (never pending/shortlisted/accepted) — see ApplicationRow's `deletable` check.
  async function handleDeleteApplication(appId) {
    await supabase.from('applications').delete().eq('id', appId).in('status', ['declined', 'rejected']);
    queryClient.invalidateQueries({ queryKey: ['artistDashboard', userId, cfg.profileType] });
  }

  /**
   * ⭐ WITHDRAW AN ENQUIRY YOU SENT (owner, 2026-08-14).
   *
   * ⚠ AN UPDATE, NOT A DELETE — and the row it guards on is the one the SENDER
   * owns. `applicant_profile_id` scopes the write to this act's own asks, so
   * a mis-passed id cannot cancel somebody else's; RLS says the same thing
   * from the other side, and agreeing with it here means the failure is a
   * no-op rather than an error.
   *
   * ⚠⚠ THIS BLOCK SAID `declined` AND THE CODE BELOW ALREADY SAID `cancelled`.
   * The status is `cancelled` — the asker's withdrawal, kept apart from the
   * venue's verdict (owner, 2026-08-14). Both status maps understand it.
   *
   * ⚠ NO NOTIFICATION ON AN UNANSWERED ASK. Withdrawing something nobody has
   * replied to is the asker stepping back and the venue lost nothing.
   * ⭐ BUT AN ACCEPTED ONE DOES NOTIFY (owner, 2026-09-01) — a venue that
   * agreed a date has to know the spot is open again in time to refill it.
   * That split lives in `lib/cancelEnquiry`, not here.
   */
  /**
   * ⭐ MOVED INTO `lib/cancelEnquiry` (2026-09-01). The write is unchanged; what
   * it gained is the venue's notice on an ACCEPTED ask, and a second caller —
   * HostDashboard, whose own cancel wrote nothing at all. Two dashboards
   * open-coding one decision is how the `declined`/`cancelled` split happened.
   *
   * ⚠ TAKES THE ROW, not an id: the notice needs the venue's delivery identity
   * and the status it is cancelling, and neither survives an id.
   */
  async function handleCancelEnquiry(enq) {
    if (!profile?.id) return;
    const { error } = await cancelEnquiry(enq, profile.id, profile.name);
    if (error) return;
    queryClient.invalidateQueries({ queryKey: ['artistDashboard', userId, cfg.profileType] });
  }

  /**
   * ⭐ CLEAR — TIDY A DECLINED ROW OUT OF YOUR OWN LIST.
   *
   * ⛔ NOT A DELETE, and not a status change. The venue said no; that answer is
   * theirs and stays in their history. This only stops the row appearing here.
   *
   * `ids` so one call serves both the single CLEAR and CLEAR ALL — the sweep is
   * one round trip rather than one per row, and cannot half-finish.
   */
  async function handleClearEnquiries(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!profile?.id || !list.length) return;
    await supabase.from('venue_enquiries')
      .update({ applicant_cleared_at: new Date().toISOString() })
      .in('id', list)
      .eq('applicant_profile_id', profile.id);
    queryClient.invalidateQueries({ queryKey: ['artistDashboard', userId, cfg.profileType] });
  }

  function updateOffer(id, changes) {
    setOffers(prev => prev.map(o => o.id === id ? { ...o, ...changes } : o));
  }

  async function handleOfferRespond(id, status) {
    const offer = offers.find(o => o.id === id);
    if (!offer) return;
    // M6 (R6.1): the invitation already names the profile that was
    // invited — applicant_profile_id on venue_enquiries. Use it rather
    // than re-deriving: the host chose this profile, so any other answer
    // would attribute the application to someone they did not invite.
    // Fall back to the seam only for legacy offers that predate that
    // column being populated.
    //
    // ⚠ DECLARED HERE, NOT INSIDE THE `if` BELOW. It was block-scoped to the
    // accepted-with-event branch and then read again by the notification
    // further down, outside that block — a ReferenceError that threw before
    // writeNotification could run and left `updateOffer` unreached, so
    // accepting an invite appeared to do nothing. `vite build` compiles it
    // happily; only `oxlint --deny no-undef` sees it.
    const fromProfileId = status === 'accepted'
      ? (offer.applicant_profile_id
          ?? (await resolvePerformerProfileId(userId)).profileId
          ?? null)
      : null;
    if (status === 'accepted' && offer.event_id) {
      await supabase.from('applications').insert({
        event_id: offer.event_id, artist_id: userId, from_profile_id: fromProfileId, status: 'pending',
      });
    }
    await supabase.from('venue_enquiries').update({ status }).eq('id', id);
    if (offer.venue_user_id && status === 'accepted') {
      // §A7: about = the performer profile that accepted (the same one the
      // application was attributed to, resolved above — never re-derived, or
      // the notice and the application could name different profiles).
      // to = the venue's profile, inferred under U4; null if ambiguous.
      await writeNotification({
        toUserId:       offer.venue_user_id,
        toProfileId:    await inferToProfileId(offer.venue_user_id, 'venue'),
        aboutProfileId: fromProfileId,
        type:    'invite_accepted',
        message: `An artist accepted your invite${offer.event_name ? ` to ${offer.event_name}` : ''}.`,
        data:    { event_id: offer.event_id, event_name: offer.event_name },
      });
    }
    updateOffer(id, { status });
  }

  const hasProfile    = !!profile;
  // Only the user's own curated "5 tags" selection — never the full
  // genre/subgenre/vibe taxonomy list (card_pills is empty until they pick
  // some, so this intentionally shows nothing until they do, rather than
  // falling back to the long raw genre_string).
  const genres        = (profile?.card_pills || '')
    .split(/\s*·\s*|,\s*/).map(t => t.trim()).filter(Boolean).slice(0, 5).join(' · ');
  // Completion comes from the shared requirements engine (lib/requirements.js),
  // not a local field list. `cfg.profileType` — NOT profile.type — is what this
  // screen means: PerformerDashboard renders this same component for band and
  // comedy, and scoring them against the artist list is exactly the bug that
  // capped a comedian at 76% no matter what they filled in.
  const completion = completionFor(profile, cfg.profileType);
  const completionPct = completion?.pct ?? 0;
  // O4 · the highest-value missing field — registry order IS priority order,
  // so this is simply the first unanswered one. Null once nothing is missing.
  const nextStep = firstUnsettled(completion?.items);

  /**
   * ⭐ ONE OUTGOING LIST — everything this act has asked for, in one place
   * (owner: "i want all outgoing enquiries to be together").
   *
   * Two sources, one shape: an event application and a venue availability
   * enquiry are different records but the same question — "I asked for
   * something; where is it up to?". `applicantLabel` already maps both status
   * vocabularies onto the same four buckets, so the sub-tabs need no special
   * casing: an enquiry's `pending` lands in SUBMITTED exactly as an
   * application's does.
   *
   * ⚠ Sorted by `created_at` across both, so the list reads chronologically
   * rather than as two concatenated piles.
   */
  const outgoingItems = [
    ...applications.map(a => ({ kind: 'application', at: a.created_at, row: a })),
    ...outgoingEnquiries.map(e => ({ kind: 'enquiry', at: e.created_at, row: e })),
  ].sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));

  /**
   * ⭐ THE SHARED BUCKETS (owner, 2026-08-14: "theyre sposed to look the
   * same"). `normaliseStatus` is the same function EnquiryPanel uses on the
   * venue and host surfaces, so a row with status `tentative` lands under the
   * identical sub-tab wherever it is read.
   *
   * ⛔ THIS RETIRES TWO LOCAL VOCABULARIES — `IN_STATUS_MAP` (NEW /
   * CONSIDERING / ACCEPTED / HISTORY) and `applicantLabel`'s APP_TABS
   * (SUBMITTED / BEING CONSIDERED / BOOKED / NOT SELECTED). They were the
   * third and fourth mappings of one status set, and the drift they caused is
   * exactly what the owner could see: different sub-headings on two screens
   * showing the same table.
   *
   * ⚠ `applicantLabel` SURVIVES for the row BADGES below, which say where the
   * asker stands in the asker's own words. A tab is navigation and must match
   * every other surface; a badge is commentary on one row and may keep the
   * asker-facing wording.
   */
  /* ⚠ THE 30-DAY FADE RUNS BEFORE ANY BUCKETING, so a faded decline is absent
     from the tab COUNT as well as the list. A badge counting rows the list
     will not show is the bug that makes people tap an empty tab. */
  const outStatuses = outgoingItems
    .filter(it => !isFadedDecline(it.row))
    .map(it => ({ ...it, bucket: normaliseStatus({ ...it.row, direction: 'outgoing' }) }));
  const filteredOut = outStatuses.filter(it => {
    if (it.bucket !== outStatusTab.toLowerCase()) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(it.row).toLowerCase().includes(enqSearch.toLowerCase());
  });
  const filteredOffers = offers.filter(o => {
    if (normaliseStatus({ ...o, direction: 'incoming' }) !== inStatusTab.toLowerCase()) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(o).toLowerCase().includes(enqSearch.toLowerCase());
  });

  /* Counts for the shared tabs. BOOKED counts real gigs, not accepted rows:
     this surface's BOOKED tab lists what the act is actually playing
     (lineup-derived), which is a better answer than "enquiries that ended in
     yes".
     ⚠ BOOKED IS NOW UPCOMING ONLY and HISTORY carries the rest — a badge that
     counted both would promise a list BOOKED no longer renders. */
  const dirCounts = {
    INCOMING: offers.length,
    OUTGOING: outgoingItems.length,
    BOOKED:   upcomingGigs.length,
    HISTORY:  pastGigs.length,
  };
  const inCounts = Object.fromEntries(
    (DIR_TABS.find(d => d.key === 'INCOMING')?.subTabs || []).map(sub =>
      [sub, offers.filter(o => normaliseStatus({ ...o, direction: 'incoming' }) === sub.toLowerCase()).length]));
  /* What CLEAR ALL would sweep: declined ENQUIRIES only. Applications are not
     included — see the button. */
  const clearableDeclined = outStatuses.filter(it => it.kind === 'enquiry' && it.bucket === 'declined');

  const outCounts = Object.fromEntries(
    (DIR_TABS.find(d => d.key === 'OUTGOING')?.subTabs || []).map(sub =>
      [sub, outStatuses.filter(it => it.bucket === sub.toLowerCase()).length]));

  // The clash-check — one source of truth for both the Opportunity Card and the
  // Booking Invitation, so they can never disagree. v1 only checks against the
  // artist's own confirmed gigs; conflicts between two un-accepted offers come
  // with the pipeline.
  function availabilityFor(offer) {
    const d = offer.proposed_date || offer.date_requested;
    if (!d) return { status: 'unknown' };
    /* ⭐ SAME MULTI-DAY RULE AS EVERY OTHER SURFACE. An artist playing a
       three-day festival is BUSY on all three, and asking only about its start
       date told them they were free on the Saturday of a gig they are at. */
    const clash = [...upcomingGigs, ...pastGigs].find(g => eventRunsOn(g, d));
    return clash ? { status: 'clash', clashWith: clash.name } : { status: 'free' };
  }

  // Opening is a read-receipt, not a pipeline move. It clears the NEW dot and
  // nothing else — the offer stays in NEW until an actual decision is made.
  function openOfferSheet(offer) {
    if (UNREAD_STATUSES.includes((offer.status || 'new').toLowerCase())) {
      handleOfferRespond(offer.id, 'seen');
    }
    setOpenOffer(offer);
  }

  // Consider — the conscious "keep this one alive". Private and silent: the
  // venue is never notified (handleOfferRespond only notifies on accept).
  function considerOffer(offer) {
    handleOfferRespond(offer.id, 'shortlisted');
  }

  // Decline — instant, with a 5s undo. Safe to apply optimistically because
  // declining notifies nobody; the only effect is the status itself, so undo
  // just puts it back.
  function declineOffer(offer) {
    const prevStatus = offer.status || 'new';
    handleOfferRespond(offer.id, 'declined');
    setUndoItem({ id: offer.id, prevStatus, name: offer.event_name || offer.venue_name });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoItem(null), 5000);
  }

  function undoDecline() {
    if (!undoItem) return;
    handleOfferRespond(undoItem.id, undoItem.prevStatus);
    clearTimeout(undoTimer.current);
    setUndoItem(null);
  }

  /* The search belongs to HISTORY alone — an upcoming list of one or two does
     not need finding, and a played list of a hundred does. */
  const historyList = filterPastEvents(pastGigs, pastGigSearch);

  const newAppsCount  = applications.filter(a => (a.status || 'pending') === 'pending').length;
  // Prefer the loaded rows once they belong to THIS profile; until then the
  // profile-scoped count. Comparing against `profile.id` rather than testing
  // the ref for truthiness matters mid-switch: the ref already names the new
  // profile while `offers` is still empty, which would read as "0 new offers"
  // instead of falling back to the count.
  const pendingOffers = offersLoaded.current && offersLoaded.current === profile?.id && !loadingOffers
    ? offers.filter(o => (o.status || '').toLowerCase() === 'new').length
    : offersCount;
  const attentionItems = [
    newAppsCount  > 0 && `${newAppsCount} new application${newAppsCount  !== 1 ? 's' : ''}`,
    pendingOffers > 0 && `${pendingOffers} new offer${pendingOffers !== 1 ? 's' : ''}`,
  ].filter(Boolean);

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.35, behavior: 'smooth' });
  }

  /* ⭐ Arriving from a notification: `?section=enquiries&tab=BOOKED` lands on
     the section the notice is ABOUT, not merely on this screen. Same two
     actions the stat tiles already perform, so a link and a tap agree. */
  useDashboardLanding(({ elementId, tab }) => {
    if (tab) setEnqDirTab(tab);
    scrollToSection(elementId);
  });

  return (
    <div className={s.screen}>

      <DashboardHeader
        line1={cfg.headingLine1}
        line2={cfg.headingLine2}
        userId={userId}
        profileId={profile?.id}
        profileType={cfg.profileType}
        gradient={cfg.gradient}
      />

      <DashboardProfileCard
        profile={profile}
        profileType={cfg.profileType}
        accent={cfg.accent || '#00E5FF'}
        gradient={cfg.gradient}
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={cfg.accent || 'rgba(0,229,255,.7)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>}
        setupRoute={cfg.setupPath}
        subtitle={profile?.sound || (profile ? profile.location : 'Promoters will see this — takes 2 mins')}
        genres={genres}
        completionPct={hasProfile ? completionPct : undefined}
        nextStep={hasProfile ? nextStep : null}
      />

      <NotificationBar
        message={attentionItems.length > 0 ? attentionItems.join(' · ') : null}
        onClick={() => scrollToSection('section-enquiries')}
      />

      <DashboardStats stats={[
        /* ⚠ Counts the OUTGOING list, not applications alone — this tile opens
           that tab, and a tile reading "0" above a tab showing an enquiry is
           the kind of quiet disagreement nobody reports and everybody
           distrusts. Relabelled for the same reason: an availability enquiry
           is not an application. */
        { label: 'OUTGOING', value: loading ? '—' : outgoingItems.length,                  accent: '#00E5FF', accentRgb: '0,229,255', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('OUTGOING'); } },
        { label: 'OFFERS',       value: loading ? '—' : offersCount,                      accent: '#BF5FFF', accentRgb: '191,95,255', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('INCOMING'); } },
        /* ⚠ UPCOMING ONLY, matching the tab it opens (owner, 2026-08-31). It
           read upcoming+past and landed on BOOKED, which since HISTORY split
           off shows only what is ahead — 13 above a list of 1. A stat tile
           says WHAT IS COMING UP; the twelve already played are a tab away
           and are not a thing to act on. ⛔ Never a total above a tab that
           renders a subset: that quiet disagreement is what makes a whole
           dashboard feel untrustworthy. */
        { label: 'BOOKINGS',     value: loading ? '—' : upcomingGigs.length,               accent: '#00E5A0', accentRgb: '0,229,160', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('BOOKED'); } },
      ]} />

      {/* ── AVAILABILITY ── */}
      <AvailabilitySection userId={userId} profileId={profile?.id} table="artist_availability" accent={cfg.accent || '#00E5FF'} accentRgb={cfg.accentRgb || '0,229,255'} />

      {/* ── ENQUIRIES ── */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff', margin: 0 }}>ENQUIRIES</p>
          {/* ⚠ THE CALENDAR CHIP, PRESENT ON FIVE SURFACES INSTEAD OF TWO.
              The venue and host have had this since the enquiry calendar was
              built; the performer dashboards never got it, which is why the
              icon appeared beside AVAILABLE DATES on this screen and not
              beside ENQUIRIES. An act arguably needs it MORE than a venue —
              the question they are answering is "am I free that night". */}
          <CalendarIconBtn onClick={() => setCalendarOpen(true)} label="Open the enquiry calendar" />
        </div>
        {/* ⭐ THE SHARED CHROME — identical component, identical colours and
            identical sub-headings to the venue and host surfaces. This block
            used to be a hand-rolled copy that coloured its LABEL where the
            shared one colours its BORDER, which is the mismatch the owner
            could see across five dashboards. */}
        <EnquiryDirectionTabs
          dirTab={enqDirTab}
          onChange={(key) => {
            setEnqDirTab(key);
            if (key === 'INCOMING') setInStatusTab('NEW');
            if (key === 'OUTGOING') setOutStatusTab('AWAITING');
          }}
          counts={dirCounts}
        />

        <div>
        {/* INCOMING — venue offers/invites */}
        {enqDirTab === 'INCOMING' && (
          <div>
            <EnquiryStatusTabs
              subTabs={DIR_TABS.find(d => d.key === 'INCOMING')?.subTabs}
              statusTab={inStatusTab}
              onChange={setInStatusTab}
              dirColor="#FFD700"
              counts={inCounts}
            />
            <EnquirySearch value={enqSearch} onChange={setEnqSearch} placeholder="Search by venue, event, date…" />
            {loadingOffers
              ? <p className={s.empty}>Loading…</p>
              : filteredOffers.length === 0
                ? <p className={s.empty}>{enqSearch.trim() ? 'Nothing matches your search.' : IN_EMPTY[inStatusTab]}</p>
                : filteredOffers.map(offer => (
                    <OpportunityCard
                      key={offer.id}
                      offer={offer}
                      availability={availabilityFor(offer)}
                      onOpen={openOfferSheet}
                      onConsider={considerOffer}
                      onDecline={declineOffer}
                    />
                  ))
            }
          </div>
        )}

        {/* OUTGOING — applications the artist submitted */}
        {enqDirTab === 'OUTGOING' && (
          <div>
            <EnquiryStatusTabs
              subTabs={DIR_TABS.find(d => d.key === 'OUTGOING')?.subTabs}
              statusTab={outStatusTab}
              onChange={setOutStatusTab}
              dirColor="#00B4D8"
              counts={outCounts}
            />
            <EnquirySearch value={enqSearch} onChange={setEnqSearch} placeholder="Search events…" />

            {/* ⭐ CLEAR ALL — only in DECLINED, and only when there is
                something to clear. An always-present sweep on a list you might
                still be reading is an accident waiting to be tapped.

                ⚠ ENQUIRIES ONLY. Applications keep their own per-row DELETE,
                which really deletes and which the applicant genuinely owns. A
                sweep that quietly destroyed applications while merely hiding
                enquiries would be one button doing two different things. The
                count says so out loud rather than leaving it to be discovered.

                ⚠ SAYS WHAT SURVIVES. "Hidden from your list" is the honest
                description — the venue's record is untouched, and a button
                that reads as deletion would be claiming otherwise. */}
            {outStatusTab === 'DECLINED' && clearableDeclined.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
                  Declines older than {DECLINE_FADE_DAYS} days clear themselves.
                </span>
                <button type="button" onClick={() => handleClearEnquiries(clearableDeclined.map(it => it.row.id))}
                  style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
                  CLEAR ALL ({clearableDeclined.length})
                </button>
              </div>
            )}
            {loading
              ? <p className={s.empty}>Loading…</p>
              : filteredOut.length === 0
                ? <p className={s.empty}>{OUT_EMPTY[outStatusTab] || 'Nothing here yet.'}</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filteredOut.map(({ kind, row, bucket }) => {
                      /**
                       * ⭐⭐ THE BADGE IS THE TAB IT SITS IN (owner, 2026-09-01).
                       *
                       * ⛔⛔ IT USED TO BE `applicantLabel(row.status)`, AND ALL
                       * FOUR WORDS DISAGREED WITH THE TAB ABOVE THEM:
                       *
                       *   tab        badge said
                       *   AWAITING   SUBMITTED
                       *   INTERESTED BEING CONSIDERED
                       *   ACCEPTED   BOOKED
                       *   DECLINED   NOT SELECTED
                       *
                       * ⚠⚠ THE THIRD ROW IS WHY THIS IS A DEFECT AND NOT A
                       * STYLE. "BOOKED" ALREADY MEANS SOMETHING ELSE ON THIS
                       * SCREEN: the top-level BOOKED tab counts real gigs off
                       * the LINEUP (`dirCounts.BOOKED = upcomingGigs.length`).
                       * So an accepted enquiry — which holds no slot and
                       * creates no `lineup_member` — wore a BOOKED sticker
                       * while being correctly absent from the BOOKED tab. The
                       * screen asserted a booking and denied it at once.
                       *
                       * ⭐ `bucket` is `normaliseStatus`, already computed for
                       * the tab and the count, so the badge cannot drift from
                       * the tab again: it IS the tab.
                       *
                       * ⛔ `applicantLabel` is now used by nothing at runtime.
                       * Left exported — it is still the honest answer to "where
                       * does the ASKER stand", and a future asker-facing
                       * surface may want it. ⛔ Do not re-point a badge at it.
                       */
                      const badge = bucket.toUpperCase();
                      const badgeColor = STATUS_TAB_COLOR[badge] || '#FFD700';
                      if (kind === 'enquiry') {
                        return <OutgoingEnquiryRow key={`enq-${row.id}`} enq={row}
                          badge={badge} badgeColor={badgeColor} accent={cfg.accent}
                          onCancel={handleCancelEnquiry}
                          onClear={handleClearEnquiries} />;
                      }
                      /* ⚠ An application whose event did not load renders
                         nothing, as before — an EventCard with no event is the
                         broken-vs-sparse case. Left as-is deliberately: it is a
                         separate defect (see D2 in the Ask Category note) and
                         changing it here would hide it. */
                      return row.event
                        ? <ApplicationRow key={`app-${row.id}`} app={row}
                            badge={badge} badgeColor={badgeColor}
                            onDelete={handleDeleteApplication} />
                        : null;
                    })}
                  </div>
            }
          </div>
        )}

        {/* BOOKED — what the act is playing NEXT. ⛔ No sub-tabs: everything
            already played lives in HISTORY, one tab across, not one level
            down. */}
        {enqDirTab === 'BOOKED' && (
          <div>
            {loading
              ? <p className={s.empty}>Loading…</p>
              : upcomingGigs.length === 0
                ? <p className={s.empty}>No upcoming bookings.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {upcomingGigs.map(ev =>
                      <EventCard key={ev.id} event={ev} badge="PLAYING" badgeColor="#00e676" />
                    )}
                  </div>
            }
          </div>
        )}

        {/* HISTORY — everything already played. Same rows, same card, same
            derivation as BOOKED; only the side of today they fall on differs. */}
        {enqDirTab === 'HISTORY' && (
          <div>
            {!loading && pastGigs.length > 0 && (
              <PastEventsSearch query={pastGigSearch} onChange={setPastGigSearch} />
            )}
            {loading
              ? <p className={s.empty}>Loading…</p>
              : historyList.length === 0
                ? <p className={s.empty}>{pastGigSearch.trim() ? 'No past bookings match your search.' : 'Nothing played yet.'}</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {historyList.map(ev =>
                      <EventCard key={ev.id} event={ev} badge="PLAYED" badgeColor="var(--muted)" />
                    )}
                  </div>
            }
          </div>
        )}
        </div>

        {/* ⚠ THE ACT'S OWN DIARY. Same component the venue and host open from
            the same chip, fed this surface's rows: offers coming in and asks
            going out, both carrying `date_requested`. `artist_availability` is
            this profile's table (the venue's is `venue_availability`). */}
        {calendarOpen && (
          <EnquiryCalendar
            profileId={profile?.id}
            table="artist_availability"
            enquiries={[...offers, ...outgoingItems.map(it => it.row)]}
            accent={cfg.accent}
            accentRgb={cfg.accentRgb}
            onClose={() => setCalendarOpen(false)}
          />
        )}
      </div>

      {/* ── FOLLOWING — always at bottom ── */}
      <FollowingSection
        following={following}
        loading={loadingFollow}
        followView={followView}
        setFollowView={setFollowView}
        followFilter={followFilter}
        setFollowFilter={setFollowFilter}
        followShowAll={followShowAll}
        setFollowShowAll={setFollowShowAll}
        followSearch={followSearch}
        setFollowSearch={setFollowSearch}
        followDrag={followDrag}
        emptyMsg="Follow venues and artists from their profiles to see them here."
        filterTypes={FOLLOW_FILTER_CONFIGS[cfg.profileType] || FOLLOW_FILTER_CONFIGS.artist}
      />

      {/* Browse CTA — always last */}
      <button
        onClick={() => navigate('/discover')}
        style={{
          display: 'block', width: '100%', marginTop: 24,
          background: 'linear-gradient(#0f0f1a, #0f0f1a) padding-box, linear-gradient(90deg, #BF5FFF, #ffb830) border-box',
          color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2,
          padding: '14px', borderRadius: 20, border: '1.5px solid transparent', cursor: 'pointer',
          transition: 'background .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #00E5A0, #00B4D8)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(#0f0f1a, #0f0f1a) padding-box, linear-gradient(90deg, #BF5FFF, #ffb830) border-box'; }}
      >{cfg.browseLabel}</button>

      {/* Level 2 — the full Booking Invitation (same clash-check as the card) */}
      {openOffer && (
        <BookingInvitation
          offer={openOffer}
          artistName={profile?.name}
          /* The PROFILE that was invited, not the account — this dashboard is
             already profile-scoped, so it is the one identity that may reply. */
          viewerProfileId={profile?.id}
          availability={availabilityFor(openOffer)}
          onRespond={handleOfferRespond}
          onClose={() => setOpenOffer(null)}
        />
      )}

      {/* Undo, not confirm — the decline already happened; this just offers the
          way back. Cheap on the common case, fully recoverable on the misfire. */}
      {undoItem && (
        <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(var(--yp-safe-bottom, 0px) + 78px)', zIndex: 9500, display: 'flex', alignItems: 'center', gap: 14, background: '#1c1c26', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 28px rgba(0,0,0,.5)', maxWidth: 'calc(100vw - 32px)' }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Declined{undoItem.name ? ` ${undoItem.name}` : ''}
          </span>
          <button onClick={undoDecline}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, background: 'none', border: 'none', color: '#00E5FF', cursor: 'pointer', flexShrink: 0, padding: 0 }}
          >UNDO</button>
        </div>
      )}
    </div>
  );
}


