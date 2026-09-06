import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDashboardLanding } from '../lib/useDashboardLanding';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { cancelEnquiry } from '../lib/cancelEnquiry';
import { updateEnquiryStatus } from '../lib/updateEnquiryStatus';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { writeNotification } from '../lib/writeNotification';
import { planAcceptedEnquiry, draftEventForAcceptance } from '../lib/acceptedEnquiryEvent';
import { venueEventsFilter } from '../lib/eventOwnership';
import { planAddArtistToShortlist, addArtistToShortlist } from '../lib/shortlistFromArtist';
import { useSession, usePlayer } from '../App';
import { today } from '../lib/dates';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import InviteSheet from '../components/InviteSheet';
import { normaliseStatus, withDirection, clearedColumnFor } from '../lib/enquiryUtils';
import EnquiryPanel from '../components/EnquiryPanel';
import AvailabilitySection from '../components/AvailabilitySection';
import EnquiryCalendar from '../components/EnquiryCalendar';
import { CalendarIconBtn } from '../components/DecisionButtons';
import SectionCollapseButton from '../components/SectionCollapseButton';
import DashboardHeader from '../components/DashboardHeader';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import { bucketEvents, effectiveDate, UPCOMING, DRAFT, ARCHIVE } from '../lib/eventBuckets';
import EventsSection from '../components/EventsSection';
import QrCodesSection from '../components/QrCodesSection';
import { useDragScroll } from '../hooks/useDragScroll';
import s from './VenueDashboard.module.css';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { completionFor, firstUnsettled } from '@yespleez/requirements';
import { ENQUIRY_CARD_COLUMNS } from '../components/EnquiryCard';

// The card declares what it reads; this screen only joins it. Previously a
// hand-kept subset that omitted `fee`, `fee_type` and `contact_email` —
// columns the card has always read — so those rows silently never rendered.
const APPLICANT_COLS = ENQUIRY_CARD_COLUMNS.join(', ');

