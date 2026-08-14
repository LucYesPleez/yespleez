import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { writeNotification } from '../lib/writeNotification';
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
import EventsSection from '../components/EventsSection';
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
        // Upcoming events where config->venue matches profile name — approximated with host_id for now
        supabase.from('events').select('id, name, status, config, applications_open, is_public, created_at').eq('host_id', userId).order('created_at', { ascending: false }).limit(200),
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
  const todayStr     = new Date().toISOString().split('T')[0];
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && ev.status !== 'completed' && (ev.config?.date || '') >= todayStr)
                               .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  const draftEvents    = events.filter(ev => ev.status === 'draft');
  const pastEvents     = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') < todayStr)
                               .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));

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
    await supabase.from('venue_enquiries').update({ status }).eq('id', id);
    setEnquiries(allEnquiries.map(e => e.id === id ? { ...e, status } : e));
    const enq = allEnquiries.find(e => e.id === id);
    if (!enq) return;
    const artistId  = enq.applicant_user_id;
    const venueName = enq.venue_name || 'A venue';
    const eventName = enq.event_name || null;
    const NOTIF = {
      shortlisted: { type: 'shortlisted',         message: `${venueName} shortlisted you${eventName ? ` for ${eventName}` : ''}.` },
      accepted:    { type: 'booking_confirmed',    message: `${venueName} accepted you${eventName ? ` for ${eventName}` : ''}. You're booked!` },
      booked:      { type: 'booking_confirmed',    message: `${venueName} confirmed your booking${eventName ? ` for ${eventName}` : ''}.` },
      declined:    { type: 'application_declined', message: `${venueName} passed on your application${eventName ? ` for ${eventName}` : ''}.` },
      interested:  { type: 'shortlisted',          message: `${venueName} is interested in your enquiry${eventName ? ` for ${eventName}` : ''}.` },
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
        data:    { event_name: eventName, venue_name: venueName, enquiry_id: id },
      });
    }
  }

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
        tabs={{ UPCOMING: upcomingEvents, DRAFTS: draftEvents, PAST: pastEvents }}
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


