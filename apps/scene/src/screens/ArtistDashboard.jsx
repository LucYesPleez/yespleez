import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { writeNotification, inferToProfileId } from '../lib/writeNotification';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import { STATUS_TAB_COLOR, withDirection } from '../lib/enquiryUtils';
import s from './ArtistDashboard.module.css';
import EventCard from '../components/EventCard';
import { useDragScroll } from '../hooks/useDragScroll';
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
import { APP_TABS, APP_TAB_COLOR, applicantLabel, OUT_EMPTY, fetchOutgoingEnquiries } from '../lib/outgoingPipeline';
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
const IN_STATUS_MAP  = {
  NEW:         ['new', 'pending', 'seen', 'viewed'],
  CONSIDERING: ['shortlisted', 'interested', 'tentative'],
  ACCEPTED:    ['accepted', 'booked', 'confirmed'],
  HISTORY:     ['declined', 'rejected', 'cancelled', 'completed', 'expired'],
};
const IN_TABS = ['NEW', 'CONSIDERING', 'ACCEPTED', 'HISTORY'];
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
const GIG_TABS  = ['UPCOMING', 'PAST'];

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
  const [outStatusTab,  setOutStatusTab]  = useState('SUBMITTED');
  const [gigTab,        setGigTab]        = useState('UPCOMING');
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
            supabase.from('lineup_members').select('event_id').eq('artist_profile_id', profileId).neq('status', 'removed'),
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
      const seen = {};
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      (fUidRes.data || []).forEach(p => { if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p; });
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

  const filteredOut = outgoingItems.filter(it => {
    if (applicantLabel(it.row.status) !== outStatusTab) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(it.row).toLowerCase().includes(enqSearch.toLowerCase());
  });
  const filteredOffers = offers.filter(o => {
    const st = (o.status || 'new').toLowerCase();
    if (!(IN_STATUS_MAP[inStatusTab] || ['new']).includes(st)) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(o).toLowerCase().includes(enqSearch.toLowerCase());
  });

  // The clash-check — one source of truth for both the Opportunity Card and the
  // Booking Invitation, so they can never disagree. v1 only checks against the
  // artist's own confirmed gigs; conflicts between two un-accepted offers come
  // with the pipeline.
  function availabilityFor(offer) {
    const d = offer.proposed_date || offer.date_requested;
    if (!d) return { status: 'unknown' };
    const clash = [...upcomingGigs, ...pastGigs].find(g => g.config?.date === d);
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

  const gigList = gigTab === 'UPCOMING' ? upcomingGigs : filterPastEvents(pastGigs, pastGigSearch);

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
        { label: 'BOOKINGS',     value: loading ? '—' : upcomingGigs.length + pastGigs.length, accent: '#00E5A0', accentRgb: '0,229,160', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('BOOKED'); } },
      ]} />

      {/* ── AVAILABILITY ── */}
      <AvailabilitySection userId={userId} profileId={profile?.id} table="artist_availability" accent={cfg.accent || '#00E5FF'} accentRgb={cfg.accentRgb || '0,229,255'} />

      {/* ── ENQUIRIES ── */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff' }}>ENQUIRIES</p>
        </div>
        {/* Direction tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[
            { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',   cnt: offersCount },
            { key: 'OUTGOING', color: 'var(--neon2)', rgb: '0,229,255', cnt: outgoingItems.length },
            { key: 'BOOKED',   color: '#00E5A0', rgb: '0,229,160',   cnt: upcomingGigs.length + pastGigs.length },
          ].map(({ key, color, rgb, cnt }) => {
            const active = enqDirTab === key;
            return (
              <button key={key} onClick={() => setEnqDirTab(key)}
                style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, padding: '5px 14px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s', background: active ? `rgba(${rgb},.12)` : 'transparent', border: `1.5px solid ${active ? color : 'rgba(255,255,255,.12)'}`, color: active ? color : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                {key}
                {cnt > 0 && <span style={{ fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700, background: active ? `rgba(${rgb},.22)` : 'rgba(255,255,255,.06)', color: active ? color : 'var(--muted)', borderRadius: 8, padding: '1px 5px' }}>{cnt}</span>}
              </button>
            );
          })}
        </div>

        <div>
        {/* INCOMING — venue offers/invites */}
        {enqDirTab === 'INCOMING' && (
          <div>
            <div className={s.subTabBar}>
              {IN_TABS.map(t => {
                const statuses = IN_STATUS_MAP[t] || [];
                const count = offers.filter(o => statuses.includes((o.status || 'new').toLowerCase())).length;
                const active = inStatusTab === t && offers.length > 0;
                return (
                  <button key={t} className={s.subTab}
                    style={active ? { color: '#fff', borderBottomColor: STATUS_TAB_COLOR[t] } : {}}
                    onClick={() => setInStatusTab(t)}>
                    {t}
                    {count > 0 && <span className={s.subTabCount} style={active ? { color: STATUS_TAB_COLOR[t] } : {}}>{count}</span>}
                  </button>
                );
              })}
            </div>
            <input className={s.searchBar} placeholder="Search by venue, event, date…" value={enqSearch} onChange={e => setEnqSearch(e.target.value)} style={{ '--focus-col': 'rgba(191,95,255,.4)' }} />
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
            <div className={s.subTabBar}>
              {APP_TABS.map(t => {
                const count  = outgoingItems.filter(it => applicantLabel(it.row.status) === t).length;
                const active = outStatusTab === t;
                const col    = APP_TAB_COLOR[t] || '#FFD700';
                return (
                  <button key={t} className={s.subTab}
                    style={active ? { color: '#fff', borderBottomColor: col } : {}}
                    onClick={() => setOutStatusTab(t)}>
                    {t}
                    {count > 0 && <span className={s.subTabCount} style={active ? { color: col } : {}}>{count}</span>}
                  </button>
                );
              })}
            </div>
            <input className={s.searchBar} placeholder="Search events…" value={enqSearch} onChange={e => setEnqSearch(e.target.value)} />
            {loading
              ? <p className={s.empty}>Loading…</p>
              : filteredOut.length === 0
                ? <p className={s.empty}>{OUT_EMPTY[outStatusTab] || 'Nothing here yet.'}</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filteredOut.map(({ kind, row }) => {
                      const badge = applicantLabel(row.status);
                      const badgeColor = APP_TAB_COLOR[badge] || '#FFD700';
                      if (kind === 'enquiry') {
                        return <OutgoingEnquiryRow key={`enq-${row.id}`} enq={row}
                          badge={badge} badgeColor={badgeColor} accent={cfg.accent} />;
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

        {/* BOOKED — confirmed gigs */}
        {enqDirTab === 'BOOKED' && (
          <div>
            <div className={s.subTabBar}>
              {GIG_TABS.map(t => {
                const count  = t === 'UPCOMING' ? upcomingGigs.length : pastGigs.length;
                const active = gigTab === t;
                return (
                  <button key={t} className={s.subTab}
                    style={active ? { color: '#00E5A0', borderBottomColor: '#00E5A0' } : {}}
                    onClick={() => setGigTab(t)}>
                    {t}
                    <span className={s.subTabCount} style={active ? { background: 'rgba(0,229,160,.15)', color: '#00E5A0' } : {}}>{count}</span>
                  </button>
                );
              })}
            </div>
            {gigTab === 'PAST' && !loading && pastGigs.length > 0 && (
              <PastEventsSearch query={pastGigSearch} onChange={setPastGigSearch} />
            )}
            {loading
              ? <p className={s.empty}>Loading…</p>
              : gigList.length === 0
                ? <p className={s.empty}>{gigTab === 'PAST' && pastGigSearch.trim() ? 'No past bookings match your search.' : `No ${gigTab.toLowerCase()} bookings.`}</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {gigList.map(ev =>
                      <EventCard key={ev.id} event={ev}
                        badge={gigTab === 'UPCOMING' ? 'PLAYING' : 'PLAYED'}
                        badgeColor={gigTab === 'UPCOMING' ? '#00e676' : 'var(--muted)'} />
                    )}
                  </div>
            }
          </div>
        )}
        </div>
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


