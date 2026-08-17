import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { writeNotification } from '../lib/writeNotification';
import { useSession } from '../App';
import s from './HostDashboard.module.css';
/* ⚠ `ProfileCard` IS NO LONGER USED ON THIS SCREEN — the lineup and
   application cards were its only callers here, and both are WorkItemCard now.
   `PROFILE_CARD_META_COLUMNS` stays: `memberCols` still fetches those columns,
   and the enquiry cards above still render readiness from them. */
import { PROFILE_CARD_META_COLUMNS } from '../components/ProfileCard';
import WorkItemCard, { applicationWorkState, lineupWorkState } from '../components/WorkItemCard';
import { DecisionBtn, StarIcon, XIcon, CheckIcon } from '../components/DecisionButtons';
import { HOST_CATEGORIES } from '../lib/profileTaxonomy';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { completionFor, firstUnsettled } from '@yespleez/requirements';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import EnquiryPanel from '../components/EnquiryPanel';
import { ENQUIRY_CARD_COLUMNS } from '../components/EnquiryCard';
import { fetchApplicantProfiles } from '../lib/applicantProfiles';
import { memberProfileKeys, indexMemberProfiles } from './event/lineupProfiles';
/* ⚠ `durationLabel` went with the hand-rolled SET TIMES row — `SlotCard` does
   its own duration formatting through `fmtDur`. ⛔ Two formatters for one value
   is how the old row came to print "1.5 hrsm". */
import { groupSlotsIntoDays, indexPerformances } from '../lib/eventSlots';
/* ⭐ THE ONE definition of a dressed claim — shared with `useEventData`. */
import { enrichClaims } from '../lib/claimEnrichment';
/* ⛔ `DaySlots`, ⛔ NOT `SlotCard` directly — it owns the DndContext, so the
   drag dots the padlock reveals actually drag. */
import DaySlots from './event/DaySlots';
import { buildHostLineup, STATE_COLOURS, bookedMembers } from '../lib/hostLineup';
import { shortlistEntriesFromGroups } from '../lib/shortlist';
import { setTimesEnabled, withSetTimesEnabled } from '../lib/eventSetTimes';
/* ⚠ `findExistingMember` ONLY. The dashboard still needs to READ whether an
   applicant is on the bill — that is what ACCEPTED · ON THE BILL says — but it
   no longer WRITES membership, so `planAddToBill`/`addToBill` went with the
   action. Reading the bill is triage; changing it is the workspace. */
import { findExistingMember } from '../lib/lineupFromApplication';
/* ⭐⭐ THE SAME EXECUTOR THE EVENT PAGE USES. ⛔ Not a copy of its rules — this
   screen may not decide what a removal destroys or who hears about it. */
import { planUnassign, planMoveToShortlist, planRemoveFromEvent, executeLineupPlan, assignMemberToSlot } from '../lib/lineupActions';
import FillSlotModal from '../components/FillSlotModal';
import AssignSlotSheet from '../components/AssignSlotSheet';
import DashboardHeader from '../components/DashboardHeader';
import MyVenueSubmissions from '../components/MyVenueSubmissions';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import AvailabilitySection from '../components/AvailabilitySection';
import EnquiryCalendar from '../components/EnquiryCalendar';
import { CalendarIconBtn } from '../components/DecisionButtons';
import { fetchOutgoingEnquiries } from '../lib/outgoingPipeline';
import { withDirection, normaliseStatus, rawStatusesFor, PIPELINE_BUCKETS, STATUS_TAB_COLOR } from '../lib/enquiryUtils';
import { bucketEvents, eventBucket, defaultBucket, effectiveDate, BUCKETS, UPCOMING, DRAFT, ARCHIVE } from '../lib/eventBuckets';
import EventsSection from '../components/EventsSection';
import EventTabBar from '../components/EventTabBar';
import SectionCollapseButton from '../components/SectionCollapseButton';
import { useDragScroll } from '../hooks/useDragScroll';
import { ownedByFilter } from '../lib/eventOwnership';

/* ⚠ `ownedByFilter` MOVED to lib/eventOwnership (2026-08-16) — the Discover
   shortlist sheet asks the same question and a second copy would drift. */