export default function VenueDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const { setPlayer } = usePlayer();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const [enquiries,      setEnquiries]      = useState([]);
  // Bumped when accepting closes a night — see onAccepted.
  const [availReload,    setAvailReload]    = useState(0);
  // ⛔ `localAvail` / `showAvailCal` are gone with VenueAvailCalendar —
  // AvailabilitySection owns availability state, its fetch and its modal now.
  // Keeping a copy here would have been the duplicate state the whole swap
  // exists to remove.
  const [calendarOpen,   setCalendarOpen]   = useState(false);
  // ⚠ DEFAULTS OPEN, matching Host's `showEnquiries`. It was `false`, which was
  // harmless while nothing read it — now that it actually gates the panel, a
  // false default would hide every enquiry on load.
  const [showAllEnq,     setShowAllEnq]     = useState(true);
  const [following,      setFollowing]      = useState([]);
  const [inviteArtist,   setInviteArtist]   = useState(null);
  const [loadingFollow,  setLoadingFollow]  = useState(false);
  const [followView,       setFollowView]       = useState('portrait'); // 'portrait' | 'landscape'
  const [followFilter,     setFollowFilter]     = useState('ALL');
  const [followingShowAll, setFollowingShowAll] = useState(false);
  const [followingSearch,  setFollowingSearch]  = useState('');
  // Discovery-bump key stays 'venue-dashboard-regulars' even though the
  // section is now FOLLOWING: it keys a persisted visit counter
  // (yp_hscroll_visits_*), so renaming it would replay the swipe hint for
  // everyone who has already seen it.
  const followingDrag = useDragScroll('venue-dashboard-regulars');
  // ⛔ `isNarrow` and its resize listener are gone with the availability chips.
  // They existed only to cap that list at 8 on narrow screens, and
  // AvailabilitySection applies the same cap itself — a resize listener kept
  // alive for a list this screen no longer renders is work done for nobody.

  const { data, isLoading: loading } = useQuery({
    queryKey: ['venueDashboard', userId],
    queryFn: async () => {
      /**
       * ⭐ PROFILE FIRST, THEN ENQUIRIES BY PROFILE (P11).
       *
       * This used to read `.eq('venue_user_id', userId)` — the ACCOUNT — so a
       * person owning two venues saw both venues' enquiries merged on either
       * dashboard. Exactly the cross-over ArtistDashboard already removed from
       * the applicant side: "falling back to the account key would reinstate
       * the cross-over. That clause is the bug: it is what shows one profile's
       * work on another."
       *
       * It matters more from P11 onward: once one person's two ACTS can each
       * enquire about the same date, this screen is where that ambiguity shows
       * up, and it must at least be showing the right venue's enquiries.
       *
       * The sequencing is the cost — the enquiry fetch needs the profile id, so
       * it can no longer run in the same parallel batch.
       */
      const profRes = await supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'venue').maybeSingle();
      const venueProfileId = profRes.data?.id ?? null;

      const [availRes, enqRes, evtRes] = await Promise.all([
        supabase.from('venue_availability').select('available_date').eq('user_id', userId).gte('available_date', today()).order('available_date').limit(10),
        /**
         * ⛔ No account-key fallback when there is no venue profile yet. An
         * empty list is the correct answer — falling back to `venue_user_id`
         * here would reinstate the merge for exactly the accounts most likely
         * to notice it.
         */
        venueProfileId
          /* ⚠ S5 · THIS VENUE'S OWN CLEARED ROWS NEVER ARRIVE — and ⛔ only
             its own: `applicant_cleared_at` is the ASKER's marker and must not
             be read here, or one side tidying its list would empty the
             other's. Filtered in the query so a hidden row cannot be counted
             by a tab or consume the 100-row limit. */
          ? supabase.from('venue_enquiries').select('*').eq('venue_profile_id', venueProfileId).is('venue_cleared_at', null).order('created_at', { ascending: false }).limit(100)
          : Promise.resolve({ data: [] }),
        /* ⭐⭐ THIS VENUE'S EVENTS, ⛔ NOT THIS ACCOUNT'S. Was
           `.eq('host_id', userId)` under the note "approximated with host_id
           for now" — and `host_id` is the account, so every profile on it
           shared one event list. See `venueEventsFilter` for what each arm is
           holding up; ⛔ the `venue_profile_id` arm in particular is what keeps
           a night somebody ELSE owns but holds here on this dashboard. */
        supabase.from('events').select('id, name, status, config, applications_open, is_public, created_at')
          .or(venueEventsFilter(userId, venueProfileId))
          .order('created_at', { ascending: false }).limit(200),
      ]);

      // Batch-fetch applicant profiles so EnquiryCard skips per-card Supabase calls.
      // M5.1 (D3): resolve by the enquiry row's applicant_profile_id (an id names
      // exactly the typed profile the old user_id+type key-pair approximated);
      // legacy join kept only for rows without one.
      // This screen reads the table from the venue's side: an applicant-initiated
      // row is incoming here, a venue-initiated one is outgoing. `direction` is
      // derived, never stored — see enquiryUtils.deriveDirection.
      const enqs = withDirection(enqRes.data, 'venue');
      const pidEnqs = enqs.filter(e => e.applicant_profile_id);
      const uidEnqs = enqs.filter(e => !e.applicant_profile_id && e.applicant_user_id);
      const [pidProfs, uidProfs] = await Promise.all([
        pidEnqs.length ? supabase.from('profiles').select(APPLICANT_COLS).in('id', pidEnqs.map(e => e.applicant_profile_id)) : Promise.resolve({ data: [] }),
        uidEnqs.length ? supabase.from('profiles').select(APPLICANT_COLS).in('user_id', uidEnqs.map(e => e.applicant_user_id)) : Promise.resolve({ data: [] }),
      ]);
      const applicantById = {}; (pidProfs.data || []).forEach(p => { applicantById[p.id] = p; });
      // Legacy fallback map: key by user_id + type so multi-profile users don't bleed
      const applicantProfileMap = {};
      (uidProfs.data || []).forEach(p => { applicantProfileMap[`${p.user_id}_${p.type}`] = p; });

      return {
        profile:      profRes.data,
        availability: (availRes.data || []).map(r => r.available_date),
        enquiries:    enqs.map(e => ({
          ...e,
          profile: applicantById[e.applicant_profile_id]
                || applicantProfileMap[`${e.applicant_user_id}_${e.applicant_type}`]
                || applicantProfileMap[`${e.applicant_user_id}_artist`]
                || null,
        })),
        upcomingEvts: evtRes.data || [],
      };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const events       = data?.upcomingEvts || [];
  /**
   * ⛔⛔ WAS THE UTC EXPRESSION AGAIN — `new Date().toISOString().split('T')[0]`,
   * the third copy of it, deciding whether a venue's event had happened. In
   * AEST that reads as YESTERDAY every morning until 10am.
   *
   * ⭐ `lib/eventBuckets` is the one rule now, shared with the host dashboard,
   * so the two cannot disagree about which of the SAME events are past.
   */
  const venueBuckets   = bucketEvents(events);
  const byDateAsc      = (a, b) => effectiveDate(a).localeCompare(effectiveDate(b));
  const byDateDesc     = (a, b) => effectiveDate(b).localeCompare(effectiveDate(a));
  const upcomingEvents = [...venueBuckets[UPCOMING]].sort(byDateAsc);
  const draftEvents    = [...venueBuckets[DRAFT]].sort(byDateAsc);
  const pastEvents     = [...venueBuckets[ARCHIVE]].sort(byDateDesc);

  // ⛔ `toggleDate` removed with VenueAvailCalendar. AvailabilitySection owns
  // the write, using the same table and the venue's own conflict target — one
  // writer instead of two that had already drifted (this one deleted by
  // `user_id`, the shared one by `profile_id`).

  // enquiries kept in local state so optimistic respond() updates work
  const allEnquiries = enquiries.length ? enquiries : (data?.enquiries || []);

  /**
   * ⭐ CLEAR — the venue tidying a declined row out of ITS OWN list (S5).
   *
   * ⛔ `venue_cleared_at`, never the applicant's column — `clearedColumnFor`
   * picks it from the row and the viewer so this screen cannot hide something
   * from the person on the other side. Optimistic locally, then refetched.
   */
  async function handleClearEnquiry(enqOrList) {
    const list = (Array.isArray(enqOrList) ? enqOrList : [enqOrList]).filter(Boolean);
    if (!list.length) return;
    /* ⚠ ONE ROUND TRIP, so a sweep cannot half-finish and leave the list in a
       state neither the user nor the next render can explain. Grouped by
       column because a single sweep can in principle contain rows from both
       sides — today it cannot, and relying on that would be the assumption
       that breaks when it can. */
    const byCol = {};
    for (const e of list) {
      const col = clearedColumnFor(e, profile?.id);
      (byCol[col] ||= []).push(e.id);
    }
    const now = new Date().toISOString();
    await Promise.all(Object.entries(byCol).map(([col, ids]) =>
      supabase.from('venue_enquiries').update({ [col]: now }).in('id', ids)));
    const gone = new Set(list.map(e => e.id));
    setEnquiries(allEnquiries.filter(e => !gone.has(e.id)));
  }

  async function handleEnquiryRespond(id, status) {
    /**
     * ⛔⛔ CANCELLING IS NOT A STATUS WRITE, AND TREATING IT AS ONE MADE THE
     * VENUE'S CANCEL DO NOTHING VISIBLE (2026-09-01).
     *
     * ⚠⚠ The generic write below sets `status` and NOTHING ELSE. For a venue
     * withdrawing an offer it SENT that left `venue_cleared_at` null, and this
     * screen fetches with `.is('venue_cleared_at', null)` — so the row came
     * straight back, and with no `cancelled` key in the outgoing status map it
     * came back into AWAITING. The write worked; the row looked untouched.
     *
     * ⭐ `cancelEnquiry` owns the whole act: the correct cleared column for the
     * side that is acting, the duplicate guard, and the notice to the OTHER
     * party. ⛔ Do not re-implement any of it here — three screens open-coding
     * this is how the first cancel bug happened.
     */
    if (status === 'cancelled') {
      const row = allEnquiries.find(e => e.id === id);
      if (!row || !profile?.id) return;
      const { error } = await cancelEnquiry(row, profile.id, profile.name);
      if (error) return;
      setEnquiries(allEnquiries.filter(e => e.id !== id));
      return;
    }
    /**
     * ⛔⛔ THE WRITE IS VERIFIED, AND EVERYTHING BELOW DEPENDS ON IT.
     *
     * This was a bare `await …update({ status }).eq('id', id)` that inspected
     * NOTHING — not even `error`. RLS filters an UPDATE rather than erroring
     * it, so a refused decision still moved the card, still ran `onAccepted`
     * (which creates a draft event or puts the act on an existing one) and
     * still told the artist their enquiry was accepted, while the row itself
     * stayed pending.
     *
     * ⭐ The early return is what makes those three unreachable rather than
     * merely skipped, and it matches the `cancelled` branch immediately above,
     * which already returns silently when `cancelEnquiry` reports a failure.
     * ⚠ This screen has no error banner; leaving the card where it was is the
     * honest outcome, because it does not claim a decision that did not land.
     */
    const res = await updateEnquiryStatus(id, status);
    if (!res.ok) return;
    setEnquiries(allEnquiries.map(e => e.id === id ? { ...e, status } : e));
    const enq = allEnquiries.find(e => e.id === id);
    if (!enq) return;
    /* ⭐ Accepting is the moment the night becomes real. Everything the
       acceptance produces lives in one place so the order is legible, and it
       runs BEFORE the notification so the artist's "You're booked!" cannot
       arrive pointing at a night that does not exist yet. */
    if (status === 'accepted') await onAccepted(enq);
    const artistId  = enq.applicant_user_id;
    const venueName = enq.venue_name || 'A venue';
    const eventName = enq.event_name || null;
    const NOTIF = {
      shortlisted: { type: 'shortlisted',         message: `${venueName} shortlisted you${eventName ? ` for ${eventName}` : ''}.` },
      /* ⛔⛔ "YOU'RE BOOKED!" WAS FALSE AND IT SET THE WRONG EXPECTATION AT THE
         WORST MOMENT. Acceptance opens the booking relationship; it agrees no
         fee, creates no event and holds no slot. An act that reads "you're
         booked" stops chasing terms, and the first thing they learn otherwise
         is when the night does not happen. ⭐ Says what is true and what is
         next — the same two things the card now says. */
      accepted:    { type: 'booking_confirmed',    message: `${venueName} accepted your enquiry${eventName ? ` for ${eventName}` : ''}. Next: agree the booking details.` },
      booked:      { type: 'booking_confirmed',    message: `${venueName} confirmed your booking${eventName ? ` for ${eventName}` : ''}.` },
      declined:    { type: 'application_declined', message: `${venueName} passed on your application${eventName ? ` for ${eventName}` : ''}.` },
      /* ⛔⛔ THERE WAS AN `interested:` KEY HERE AND IT COULD NEVER FIRE. This
         map is `NOTIF[status]` — keyed on the RAW status being written — and
         `interested` is a BUCKET, the asker's name for the state this side
         calls `shortlisted`. It is a map VALUE in enquiryUtils, never a key,
         and the decision button writes `shortlisted` (EnquiryCard). So the
         asker was already told by the `shortlisted` entry above, and this one
         was dead vocabulary that made the raw column look like it could hold a
         bucket name. ⛔ Do not add it back: if the wording above is ever wrong,
         fix the wording. */
    };
    const notif = NOTIF[status];
    if (notif && artistId) {
      /**
       * §A7: about = this venue's profile (whose decision this is);
       * to = the profile that ASKED.
       *
       * ⭐⭐ THE ROW ALREADY NAMES THEM — `applicant_profile_id`. It used to be
       * re-derived with `resolvePerformerProfileId(artistId)`, which answers
       * "which act does this account perform as", and that is a different
       * question. For a HOST who enquired about a room it returns their DJ act,
       * or null: the venue's reply arrives addressed to a profile that never
       * asked, or to nobody. Same class of defect as `acceptInvite` losing
       * attribution (D1, 2026-08-10), same fix — read the identity the record
       * states rather than computing one beside it.
       *
       * The seam stays only for legacy rows written before the column was
       * populated, and even then it is honest: a performer-only account is what
       * it was ever right for.
       */
      await writeNotification({
        toUserId:       artistId,
        toProfileId:    enq.applicant_profile_id
                          ?? (await resolvePerformerProfileId(artistId)).profileId
                          ?? null,
        aboutProfileId: profile?.id ?? null,
        type:    notif.type,
        message: notif.message,
        /* ⭐ `applicant_type` and `event_id` are here so the row can NAME its
           own destination — notifDestination derives the link from what the
           row carries and must never guess. Without them a booking notice was
           inert: the enquirer read "You're booked!" with nowhere to press.
           ⚠ `event_id` is usually null (a direct date enquiry has no event),
           which is why the type alone could never answer this. */
        data:    {
          event_name: eventName, venue_name: venueName, enquiry_id: id,
          applicant_type: enq.applicant_type ?? null,
          event_id: enq.event_id ?? null,
        },
      });
    }
  }

  /**
   * ── ⭐⭐ WHAT ACCEPTING PRODUCES ─────────────────────────────────────────
   *
   * Two things, both of which the organiser would otherwise have to do by
   * hand and one of which they would forget:
   *
   *   1. THE NIGHT EXISTS. A draft event, or the act joining the one already
   *      there — see `planAcceptedEnquiry` for why the second case is the
   *      whole feature and not an edge case.
   *   2. THE DATE CLOSES. An accepted night is spoken for, so it stops being
   *      offered to everyone else.
   *
   * ⚠ NEITHER IS FATAL. The status is already saved; a failure here costs an
   * automation, ⛔ not the decision the organiser just made. Errors are
   * swallowed deliberately rather than sent back to a screen whose write has
   * already landed.
   */
  async function onAccepted(enq) {
    const date = enq.date_requested || null;
    const actId = enq.applicant_profile_id || null;
    try {
      /* ⭐⭐ THE DATE STOPS BEING AVAILABLE — the rule that makes this safe.
         Once somebody is accepted for a night, nobody else may enquire about
         it, so the published date goes. ⛔ SHORTLISTING DOES NOT DO THIS: a
         shortlist is interest, not a booking, and the night is still open.
         ⚠ It is a DELETE of published data, so it does not come back on its
         own if the booking later falls through — the organiser re-adds the
         date, which is the same act as offering it in the first place. */
      if (date && profile?.id) {
        await supabase.from('venue_availability')
          .delete().eq('profile_id', profile.id).eq('available_date', date);
        setAvailReload(n => n + 1);
      }

      const plan = planAcceptedEnquiry({
        viewerType: profile?.type,
        otherType:  enq.profile?.type || enq.applicant_type,
        date,
        venueProfileId: profile?.id,
        events,
        hasEventAlready: !!enq.event_id,
      });
      if (plan.action === 'none' || !actId) return;

      let eventId = plan.event?.id ?? null;
      if (plan.action === 'create') {
        const { data: created, error } = await supabase.from('events')
          .insert(draftEventForAcceptance({
            actName:   enq.profile?.name || enq.applicant_name || null,
            venueName: profile?.name || null,
            date,
            venueProfileId:  profile.id,
            ownerProfileId:  profile.id,
            userId:          session.user.id,
          }))
          .select('id').single();
        if (error || !created?.id) return;
        eventId = created.id;
      }

      /* ⭐⭐ THE ENQUIRY NOW NAMES ITS EVENT. Without this the draft exists but
         nothing points at it, so the card would keep saying CREATE EVENT and
         a second press would make a SECOND event for the same night — the
         duplicate the whole guard exists to prevent, reintroduced one step
         later. It is also what turns the button into EDIT EVENT. */
      await supabase.from('venue_enquiries').update({ event_id: eventId }).eq('id', enq.id);
      setEnquiries(prev => prev.map(e => (e.id === enq.id ? { ...e, event_id: eventId } : e)));

      /* ⭐ The act joins through the SAME planner every other surface uses, so
         a night made by acceptance holds acts the identical way a night made
         by hand does. ⛔ Shortlist, never the bill — being accepted for a date
         is not the same as being offered a slot. */
      const { data: members } = await supabase.from('lineup_members')
        .select('id, event_id, artist_id, artist_profile_id, status').eq('event_id', eventId);
      const memberPlan = planAddArtistToShortlist(enq.profile || { id: actId }, eventId, members || []);
      if (memberPlan.ok) await addArtistToShortlist(supabase, memberPlan);
    } catch {
      /* ⛔ Swallowed on purpose — see the note above. */
    }
  }

  /* ⭐ Arriving from a link — VIEW OUTGOING ENQUIRIES after sending an invite,
     or a notification. Same reader as the other dashboards, so `?section=` and
     `?tab=` mean one thing everywhere. ⚠ The direction seeds the panel's own
     state, so it must be read BEFORE the panel mounts, not scrolled to after. */
  const [searchParams] = useSearchParams();
  const enqDirLanding = ['INCOMING', 'OUTGOING', 'BOOKED']
    .includes(searchParams.get('tab')) ? searchParams.get('tab') : 'INCOMING';
  useDashboardLanding(({ elementId }) => scrollToSection(elementId));

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.35, behavior: 'smooth' });
  }

  // Load following list
  useEffect(() => {
    if (!userId) return;
    setLoadingFollow(true);
    (async () => {
      // M5.1 (D6): followed profiles resolve by target_profile_id; legacy
      // entity_id join only for rows without one.
      const { data: rows } = await supabase.from('follows')
        .select('entity_id, target_profile_id').eq('user_id', userId).neq('entity_type', 'event');
      const fPids = [...new Set((rows || []).filter(r => r.target_profile_id).map(r => r.target_profile_id))];
      const fLegacy = [...new Set((rows || []).filter(r => !r.target_profile_id).map(r => r.entity_id).filter(Boolean))];
      if (!fPids.length && !fLegacy.length) { setLoadingFollow(false); return; }
      const fCols = 'id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, suburb, state, bio';
      const [fPidRes, fUidRes] = await Promise.all([
        fPids.length ? supabase.from('profiles').select(fCols).in('id', fPids) : Promise.resolve({ data: [] }),
        fLegacy.length ? supabase.from('profiles').select(fCols).in('user_id', fLegacy) : Promise.resolve({ data: [] }),
      ]);
      const seen = {};
      // ⚠ ONE KEYSPACE OUT — PROFILE ID. See ArtistDashboard's loader: storing
      // `seen[p.id]` beside `seen[p.user_id]` let a profile reachable through
      // both follow keyspaces enter the list twice. Legacy rows still collapse
      // per USER first (one legacy follow, one card, punter last), and only the
      // winner is merged in by profile id.
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      const legacyByUser = {};
      (fUidRes.data || []).forEach(p => { if (!legacyByUser[p.user_id] || p.type !== 'punter') legacyByUser[p.user_id] = p; });
      Object.values(legacyByUser).forEach(p => { seen[p.id] = p; });
      setFollowing(Object.values(seen));
      setLoadingFollow(false);
    })();
  }, [userId]);

  const hasProfile   = !!profile;
  const enquiryCount = allEnquiries.length;
  // ⚠ STILL READ FROM THE DASHBOARD'S OWN QUERY, not from AvailabilitySection.
  // The stat card needs a count before that section has mounted or fetched,
  // and a component that owns an editor should not also be the source other
  // widgets read. Same table, same rows — one number, fetched where it is
  // needed, which is not duplicate STATE.
  const availCount   = (data?.availability || []).length;

  // Shared requirements engine — see lib/requirements.js. Same thirteen fields
  // as the closure this replaces.
  const completion = completionFor(profile, 'venue');
  const completionPct = completion?.pct ?? 0;
  // O4 · the next thing worth adding; registry order is priority order.
  const nextStep = firstUnsettled(completion?.items);

  return (
    <div className={s.screen}>
      <DashboardHeader line1="VENUE" line2="DASHBOARD" userId={userId} profileId={profile?.id} profileType="venue" gradient={PROFILE_TYPES.venue.gradient} />

      <DashboardProfileCard
        profile={profile}
        profileType="venue"
        accent={PROFILE_TYPES.venue.accent}
        gradient={PROFILE_TYPES.venue.gradient}
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
        setupRoute="/industry/venue/setup"
        subtitle={profile?.location || 'Add your venue details so promoters can find you'}
        genres={profile?.sound}
        completionPct={hasProfile ? completionPct : undefined}
        nextStep={hasProfile ? nextStep : null}
      />

      {(() => {
        const newEnq = allEnquiries.filter(e => (e.direction || 'incoming').toLowerCase() === 'incoming' && normaliseStatus(e) === 'new').length;
        return <NotificationBar message={newEnq > 0 ? `${newEnq} NEW ENQUIR${newEnq !== 1 ? 'IES' : 'Y'} — TAP TO REVIEW` : null} onClick={() => scrollToSection('section-enquiries')} />;
      })()}

      <DashboardStats accent={PROFILE_TYPES.venue.accent} accentRgb={PROFILE_TYPES.venue.rgb} stats={[
        { label: 'EVENTS',       value: loading ? '—' : events.length, sectionId: 'section-events' },
        { label: 'ENQUIRIES',    value: loading ? '—' : enquiryCount,  sectionId: 'section-enquiries' },
        { label: 'AVAIL. DATES', value: loading ? '—' : availCount,    sectionId: 'section-availability' },
      ]} />

      {/* Events */}
      <EventsSection
        ownerType="venue"
        tabs={{ UPCOMING: upcomingEvents, DRAFT: draftEvents, ARCHIVE: pastEvents }}
        loading={loading}
        accent="#00E5A0"
      />

      {/* ── AVAILABILITY ──
          ⭐⭐ THE SHARED SECTION, replacing this screen's own `VenueAvailCalendar`
          — a third calendar with its own grid, own day labels and own month
          logic, which meant every fix made to the real one stopped at the venue
          border. It never got the fixed six-row height, so its chevrons moved
          as you paged months, and it could not be handed application dots at
          all.

          ⚠ `conflictTarget` IS NOT OPTIONAL HERE. venue_availability is
          UNIQUE (user_id, available_date) while the performer table is
          UNIQUE (profile_id, available_date) — the default target names
          columns this table has no constraint on, and the upsert would throw
          on every toggle.

          ⭐ ENQUIRIES PASSED for the same reason the host's are: a venue with
          16 open enquiries could mark a date free with nothing on screen to
          say anything was already against it. */}
      <div id="section-availability">
        <AvailabilitySection
          userId={userId}
          profileId={profile?.id}
          table="venue_availability"
          /* Accepting an enquiry closes that night from outside this section. */
          reloadKey={availReload}
          conflictTarget="user_id,available_date"
          accent="#00E5A0"
          accentRgb="0,229,160"
          enquiries={allEnquiries}
        />
      </div>

      {/* Enquiries */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        {/* ⚠ THE SAME CONTROL HOST USES, not a lookalike — see
            SectionCollapseButton for why it stopped being inline markup.

            ⛔ IT REPLACES A "View all >" LINK THAT DID NOTHING. `showAllEnq`
            was declared, flipped by that link and read by nothing but its own
            label — so the only effect of pressing it was to change its own
            wording. The panel never expanded or collapsed. This wires the
            heading to something real. */}
        <Section
          title="ENQUIRIES"
          headingAction={<CalendarIconBtn onClick={() => setCalendarOpen(true)} label="Open the enquiry calendar" />}
          trailing={<SectionCollapseButton expanded={showAllEnq} onToggle={() => setShowAllEnq(v => !v)} />}
        >
          {showAllEnq && (
            <EnquiryPanel
              enquiries={allEnquiries}
              viewerProfile={profile}
              /* ⭐ A venue owns events, so it may be offered ADD TO EVENT on an
                 accepted enquiry. ⚠ The account id, because this dashboard's
                 own events are keyed on `events.host_id`. */
              viewerUserId={userId}
              initialDirTab={enqDirLanding}
              onRespond={handleEnquiryRespond}
              onClear={handleClearEnquiry}
              onPlayDemo={setPlayer}
            />
          )}
        </Section>

        {/* ⚠ ON DEMAND, NEVER RESIDENT — the same modal AVAILABLE DATES opens,
            handed the private overlay. Mounted only while open so it holds no
            page space and re-reads availability each time. */}
        {calendarOpen && (
          <EnquiryCalendar
            profileId={profile?.id}
            table="venue_availability"
            enquiries={allEnquiries}
            accent="#00E5A0"
            accentRgb="0,229,160"
            onClose={() => setCalendarOpen(false)}
          />
        )}
      </div>

      {/* ⭐ QR1 · QR codes live INSIDE the dashboard, beside the events and
          enquiries they belong to. ⛔ Not a top-level area, and the bottom
          navigation is untouched — it is permanent. */}
      <QrCodesSection ownedProfiles={profile ? [profile] : []} userId={userId} accent="#00E5A0" />

      {/* Following —
          ⛔ NO WRAPPER MARGIN. The gap is FollowingSection's own
          `FOLLOWING_GAP`, shared by every screen that renders it (owner,
          2026-08-15). See the note in that component for why one owner beats
          two: these margins collapse rather than add. */}
      <FollowingSection
        following={following}
        loading={loadingFollow}
        followView={followView}
        setFollowView={setFollowView}
        followFilter={followFilter}
        setFollowFilter={setFollowFilter}
        followShowAll={followingShowAll}
        setFollowShowAll={setFollowingShowAll}
        followSearch={followingSearch}
        setFollowSearch={setFollowingSearch}
        followDrag={followingDrag}
        emptyMsg="Follow artists from their profiles to build your roster here."
        filterTypes={FOLLOW_FILTER_CONFIGS.venue}
        actions={p => (
          <button
            onClick={() => setInviteArtist(p)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,229,160,.4)', background: 'rgba(0,229,160,.08)', color: '#00E5A0', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s' }}
          >INVITE →</button>
        )}
      />

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
      >BROWSE ENTERTAINMENT →</button>

      {inviteArtist && (
        <InviteSheet
          artist={inviteArtist}
          events={events.filter(ev => ev.status !== 'completed')}
          venueUserId={userId}
          /* The dashboard already loaded this venue's profile row — and here
             the sender is NOT a choice: this screen IS one venue's dashboard,
             so passing the list would offer to send from a room the user did
             not open. One option, stated. */
          venueProfileId={profile?.id ?? null}
          venueProfiles={profile ? [{ id: profile.id, name: profile.name }] : null}
          onClose={() => setInviteArtist(null)}
        />
      )}
    </div>
  );
}


/* ⛔ `DateChip` deleted with the availability block it served. AvailabilitySection
   renders its own chips — keeping a second, near-identical chip here is how the
   two calendars drifted apart in the first place. */

function Section({ title, subtitle, action, onAction, headingAction, trailing, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5 }}>
            <span style={{ color: '#fff' }}>{title}</span>
          </p>
          {/* Sits BESIDE the heading, before the subtitle — the same position
              the calendar icon takes on the host dashboard's ENQUIRIES and on
              AVAILABLE DATES, so one calendar reads as one control wherever it
              is opened from. Distinct from `action`, which is the right-aligned
              "View all >" text link. */}
          {headingAction}
          {subtitle && <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.3 }}>{subtitle}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {action && <button onClick={onAction} className={s.viewAllBtn}>{action}</button>}
        {/* Far right, after any "View all" link — the minimise/maximise control
            sits in the same position on every dashboard section. */}
        {trailing}
      </div>
      {children}
    </div>
  );
}


