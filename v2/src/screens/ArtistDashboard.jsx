import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import { STATUS_TAB_COLOR } from '../lib/enquiryUtils';
import s from './ArtistDashboard.module.css';
import EventCard from '../components/EventCard';
import ProfileCard from '../components/ProfileCard';
import PortraitCard from '../components/PortraitCard';
import { useDragScroll } from '../hooks/useDragScroll';
import DashboardHeader from '../components/DashboardHeader';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import EnquiryCard from '../components/EnquiryCard';
import AvailabilitySection from '../components/AvailabilitySection';

// Organiser-side (INCOMING) pipeline — what venues/hosts see
const IN_STATUS_MAP  = {
  NEW:         ['new', 'pending'],
  SHORTLISTED: ['shortlisted', 'interested'],
  ACCEPTED:    ['accepted', 'booked'],
  DECLINED:    ['declined'],
};
const IN_TABS = ['NEW', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'];

// Applicant-side (OUTGOING) pipeline — what artists see (asymmetric labels)
const APP_TAB_STATUSES = {
  'SUBMITTED':        ['pending', 'new', 'viewed'],
  'BEING CONSIDERED': ['shortlisted', 'interested', 'tentative'],
  'BOOKED':           ['accepted', 'booked'],
  'NOT SELECTED':     ['declined', 'rejected'],
};
const APP_TABS = Object.keys(APP_TAB_STATUSES);
const APP_TAB_COLOR = {
  'SUBMITTED':        '#FFD700',
  'BEING CONSIDERED': '#BF5FFF',
  'BOOKED':           '#00E5A0',
  'NOT SELECTED':     '#888',
};
function applicantLabel(status) {
  const s = (status || 'pending').toLowerCase();
  if (['pending', 'new', 'viewed'].includes(s))               return 'SUBMITTED';
  if (['shortlisted', 'interested', 'tentative'].includes(s)) return 'BEING CONSIDERED';
  if (['accepted', 'booked'].includes(s))                     return 'BOOKED';
  if (['declined', 'rejected'].includes(s))                   return 'NOT SELECTED';
  return 'SUBMITTED';
}
const GIG_TABS  = ['UPCOMING', 'PAST'];

export default function ArtistDashboard({ userId: userIdProp, config }) {
  const { session } = useSession();
  const navigate    = useNavigate();
  const userId      = userIdProp || session?.user?.id;

  const cfg = config || {
    headingLine1: 'DJ /',
    headingLine2: 'PRODUCER',
    gradient:     'linear-gradient(135deg,#00E5FF,#00BFFF,#7B5EA7,#FF88AA)',
    profileType:  'artist',
    setupPath:    '/industry/artist/setup',
    browseLabel:  'BROWSE OPEN EVENTS →',
    setupPlaceholder: 'Set up your artist profile',
  };

  const [enqDirTab,     setEnqDirTab]     = useState('INCOMING');
  const [inStatusTab,   setInStatusTab]   = useState('NEW');
  const [outStatusTab,  setOutStatusTab]  = useState('SUBMITTED');
  const [gigTab,        setGigTab]        = useState('UPCOMING');
  const [enqSearch,     setEnqSearch]     = useState('');
  const [unclaimedProf, setUnclaimedProf] = useState(null);
  const [claiming,      setClaiming]      = useState(false);
  const [following,     setFollowing]     = useState([]);
  const [loadingFollow, setLoadingFollow] = useState(false);
  const [followView,    setFollowView]    = useState('portrait');
  const [followFilter,  setFollowFilter]  = useState('ALL');
  const [followShowAll, setFollowShowAll] = useState(false);
  const [followSearch,  setFollowSearch]  = useState('');
  const followDrag = useDragScroll();
  const [offers,        setOffers]        = useState([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const offersLoaded = useRef(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['artistDashboard', userId, cfg.profileType],
    queryFn: async () => {
      const [profRes, appsRes, gigsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', cfg.profileType).maybeSingle(),
        supabase.from('applications').select('id, status, event_id, created_at').eq('artist_id', userId).order('created_at', { ascending: false }).limit(50),
        supabase.from('lineup_members').select('event_id').eq('artist_id', userId).neq('status', 'removed'),
      ]);

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

      const { count: offersCount } = await supabase
        .from('venue_enquiries')
        .select('id', { count: 'exact', head: true })
        .eq('applicant_user_id', userId);

      let unclaimedProf = null;
      if (session?.user?.email) {
        const { data: unclaimed } = await supabase.from('unclaimed_profiles')
          .select('*').eq('claim_email', session.user.email).limit(1).maybeSingle();
        unclaimedProf = unclaimed || null;
      }

      return { profile: profRes.data, applications, upcomingGigs, pastGigs, offersCount: offersCount || 0, unclaimedProf };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const applications = data?.applications || [];
  const upcomingGigs = data?.upcomingGigs || [];
  const pastGigs     = data?.pastGigs     || [];
  const offersCount  = data?.offersCount  ?? 0;

  useEffect(() => {
    if (data?.unclaimedProf !== undefined) setUnclaimedProf(data.unclaimedProf);
  }, [data?.unclaimedProf]);

  // Load offers lazily when INCOMING tab is first selected
  useEffect(() => {
    if (enqDirTab !== 'INCOMING' || !userId || offersLoaded.current) return;
    offersLoaded.current = true;
    setLoadingOffers(true);
    (async () => {
      const { data: rows } = await supabase.from('venue_enquiries')
        .select('*').eq('applicant_user_id', userId).order('created_at', { ascending: false }).limit(50);
      const venueIds = [...new Set((rows || []).map(r => r.venue_user_id).filter(Boolean))];
      let venueNames = {};
      let venueProfileMap = {};
      if (venueIds.length) {
        const { data: vProfs } = await supabase.from('profiles')
          .select('user_id, name, avatar, avatar_thumb, type, bio, sound, genre_string, location, card_pills')
          .in('user_id', venueIds).eq('type', 'venue');
        (vProfs || []).forEach(p => { venueNames[p.user_id] = p.name; venueProfileMap[p.user_id] = p; });
      }
      setOffers((rows || []).map(r => ({ ...r, venue_name: venueNames[r.venue_user_id] || null, venueProfile: venueProfileMap[r.venue_user_id] || null })));
      setLoadingOffers(false);
    })();
  }, [userId]);

  // Load following on mount
  useEffect(() => {
    if (!userId) return;
    setLoadingFollow(true);
    (async () => {
      const { data: rows } = await supabase.from('follows').select('entity_id').eq('user_id', userId).neq('entity_type', 'event');
      const ids = (rows || []).map(r => r.entity_id).filter(Boolean);
      if (!ids.length) { setLoadingFollow(false); return; }
      const { data: profs } = await supabase.from('profiles')
        .select('user_id, name, avatar, avatar_thumb, type, sound, genre_string, location').in('user_id', ids);
      const seen = {};
      (profs || []).forEach(p => { if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p; });
      setFollowing(Object.values(seen));
      setLoadingFollow(false);
    })();
  }, [userId]);

  async function claimProfile() {
    if (!userId || !unclaimedProf || claiming) return;
    setClaiming(true);
    await supabase.from('profiles').upsert({
      user_id: userId, type: cfg.profileType,
      name: unclaimedProf.name, sound: unclaimedProf.sound,
      genre_string: unclaimedProf.genre_string, bio: unclaimedProf.bio, mix_link: unclaimedProf.mix_link,
    }, { onConflict: 'user_id,type' });
    await supabase.from('unclaimed_profiles').delete().eq('claim_email', session.user.email);
    setUnclaimedProf(null);
    setClaiming(false);
  }


  function updateOffer(id, changes) {
    setOffers(prev => prev.map(o => o.id === id ? { ...o, ...changes } : o));
  }

  async function handleOfferRespond(id, status) {
    const offer = offers.find(o => o.id === id);
    if (!offer) return;
    if (status === 'accepted' && offer.event_id) {
      await supabase.from('applications').insert({
        event_id: offer.event_id, artist_id: userId, status: 'pending',
      });
    }
    await supabase.from('venue_enquiries').update({ status }).eq('id', id);
    if (offer.venue_user_id && status === 'accepted') {
      await writeNotification(offer.venue_user_id, 'invite_accepted',
        `An artist accepted your invite${offer.event_name ? ` to ${offer.event_name}` : ''}.`,
        { event_id: offer.event_id, event_name: offer.event_name });
    }
    updateOffer(id, { status });
  }

  const hasProfile    = !!profile;
  const genres        = (() => {
    if (!profile) return '';
    const src = profile.card_pills || profile.genre_string || '';
    return src.split(/\s*·\s*|,\s*/).map(t => t.trim()).filter(Boolean).slice(0, 5).join(' · ');
  })();
  const completionPct = !hasProfile ? 0 : (() => {
    const filled = v => !!(v && v !== 'N/A');
    const done   = v => !!(v === 'N/A' || (v && v.trim && v.trim()));
    const fields = [
      filled(profile.name), filled(profile.avatar), filled(profile.location),
      filled(profile.sound), filled(profile.tagline), filled(profile.bio),
      filled(profile.genre_string), filled(profile.mix_link), filled(profile.card_pills),
      filled(profile.fee_type), filled(profile.emergency_name),
      profile.has_abn !== null && profile.has_abn !== undefined,
      done(profile.soundcloud), done(profile.mixcloud), done(profile.instagram),
      done(profile.youtube), done(profile.facebook),
    ];
    return fields.filter(Boolean).length / fields.length * 100;
  })();

  const filteredApps = applications.filter(a => {
    const statuses = APP_TAB_STATUSES[outStatusTab] || [];
    if (!statuses.includes((a.status || 'pending').toLowerCase())) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(a).toLowerCase().includes(enqSearch.toLowerCase());
  });
  const filteredOffers = offers.filter(o => {
    const st = (o.status || 'new').toLowerCase();
    if (!(IN_STATUS_MAP[inStatusTab] || ['new']).includes(st)) return false;
    if (!enqSearch.trim()) return true;
    return JSON.stringify(o).toLowerCase().includes(enqSearch.toLowerCase());
  });

  const gigList = gigTab === 'UPCOMING' ? upcomingGigs : pastGigs;

  const newAppsCount  = applications.filter(a => (a.status || 'pending') === 'pending').length;
  const pendingOffers = offersLoaded.current
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
        accent={cfg.accent || '#00E5FF'}
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={cfg.accent || 'rgba(0,229,255,.7)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>}
        setupRoute={cfg.setupPath}
        subtitle={profile?.sound || (profile ? profile.location : 'Promoters will see this — takes 2 mins')}
        genres={genres}
        completionPct={hasProfile ? completionPct : undefined}
      />

      {/* Unclaimed profile banner */}
      {unclaimedProf && (
        <div style={{ background: 'rgba(0,229,255,.08)', border: '1.5px solid rgba(0,229,255,.35)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: 'var(--neon2)', marginBottom: 4 }}>PROFILE WAITING FOR YOU</p>
          <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>
            <strong>{unclaimedProf.name}</strong> was listed by a promoter — claim it to take ownership.
          </p>
          <button onClick={claimProfile} disabled={claiming}
            style={{ background: 'var(--neon2)', color: '#000', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', opacity: claiming ? .6 : 1 }}>
            {claiming ? 'CLAIMING…' : 'CLAIM THIS PROFILE'}
          </button>
        </div>
      )}

      <NotificationBar
        message={attentionItems.length > 0 ? attentionItems.join(' · ') : null}
        onClick={() => scrollToSection('section-enquiries')}
      />

      <DashboardStats stats={[
        { label: 'APPLICATIONS', value: loading ? '—' : applications.length,              accent: '#00E5FF', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('OUTGOING'); } },
        { label: 'OFFERS',       value: loading ? '—' : offersCount,                      accent: '#BF5FFF', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('INCOMING'); } },
        { label: 'BOOKINGS',     value: loading ? '—' : upcomingGigs.length + pastGigs.length, accent: '#00E5A0', onClick: () => { scrollToSection('section-enquiries'); setEnqDirTab('BOOKED'); } },
      ]} />

      {/* ── AVAILABILITY ── */}
      <AvailabilitySection userId={userId} table="artist_availability" accent={cfg.accent || '#00E5FF'} accentRgb={cfg.accentRgb || '0,229,255'} />

      {/* ── ENQUIRIES ── */}
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff' }}>ENQUIRIES</p>
        </div>
        {/* Direction tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[
            { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',   cnt: offersCount },
            { key: 'OUTGOING', color: 'var(--neon2)', rgb: '0,229,255', cnt: applications.length },
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
              : filteredOffers.map(offer => (
                    <EnquiryCard key={offer.id} enq={{
                      id: offer.id,
                      direction: 'incoming',
                      status: offer.status || 'new',
                      applicant_user_id: offer.venue_user_id,
                      applicant_type: 'venue',
                      name: offer.venue_name || 'Venue',
                      event_name: offer.event_name,
                      date_requested: offer.proposed_date || offer.date_requested,
                      created_at: offer.created_at,
                      note: offer.message || offer.note,
                      venue_name: offer.venue_name,
                      profile: offer.venueProfile || null,
                    }} onRespond={handleOfferRespond} />
                  ))
            }
          </div>
        )}

        {/* OUTGOING — applications the artist submitted */}
        {enqDirTab === 'OUTGOING' && (
          <div>
            <div className={s.subTabBar}>
              {APP_TABS.map(t => {
                const statuses = APP_TAB_STATUSES[t] || [];
                const count  = applications.filter(a => statuses.includes((a.status || 'pending').toLowerCase())).length;
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
              : filteredApps.length === 0
                ? <p className={s.empty}>No {outStatusTab.toLowerCase()} applications yet.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filteredApps.map(app => app.event
                      ? <EventCard key={app.id} event={app.event}
                          badge={applicantLabel(app.status)}
                          badgeColor={APP_TAB_COLOR[applicantLabel(app.status)] || '#FFD700'} />
                      : null
                    )}
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
            {loading
              ? <p className={s.empty}>Loading…</p>
              : gigList.length === 0
                ? <p className={s.empty}>No {gigTab.toLowerCase()} bookings.</p>
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
    </div>
  );
}

function appStatusColor(status) {
  return { accepted: '#00e676', tentative: '#00E5FF', pending: '#ffb830', rejected: 'var(--muted)' }[status] || 'var(--muted)';
}

