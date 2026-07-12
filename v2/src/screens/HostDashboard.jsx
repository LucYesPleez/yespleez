import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { useSession } from '../App';
import s from './HostDashboard.module.css';
import ds from './DiscoverScreen.module.css';
import GlobalEventCard from '../components/EventCard';
import ProfileCard from '../components/ProfileCard';
import { getEventBadges } from '../lib/eventBadges';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import EnquiryPanel from '../components/EnquiryPanel';
import DashboardHeader from '../components/DashboardHeader';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import AvailabilitySection from '../components/AvailabilitySection';
import EventsSection from '../components/EventsSection';
import { useDragScroll } from '../hooks/useDragScroll';

export default function HostDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const userId = userIdProp || session?.user?.id;
  const navigate = useNavigate();

  const [showAllLineup,  setShowAllLineup]  = useState(true);
  const [lineupFocusId,  setLineupFocusId]  = useState(null);  // null = show all
  const [lineupExpandMap, setLineupExpandMap] = useState({});  // eventId → bool (default true)
  const [lineupSubTabs,  setLineupSubTabs]  = useState({});   // eventId → 'SET TIMES'|'SHORT LIST'|'PIPELINE'
  const [setTimesMap,    setSetTimesMap]    = useState({});   // eventId → bool
  const [allApps,        setAllApps]        = useState([]);
  const [appProfiles,    setAppProfiles]    = useState({});
  const [loadingApps,    setLoadingApps]    = useState(false);
  const [lineups,        setLineups]        = useState([]);
  const [loadingLineups, setLoadingLineups] = useState(false);
  const [claimsMap,      setClaimsMap]      = useState({});   // eventId → { slotId → claim }
  const [editingSlot,   setEditingSlot]    = useState(null); // { ev, dayIdx, slotIdx, slot }
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
      const [profRes, evtRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'host').limit(1).maybeSingle(),
        supabase.from('events').select('id, name, status, config, applications_open, is_public, created_at')
          .eq('host_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      const evtIds = (evtRes.data || []).map(e => e.id);
      let newAppsCount = 0, lineupSlotsCount = 0;
      if (evtIds.length) {
        const [pendingRes, acceptedRes] = await Promise.all([
          supabase.from('applications').select('id', { count: 'exact', head: true }).in('event_id', evtIds).eq('status', 'pending'),
          supabase.from('applications').select('id', { count: 'exact', head: true }).in('event_id', evtIds).eq('status', 'accepted'),
        ]);
        newAppsCount      = pendingRes.count  || 0;
        lineupSlotsCount  = acceptedRes.count || 0;
      }
      return {
        profile: profRes.data || null,
        events:  evtRes.data  || [],
        newAppsCount,
        lineupSlotsCount,
      };
    },
    enabled: !!userId,
  });

  const profile          = data?.profile          || null;
  const events           = data?.events           || [];
  const newAppsCount     = data?.newAppsCount     ?? null;
  const lineupSlotsCount = data?.lineupSlotsCount ?? null;

  // Load applications on mount
  useEffect(() => {
    if (!userId || appsLoaded.current) return;
    appsLoaded.current = true;
    setLoadingApps(true);
    async function loadApps() {
      const { data: evIds } = await supabase.from('events').select('id').eq('host_id', userId);
      if (!evIds?.length) { setLoadingApps(false); return; }
      const ids = evIds.map(e => e.id);
      const { data: apps } = await supabase.from('applications')
        .select('*').in('event_id', ids).order('created_at', { ascending: false });
      setAllApps(apps || []);
      const artistIds = [...new Set((apps || []).map(a => a.artist_id).filter(Boolean))];
      if (artistIds.length) {
        const { data: profs } = await supabase.from('profiles')
          .select('user_id, name, avatar, type, sound, genre_string, location, bio, mix_link, card_pills').in('user_id', artistIds);
        const map = {};
        (profs || []).forEach(p => { map[p.user_id] = p; });
        setAppProfiles(map);
      }
      setLoadingApps(false);
    }
    loadApps();
  }, [userId]);

  // Load lineups lazily — triggered by BOOKED tab or LINEUP section scroll
  useEffect(() => {
    if (!userId || lineupsLoaded.current) return;
    lineupsLoaded.current = true;
    setLoadingLineups(true);
    async function loadLineups() {
      const { data: evRows } = await supabase.from('events')
        .select('id, name, config, status').eq('host_id', userId);
      if (!evRows?.length) { setLoadingLineups(false); return; }
      const ids = evRows.map(e => e.id);
      const { data: apps } = await supabase.from('applications')
        .select('*').in('event_id', ids).eq('status', 'accepted').order('created_at', { ascending: false });
      const artistIds = [...new Set((apps || []).map(a => a.artist_id).filter(Boolean))];
      let profMap = {};
      if (artistIds.length) {
        const { data: profs } = await supabase.from('profiles')
          .select('user_id, name, avatar, type, sound, genre_string, location, bio').in('user_id', artistIds);
        (profs || []).forEach(p => { profMap[p.user_id] = p; });
      }
      const evtMap = {};
      evRows.forEach(e => { evtMap[e.id] = e; });
      const grouped = {};
      (apps || []).forEach(a => {
        if (!grouped[a.event_id]) grouped[a.event_id] = { event: evtMap[a.event_id], artists: [] };
        grouped[a.event_id].artists.push({ ...a, profile: profMap[a.artist_id] });
      });
      const grouped2 = Object.values(grouped).filter(g => g.event);
      setLineups(grouped2);

      if (ids.length) {
        const [{ data: membersData }, { data: perfsData }] = await Promise.all([
          supabase.from('lineup_members').select('id, event_id, artist_id, artist_name, genre, sound, card_pills').in('event_id', ids).neq('status', 'removed'),
          supabase.from('performances').select('lineup_member_id, slot_id, event_id').in('event_id', ids).neq('status', 'declined'),
        ]);
        const membersById = {};
        (membersData || []).forEach(m => { membersById[m.id] = m; });
        const cm = {};
        (perfsData || []).forEach(p => {
          if (!p.slot_id) return;
          const member = membersById[p.lineup_member_id];
          if (!member) return;
          if (!cm[p.event_id]) cm[p.event_id] = {};
          cm[p.event_id][p.slot_id] = { ...member, name: member.artist_name, user_id: member.artist_id };
        });
        setClaimsMap(cm);
      }

      // Init set-times map: true = show set times (default on when days exist)
      const stMap = {};
      grouped2.forEach(({ event: ev }) => { stMap[ev.id] = (ev.config?.days?.length ?? 0) > 0; });
      setSetTimesMap(stMap);
      setLoadingLineups(false);
    }
    loadLineups();
  }, [userId]);

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
      // Dedupe (legacy rows only), preferring venue/artist over punter
      const seen = {};
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      (fUidRes.data || []).forEach(p => {
        if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p;
      });
      setFollowing(Object.values(seen));
      setLoadingFollowing(false);
    }
    loadFollowing();
  }, [userId]);

  async function respondApp(appId, status, artistId, eventName) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    if (!artistId) return;
    const evLabel = eventName ? ` for ${eventName}` : '';
    const NOTIF = {
      accepted:  { type: 'booking_confirmed',    message: `You've been accepted${evLabel}. You're booked!` },
      tentative: { type: 'shortlisted',          message: `You've been shortlisted${evLabel}.` },
      rejected:  { type: 'application_declined', message: `Your application was unsuccessful${evLabel}.` },
    };
    const notif = NOTIF[status];
    if (notif) await writeNotification(artistId, notif.type, notif.message, { event_name: eventName });
  }

  function toggleSetTimes(evId) {
    setSetTimesMap(prev => ({ ...prev, [evId]: !prev[evId] }));
  }

  async function saveSlot(ev, dayIdx, slotIdx, updated) {
    const newDays = ev.config.days.map((day, di) =>
      di !== dayIdx ? day : {
        ...day,
        slots: day.slots.map((sl, si) => si !== slotIdx ? sl : { ...sl, ...updated }),
      }
    );
    const newConfig = { ...ev.config, days: newDays };
    await supabase.from('events').update({ config: newConfig }).eq('id', ev.id);
    setLineups(prev => prev.map(g =>
      g.event.id !== ev.id ? g : { ...g, event: { ...g.event, config: newConfig } }
    ));
    setEditingSlot(null);
  }

  // Event map for app cards
  const evtMap = Object.fromEntries(events.map(e => [e.id, e]));

  // Pre-compute event lists
  const todayStr    = new Date().toISOString().split('T')[0];
  const draftEvents    = events.filter(ev => ev.status === 'draft');
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && ev.status !== 'completed' && (ev.config?.date || '') >= todayStr)
                               .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  const pastEvents     = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') < todayStr)
                               .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
  // Pre-compute application lists
  const newApps       = allApps.filter(a => a.status === 'pending');
  const tentativeApps = allApps.filter(a => a.status === 'tentative');
  const acceptedApps  = allApps.filter(a => a.status === 'accepted');
  const declinedApps  = allApps.filter(a => a.status === 'rejected' || a.status === 'declined');

  // Map applications to the common enquiry shape for EnquiryPanel
  const mappedEnquiries = allApps.map(app => ({
    id: app.id,
    direction: 'incoming',
    status: app.status,
    applicant_user_id: app.artist_id,
    applicant_type: appProfiles[app.artist_id]?.type || 'artist',
    name: appProfiles[app.artist_id]?.name || app.artist_name || '',
    event_name: evtMap[app.event_id]?.name || '',
    date_requested: evtMap[app.event_id]?.config?.date || null,
    created_at: app.created_at,
    note: app.note,
    venue_name: null,
    profile: appProfiles[app.artist_id] || null,
  }));

  async function handleEnquiryRespond(id, status) {
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

  const genres = profile?.genre_string || '';
  const hasProfile = !!profile;
  const completionPct = !hasProfile ? 0
    : [profile.name, profile.avatar, profile.location, profile.sound, profile.tagline, profile.genre_string, profile.bio, profile.website]
        .filter(Boolean).length / 8 * 100;

  return (
    <div className={s.screen}>
      <DashboardHeader line1="HOST /" line2="PROMOTER" userId={userId} profileId={profile?.id} profileType="host" gradient="linear-gradient(135deg, #FF2D78, #00B4D8)" />

      <DashboardProfileCard
        profile={profile}
        accent="#FF3399"
        gradient="linear-gradient(135deg, #FF2D78, #00B4D8)"
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,51,153,.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2"/><line x1="9" y1="5.5" x2="15" y2="5.5" strokeWidth="1.5" strokeLinecap="round"/></svg>}
        setupRoute="/industry/host/setup"
        subtitle={profile?.location || 'Add your details so artists can find you'}
        genres={genres}
        completionPct={hasProfile ? completionPct : undefined}
      />

      <NotificationBar
        message={attentionItems.length > 0 ? attentionItems.join(' · ') : null}
        onClick={() => scrollToSection('section-enquiries')}
      />

      <DashboardStats accent="#FF3399" stats={[
        { label: 'EVENTS',   value: loadingEvents ? '—' : events.length,                sectionId: 'section-events' },
        { label: 'INCOMING', value: newAppsCount === null ? '—' : newAppsCount,          sectionId: 'section-enquiries' },
        { label: 'LINEUP',   value: lineupSlotsCount === null ? '—' : lineupSlotsCount,  sectionId: 'section-lineup' },
      ]} />

      {/* ── EVENTS ── */}
      <EventsSection
        tabs={{ UPCOMING: upcomingEvents, DRAFTS: draftEvents, PAST: pastEvents }}
        loading={loadingEvents}
        accent="#FF3399"
      />

      {/* ── AVAILABILITY ── */}
      <AvailabilitySection userId={userId} table="artist_availability" accent="#FF3399" accentRgb="255,51,153" />

      {/* ── ENQUIRIES ── */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>ENQUIRIES</span>
          {newAppsCount > 0 && <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{newAppsCount}</span>}
        </div>
        {loadingApps
          ? <p className={s.empty}>Loading applications…</p>
          : <EnquiryPanel enquiries={mappedEnquiries} onRespond={handleEnquiryRespond} />
        }
      </div>

      {/* ── LINEUP ── */}
      <div id="section-lineup" style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: lineups.length > 1 ? 8 : 12 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>LINEUP</span>
          {lineupSlotsCount > 0 && <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{lineupSlotsCount}</span>}
          <button onClick={() => setShowAllLineup(v => !v)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--neon2)'; e.currentTarget.style.color = 'var(--neon2)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
            title={showAllLineup ? 'Minimise' : 'Maximise'}
          >
            {showAllLineup
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
            }
          </button>
        </div>

        {/* Event selector pills — only when >1 event */}
        {lineups.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              onClick={() => setLineupFocusId(null)}
              style={{
                fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                transition: 'background .15s, border-color .15s, color .15s',
                background: lineupFocusId === null ? 'rgba(0,229,255,.12)' : 'transparent',
                border: `1.5px solid ${lineupFocusId === null ? 'var(--neon2)' : 'rgba(255,255,255,.15)'}`,
                color: lineupFocusId === null ? 'var(--neon2)' : 'var(--muted)',
              }}
            >ALL</button>
            {lineups.map(({ event: ev }) => {
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
                    color: active ? 'var(--neon2)' : 'var(--muted)',
                  }}
                >{evName}</button>
              );
            })}
          </div>
        )}

        {loadingLineups ? (
          <p className={s.empty}>Loading lineup…</p>
        ) : lineups.length === 0 ? (
          <p className={s.empty}>No confirmed artists yet. Accept applications to build your lineup.</p>
        ) : showAllLineup === false ? null : (
          <div>
            {(lineupFocusId ? lineups.filter(g => g.event.id === lineupFocusId) : lineups).map(({ event: ev, artists }) => {
              const evName      = ev.name || ev.config?.name || 'Untitled Event';
              const evDate      = ev.config?.date ? new Date(ev.config.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
              const evExpanded  = lineupExpandMap[ev.id] !== false;
              const toggleExpand = () => setLineupExpandMap(prev => ({ ...prev, [ev.id]: !evExpanded }));
              const activeTab   = lineupSubTabs[ev.id] || 'SHORT LIST';
              const setTab      = (tab) => setLineupSubTabs(prev => ({ ...prev, [ev.id]: tab }));
              const evShortList = tentativeApps.filter(a => a.event_id === ev.id);
              const evPipeline  = newApps.filter(a => a.event_id === ev.id);
              const days        = ev.config?.days || [];
              const totalSlots  = days.reduce((n, d) => n + (d.slots?.length || 0), 0);
              const evClaims    = claimsMap[ev.id] || {};
              const filledSlots = Object.keys(evClaims).length;

              return (
                <div key={ev.id} className={s.lineupGroup}>
                  {/* Header */}
                  <div className={s.lineupGroupHeader}>
                    <span className={s.lineupEventName}>{evName}</span>
                    {evDate && <span className={s.lineupEventDate}>{evDate}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <button
                        onClick={() => navigate(`/event/${ev.id}`)}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '4px 10px', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--neon2)'; e.currentTarget.style.color = 'var(--neon2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
                      >VIEW / EDIT EVENT →</button>
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
                        lineupCount={artists.length}
                        totalSlots={totalSlots}
                        filledSlots={filledSlots}
                        hasPoster={!!(ev.config?.poster || ev.config?.poster_full)}
                        pendingCount={evPipeline.length}
                      />

                      {/* Sub-tabs: SHORT LIST | PIPELINE */}
                      <div className={s.subTabBar}>
                        {[
                          { key: 'SHORT LIST', color: '#FFD700', count: evShortList.length },
                          { key: 'PIPELINE',   color: '#00B4D8', count: evPipeline.length  },
                        ].map(({ key, color, count }) => {
                          const active = activeTab === key;
                          return (
                            <button key={key} className={s.subTab}
                              style={{ color: active ? color : 'var(--muted)', borderBottomColor: active ? color : 'transparent' }}
                              onClick={() => setTab(key)}>
                              {key}
                              {count > 0 && <span className={s.subTabCount} style={active ? { background: `rgba(255,215,0,.12)`, color } : {}}>{count}</span>}
                            </button>
                          );
                        })}
                      </div>

                      {activeTab === 'SHORT LIST' && (
                        evShortList.length === 0
                          ? <p className={s.empty} style={{ fontSize: 12 }}>No shortlisted artists for this event.</p>
                          : <div style={{ marginBottom: 12 }}>{evShortList.map(app => <AppCard key={app.id} app={app} prof={appProfiles[app.artist_id] || {}} event={evtMap[app.event_id]} onRespond={respondApp} />)}</div>
                      )}
                      {activeTab === 'PIPELINE' && (
                        evPipeline.length === 0
                          ? <p className={s.empty} style={{ fontSize: 12 }}>No pending applications for this event.</p>
                          : <div style={{ marginBottom: 12 }}>{evPipeline.map(app => <AppCard key={app.id} app={app} prof={appProfiles[app.artist_id] || {}} event={evtMap[app.event_id]} onRespond={respondApp} />)}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FOLLOWING — always at bottom ── */}
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
          onSave={updated => saveSlot(editingSlot.ev, editingSlot.dayIdx, editingSlot.slotIdx, updated)}
          onClose={() => setEditingSlot(null)}
        />
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

function ProgressRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.min(value / total, 1) : 0;
  const done = total > 0 && value >= total;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', width: 72, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, borderRadius: 4, background: color, transition: 'width .4s' }} />
      </div>
      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, color: done ? color : 'var(--muted)', minWidth: 36, textAlign: 'right' }}>
        {done ? 'DONE' : total > 0 ? `${value}/${total}` : '—'}
      </span>
    </div>
  );
}

function EventProgressSummary({ lineupCount, totalSlots, filledSlots, hasPoster, pendingCount }) {
  const cols = [
    {
      label: 'LINEUP',
      color: '#FF3399',
      value: totalSlots > 0 ? `${lineupCount} / ${totalSlots}` : String(lineupCount),
      pct: totalSlots > 0 ? Math.min(lineupCount / totalSlots, 1) : (lineupCount > 0 ? 1 : 0),
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
        </div>
      ))}
    </div>
  );
}

function fmtDur(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min`;
}

const LABEL_COLORS = {
  main: '#FF3399', headliner: '#FF3399',
  support: '#BF5FFF', special: '#BF5FFF', guest: '#BF5FFF',
  opening: '#00B4D8', resident: '#00E5A0',
  sunset: '#FFD700', sunrise: '#FFD700', sunrise_set: '#FFD700',
};
function labelColor(label) {
  if (!label) return '#888';
  return LABEL_COLORS[label.toLowerCase().replace(/\s+/g, '_')] || '#888';
}


function TabBtn({ id, label, active, set }) {
  const isActive = active === id;
  return (
    <button
      className={s.tabBtn}
      style={{ borderBottomColor: isActive ? 'var(--neon2)' : 'transparent', color: isActive ? 'var(--text)' : 'var(--muted)' }}
      onClick={() => set(id)}
    >
      {label}
    </button>
  );
}

function PillTab({ label, color, rgb, active, onClick }) {
  const [hov, setHov] = useState(false);
  const lit = active || hov;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
        transition: 'border-color .15s, color .15s, background .15s',
        background: lit ? `rgba(${rgb},.12)` : 'transparent',
        border: `1.5px solid ${lit ? color : 'rgba(255,255,255,.12)'}`,
        color: lit ? color : 'var(--muted)',
      }}
    >{label}</button>
  );
}

function LineupToggle({ value, onChange }) {
  return (
    <button onClick={onChange} type="button"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
      <div style={{
        width: 36, height: 20, borderRadius: 10, position: 'relative', flexShrink: 0,
        background: value ? 'var(--neon2)' : 'rgba(255,255,255,0.15)',
        transition: 'background .2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: value ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left .2s',
        }} />
      </div>
    </button>
  );
}

function AppBtn({ onClick, disabled, base, hover, children }) {
  const [hov, setHov] = useState(false);
  const st = hov && !disabled ? hover : base;
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '8px 0', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
        transition: 'all .15s',
        background: st.bg, border: st.border, color: st.color || base.color,
        opacity: disabled ? .5 : 1,
      }}
    >{children}</button>
  );
}

function AppCard({ app, prof, event, onRespond }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const isPending   = app.status === 'pending';
  const isTentative = app.status === 'tentative';

  const TYPE_ACCENT = { artist: '#00E5FF', band: '#FF8C42', standup: '#FF88AA', dj: '#00E5FF', host: '#FF3399' };
  const TYPE_RGB    = { artist: '0,229,255', band: '255,140,66', standup: '255,136,170', dj: '0,229,255', host: '255,51,153' };
  const pType     = prof?.type || 'artist';
  const accent    = TYPE_ACCENT[pType] || '#00E5FF';
  const accentRgb = TYPE_RGB[pType]    || '0,229,255';

  const STATUS_COLOR = { accepted: '#00E5A0', rejected: '#888', declined: '#888', pending: '#FFD700' };
  const STATUS_LABEL = { accepted: 'ACCEPTED', rejected: 'DECLINED', declined: 'DECLINED', pending: 'PENDING' };
  const statusColor = STATUS_COLOR[app.status] || '#FFD700';
  const statusLabel = STATUS_LABEL[app.status] || 'PENDING';

  const p      = prof || {};
  const name   = p.name || app.artist_name || '—';
  const loc    = [p.location, p.state].filter(Boolean).join(', ');
  const avatar = p.avatar || app.avatar_url || null;
  const sound  = p.sound || (p.genre_string || '').split(/[·,]/).slice(0, 3).join(' · ') || app.genre || '';
  const allTags = [...new Set([
    ...(p.genre_string || '').split(/[,·]/).map(t => t.trim()),
    ...(p.vibe_tags    || '').split(',').map(t => t.trim()),
    ...(p.card_pills   || '').split(',').map(t => t.trim()),
  ].filter(Boolean))];

  const evName = event?.name || '—';
  const evDateBox = (() => {
    const raw = event?.config?.date;
    const d = raw ? new Date(raw + 'T12:00:00') : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (isNaN(d.getTime())) return null;
    return {
      dn:  d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase(),
      mo:  d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase(),
      num: d.getDate(),
    };
  })();

  const appliedLabel = app.created_at
    ? new Date(app.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const mixLink = app.mix_link || p.mix_link;

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond(app.id, status, app.artist_id, event?.name);
    setBusy(false);
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Main card */}
      <div className={ds.card} style={{ border: `1px solid rgba(${accentRgb},.35)`, cursor: 'default', marginBottom: 0, borderRadius: expanded ? '14px 14px 0 0' : 14 }}>
        {avatar
          ? <img className={ds.cardAvatar} src={avatar} alt={name} style={{ borderColor: accent }} />
          : <div className={ds.cardAvatarPH} style={{ borderColor: accent }}>🎵</div>
        }
        <div className={ds.cardInfo}>
          <div className={ds.cardNameRow}>
            <span className={ds.cardName}>{name}</span>
            <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>{pType.toUpperCase()}</span>
          </div>
          {loc  && <div className={ds.cardLoc}>{loc}</div>}
          {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
        </div>
        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '2px 7px' }}>
            {statusLabel}
          </span>
          {evDateBox && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid rgba(255,51,153,.4)', background: 'rgba(255,51,153,.08)', borderRadius: 7, padding: '4px 8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(255,51,153,.7)', lineHeight: 1 }}>{evDateBox.dn}</span>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(255,51,153,.7)', lineHeight: 1 }}>{evDateBox.mo}</span>
              </div>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 26, color: '#FF3399', lineHeight: 1 }}>{evDateBox.num}</span>
            </div>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, background: 'rgba(255,51,153,.1)', border: '1px solid rgba(255,51,153,.35)', color: '#FF3399', borderRadius: 8, padding: '3px 8px', cursor: 'pointer' }}
          >{expanded ? 'HIDE ▲' : 'VIEW FULL PROFILE ▼'}</button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {p.bio && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>ABOUT</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.bio}</span>
                {p.bio.length > 60 && <span onClick={() => setBioOpen(true)} style={{ color: 'var(--muted)', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>see more</span>}
              </div>
            </div>
          )}
          {app.note && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>NOTE</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, fontStyle: 'italic' }}>"{app.note}"</div>
            </div>
          )}
          {[
            ['FOR EVENT', evName],
            ['APPLIED',   appliedLabel || null],
            ['SOUND',     p.sound      || null],
            ['LOCATION',  loc          || null],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>{label}</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{value}</div>
            </div>
          ))}
          {mixLink && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>MIX / DEMO</div>
              <a href={mixLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: accent, flex: 1, wordBreak: 'break-all' }}>▶ Play demo</a>
            </div>
          )}
          {p.instagram && p.instagram !== 'N/A' && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>INSTAGRAM</div>
              {(() => {
                const h = p.instagram.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/?/i, '').replace(/\/$/, '');
                return <a href={`https://instagram.com/${h}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: accent }}>@{h}</a>;
              })()}
            </div>
          )}
          {(isPending || isTentative) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <AppBtn onClick={() => respond('accepted')} disabled={busy}
                base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
              >ACCEPT ✓</AppBtn>
              {isPending && (
                <AppBtn onClick={() => respond('tentative')} disabled={busy}
                  base={{ bg: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
                  hover={{ bg: 'rgba(0,180,216,.28)', border: '1px solid #00B4D8' }}
                >TENTATIVE</AppBtn>
              )}
              <AppBtn onClick={() => respond('rejected')} disabled={busy}
                base={{ bg: 'rgba(120,120,160,.06)', border: '1px solid rgba(120,120,160,.2)', color: 'var(--muted)' }}
                hover={{ bg: 'rgba(255,140,0,.18)', border: '1px solid #FF8C00', color: '#FF8C00' }}
              >DECLINE ✗</AppBtn>
            </div>
          )}
        </div>
      )}

      {/* Bio popup */}
      {bioOpen && p.bio && (
        <div onClick={() => setBioOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.4)`, borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2, color: accent }}>ABOUT {name.toUpperCase()}</span>
              <button onClick={() => setBioOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7 }}>{p.bio}</p>
          </div>
        </div>
      )}
    </div>
  );
}