export default function HostDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const userId = userIdProp || session?.user?.id;
  const navigate = useNavigate();

  const [showAllLineup,  setShowAllLineup]  = useState(true);
  // Open by default, exactly as LINEUP is — the control is there to get a long
  // list out of the way, never to hide the section until someone finds it.
  const [showEnquiries,  setShowEnquiries]  = useState(true);
  // The availability calendar, opened from the ENQUIRIES heading. Closed by
  // default and mounted only while open, so it holds no page space and re-reads
  // availability every time it is opened.
  const [calendarOpen,   setCalendarOpen]   = useState(false);
  const [lineupFocusId,  setLineupFocusId]  = useState(null);  // null = show all
  /* null = follow `defaultBucket`, which lands on the first bucket that has
     anything in it. ⚠ A fixed default would open this host on an EMPTY tab:
     they have 0 upcoming, 4 drafts and 11 archived. */
  const [lineupBucketPick, setLineupBucketPick] = useState(null);
  /* ⚠ A refused ADD TO BILL must be visible. Without this the dashboard fails
     silently, which is indistinguishable from a dead button. */
  const [lineupError,    setLineupError]    = useState('');
  const [lineupExpandMap, setLineupExpandMap] = useState({});  // eventId → bool (default true)
  const [lineupSubTabs,  setLineupSubTabs]  = useState({});   // eventId → 'LINEUP'|'SET TIMES'|'SHORTLIST'|'PIPELINE'|'NOT BOOKED'
  /**
   * ⭐⭐ eventId → is SET TIMES unlocked for editing HERE (owner, 2026-08-16).
   *
   * ⛔ LOCKED IS THE DEFAULT, and that is the whole point. The dashboard is
   * triage; editing a running order from a summary screen is a deliberate act,
   * so the padlock makes the host ASK for it rather than arrive in it.
   *
   * ⚠ PER EVENT, ⛔ not global: unlocking one event's schedule must not quietly
   * arm the controls on every other event in the list.
   *
   * ⚠ NOT PERSISTED — it resets on reload, like the event page's own
   * `viewAsPunter`. A latch that survives a refresh is a mode, ⛔ and a mode
   * that outlives the session it was opened for is how someone edits the wrong
   * event a week later.
   */
  const [setTimesUnlocked, setSetTimesUnlocked] = useState({});
  /**
   * ⭐ BUMPED TO RE-RUN `loadLineups`. The lineup data is NOT react-query — it
   * is an effect writing `setLineups`/`setClaimsMap` — so there is no key to
   * invalidate when a drag on this screen changes a performance.
   *
   * ⛔ Without it a reorder writes to the database and this screen keeps
   * rendering its stale copy, which is indistinguishable from a failed write.
   * That is exactly what the owner saw.
   */
  const [lineupReload, setLineupReload] = useState(0);
  /* ⚠ Shortlisted MEMBERS, keyed by event — the second half of the SHORTLIST
     tab. ⛔ Kept out of `lineups`, which is the bill. */
  const [shortlistMembersByEvent, setShortlistMembersByEvent] = useState({});
  const [shortlistProfiles, setShortlistProfiles] = useState({});
  const [allApps,        setAllApps]        = useState([]);
  const [appProfiles,    setAppProfiles]    = useState({});
  const [loadingApps,    setLoadingApps]    = useState(false);
  const [lineups,        setLineups]        = useState([]);
  const [loadingLineups, setLoadingLineups] = useState(false);
  const [claimsMap,      setClaimsMap]      = useState({});   // eventId → { slotId → claim }
  const [editingSlot,   setEditingSlot]    = useState(null); // { ev, dayIdx, slotIdx, slot }
  const [fillSlot,      setFillSlot]       = useState(null); // { ev, slot }
  const [confirmExit,   setConfirmExit]    = useState(null); // { ev, member, name }
  const [assigning,     setAssigning]      = useState(null); // { ev, member, name }
  const [following,      setFollowing]      = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [followView,    setFollowView]    = useState('portrait');
  const [followFilter,  setFollowFilter]  = useState('ALL');
  const [followShowAll, setFollowShowAll] = useState(false);
  const [followSearch,  setFollowSearch]  = useState('');
  const followDrag = useDragScroll('host-dashboard-following');
  const appsLoaded    = useRef(false);
  const lineupsLoaded = useRef(false);

  const { data, isLoading: loadingEvents } = useQuery({
    queryKey: ['hostDashboard', userId],
    queryFn: async () => {
      // Phase 16 §14 — a dashboard answers "which events am I responsible
      // for?", and responsibility follows OWNERSHIP (identity v1.3 O-R4), not
      // authorship. `host_id` is the auth account that created the row; a
      // Studio-imported event has no author and never will, so an owner could
      // own an event they could not see, edit, publish or retract here.
      //
      // The profile must be fetched BEFORE the events (no longer in parallel):
      // owner_profile_id is keyed on the profile, not the account, so its id is
      // an input to the event query. One extra round trip, deliberately.
      const profRes = await supabase.from('profiles').select('*')
        .eq('user_id', userId).eq('type', 'host').limit(1).maybeSingle();
      const hostProfileId = profRes.data?.id || null;

      const evtRes = await supabase.from('events')
        .select('id, name, status, config, applications_open, is_public, created_at')
        .or(ownedByFilter(userId, hostProfileId))
        .order('created_at', { ascending: false })
        .limit(50);
      const evtIds = (evtRes.data || []).map(e => e.id);
      let newAppsCount = 0, lineupSlotsCount = 0;
      if (evtIds.length) {
        /**
         * ⚠⚠ THE LINEUP COUNT IS THE BILL, ⛔ NOT ACCEPTED APPLICATIONS.
         *
         * This read `count(applications where status='accepted')`, which was 3
         * across the entire database while 152 acts were actually booked. The
         * header therefore under-reported the lineup by two orders of magnitude
         * — and agreed with the list below it only because that list was built
         * from the same wrong query.
         */
        /* ⚠ A SERVER COUNT CANNOT CALL THE NORMALISER, so the raw spellings are
           DERIVED from the same map the renderer uses (`rawStatusesFor`). This
           was `.eq('status','pending')` — zero rows in production, so the
           header's APPLICATIONS number was always 0 while real applications
           sat underneath it. */
        const [pendingRes, billRes] = await Promise.all([
          supabase.from('applications').select('id', { count: 'exact', head: true }).in('event_id', evtIds).in('status', rawStatusesFor('new')),
          supabase.from('lineup_members').select('id', { count: 'exact', head: true }).in('event_id', evtIds).eq('status', 'on_bill'),
        ]);
        newAppsCount      = pendingRes.count || 0;
        lineupSlotsCount  = billRes.count    || 0;
      }
      /**
       * ⭐ THE ENQUIRIES THIS PROMOTER SENT — and they had NOWHERE to appear.
       *
       * A host may enquire with a venue about a date (ProfileScreen's picker
       * offers every industry profile the account owns, host included), and the
       * row was written correctly, notified the venue, and could be answered
       * from VenueDashboard — but this screen never read `venue_enquiries`, so
       * the sender could see none of it: not the date, not the status, not the
       * reply. Exactly the defect fixed on the artist side on 2026-08-10, on
       * the one dashboard it was not fixed on.
       *
       * ⛔ Keyed on the HOST PROFILE. Keying on the account would list this
       * person's DJ act's enquiries here too — the cross-over the whole
       * profile-keying sweep exists to prevent.
       */
      const outgoingEnquiries = await fetchOutgoingEnquiries(supabase, hostProfileId);
      return {
        profile: profRes.data || null,
        events:  evtRes.data  || [],
        newAppsCount,
        lineupSlotsCount,
        outgoingEnquiries,
      };
    },
    enabled: !!userId,
  });

  const profile          = data?.profile          || null;
  const events           = data?.events           || [];
  const newAppsCount     = data?.newAppsCount     ?? null;
  const lineupSlotsCount = data?.lineupSlotsCount ?? null;
  const outgoingEnquiries = data?.outgoingEnquiries || [];

  // Load applications on mount.
  // §14: waits for the host PROFILE, not just the account — applications must
  // cover owned events too, or an owned event shows up with none.
  useEffect(() => {
    if (!userId || !profile?.id || appsLoaded.current) return;
    appsLoaded.current = true;
    setLoadingApps(true);
    async function loadApps() {
      const { data: evIds } = await supabase.from('events').select('id')
        .or(ownedByFilter(userId, profile.id));
      if (!evIds?.length) { setLoadingApps(false); return; }
      const ids = evIds.map(e => e.id);
      const { data: apps } = await supabase.from('applications')
        .select('*').in('event_id', ids).order('created_at', { ascending: false });
      setAllApps(apps || []);
      // These rows are handed straight to EnquiryCard as `enq.profile`, so the
      // card's own column list is the correct one to fetch. The former
      // 10-column subset made every readiness percentage here too low: an
      // unselected column reads as an unfilled one.
      //
      // M6 · keyed by applications.id, resolved by from_profile_id with the
      // legacy account fallback — see lib/applicantProfiles.js.
      setAppProfiles(await fetchApplicantProfiles(
        supabase, apps, ENQUIRY_CARD_COLUMNS.join(', ')));
      setLoadingApps(false);
    }
    loadApps();
  }, [userId, profile?.id]);   // §14: re-runs once the host profile resolves (loadApps)

  // Load lineups lazily — triggered by BOOKED tab or LINEUP section scroll.
  // §14: same ownership question as the event list and applications above.
  useEffect(() => {
    /**
     * ⛔⛔ THE LATCH MUST NOT BLOCK A DELIBERATE RELOAD (2026-08-16).
     *
     * ⚠⚠ `lineupsLoaded` is a LAZY-LOAD guard — "only fetch this section once,
     * when it is first needed". But it also swallowed `lineupReload`, which is
     * the drag's way of saying "refetch, something changed": the effect re-ran
     * and returned on this very line, so a set-times drag WROTE SUCCESSFULLY
     * and the screen kept painting its stale copy until a manual refresh.
     *
     * ⭐ A first-load guard and a refresh signal are two different things.
     * `lineupReload > 0` means somebody ASKED, so the latch does not apply.
     */
    if (!userId || !profile?.id) return;
    if (lineupsLoaded.current && lineupReload === 0) return;
    lineupsLoaded.current = true;
    /**
     * ⛔⛔ A REFRESH IS SILENT. ⛔ NEVER raise the loading state on a reload.
     *
     * ⚠⚠ `setLoadingLineups(true)` swaps the whole section for a skeleton, so
     * after every drag the list UNMOUNTED and came back — losing scroll
     * position and flashing the entire screen. The owner read that as "the
     * whole screen resets after each drag drop", and they were right: the data
     * was correct, the repaint was violent.
     *
     * ⭐ On a reload the CURRENT rows stay on screen until the new ones arrive.
     * The move is already on screen anyway — dnd-kit leaves the card where it
     * was dropped — so there is nothing to hide and nothing to wait for.
     */
    if (lineupReload === 0) setLoadingLineups(true);
    /**
     * ⭐⭐ THE LINEUP IS THE HOST'S EVENTS AND WHO IS ON THEM.
     *
     * ⛔ THERE IS NO APPLICATIONS QUERY HERE ANY MORE. This used to select
     * `applications where status='accepted'` and GROUP BY event, so an event
     * existed to this section only once somebody had applied and been accepted:
     * 149 of 152 real bill members were invisible, and `Bass Heavy` did not
     * appear at all. Applications still fill the SHORT LIST and PIPELINE tabs —
     * they are loaded elsewhere, and ⛔ they must never decide which events or
     * which acts appear. See lib/hostLineup for the ratified invariant.
     */
    async function loadLineups() {
      const { data: evRows } = await supabase.from('events')
        /* ⚠ `owner_profile_id` IS FOR THE NOTIFICATION, not for display. Removing
           somebody from a slot here writes `aboutProfileId` from it, exactly as
           the event page does — without it this screen would send the same
           notification with a null sender and the two surfaces would differ in
           the database while looking identical on screen. */
        .select('id, name, config, status, owner_profile_id').or(ownedByFilter(userId, profile.id))
        .order('created_at', { ascending: false });
      if (!evRows?.length) { setLoadingLineups(false); return; }
      const ids = evRows.map(e => e.id);

      const [{ data: membersData }, { data: perfsData }, { data: slotRows }] = await Promise.all([
        /* ⚠ BOTH STATUSES IN ONE READ, split immediately below — the same shape
           `useEventData` uses. ⛔ Nothing downstream may receive the mixed
           array: `buildHostLineup` is the BILL and a shortlisted member is
           somebody you are only considering. */
        supabase.from('lineup_members')
          .select('id, event_id, artist_id, artist_profile_id, artist_name, genre, sound, card_pills, status')
          .in('event_id', ids).in('status', ['on_bill', 'shortlisted']),
        // ⚠ `declined` is NO LONGER FILTERED OUT. It was, which meant a slot
        // somebody turned down looked identical to one nobody had been asked
        // about — the organiser could not tell "needs refilling because of a no"
        // from "never sent".
        supabase.from('performances')
          .select('id, lineup_member_id, slot_uuid, status, event_id').in('event_id', ids),
        supabase.from('event_slots')
          .select('id, event_id, day_index, day_name, position, legacy_key, time, ampm, dur_mins, label, label_color, pinned')
          .in('event_id', ids).order('day_index').order('position'),
      ]);

      /**
       * ⭐ THE SAME RESOLVER THE EVENT PAGE USES. `lineupProfiles` keys the map
       * by `lineup_members.id` and joins on `artist_profile_id` with the legacy
       * `artist_id` fallback — the dashboard's old query selected neither
       * `artist_profile_id` nor any profile at all, so every imported act
       * rendered as a bare name.
       */
      /* ⚠ `card_pills` and the completion columns feed the LINEUP cards' tags
         and READY chip. ⛔ Omitting them does not hide readiness — every
         unfetched column scores as an unmet gap, so a finished profile reports
         as half-built. The applications side is already safe: it fetches
         ENQUIRY_CARD_COLUMNS, which contains both. */
      const memberCols = ['id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, state',
        ...PROFILE_CARD_META_COLUMNS].join(', ');
      const { profileIds, userIds } = memberProfileKeys(membersData);
      const [mPid, mUid] = await Promise.all([
        profileIds.length ? supabase.from('profiles').select(memberCols).in('id', profileIds) : Promise.resolve({ data: [] }),
        userIds.length    ? supabase.from('profiles').select(memberCols).in('user_id', userIds) : Promise.resolve({ data: [] }),
      ]);
      const byPid = {}; (mPid.data || []).forEach(p => { byPid[p.id] = p; });
      const byUid = {}; (mUid.data || []).forEach(p => { byUid[p.user_id] = p; });
      const memberProfiles = indexMemberProfiles(membersData, byPid, byUid);

      const slotsByEvent = {};
      (slotRows || []).forEach(r => { (slotsByEvent[r.event_id] ||= []).push(r); });
      Object.keys(slotsByEvent).forEach(k => { slotsByEvent[k] = groupSlotsIntoDays(slotsByEvent[k]); });

      /* ⛔⛔ THE BILL IS `on_bill` ONLY. `buildHostLineup` builds the LINEUP, the
         counts and the set-times strip; a shortlisted member reaching it would
         appear as booked on the dashboard and in the header total. */
      const billMembers  = (membersData || []).filter(m => m.status === 'on_bill');
      const shortMembers = (membersData || []).filter(m => m.status === 'shortlisted');
      const shortByEvent = {};
      shortMembers.forEach(m => { (shortByEvent[m.event_id] ||= []).push(m); });
      setShortlistMembersByEvent(shortByEvent);
      /* ⚠ Profiles were resolved for BOTH statuses above, so the shortlist cards
         get names and pictures from the same pass. */
      setShortlistProfiles(memberProfiles);

      const groups = buildHostLineup({
        events: evRows, members: billMembers, performances: perfsData || [],
        slotsByEvent, memberProfiles,
      });
      setLineups(groups);

      // slotId → who is on it, for the SET TIMES strip. Deterministic now; the
      // old map took whichever row the planner returned last.
      const cm = {};
      groups.forEach(g => {
        const membersById = {};
        g.members.forEach(r => { membersById[r.member.id] = r; });
        const { primary } = indexPerformances(perfsData || [], Object.fromEntries(
          (membersData || []).filter(m => m.event_id === g.event.id).map(m => [m.id, m])));
        if (Object.keys(primary).length) cm[g.event.id] = primary;
      });

      /**
       * ⭐⭐ DRESSED BY THE SAME MODULE THE EVENT PAGE USES.
       *
       * ⚠⚠ This replaced a hand-rolled `claim.profile = memberProfiles[…]`,
       * which was me patching ONE symptom — missing avatars — while `mix_link`,
       * the socials and the mix rail stayed absent, so the play button never
       * rendered here and the same card behaved differently on two screens.
       *
       * ⛔ ONE CALL FOR EVERY EVENT, ⛔ not one per event: this screen loads the
       * whole list in a single pass, and `enrichClaims` is a plain function
       * rather than a hook precisely so it can be handed the lot.
       */
      await enrichClaims(supabase, Object.values(cm).flatMap(bySlot => Object.values(bySlot)));
      setClaimsMap(cm);

      /* ⛔ The old `setTimesMap` write is gone with the state it fed. Nothing
         has read that map since before this rewrite — the SET TIMES tab decides
         from `totalSlots`, which is derived and cannot fall out of step with
         the slots it describes. */
      setLoadingLineups(false);
    }
    loadLineups();
    /* ⚠ `lineupReload` re-runs this after a set-times drag on this screen —
       ⛔ there is no query key to invalidate; see the state's own note. */
  }, [userId, profile?.id, lineupReload]);   // §14: re-runs once the host profile resolves (loadLineups)

  // Load following on mount
  useEffect(() => {
    if (!userId) return;
    setLoadingFollowing(true);
    async function loadFollowing() {
      // M5.1 (D6): followed profiles resolve by target_profile_id; legacy
      // entity_id join only for rows without one.
      const { data: rows } = await supabase.from('follows')
        .select('entity_id, target_profile_id').eq('user_id', userId).neq('entity_type', 'event');
      const fPids = [...new Set((rows || []).filter(r => r.target_profile_id).map(r => r.target_profile_id))];
      const fLegacy = [...new Set((rows || []).filter(r => !r.target_profile_id).map(r => r.entity_id).filter(Boolean))];
      if (!fPids.length && !fLegacy.length) { setLoadingFollowing(false); return; }
      const fCols = 'id, user_id, name, avatar, type, sound, genre_string, location, bio';
      const [fPidRes, fUidRes] = await Promise.all([
        fPids.length ? supabase.from('profiles').select(fCols).in('id', fPids) : Promise.resolve({ data: [] }),
        fLegacy.length ? supabase.from('profiles').select(fCols).in('user_id', fLegacy) : Promise.resolve({ data: [] }),
      ]);
      // Dedupe (legacy rows only), preferring venue/artist over punter.
      // ⚠ ONE KEYSPACE OUT — PROFILE ID. See ArtistDashboard's loader: storing
      // `seen[p.id]` beside `seen[p.user_id]` let a profile reachable through
      // both follow keyspaces enter the list twice. Legacy rows still collapse
      // per USER first, and only the winner is merged in by profile id.
      const seen = {};
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      const legacyByUser = {};
      (fUidRes.data || []).forEach(p => {
        if (!legacyByUser[p.user_id] || p.type !== 'punter') legacyByUser[p.user_id] = p;
      });
      Object.values(legacyByUser).forEach(p => { seen[p.id] = p; });
      setFollowing(Object.values(seen));
      setLoadingFollowing(false);
    }
    loadFollowing();
  }, [userId]);

  /* ⛔ `addApplicantToBill` WAS DELETED HERE (owner, 2026-08-15) — the
     dashboard is triage and no longer performs bill operations. The rules it
     obeyed are untouched and still enforced where the action lives:
     lib/lineupFromApplication, called from EventHostView. */

  async function respondApp(appId, status, artistId, eventName) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    if (!artistId) return;
    const evLabel = eventName ? ` for ${eventName}` : '';
    /**
     * ⚠⚠ THE HOST'S DECISIONS WERE SILENT. This map was keyed on `tentative`
     * and `rejected`; `EnquiryCard` sends `shortlisted` and `declined`, so
     * `NOTIF[status]` was undefined and NO NOTIFICATION WAS SENT for either.
     * Only `accepted` ever matched. Applicants were being shortlisted and
     * declined without being told.
     *
     * ⭐ Keyed on the NORMALISED bucket, so both spellings reach the same
     * notice and a future rename cannot silence it again.
     *
     * ⛔ `seen` is deliberately absent. It is written automatically when a card
     * is expanded — notifying someone that their application was looked at is
     * not a decision and would be noise.
     */
    const NOTIF = {
      /**
       * ⚠⚠ NOT "You're booked!", AND NOT "you are on the lineup" EITHER.
       *
       * This button accepts the APPLICATION and nothing else — it creates no
       * `lineup_member` and no `performance`. "Booked" claims a slot that has
       * not been offered; "on the lineup" claims a membership that was not
       * created. Only ADD TO BILL may say that, because only it makes it true.
       */
      accepted:    { type: 'booking_confirmed',    message: `Your application was accepted${evLabel}.` },
      shortlisted: { type: 'shortlisted',          message: `You've been shortlisted${evLabel}.` },
      declined:    { type: 'application_declined', message: `Your application was unsuccessful${evLabel}.` },
    };
    const notif = NOTIF[normaliseStatus({ status, direction: 'incoming' })];
    // §A7: about = this host's profile (whose decision this is);
    // to = the artist's performer profile, U4-resolved, null if ambiguous.
    if (notif) await writeNotification({
      toUserId:       artistId,
      toProfileId:    (await resolvePerformerProfileId(artistId)).profileId ?? null,
      aboutProfileId: profile?.id ?? null,
      type:    notif.type,
      message: notif.message,
      data:    { event_name: eventName },
    });
  }


  /**
   * ⛔⛔ THIS WROTE THE WRONG STORE, AND THE SAVE LOOKED LIKE A NO-OP.
   *
   * ⚠⚠ It rebuilt `events.config.days[].slots[]` — the JSON BLOB — and wrote
   * that back. Since L2 the slots ARE ROWS and this screen reads
   * `event_slots` (`groupSlotsIntoDays(slotRows)`), so the write landed
   * somewhere nothing renders from: clearing a slot's label appeared to do
   * nothing, and re-opening the editor showed the old value again because the
   * row it came from never changed.
   *
   * ⭐ Same class as the `slot_uuid` defect — a reader migrated to the new
   * store and a writer left on the old one. ⛔ Do not restore the blob write.
   *
   * ⚠ IDENTICAL TO `EventHostView.saveSlot`, deliberately: one row, one
   * update, keyed by `slot.id`. The `dayIdx`/`slotIdx` pair it used to need is
   * gone with it — those were positions into the blob, and a reorder between
   * render and save pointed them at the wrong slot.
   *
   * ⚠ `dur_mins` is NOT NULL with a default, so a cleared duration must fall
   * back to 60 rather than write null and fail the constraint silently.
   */
  async function saveSlot(slotId, updated) {
    const { error } = await supabase.from('event_slots').update({
      time:        updated.time || null,
      ampm:        updated.ampm || null,
      dur_mins:    Number.isFinite(Number(updated.dur)) && Number(updated.dur) > 0 ? Number(updated.dur) : 60,
      /* ⭐ `|| null` IS WHAT CLEARS IT. An empty label must become NULL, or the
         green text the owner tried to delete stays exactly where it was. */
      label:       updated.label || null,
      label_color: updated.labelColor || null,
      updated_at:  new Date().toISOString(),
    }).eq('id', slotId);
    /* ⛔ SURFACED, NEVER SWALLOWED — this write reported success while doing
       nothing for long enough that the owner reported it as a bug. */
    if (error) { setLineupError(error.message); return; }
    setEditingSlot(null);
    setLineupReload(n => n + 1);
  }

  /**
   * ⭐ LOCK / UNLOCK A SLOT — the padlock in the set-times panel.
   *
   * ⚠ Identical to `EventHostView.togglePin`: one `event_slots` update. ⛔ It
   * is NOT shared code — the event page invalidates its own query key and this
   * screen bumps `lineupReload`, which is the whole difference between them.
   *
   * ⛔ SURFACED, NEVER SWALLOWED. RLS FILTERS an UPDATE rather than erroring
   * it, so a blocked write looks exactly like a button that did nothing.
   */
  async function toggleSlotPin(slot) {
    if (!slot?.id) return;
    const { error } = await supabase.from('event_slots')
      .update({ pinned: !slot.pinned, updated_at: new Date().toISOString() })
      .eq('id', slot.id);
    if (error) { setLineupError(error.message); return; }
    setLineupReload(n => n + 1);
  }

  /**
   * ⭐⭐ CLEAR SET TIME, ON THE DASHBOARD — the same act as on the event page,
   * because it is literally the same function.
   *
   * ⛔ THIS SCREEN OWNS NO RULES. It finds the claim, hands the executor the
   * plan and the RAW rows the claim now carries, and refreshes. Every decision
   * about what is destroyed and who is told lives in `lib/lineupActions`.
   *
   * ⚠ This could not exist before the claim carried `performance` and `member`:
   * the screen held a translated status and a name, which is enough to draw a
   * card and ⛔ not enough to act on one safely.
   *
   * ⚠ SCOPED TO THE ONE SLOT — `[claim.performance]`, ⛔ not every performance
   * the member holds. An act playing two slots keeps the other.
   */
  async function removeFromSlot(ev, slot) {
    const claim = claimsMap[ev.id]?.[slot.id];
    if (!claim?.performance || !claim.member) return;
    const perfs = [claim.performance];
    const { ok, error } = await executeLineupPlan(supabase, planUnassign(claim.member, perfs), {
      member: claim.member,
      perfs,
      event: ev,
      notify: writeNotification,
      resolveProfileId: resolvePerformerProfileId,
    });
    if (!ok) { setLineupError(error); return; }
    setLineupReload(n => n + 1);
  }

  /**
   * ⭐⭐ MOVE TO SHORTLIST, FROM THE SET TIMES TAB — the bill exit the owner
   * expected REMOVE to be. `removeFromSlot` clears the time and keeps them on
   * the bill; this takes them off it and back to active consideration.
   *
   * ⚠ ALL their performances, ⛔ not just this slot's. They are leaving the
   * bill, so a set time on another slot cannot outlive them. `removeFromSlot`
   * passes one performance for exactly the opposite reason.
   */
  async function demoteFromSlot(ev, slot) {
    const claim = claimsMap[ev.id]?.[slot.id];
    if (!claim?.member) return;
    const { data: perfs } = await supabase.from('performances')
      .select('id, status, slot_uuid').eq('lineup_member_id', claim.member.id);
    const rows = perfs || [];
    const { ok, error } = await executeLineupPlan(supabase, planMoveToShortlist(claim.member, rows), {
      member: claim.member,
      perfs: rows,
      event: ev,
      notify: writeNotification,
      resolveProfileId: resolvePerformerProfileId,
    });
    if (!ok) { setLineupError(error); return; }
    setLineupReload(n => n + 1);
  }

  /**
   * ⭐⭐ THE BILL EXITS, FROM A LINEUP CARD — the dashboard's twin of the event
   * page's dialog. ⚠ Both exits, because one without the other is the gap the
   * owner hit: an act could be demoted but never taken off, or the reverse.
   *
   * ⛔ NO RULES HERE. `planMoveToShortlist` and `planRemoveFromEvent` differ by
   * exactly one field and `executeLineupPlan` decides who is told — this
   * function picks which plan and refreshes.
   */
  async function exitMember(ev, member, mode) {
    const { data: perfs } = await supabase.from('performances')
      .select('id, status, slot_uuid').eq('lineup_member_id', member.id);
    const rows = perfs || [];
    const plan = mode === 'remove'
      ? planRemoveFromEvent(member, rows)
      : planMoveToShortlist(member, rows);
    const { ok, error } = await executeLineupPlan(supabase, plan, {
      member, perfs: rows, event: ev,
      notify: writeNotification,
      resolveProfileId: resolvePerformerProfileId,
    });
    setConfirmExit(null);
    if (!ok) { setLineupError(error); return; }
    setLineupReload(n => n + 1);
  }

  /**
   * ⭐⭐ DOES THIS EVENT HAVE A RUNNING ORDER? Flipped from the event card
   * header (owner, 2026-08-17).
   *
   * ⛔⛔ IT CANNOT LIVE IN EITHER TAB. Put it inside LINEUP and switching set
   * times ON removes that tab, taking the control with it — you could turn it
   * on and then have to hunt for how to turn it off. A control that destroys
   * itself on use is worse than one that is a click further away. The header
   * exists in BOTH states, which is the whole requirement.
   *
   * ⚠ ⛔ NOT the padlock beside SET TIMES. That governs whether the schedule can
   * be EDITED; this governs whether the event HAS one. Two lock-ish controls in
   * one tab row would be genuinely hard to tell apart.
   *
   * ⭐⭐ SAFE ONLY BECAUSE OF P2. Disabling used to DELETE every `event_slots`
   * row and cascade the bookings on them, so a one-tap toggle here would have
   * been a loaded gun. `saveEventSlots` now leaves the rows alone, so this is
   * reversible and the running order survives being switched off and on.
   *
   * ⛔ MERGE, ⛔ never replace: `config` also carries days, poster and venue.
   */
  async function toggleEventSetTimes(ev, next) {
    const { error } = await supabase.from('events')
      .update({ config: withSetTimesEnabled(ev.config, next) })
      .eq('id', ev.id);
    /* ⛔ SURFACED — RLS filters an UPDATE rather than erroring it, so a blocked
       write looks exactly like a toggle that did nothing. */
    if (error) { setLineupError(error.message); return; }
    setLineupReload(n => n + 1);
  }

  // Event map for app cards
  const evtMap = Object.fromEntries(events.map(e => [e.id, e]));

  // Pre-compute event lists
  /**
   * ⛔⛔ WAS `new Date().toISOString().split('T')[0]` — the UTC date, which in
   * AEST reads as YESTERDAY every morning until 10am. It sat on the line
   * deciding whether an event had happened, so an event on TODAY filed itself
   * as past before 10am. `lib/eventBuckets` owns this now, and takes the local
   * day from `lib/dates`.
   */
  const eventBuckets = bucketEvents(events);
  /* Soonest first for what is coming, most recent first for what is done —
     both read outward from today, which is where the reader is standing. */
  const byDateAsc  = (a, b) => effectiveDate(a).localeCompare(effectiveDate(b));
  const byDateDesc = (a, b) => effectiveDate(b).localeCompare(effectiveDate(a));
  const draftEvents    = [...eventBuckets[DRAFT]].sort(byDateAsc);
  const upcomingEvents = [...eventBuckets[UPCOMING]].sort(byDateAsc);
  const pastEvents     = [...eventBuckets[ARCHIVE]].sort(byDateDesc);
  // Pre-compute application lists
  /* ⚠⚠ Both of these matched ZERO production rows — see the note in
     EventHostView. Routed through the one normaliser that knows both
     vocabularies, so a differently-spelled application can no longer be
     invisible. `tentativeApps` keeps its name only because the JSX below reads
     it; the bucket it now holds is `shortlisted`. */
  /**
   * The LINEUP section, filed the same way the events list is.
   *
   * ⛔ `eventBucket` is the ONE rule — reusing it here is what stops the
   * selector and the events list disagreeing about which events are past.
   */
  const lineupsByBucket = { [UPCOMING]: [], [DRAFT]: [], [ARCHIVE]: [] };
  lineups.forEach(g => { lineupsByBucket[eventBucket(g.event)].push(g); });
  const activeLineupBucket = lineupBucketPick ?? defaultBucket(lineupsByBucket);
  const bucketLineups      = lineupsByBucket[activeLineupBucket] || [];

  const bucketOfApp   = a => normaliseStatus({ status: a.status, direction: 'incoming' });
  /* ⚠ `new` AND `seen` — opening an application auto-writes `seen`, so matching
     `new` alone meant LOOKING at one removed it from the queue. See
     PIPELINE_BUCKETS: reading is not deciding. */
  const newApps       = allApps.filter(a => PIPELINE_BUCKETS.includes(bucketOfApp(a)));
  const tentativeApps = allApps.filter(a => bucketOfApp(a) === 'shortlisted');
  const acceptedApps  = allApps.filter(a => bucketOfApp(a) === 'accepted');

  // Map applications to the common enquiry shape for EnquiryPanel
  const mappedEnquiries = allApps.map(app => ({
    id: app.id,
    direction: 'incoming',
    status: app.status,
    // M6 · the account id stays as the notification delivery identity; the
    // DISPLAY identity is the profile that applied, keyed by application.
    applicant_user_id: app.artist_id,
    applicant_type: appProfiles[app.id]?.type || 'artist',
    name: appProfiles[app.id]?.name || app.artist_name || '',
    event_name: evtMap[app.event_id]?.name || '',
    date_requested: evtMap[app.event_id]?.config?.date || null,
    /**
     * ⚠ THE EVENT'S LAST DAY, so the calendar can mark every day a booking
     * covers rather than only its first. An act on a three-day event is
     * committed on all three, and a diary that shows the middle day as free is
     * worse than one that shows nothing.
     *
     * Read straight off the event that is already in scope for `date_requested`
     * above — no new query, and no new column. Absent on a single-day event,
     * which `datesCovered` reads as a one-day range.
     */
    date_requested_end: evtMap[app.event_id]?.config?.endDate || null,
    created_at: app.created_at,
    note: app.note,
    venue_name: null,
    profile: appProfiles[app.id] || null,
    // P5 · the verdict recorded at submission. NULL for every application to an
    // event that declared no requirements, and for every row written before
    // P5 — EnquiryCard renders nothing in that case rather than "0/0".
    requirements_snapshot: app.requirements_snapshot || null,
  }));

  /**
   * ⭐ THE PROMOTER'S OWN ENQUIRIES, IN THE PANEL THAT ALREADY HAD A PLACE FOR
   * THEM.
   *
   * ⚠ THE FIRST ATTEMPT BUILT A SECOND SET OF DIRECTION TABS above this panel
   * — INCOMING/OUTGOING drawn twice, one above the other, because the existing
   * pair was three lines further down inside `EnquiryPanel` and went unread.
   * Everything needed already existed: `withDirection` derives the direction,
   * `normaliseStatus` has an OUTGOING map, the panel has an OUTGOING tab with
   * its own AWAITING/INTERESTED/ACCEPTED/DECLINED sub-tabs, and `EnquiryCard`
   * words its next-step copy per direction. ⛔ Look for the tab before building
   * one.
   *
   * ⭐ `profile` IS THE VENUE, and that is the whole trick. `EnquiryCard`
   * resolves the APPLICANT when no profile is supplied — correct for a venue,
   * who is never the applicant, and wrong for a promoter reading their own
   * enquiry, who would be shown themselves. Supplying it names the counterparty
   * explicitly and the card's own lookup stands down (it returns early when
   * `enq.profile` is set). No shared component learns who is asking.
   *
   * ⛔ `direction` is DERIVED, never stored — the same row is incoming to the
   * venue and outgoing to the promoter, so there is no correct column value.
   * This screen reads from the applicant's side.
   */
  const mappedOutgoing = withDirection(outgoingEnquiries, 'applicant').map(e => ({
    ...e,
    // ⛔ The venue may be absent — a profile that failed to load does not
    // delete the enquiry. The card renders what it has (R4: broken ≠ sparse).
    profile: e.venue || null,
    applicant_type: e.venue?.type || 'venue',
    name: e.venue?.name || '',
    venue_name: e.venue?.name || null,
  }));

  const panelEnquiries = [...mappedEnquiries, ...mappedOutgoing];

  /**
   * ⭐ CLEAR — the promoter tidying a finished row out of THEIR OWN list (S5).
   *
   * ⚠ ENQUIRIES ONLY. The incoming rows on this surface are APPLICATIONS,
   * mapped into the enquiry shape for display — a different table with its own
   * delete.  picks the column from the row and the viewer, so
   * this can only ever hide the promoter's own side.
   */
  async function handleClearEnquiry(enqOrList) {
    const list = (Array.isArray(enqOrList) ? enqOrList : [enqOrList]).filter(Boolean)
      /* ⛔ APPLICATIONS ARE NOT IN THIS TABLE. Half this surface's rows are
         applications mapped into the enquiry shape; without this guard a
         sweep would write `venue_enquiries` rows by an application's id and
         silently hit nothing — or worse, something. They keep their own
         delete. */
      .filter(e => e.venue_profile_id);
    if (!list.length) return;
    const now = new Date().toISOString();
    const byCol = {};
    for (const e of list) {
      const col = clearedColumnFor(e, profile?.id);
      (byCol[col] ||= []).push(e.id);
    }
    await Promise.all(Object.entries(byCol).map(([col, ids]) =>
      supabase.from('venue_enquiries').update({ [col]: now }).in('id', ids)));
    queryClient.invalidateQueries({ queryKey: ['hostDashboard', userId] });
  }

  async function handleEnquiryRespond(id, status) {
    // ⛔ ONLY the promoter's INCOMING applications are theirs to answer. An
    // enquiry they SENT is the venue's to decide; a status write from this side
    // would be the asker marking their own request accepted.
    const app = allApps.find(a => a.id === id);
    if (!app) return;
    await respondApp(id, status, app.artist_id, evtMap[app.event_id]?.name);
  }

  // Needs attention
  const attentionItems = [];
  if ((newAppsCount ?? 0) > 0)  attentionItems.push(`${newAppsCount} new application${newAppsCount !== 1 ? 's' : ''}`);
  if (draftEvents.length  > 0)  attentionItems.push(`${draftEvents.length} unpublished event${draftEvents.length !== 1 ? 's' : ''}`);

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.35, behavior: 'smooth' });
  }

  // Host has no card_pills/"5 tags" concept — its closest curated selection
  // is "what do you host?" (selected categories), not the full flat
  // genre/subgenre/vibe list also packed into genre_string.
  const genres = (() => {
    const parts = new Set((profile?.genre_string || '').split(' · ').map(t => t.trim()).filter(Boolean));
    return HOST_CATEGORIES.filter(c => parts.has(c.key)).map(c => c.label).join(' · ');
  })();
  const hasProfile = !!profile;
  // Shared requirements engine — see lib/requirements.js. Same eight fields as
  // the closure this replaces; `website` keeps accepting 'N/A' as an answer.
  const completion = completionFor(profile, 'host');
  const completionPct = completion?.pct ?? 0;
  // O4 · the next thing worth adding; registry order is priority order.
  const nextStep = firstUnsettled(completion?.items);

  return (
    <div className={s.screen}>
      <DashboardHeader line1="HOST /" line2="PROMOTER" userId={userId} profileId={profile?.id} profileType="host" gradient={PROFILE_TYPES.host.gradient} />

      <DashboardProfileCard
        profile={profile}
        profileType="host"
        accent={PROFILE_TYPES.host.accent}
        gradient={PROFILE_TYPES.host.gradient}
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,45,120,.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2"/><line x1="9" y1="5.5" x2="15" y2="5.5" strokeWidth="1.5" strokeLinecap="round"/></svg>}
        setupRoute="/industry/host/setup"
        subtitle={profile?.location || 'Add your details so artists can find you'}
        genres={genres}
        completionPct={hasProfile ? completionPct : undefined}
        nextStep={hasProfile ? nextStep : null}
      />

      <NotificationBar
        message={attentionItems.length > 0 ? attentionItems.join(' · ') : null}
        onClick={() => scrollToSection('section-enquiries')}
      />

      <DashboardStats accent={PROFILE_TYPES.host.accent} accentRgb={PROFILE_TYPES.host.rgb} stats={[
        { label: 'EVENTS',   value: loadingEvents ? '—' : events.length,                sectionId: 'section-events' },
        { label: 'INCOMING', value: newAppsCount === null ? '—' : newAppsCount,          sectionId: 'section-enquiries' },
        { label: 'LINEUP',   value: lineupSlotsCount === null ? '—' : lineupSlotsCount,  sectionId: 'section-lineup' },
      ]} />

      {/* ── EVENTS ── */}
      <EventsSection
        ownerType="host"
        tabs={{ UPCOMING: upcomingEvents, DRAFT: draftEvents, ARCHIVE: pastEvents }}
        loading={loadingEvents}
        accent="#FF2D78"
      />

      {/* ── AVAILABILITY ── */}
      {/* profileId is the HOST profile. Before this, a host and their own DJ or
          comedy profile wrote the same account-keyed rows, so marking yourself
          free as a promoter silently changed your performer availability. */}
      {/* ⭐⭐ THE SAME ENQUIRIES THE CALENDAR BELOW GETS. Available Dates used
          to show availability alone, so the owner could mark a date free
          without being told two acts had already applied for it — and the only
          way to find out was to remember to look in Enquiries first. Both
          entry points now render the same private state. */}
      <AvailabilitySection userId={userId} profileId={profile?.id} table="artist_availability" accent="#FF2D78" accentRgb="255,45,120" enquiries={panelEnquiries} />

      {/* ── MY VENUE SUBMISSIONS ──
          Renders itself away entirely when this organiser has never asked for
          a venue, which is most of them. See the component for why an empty
          panel would be worse than none. */}
      <MyVenueSubmissions />

      {/* ── ENQUIRIES ── */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff' }}>ENQUIRIES</span>
          {newAppsCount > 0 && <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{newAppsCount}</span>}
          {/* Opens the availability calendar with the private overlay. Quiet by
              design — it sits beside the heading, not in the control rows, so
              it never competes with INCOMING / OUTGOING / BOOKED.
              ⚠ SAME BUTTON as the one AvailabilitySection puts beside AVAILABLE
              DATES below (and the pink/white treatment MORE INFO already uses)
              — one calendar, opened from either heading, must not look like it
              belongs to two different controls. */}
          <CalendarIconBtn onClick={() => setCalendarOpen(true)} label="Open the enquiry calendar" />
          {/* ⚠ The SAME control as LINEUP's, not a lookalike — see
              SectionCollapseButton for why it stopped being inline markup. */}
          <SectionCollapseButton expanded={showEnquiries} onToggle={() => setShowEnquiries(v => !v)} />
        </div>

        {/* ⭐ ONE PANEL, ONE SET OF DIRECTION TABS. The promoter's own enquiries
            arrive as `direction: 'outgoing'` rows in the same array — see
            `mappedOutgoing` — so the panel's existing OUTGOING tab lists them
            with no new control on this screen.
            ⭐ The count badge above stays visible when collapsed: the heading
            must still say how much is waiting, or minimising a section hides
            the fact that it needs attention. */}
        {showEnquiries && (loadingApps
          ? <p className={s.empty}>Loading applications…</p>
          : <EnquiryPanel enquiries={panelEnquiries} viewerProfile={profile} onRespond={handleEnquiryRespond} onClear={handleClearEnquiry} />
        )}

        {/* ⚠ ON DEMAND, NEVER RESIDENT. An earlier pass rendered this calendar
            permanently above the panel, which made the product feel like it had
            two calendars however much code they shared. It is the SAME modal
            Available Dates opens; the only difference is that a signed-in
            organiser looking at their own dashboard may be handed dots. */}
        {calendarOpen && (
          <EnquiryCalendar
            profileId={profile?.id}
            table="artist_availability"
            enquiries={panelEnquiries}
            accent="#FF2D78"
            accentRgb="255,45,120"
            onClose={() => setCalendarOpen(false)}
          />
        )}
      </div>

      {/* ── LINEUP ── */}
      <div id="section-lineup" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: lineups.length > 1 ? 8 : 12 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff' }}>LINEUP</span>
          {lineupSlotsCount > 0 && <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{lineupSlotsCount}</span>}
          <SectionCollapseButton expanded={showAllLineup} onToggle={() => setShowAllLineup(v => !v)} />
        </div>

        {/* ⚠ A REFUSED ADD TO BILL, SAID OUT LOUD. RLS filters a write rather
            than erroring it, and this path used to swallow even the errors it
            did get — so a rejected add looked exactly like a dead button. */}
        {lineupError && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(255,45,120,.1)', border: '1px solid rgba(255,45,120,.35)' }}>
            <span style={{ fontSize: 12.5, color: '#FF2D78', lineHeight: 1.5 }}>{lineupError}</span>
            <button onClick={() => setLineupError('')} style={{ background: 'none', border: 'none', color: '#FF2D78', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>
        )}

        {/**
          * ⭐⭐ UPCOMING · DRAFT · ARCHIVE — because 11 of this host's 15 events
          * are 2023-2025 imports, and listing them all turned the selector into
          * a wall of dead gigs with the four live ones buried at the end.
          *
          * ⛔ The archive is not hidden, it is FILED. Those bills are real and
          * still readable; they are simply not what anyone opens this section to
          * work on. Same rule as the events list above, from the same function,
          * so the two cannot disagree about what "past" means.
          */}
        {lineups.length > 0 && (
          <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
            {BUCKETS.map(b => {
              const n = (lineupsByBucket[b] || []).length;
              const active = activeLineupBucket === b;
              return (
                <button key={b}
                  onClick={() => { setLineupBucketPick(b); setLineupFocusId(null); }}
                  style={{
                    flex: 1, background: 'none', border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--neon2)' : 'transparent'}`,
                    fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
                    /* ⚠ An empty bucket is dimmed, never hidden. Removing the tab
                       would make the section's shape change under the reader
                       every time a date passes. */
                    color: active ? '#fff' : n === 0 ? 'rgba(255,255,255,.25)' : 'var(--muted)',
                    padding: '8px 4px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'color .15s, border-bottom-color .15s',
                  }}
                >
                  {b}
                  <span style={{ background: 'var(--card2)', color: 'var(--muted)', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontFamily: "'DM Sans'", fontWeight: 700, letterSpacing: 0 }}>{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Event selector pills — only when the ACTIVE bucket holds >1 event */}
        {bucketLineups.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              onClick={() => setLineupFocusId(null)}
              style={{
                fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                transition: 'background .15s, border-color .15s, color .15s',
                background: lineupFocusId === null ? 'rgba(0,229,255,.12)' : 'transparent',
                border: `1.5px solid ${lineupFocusId === null ? 'var(--neon2)' : 'rgba(255,255,255,.15)'}`,
                /* ⚠ WHITE INK, COLOUR ON THE EDGE — the same rule the enquiry
                   dir chips, the status sub-tabs and the card's status chip now
                   follow. The tint and the border say which pill is selected;
                   the word does not have to say it as well. Inactive stays
                   `--muted`, as everywhere else. */
                color: lineupFocusId === null ? '#fff' : 'var(--muted)',
              }}
            >ALL</button>
            {bucketLineups.map(({ event: ev }) => {
              const evName = ev.name || ev.config?.name || 'Untitled';
              const active = lineupFocusId === ev.id;
              return (
                <button key={ev.id}
                  onClick={() => setLineupFocusId(ev.id)}
                  style={{
                    fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                    padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                    transition: 'background .15s, border-color .15s, color .15s',
                    background: active ? 'rgba(0,229,255,.12)' : 'transparent',
                    border: `1.5px solid ${active ? 'var(--neon2)' : 'rgba(255,255,255,.15)'}`,
                    /* Same rule as the ALL pill above — these are one control
                       rendered twice, and the two inline styles must not drift
                       apart the way the enquiry status colours did. */
                    color: active ? '#fff' : 'var(--muted)',
                  }}
                >{evName}</button>
              );
            })}
          </div>
        )}

        {loadingLineups ? (
          <p className={s.empty}>Loading lineup…</p>
        ) : lineups.length === 0 ? (
          /* ⚠ THIS NOW MEANS "YOU HAVE NO EVENTS", which is the only honest
             reading. It used to mean "no accepted applications", and appeared
             above 39 events that had a bill. */
          <p className={s.empty}>No events yet. Create one and start building its bill.</p>
        ) : showAllLineup === false ? null : (
          <div>
            {/* ⚠ `bucketLineups`, not `lineups` — the list must show what the
                tab above it says, or the counts and the content disagree. */}
            {(lineupFocusId ? bucketLineups.filter(g => g.event.id === lineupFocusId) : bucketLineups).map(({ event: ev, members, days, totalSlots, filledSlots, unscheduled }) => {
              const evName      = ev.name || ev.config?.name || 'Untitled Event';
              const evDate      = ev.config?.date ? new Date(ev.config.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
              const evExpanded  = lineupExpandMap[ev.id] !== false;
              const toggleExpand = () => setLineupExpandMap(prev => ({ ...prev, [ev.id]: !evExpanded }));
              /**
               * ⭐ Does this event have a running order? `lib/eventSetTimes` is
               * the one reader; `totalSlots` is consulted only for an event
               * that has never stated a preference, so ⛔ nothing existing
               * changes shape.
               */
              const usesSetTimes = setTimesEnabled(ev, totalSlots);

              /* ⭐ THE CONFIRMED BILL (P5.1) — one rule, group shape. */
              const bookedLineup = bookedMembers(members, ev);

              /**
               * ⛔⛔ THE REMEMBERED TAB CAN BE ONE THIS EVENT NO LONGER HAS.
               * `lineupSubTabs` persists per event across renders and the old
               * default was LINEUP, so a set-times event would select a tab
               * absent from its own bar: content below, nothing highlighted
               * above, which reads as broken rather than as a missing tab.
               *
               * ⚠ SWAPPED, ⛔ not reset. LINEUP and SET TIMES occupy the same
               * position in the workflow, so the host lands where they meant to
               * be either way. Corrected on READ rather than by an effect —
               * ⛔ nothing is written, so there is no state to drift.
               */
              const storedTab   = lineupSubTabs[ev.id] || 'LINEUP';
              const activeTab   = usesSetTimes && storedTab === 'LINEUP'     ? 'SET TIMES'
                                : !usesSetTimes && storedTab === 'SET TIMES' ? 'LINEUP'
                                : storedTab;
              const setTab      = (tab) => setLineupSubTabs(prev => ({ ...prev, [ev.id]: tab }));
              /* ⚠ Lifted to the group scope because the PADLOCK lives in the
                 tab heading and the cards it governs render further down. ⛔ Two
                 copies of `!!setTimesUnlocked[ev.id]` is how a control and the
                 thing it controls come to disagree. */
              const stUnlocked  = !!setTimesUnlocked[ev.id];
              const toggleSetTimes = () => setSetTimesUnlocked(prev => ({ ...prev, [ev.id]: !stUnlocked }));
              const evPipeline  = newApps.filter(a => a.event_id === ev.id);
              /**
               * ⭐⭐ THE SHORTLIST IS TWO SOURCES, matching `EventHostView`.
               *
               * ⚠⚠ THIS SCREEN READ APPLICATIONS ONLY and the event page did
               * not, so an artist moved to the shortlist from the event page
               * appeared in NEITHER list here — the same disappearing act the
               * funnel work was meant to close, left live on one surface.
               *
               * ⛔ An applicant who already has a member row appears ONCE.
               */
              const evRawMembers = (shortlistMembersByEvent[ev.id] || []);
              const evShortProfiles = shortlistProfiles;
              /**
               * ⭐⭐ P5.2 · ONE DERIVATION, SHARED WITH THE EVENT PAGE. Both
               * screens assembled this inline from their own variables, so the
               * two exclusions held by coincidence rather than by construction.
               *
               * ⛔ Contract-aware: a legacy or imported event's bill is NOT
               * injected here, so ⛔ nothing about the 90 grandfathered events
               * changes. Only a managed event lists booked artists, first.
               */
              const evShortRows = shortlistEntriesFromGroups({
                event: ev,
                shortlistMembers: evRawMembers,
                billGroups: members,
                shortlistedApps: tentativeApps.filter(a => a.event_id === ev.id),
                appProfiles,
                /* ⭐⭐ P5.3 · THE GATE — this screen's own `usesSetTimes` (line
                   1057), the same value that decides its tab strip. */
                usesSetTimes,
              });
              const evShortList  = evShortRows.map(e => e.row);
              /**
               * ⭐ ORPHANS ONLY — accepted, and on nobody's bill. ⛔ Not an
               * `acceptedApps` list: ADD TO LINEUP *is* the acceptance now, so a
               * permanent ACCEPTED workspace describes a state the model no
               * longer creates. This tab is a one-time cleanup and disappears.
               */
              const evOrphaned  = acceptedApps.filter(a => a.event_id === ev.id
                && !findExistingMember(a, members.map(r => r.member), appProfiles[a.id] || null)
                && !findExistingMember(a, evRawMembers, appProfiles[a.id] || null));
              /* ⚠ `days`, `totalSlots` and `filledSlots` arrive from
                 `buildHostLineup` — they came from `ev.config.days` and from
                 `Object.keys(claims).length`, which counted an unanswered offer
                 as a booked slot. */
              const evClaims    = claimsMap[ev.id] || {};

              return (
                <div key={ev.id} className={s.lineupGroup}>
                  {/* Header */}
                  <div className={s.lineupGroupHeader}>
                    <span className={s.lineupEventName}>{evName}</span>
                    {evDate && <span className={s.lineupEventDate}>{evDate}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {/**
                        * ⭐⭐ TWO CONTROLS, ⛔ NOT ONE (owner, 2026-08-16).
                        * `VIEW / EDIT EVENT` was a single button doing two
                        * unrelated jobs, and it did neither directly: it landed
                        * on the host workspace, from which EDIT was another two
                        * presses through MANAGE EVENT.
                        *
                        * ⚠ The EYE is the app's established "see it as the
                        * public does" mark — the same glyph DashboardHeader
                        * uses for the profile preview and the event page uses
                        * for its own punter toggle. ⛔ Do not give it a label;
                        * three of these sit in a row and the icon is the
                        * vocabulary.
                        */}
                      <button
                        onClick={() => navigate(`/event/${ev.id}?view=public`)}
                        title="View as the public sees it"
                        aria-label="View as the public sees it"
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--neon2)'; e.currentTarget.style.color = 'var(--neon2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
                        </svg>
                      </button>
                      {/**
                        * ⭐ SET TIMES ON / OFF, in the header because the header
                        * exists in BOTH states — see `toggleEventSetTimes`.
                        *
                        * ⚠ IT SAYS WHAT IT CONTROLS, ⛔ not just "on". The tab
                        * row directly below reshuffles when this is pressed, so
                        * the label has to name the thing that is about to move.
                        *
                        * ⚠ Cyan when on, muted when off — the same on/off
                        * vocabulary the padlock uses, ⛔ without a second lock
                        * glyph to confuse it with.
                        */}
                      <button
                        onClick={() => toggleEventSetTimes(ev, !usesSetTimes)}
                        aria-pressed={usesSetTimes}
                        title={usesSetTimes
                          ? 'This event has a running order. Turn off to show LINEUP instead.'
                          : 'This event has no running order. Turn on to schedule set times.'}
                        style={{
                          background: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
                          fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, flexShrink: 0,
                          border: `1px solid ${usesSetTimes ? 'rgba(0,229,255,.45)' : 'rgba(255,255,255,.15)'}`,
                          color: usesSetTimes ? 'var(--neon2)' : 'var(--muted)',
                          transition: 'border-color .15s, color .15s',
                        }}
                      >{usesSetTimes ? 'SET TIMES ON' : 'SET TIMES OFF'}</button>
                      {/* ⛔ STRAIGHT TO THE EDITOR, ⛔ not to the event page.
                          "Edit" that lands somewhere you then have to press
                          MANAGE EVENT from is not an edit button. */}
                      <button
                        onClick={() => navigate(`/create-event?edit=${ev.id}`)}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '4px 10px', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--neon2)'; e.currentTarget.style.color = 'var(--neon2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
                      >EDIT EVENT →</button>
                      <button onClick={toggleExpand}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.4)'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
                      >
                        {evExpanded
                          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                          : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                        }
                      </button>
                    </div>
                  </div>

                  {evExpanded && (
                    <div style={{ marginTop: 10 }}>
                      <EventProgressSummary
                        lineupCount={members.length}
                        totalSlots={totalSlots}
                        filledSlots={filledSlots}
                        hasPoster={!!(ev.config?.poster || ev.config?.poster_full)}
                        pendingCount={evPipeline.length}
                      />

                      {/**
                        * Communal event tabs.
                        *
                        * ⚠⚠ THE ORDER IS DUPLICATED IN `EventHostView` and the
                        * two must match — they are the same five tabs on two
                        * different screens, and an organiser moving between the
                        * dashboard and the event page should not have to re-find
                        * them. ⛔ Change one, change both.
                        *
                        * ⚠ ORDER IS THE FUNNEL, READ BACKWARDS (owner,
                        * 2026-08-15): the settled bill, its running order, then
                        * the decisions behind it in reverse — accepted,
                        * shortlisted, and the raw inbox last. PIPELINE and
                        * ACCEPTED previously sat at opposite ends with two
                        * unrelated tabs between them.
                        *
                        * ⛔ ORDER ONLY — keys, labels and counts are untouched.
                        * ⚠ The keys here are SPACED ('SET TIMES', 'SHORT LIST')
                        * where EventHostView's are underscored; they index
                        * `lineupSubTabs` and ⛔ must not be "tidied" to match.
                        */}
                      <EventTabBar
                        active={activeTab}
                        onChange={setTab}
                        style={{ marginBottom: 12 }}
                        tabs={[
                          /**
                            * ⭐⭐ PIPELINE · SHORTLIST · (SET TIMES or LINEUP)
                            * — the workflow read forwards (ratified 2026-08-17).
                            *
                            * ⛔⛔ NEVER BOTH LINEUP AND SET TIMES: SET TIMES *is*
                            * the scheduling presentation of the confirmed bill,
                            * so both is two workspaces over one population.
                            * ⛔ Change this list and change `EventHostView`'s —
                            * §11, which was written for exactly this pair and
                            * then broken by its own author within hours.
                            */
                          /* ⚠ SWAPPED (owner, 2026-08-17): the WORKSPACE leads,
                             PIPELINE moves to the end. ⛔ Change this order and
                             change EventHostView's — §11. */
                          ...(usesSetTimes ? [
                          /**
                            * ⭐⭐ THE PADLOCK SITS IN THE HEADING (owner,
                            * 2026-08-16). `EventTabBar` renders `label` as a
                            * child, so it takes a node — ⛔ no change needed
                            * there, and ⛔ none made: it is shared with the
                            * event page.
                            *
                            * ⛔ A `<span role="button">`, ⛔ NOT a `<button>` —
                            * the tab itself is a button and nesting one inside
                            * another is invalid HTML that browsers resolve by
                            * dropping the inner control.
                            *
                            * ⚠ `stopPropagation` or the padlock would also fire
                            * the tab change underneath it. ⭐ Toggling the lock
                            * and choosing the tab are two different intents on
                            * one piece of chrome.
                            *
                            * ⚠ 40px hit area via padding + equal NEGATIVE
                            * margin, so the target is thumb-sized without
                            * growing the tab row's height.
                            */
                          { key: 'SET TIMES',  label: (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              SET TIMES
                              <span
                                role="button"
                                tabIndex={0}
                                aria-pressed={stUnlocked}
                                aria-label={stUnlocked ? 'Lock set times' : 'Unlock to edit set times here'}
                                title={stUnlocked ? 'Lock set times' : 'Unlock to edit set times here'}
                                onClick={e => { e.stopPropagation(); toggleSetTimes(); }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSetTimes(); }
                                }}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  padding: 13, margin: -13, border: 'none', background: 'none',
                                  color: stUnlocked ? '#fff' : 'var(--muted)',
                                  cursor: 'pointer', transition: 'color .15s',
                                }}
                              >
                                {stUnlocked
                                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                }
                              </span>
                            </span>
                          ) },
                          ] : [
                            /* ⚠ No running order, so the confirmed bill is the
                               third tab instead. Same position, same place in
                               the workflow. */
                            { key: 'LINEUP', label: `LINEUP${bookedLineup.length ? ` (${bookedLineup.length})` : ''}` },
                          ]),
                          { key: 'SHORTLIST',  label: `SHORTLIST${evShortList.length ? ` (${evShortList.length})` : ''}` },
                          { key: 'PIPELINE',   label: `PIPELINE${evPipeline.length ? ` (${evPipeline.length})` : ''}` },
                          ...(evOrphaned.length
                            ? [{ key: 'NOT BOOKED', label: `NOT BOOKED (${evOrphaned.length})` }]
                            : []),
                        ]}
                      />

                      <div>
                      {/**
                        * ⭐⭐ P5.1 · THE SAME DERIVATION AS THE EVENT PAGE.
                        * `bookedMembers` and that screen's `bookedMemberRows`
                        * are two adapters over ONE rule (`isBooked`), because
                        * this surface holds `buildHostLineup` groups and that
                        * one holds a flat list. ⛔ Two shapes, ⛔ never two rules.
                        *
                        * ⚠⚠ A NO-OP ON ALL 90 PRODUCTION EVENTS: every one is
                        * `legacy`, so the answer is `on_bill` — which is what
                        * `members` already is.
                        */}
                      {activeTab === 'LINEUP' && (
                        bookedLineup.length === 0
                          /* ⚠ "No confirmed artists yet. Accept applications to
                             build your lineup." was the old copy, and it was
                             wrong twice: it described the bill as a by-product
                             of applications, and it appeared on events that had
                             a full bill. An empty bill is an empty bill. */
                          ? <p className={s.empty} style={{ fontSize: 12 }}>Nobody on the bill yet.</p>
                          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                              {/* ⭐ Keyed by the MEMBER row. Keyed by artist_id,
                                  every imported act collides on NULL. */}
                              {/**
                                * ⭐⭐ THE SAME CARD THE EVENT PAGE DRAWS, WITH NO
                                * ACTION ROW (owner, 2026-08-15).
                                *
                                * ⚠⚠ THE APP HAD THREE WAYS OF DRAWING ONE ACT —
                                * a photo tile here, a work item on the event
                                * page, a slot row in Set Times — and the owner
                                * hit all three within two clicks. "Keep the
                                * dashboard as triage" is a rule about FUNCTION,
                                * ⛔ not a licence for a second visual language.
                                *
                                * ⛔ SO: same component, same state vocabulary,
                                * ⛔ no actions. Everything you can DO to a bill
                                * member is a workspace operation and lives on
                                * the event page. This is the summary that tells
                                * you whether to go there.
                                */}
                              {bookedLineup.map(m => {
                                const item = m.profile || {
                                  /* ⛔ Not "Unknown". A member always has a
                                     name — the old card fell back to Unknown
                                     whenever the profile join missed, which
                                     for imported acts was always. */
                                  id: m.member.artist_profile_id || null,
                                  user_id: m.member.artist_id || null,
                                  name: m.member.artist_name || 'Unnamed act',
                                  type: 'artist',
                                  sound: m.member.sound || null,
                                  genre_string: m.member.genre || null,
                                };
                                const work = lineupWorkState(m.state);
                                return (
                                  <WorkItemCard key={m.id} kind="lineup" item={item}
                                    /* ⛔ NO `stateLabel` — see EventHostView's
                                       twin of this call. The tab is the bill;
                                       the set time is promoted into the chip.
                                       ⛔ Change one, change both. */
                                    stateColor={STATE_COLOURS[m.state]}
                                    subState={work.setTime} needsAction={work.needsAction}
                                    tags={m.profile?.card_pills || m.member.card_pills}
                                    viewerProfileId={profile?.id || null}
                                    /**
                                      * ⭐⭐ THE SAME PANEL AS THE EVENT PAGE
                                      * (owner, 2026-08-16). ⛔ The note that
                                      * used to sit here said "NO `actions` —
                                      * the dashboard performs no lineup work",
                                      * and that is no longer the rule: it
                                      * removes from slots, replaces artists and
                                      * now takes acts off the bill.
                                      *
                                      * ⚠⚠ THE TWIN RULE STILL BINDS — this call
                                      * and `EventHostView`'s must agree. ⛔
                                      * Change one, change both.
                                      *
                                      * ⚠ ASSIGN SET TIME IS ABSENT HERE, ⛔ not
                                      * forgotten: it opens the event page's
                                      * inline slot-picker sheet, which is 80
                                      * lines of that screen's own state. It
                                      * needs EXTRACTING before a second surface
                                      * can offer it, and half-copying it is how
                                      * these two screens drifted before.
                                      */
                                    actions={
                                      <div className="yp-decision-row">
                                        {/* ⭐ THE DOMINANT STATE GETS THE PRIMARY
                                            ACTION — no set time is the only
                                            state here with work outstanding, so
                                            it alone offers the forward move.
                                            ⛔ Change one, change both. */}
                                        {/* ⚠ `slotCount`, ⛔ not the state label.
                                            It is the same question the event
                                            page asks (`memberPerfs(...).length
                                            === 0`) answered from the data
                                            `buildHostLineup` already derived. */}
                                        {m.slotCount === 0 && (
                                          <DecisionBtn tone="accept" icon={CheckIcon} label="ASSIGN SET TIME"
                                            onClick={() => setAssigning({ ev, member: m.member, name: item.name, days })} />
                                        )}
                                        <DecisionBtn tone="decline" icon={XIcon} label="REMOVE FROM LINEUP"
                                          onClick={() => setConfirmExit({ ev, member: m.member, name: item.name })} />
                                      </div>
                                    }
                                    /* ⛔ NO `actions` — the dashboard performs no
                                       bill operations. The disclosure is still
                                       here because the panel holds home town,
                                       tags, follow, message and profile, so a
                                       dashboard card and an event card are the
                                       same object closed AND open; only the
                                       decision row differs, which is exactly
                                       what "triage, not a second workspace"
                                       means. */ />
                                );
                              })}
                              {/* The number the Lineup workspace exists to act
                                  on: booked, but nowhere to play yet. */}
                              {unscheduled > 0 && totalSlots > 0 && (
                                <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 0' }}>
                                  {unscheduled} of {members.length} {unscheduled === 1 ? 'has' : 'have'} no set time yet.
                                </p>
                              )}
                            </div>
                      )}
                      {activeTab === 'SET TIMES' && (() => {
                        const slots = days.flatMap(d => d.slots || []);
                        if (slots.length === 0) return <p className={s.empty} style={{ fontSize: 12 }}>No set times added for this event yet.</p>;
                        /* ⛔ `locate()` IS GONE. It translated a slot into its
                           `config.days` position for the old blob write, and
                           `saveSlot` now updates the `event_slots` ROW by id —
                           so there is no position to find, and no way for the
                           lookup to fail and swallow the edit. */
                        /* ⛔ THE PADLOCK MOVED INTO THE TAB HEADING (owner,
                           2026-08-16) — icon only, ⛔ no label row and ⛔ no
                           border. `stUnlocked` is the group-scope source. */
                        const unlocked = stUnlocked;
                        return (
                          <div style={{ marginBottom: 12 }}>
                            {/**
                              * ⭐⭐ THE REAL `SlotCard` — the same row the event
                              * page draws (owner, 2026-08-16). ⛔ It replaced a
                              * hand-rolled time/name/duration line that shared
                              * no markup, no styling and no vocabulary with the
                              * card one screen over, so the same schedule read
                              * as two different products.
                              *
                              * ⚠ `isHost` — this IS the host's own dashboard.
                              * ⛔ Passing false would render the PUBLIC view,
                              * which shows an unconfirmed act as "PENDING" and
                              * treats a draft slot as empty: the host would be
                              * hidden from acts they can see one tab away.
                              *
                              * ⛔ NO `onFill`/`onEdit`/`onRemove` and ⛔ NOT
                              * sortable — "triage, not a second workspace", the
                              * same rule the LINEUP tab above follows by
                              * passing no `actions`. Scheduling happens on the
                              * event page, and OPEN FULL SCHEDULE goes there.
                              */}
                            <DaySlots
                              eventId={ev.id}
                              days={days}
                              claims={evClaims}
                              isHost
                                /**
                                 * ⭐⭐ EXPANDING IS READING; THE PADLOCK GOVERNS
                                 * WRITING (owner, 2026-08-16).
                                 *
                                 * ⚠ I had `expandable={unlocked}` first, which
                                 * conflated the two: a host could not even LOOK
                                 * at who is on a slot without arming the edit
                                 * controls. ⛔ Wrong gate. The panel's status,
                                 * tags, follow, message and profile are all
                                 * read-only, so they are ⛔ never locked.
                                 *
                                 * `locked` still hides EDIT SLOT, and with no
                                 * `onPin`/`onRemove`/`onFill` passed the other
                                 * three controls never render here at all.
                                 */
                              /**
                               * ⭐⭐ `editable` IS THE EDITOR ON/OFF FLAG, and
                               * the padlock now drives it (owner, 2026-08-16:
                               * "just wire the padlock to do the job of the
                               * editor on/off button").
                               *
                               * ⛔ `DaySlots` OWNS THE DndContext — that is why
                               * this renders it rather than mapping `SlotCard`
                               * directly. Drag dots without a drag context are
                               * an affordance that does nothing.
                               *
                               * ⚠ `editable` gives the CONTEXT; `isLocked`
                               * gives the CONTROLS. Both follow the padlock, so
                               * locked is a readable schedule and unlocked is
                               * the editor.
                               */
                              editable={unlocked}
                              isLocked={!unlocked}
                              /**
                                * ⛔⛔ `locate(slot)` IS GONE FROM THIS PATH, and
                                * it was a second way to lose the edit: it
                                * searched `config.days` for the slot's position
                                * and `if (at)` SILENTLY DID NOTHING when the
                                * search failed. A slot that exists as a row but
                                * has no counterpart left in the blob could not
                                * be opened at all, and the button simply did
                                * not respond.
                                *
                                * ⭐ The card knows which slot it is; it says so.
                                * `saveSlot` needs only `slot.id`.
                                */
                              onEdit={slot => setEditingSlot({ ev, slot })}
                              /* ⭐ The padlock. */
                              onPin={slot => toggleSlotPin(slot)}
                              /**
                               * ⭐⭐ REMOVE NOW RENDERS HERE, because the claim
                               * finally carries what acting on it requires.
                               *
                               * ⚠ The note this replaces was correct when it
                               * was written: the planners need the member row
                               * and its performances, and this screen held
                               * neither. `toClaim` now carries both, so the
                               * verb exists and therefore so does the control.
                               *
                               * ⭐ `onFill` followed for the same reason: the
                               * picker is now mounted here and writes through
                               * the same `assignMemberToSlot`.
                               */
                              onRemove={slot => removeFromSlot(ev, slot)}
                              onDemote={slot => demoteFromSlot(ev, slot)}
                              onFill={slot => setFillSlot({ ev, slot })}
                              /* ⭐⭐ THIS SCREEN REFRESHES ITSELF. `DaySlots`
                                 invalidates the EVENT PAGE's query key, which
                                 nothing here reads — without this a drag wrote
                                 to the database and the row snapped back. */
                              onChanged={() => setLineupReload(n => n + 1)}
                              /**
                                * ⭐⭐ OPTIMISTIC, and it is what makes the drop
                                * feel instant. `DaySlots` patches the event
                                * page's query cache; this screen keeps its
                                * claims in state, so it patches them here.
                                *
                                * ⚠⚠ IT TAKES THE WHOLE DAY'S NEW ORDER, ⛔ not a
                                * pair. A drag is an INSERT: everyone between
                                * the source and the target shifts one slot, so
                                * any number of rows can change. ⛔ A slot
                                * missing from `nextBySlot` ends up EMPTY and
                                * must be deleted, or its old occupant lingers
                                * in two places until the refetch.
                                */
                              onLocalMove={({ slotIds, nextBySlot }) => {
                                setClaimsMap(prev => {
                                  const bySlot = { ...(prev[ev.id] || {}) };
                                  slotIds.forEach(sid => {
                                    if (nextBySlot[sid]) bySlot[sid] = nextBySlot[sid];
                                    else delete bySlot[sid];
                                  });
                                  return { ...prev, [ev.id]: bySlot };
                                });
                              }}
                              viewerProfileId={profile?.id || null} />
                            <button
                              onClick={() => navigate(`/event/${ev.id}`)}
                              style={{ marginTop: 10, background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '6px 12px', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--neon2)'; e.currentTarget.style.color = 'var(--neon2)'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
                            >OPEN FULL SCHEDULE →</button>
                          </div>
                        );
                      })()}
                      {activeTab === 'SHORTLIST' && (
                        evShortList.length === 0
                          ? <p className={s.empty} style={{ fontSize: 12 }}>Nobody on the shortlist for this event.</p>
                          : <div style={{ marginBottom: 12 }}>{evShortRows.map(({ row, kind, booked, needsSetTime }) => {
                            /* ⚠⚠ TWO SHAPES IN ONE LIST — a `lineup_members` row
                               carries `status`; an application does not.
                               ⛔ Reading one shape's fields off the other yields
                               `undefined`, which draws a nameless card rather
                               than raising.
                               ⭐ P5.2 · the kind is TOLD, ⛔ no longer inferred
                               from `!row.status`: a booked member reaching this
                               list carries `on_bill`. */
                            if (kind === 'application') {
                              return <AppCard key={row.id} app={row} viewerProfileId={profile?.id || null} prof={appProfiles[row.id] || {}} eventName={evtMap[row.event_id]?.name} onRespond={respondApp} onBill={!!findExistingMember(row, members.map(r => r.member), appProfiles[row.id] || null)} />;
                            }
                            const mp = evShortProfiles[row.id] || null;
                            const item = {
                              id: mp?.id || row.artist_profile_id || null,
                              user_id: row.artist_id || null,
                              name: mp?.name || row.artist_name || 'Unnamed act',
                              type: mp?.type || 'artist',
                              avatar: mp?.avatar || null,
                              avatar_thumb: mp?.avatar_thumb || null,
                              sound: mp?.sound || row.sound || null,
                              genre_string: mp?.genre_string || row.genre || null,
                              location: mp?.location || null,
                              state: mp?.state || null,
                            };
                            /* ⛔ NO ACTIONS — the dashboard is triage. Moving
                               somebody onto the bill is a workspace operation
                               and lives on the event page. */
                            return (
                              <WorkItemCard key={row.id} kind="application" item={item}
                                /* ⭐ The chip describes the ROW, not the tab —
                                   identical rule to the event page. */
                                stateLabel={booked ? 'BOOKED' : 'SHORTLISTED'}
                                stateColor={booked ? STATE_COLOURS.CONFIRMED : STATUS_TAB_COLOR.SHORTLISTED}
                                /* ⭐ P5.3 · the same wording as the event page
                                   and the LINEUP tab. ⛔ Still NO actions here:
                                   the dashboard is triage, and assigning a set
                                   time is a workspace operation. */
                                subState={needsSetTime ? lineupWorkState('ON BILL').setTime : undefined}
                                needsAction={!!needsSetTime}
                                tags={mp?.card_pills || row.card_pills}
                                viewerProfileId={profile?.id || null} />
                            );
                          })}</div>
                      )}
                      {activeTab === 'PIPELINE' && (
                        evPipeline.length === 0
                          ? <p className={s.empty} style={{ fontSize: 12 }}>Nothing waiting on you for this event.</p>
                          : <div style={{ marginBottom: 12 }}>{evPipeline.map(app => <AppCard key={app.id} app={app} viewerProfileId={profile?.id || null} prof={appProfiles[app.id] || {}} eventName={evtMap[app.event_id]?.name} onRespond={respondApp} />)}</div>
                      )}
                      {/* ⛔ A ONE-TIME CLEANUP, ⛔ not a workspace. The tab only
                          renders while orphans exist and disappears for good
                          once they are cleared — see EventHostView, which must
                          stay identical to this. */}
                      {activeTab === 'NOT BOOKED' && (
                        evOrphaned.length === 0
                          ? <p className={s.empty} style={{ fontSize: 12 }}>Nothing left to clear.</p>
                          : <div style={{ marginBottom: 12 }}>
                              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
                                You told these artists yes and they were never added to the lineup. Open the event to add or decline them.
                              </p>
                              {evOrphaned.map(app => <AppCard key={app.id} app={app} viewerProfileId={profile?.id || null} prof={appProfiles[app.id] || {}} eventName={evtMap[app.event_id]?.name} onRespond={respondApp} onBill={false} />)}
                            </div>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FOLLOWING — always at bottom ──
          ⛔ NO WRAPPER MARGIN. The gap is FollowingSection's own
          `FOLLOWING_GAP`, so every screen showing this section shows the same
          space above it (owner, 2026-08-15). A wrapper here would collapse into
          that margin and quietly win or lose depending on which was larger,
          which is how Host and Artist came to differ in the first place. */}
      <FollowingSection
        following={following}
        loading={loadingFollowing}
        followView={followView}
        setFollowView={setFollowView}
        followFilter={followFilter}
        setFollowFilter={setFollowFilter}
        followShowAll={followShowAll}
        setFollowShowAll={setFollowShowAll}
        followSearch={followSearch}
        setFollowSearch={setFollowSearch}
        followDrag={followDrag}
        emptyMsg="Follow artists from their profiles to build your roster here."
        filterTypes={FOLLOW_FILTER_CONFIGS.host}
      />

      {/* Slot edit modal */}
      {editingSlot && (
        <SlotEditModal
          slot={editingSlot.slot}
          claim={claimsMap[editingSlot.ev.id]?.[editingSlot.slot.id]}
          /* ⚠ THE SLOT'S OWN ID, ⛔ not its position in the blob. */
          onSave={updated => saveSlot(editingSlot.slot.id, updated)}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {/**
        * ⭐⭐ REPLACE ARTIST, ON THE DASHBOARD — the last piece of set-times
        * parity. ⛔ It is the SAME COMPONENT and the same writer the event page
        * uses; this screen contributes a mount point and a refresh, ⛔ no rules.
        *
        * ⚠ `acceptedArtists` IS EMPTY HERE, DELIBERATELY. That prop feeds the
        * "pick from your shortlist" shortcut, which needs the event's
        * applications and their profiles — data this screen does not load. The
        * sheet's SEARCH and ADD MANUALLY paths are complete without it, so the
        * shortcut is ABSENT rather than broken. ⛔ Do not pass the dashboard's
        * own application list: it is keyed by a different shape, and crossing
        * the two draws a nameless card rather than raising.
        */}
      {fillSlot && (
        <FillSlotModal
          slot={fillSlot.slot}
          eventId={fillSlot.ev.id}
          eventName={fillSlot.ev.name || ""}
          eventDate={fillSlot.ev.config?.date || ""}
          eventVenue={fillSlot.ev.config?.venue || ""}
          hostId={userId}
          onFilled={() => { setFillSlot(null); setLineupReload(n => n + 1); }}
          onClose={() => setFillSlot(null)}
        />
      )}

      {/**
        * ⭐⭐ THE SAME SHEET THE EVENT PAGE USES — extracted for exactly this.
        * ⚠ `quiet` is TRUE: this is the MEMBER route, which writes a draft and
        * tells nobody. ⛔ The application route (which accepts and notifies) is
        * not offered from this screen.
        *
        * ⛔ `assignMemberToSlot` does the write, so the dashboard cannot invent
        * a different meaning for placing somebody in a running order.
        */}
      {assigning && (
        <AssignSlotSheet
          name={assigning.name}
          days={assigning.days || []}
          claims={claimsMap[assigning.ev.id] || {}}
          quiet
          onPick={async slot => {
            const { ok, error } = await assignMemberToSlot(supabase, {
              slotId: slot.id, eventId: assigning.ev.id, memberId: assigning.member.id, status: 'draft',
            });
            setAssigning(null);
            if (!ok) { setLineupError(error); return; }
            setLineupReload(n => n + 1);
          }}
          onClose={() => setAssigning(null)}
        />
      )}

      {/**
        * ⭐ BOTH EXITS, worded as the event page words them. ⚠ Keeping somebody
        * is the safe reversible act, so it is the filled button; taking them
        * off the event is the outline one beside it.
        */}
      {confirmExit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setConfirmExit(null)}>
          <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 34px', border: '1px solid rgba(255,255,255,.08)', borderBottom: 'none' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>
              Take {confirmExit.name || 'this act'} off the lineup?
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 8, lineHeight: 1.6 }}>
              Any set time they hold will be cleared. They are only told if it was already sent to them.
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 10, lineHeight: 1.5 }}>
              Their application is left exactly as it is either way.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => exitMember(confirmExit.ev, confirmExit.member, 'shortlist')}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#FF2D78', color: '#0a0a14', cursor: 'pointer' }}>
                MOVE TO SHORTLIST
              </button>
              <button onClick={() => exitMember(confirmExit.ev, confirmExit.member, 'remove')}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,45,120,.5)', background: 'rgba(255,45,120,.10)', color: '#FF2D78', cursor: 'pointer' }}>
                TAKE OFF EVENT
              </button>
            </div>
            <button onClick={() => setConfirmExit(null)}
              style={{ width: '100%', marginTop: 10, padding: '11px 0', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>
              CANCEL
            </button>
          </div>
        </div>
      )}

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
      >BROWSE OPEN EVENTS →</button>
    </div>
  );
}

function SlotEditModal({ slot, claim, onSave, onClose }) {
  const [time,  setTime]  = useState(slot.time  || '');
  const [ampm,  setAmpm]  = useState(slot.ampm  || 'PM');
  const [dur,   setDur]   = useState(String(slot.dur ?? slot.duration ?? ''));
  const [label, setLabel] = useState(slot.label || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ time, ampm, dur: dur ? Number(dur) : null, label });
    setSaving(false);
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' };
  const sheet   = { background: 'var(--bg2,#0f0f1a)', border: '1px solid var(--border)', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480 };
  const inp     = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const lbl     = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', display: 'block', marginBottom: 5 };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2 }}>EDIT SLOT</span>
          {claim && <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--muted)' }}>— {claim.name}</span>}
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <span style={lbl}>TIME</span>
            <input style={inp} value={time} onChange={e => setTime(e.target.value)} placeholder="9:00" />
          </div>
          <div>
            <span style={lbl}>AM / PM</span>
            <select style={{ ...inp, padding: '10px 8px' }} value={ampm} onChange={e => setAmpm(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div>
            <span style={lbl}>DURATION (mins)</span>
            <input style={inp} type="number" value={dur} onChange={e => setDur(e.target.value)} placeholder="90" />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span style={lbl}>LABEL (optional)</span>
          <input style={inp} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SUNSET SET 🔒" />
        </div>

        <button
          onClick={handleSave} disabled={saving}
          style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, background: saving ? 'rgba(255,255,255,.08)' : 'var(--neon2)', color: saving ? 'var(--muted)' : '#0a0a0f', transition: 'background .15s' }}
        >{saving ? 'SAVING…' : 'SAVE SLOT'}</button>
      </div>
    </div>
  );
}


function EventProgressSummary({ lineupCount, totalSlots, filledSlots, hasPoster, pendingCount }) {
  const cols = [
    {
      label: 'LINEUP',
      /**
       * ⭐⭐ MORE ACTS THAN SLOTS IS ALLOWED, AND SAID OUT LOUD (owner,
       * 2026-08-16). The bill and the running order are different things, and
       * an organiser may genuinely hold six acts for five slots while they work
       * it out — ⛔ so this is NOT blocked at the point of adding, which would
       * fight them mid-decision.
       *
       * ⚠⚠ BUT IT MUST NOT READ AS FINE. `Math.min(…, 1)` capped the bar, so
       * `7 / 5` painted exactly like `5 / 5`: a full pink bar and a value in
       * the same colour as a complete one. The number said one thing and every
       * other signal on the tile said "done".
       *
       * ⭐ Amber, ⛔ not red. This is an overage to resolve, not an error to
       * fix — the same colour the app already uses for "awaiting" rather than
       * for failure.
       */
      color: lineupCount > totalSlots && totalSlots > 0 ? '#FFB830' : '#FF3399',
      value: totalSlots > 0 ? `${lineupCount} / ${totalSlots}` : String(lineupCount),
      pct: totalSlots > 0 ? Math.min(lineupCount / totalSlots, 1) : (lineupCount > 0 ? 1 : 0),
      /* ⚠ Names the SIZE of the overage, so the fix is countable. */
      note: totalSlots > 0 && lineupCount > totalSlots
        ? `${lineupCount - totalSlots} more than slots`
        : null,
    },
    {
      label: 'SET TIMES',
      color: '#00E5FF',
      value: totalSlots > 0 ? `${filledSlots} / ${totalSlots}` : '—',
      pct: totalSlots > 0 ? Math.min(filledSlots / totalSlots, 1) : 0,
    },
    {
      label: 'POSTER',
      color: '#00E5A0',
      value: hasPoster ? 'Done' : 'None',
      pct: hasPoster ? 1 : 0,
    },
    {
      label: 'APPLICATIONS',
      color: '#FFD700',
      value: pendingCount > 0 ? `${pendingCount} Pending` : 'Clear',
      pct: pendingCount > 0 ? 1 : 0,
    },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
      background: 'rgba(255,255,255,0.04)', borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
      marginBottom: 14,
    }}>
      {cols.map((col, i) => (
        <div key={col.label} style={{
          padding: '12px 10px 10px',
          borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
        }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 4 }}>{col.label}</div>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 1, color: col.pct >= 1 ? col.color : 'var(--text)', lineHeight: 1, marginBottom: 8 }}>{col.value}</div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ height: '100%', width: `${col.pct * 100}%`, borderRadius: 2, background: col.color }} />
          </div>
          {/* ⚠ Only where there is something to say. ⛔ An always-present line
              would push every tile taller for the one case that needs it. */}
          {col.note && (
            <div style={{ marginTop: 5, fontSize: 9, lineHeight: 1.3, color: '#FFB830' }}>{col.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}







/* ⛔ `AppBtn` DELETED — the dashboard’s bespoke button. Its last callers
   were the AppCard actions, which now use the shared `.yp-decision` controls so
   a decision looks the same on every surface that offers it. */


/**
 * ⭐⭐ THE CANONICAL CARD, with only what this section adds.
 *
 * This was 186 lines of bespoke markup — its own avatar, type pill, location,
 * sound line, status chip, date box, expander, bio window and social rows —
 * rendering the SAME thing `ProfileCard` renders everywhere else in the app.
 * A third application card (`components/ApplicationCard.jsx`, imported nowhere)
 * is a near-copy of it again.
 *
 * ⚠ WHAT THIS SECTION GENUINELY ADDS, and all it adds:
 *   · the application's BUCKET as the badge
 *   · ADD TO BILL / ON BILL — membership, derived from `lineup_members`
 *   · the host's decision buttons
 *
 * ⛔ WHAT WAS DROPPED, deliberately:
 *   · the event DATE BOX — these cards sit inside an event group whose header
 *     already carries the name and the date. It was the same fact, twice.
 *   · the EXPANDER (bio, tags, socials, mix link). Tapping the card opens the
 *     real profile, which is what ProfileCard does everywhere else and is a
 *     better home for detail than a panel that exists only here.
 *     ⚠⚠ That expander is also what HID `ADD TO BILL` from the owner: the
 *     action had been placed inside it, so the feature was unreachable.
 */
/* ⛔ `onAddToBill` IS GONE FROM THIS SIGNATURE, not merely unrendered — the
   dashboard no longer performs that operation, and a prop the component
   accepts but never uses is how a removed capability quietly comes back. */
function AppCard({ app, prof, onRespond, onBill = false, eventName, viewerProfileId = null }) {
  const [busy, setBusy] = useState(false);
  const bucket = normaliseStatus({ status: app.status, direction: 'incoming' });
  const undecided = PIPELINE_BUCKETS.includes(bucket);

  /* ProfileCard routes on `id` first and falls back to `user_id`: without the
     id an unclaimed applicant's card is unclickable — the same rule the lineup
     cards already follow. */
  const item = {
    id:           prof?.id || app.from_profile_id || null,
    user_id:      app.artist_id || null,
    name:         prof?.name || app.artist_name || 'Applicant',
    type:         prof?.type || 'artist',
    avatar:       prof?.avatar || null,
    avatar_thumb: prof?.avatar_thumb || null,
    sound:        prof?.sound || null,
    genre_string: prof?.genre_string || null,
    location:     prof?.location || null,
    state:        prof?.state || null,
  };

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond(app.id, status, app.artist_id, eventName);
    setBusy(false);
  }
  return (
    <WorkItemCard
      kind="application"
      item={item}
      /* ⭐ ON BILL WINS THE STATE when membership exists: it is the more
         specific fact, and it comes from `lineup_members`, ⛔ never from
         `applications.status`. */
      stateLabel={applicationWorkState(bucket, onBill).label}
      stateColor={onBill ? '#00E5A0' : (STATUS_TAB_COLOR[bucket.toUpperCase()] || 'var(--muted)')}
      tags={prof?.card_pills}
      viewerProfileId={viewerProfileId}
      quiet={applicationWorkState(bucket, onBill).quiet}
      /**
       * ⭐ TRIAGE DECISIONS ONLY — shortlist and decline.
       *
       * ⛔ `ADD TO BILL` AND `ACCEPT` WERE REMOVED FROM THIS SURFACE.
       * Putting somebody on the bill is a workspace operation: it is the step
       * that creates membership, and the next thing you want after it is a set
       * time, which only the event page can give. Offering it here left the
       * organiser on a summary screen with a half-finished act.
       *
       * ⚠ ACCEPT went with it because ADD TO BILL already accepts as a side
       * effect (`planAddToBill.statusUpdate`), so a bare ACCEPT only moved a
       * row between tabs — the same reasoning that removed it from the event
       * page's PIPELINE.
       *
       * ⭐ Shortlist and decline STAY: deciding whether something is worth
       * your attention is what triage IS. Stripping those would leave a queue
       * you can read and not answer.
       */
      actions={
        <div className="yp-decision-row">
          {undecided && (
            <DecisionBtn tone="shortlist" icon={StarIcon} label="SHORTLIST"
              onClick={() => respond('shortlisted')} disabled={busy} />
          )}
          {bucket !== 'declined' && (
            <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
              onClick={() => respond('declined')} disabled={busy} />
          )}
        </div>
      }
    />
  );
}

