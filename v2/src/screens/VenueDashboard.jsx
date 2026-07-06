import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { useSession, usePlayer } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import EventCard from '../components/EventCard';
import PortraitCard from '../components/PortraitCard';
import ProfileCard from '../components/ProfileCard';
import InviteSheet from '../components/InviteSheet';
import { useDragScroll } from '../hooks/useDragScroll';
import s from './VenueDashboard.module.css';
import ds from './DiscoverScreen.module.css';

const DIR_TABS = [
  { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',
    subTabs: ['NEW', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'OUTGOING', color: '#00B4D8', rgb: '0,180,216',
    subTabs: ['AWAITING', 'INTERESTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'BOOKED',   color: '#00E5A0', rgb: '0,229,160',
    subTabs: [] },
];

function normaliseStatus(e) {
  const dir = (e.direction || 'incoming').toLowerCase();
  const st  = (e.status   || 'pending').toLowerCase();
  if (dir === 'outgoing') {
    if (st === 'pending')   return 'awaiting';
    if (st === 'tentative') return 'interested';
  } else {
    if (st === 'pending')   return 'new';
    if (st === 'tentative') return 'shortlisted';
  }
  return st;
}

export default function VenueDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const [enquiries,      setEnquiries]      = useState([]);
  const [dirTab,         setDirTab]         = useState('INCOMING');
  const [statusTab,      setStatusTab]      = useState('NEW');
  const [search,         setSearch]         = useState('');
  const [localAvail,     setLocalAvail]     = useState(null);
  const [showAvailCal,   setShowAvailCal]   = useState(false);
  const [showAllEnq,     setShowAllEnq]     = useState(false);
  const [evtTab,         setEvtTab]         = useState('UPCOMING');
  const [showAllEvts,    setShowAllEvts]    = useState(false);
  const [following,      setFollowing]      = useState([]);
  const [inviteArtist,   setInviteArtist]   = useState(null);
  const [loadingFollow,  setLoadingFollow]  = useState(false);
  const [followView,       setFollowView]       = useState('portrait'); // 'portrait' | 'landscape'
  const [followFilter,     setFollowFilter]     = useState('ALL');
  const [regularsShowAll,  setRegularsShowAll]  = useState(false);
  const [regularsSearch,   setRegularsSearch]   = useState('');
  const regularsDrag = useDragScroll();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['venueDashboard', userId],
    queryFn: async () => {
      const [profRes, availRes, enqRes, evtRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'venue').maybeSingle(),
        supabase.from('venue_availability').select('available_date').eq('user_id', userId).gte('available_date', today()).order('available_date').limit(10),
        supabase.from('venue_enquiries').select('*').eq('venue_user_id', userId).order('created_at', { ascending: false }).limit(100),
        // Upcoming events where config->venue matches profile name — approximated with host_id for now
        supabase.from('events').select('id, name, status, config, applications_open, is_public, created_at').eq('host_id', userId).order('created_at', { ascending: false }).limit(200),
      ]);
      return {
        profile:      profRes.data,
        availability: (availRes.data || []).map(r => r.available_date),
        enquiries:    enqRes.data || [],
        upcomingEvts: evtRes.data || [],
      };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const availability = localAvail ?? data?.availability ?? [];
  const events       = data?.upcomingEvts || [];
  const todayStr     = new Date().toISOString().split('T')[0];
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') >= todayStr)
                               .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  const draftEvents    = events.filter(ev => ev.status === 'draft');
  const pastEvents     = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') < todayStr)
                               .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
  const evtTabEvents   = evtTab === 'UPCOMING' ? upcomingEvents : evtTab === 'DRAFTS' ? draftEvents : pastEvents;

  // Sync fetched availability into local state once loaded
  if (data?.availability && localAvail === null) setLocalAvail(data.availability);

  async function toggleDate(dateStr) {
    if (!userId) return;
    const avail = localAvail ?? [];
    const wasAvail = avail.includes(dateStr);
    // Optimistic update
    setLocalAvail(wasAvail ? avail.filter(d => d !== dateStr) : [...avail, dateStr].sort());
    if (wasAvail) {
      await supabase.from('venue_availability').delete().eq('user_id', userId).eq('available_date', dateStr);
    } else {
      await supabase.from('venue_availability').upsert({ user_id: userId, available_date: dateStr }, { onConflict: 'user_id,available_date' });
    }
  }

  // enquiries kept in local state so optimistic respond() updates work
  const allEnquiries = enquiries.length ? enquiries : (data?.enquiries || []);

  const filteredEnq = useMemo(() => {
    return allEnquiries
      .filter(e => {
        if (dirTab === 'BOOKED') {
          const st = (e.status || '').toLowerCase();
          return st === 'booked' || st === 'accepted';
        }
        const dir = (e.direction || 'incoming').toLowerCase();
        if (dir !== dirTab.toLowerCase()) return false;
        return normaliseStatus(e) === statusTab.toLowerCase();
      })
      .filter(e => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
  }, [allEnquiries, dirTab, statusTab, search]);

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
      const { data: rows } = await supabase.from('follows')
        .select('entity_id').eq('user_id', userId).neq('entity_type', 'event');
      const ids = (rows || []).map(r => r.entity_id).filter(Boolean);
      if (!ids.length) { setLoadingFollow(false); return; }
      const { data: profs } = await supabase.from('profiles')
        .select('user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, suburb, state, bio').in('user_id', ids);
      const seen = {};
      (profs || []).forEach(p => { if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p; });
      setFollowing(Object.values(seen));
      setLoadingFollow(false);
    })();
  }, [userId]);

  const hasProfile   = !!profile;
  const enquiryCount = allEnquiries.length;
  const availCount   = availability.length;
  const enquiredDates = new Set(allEnquiries.map(e => e.date_requested || e.preferred_date).filter(Boolean));

  const completionPct = !hasProfile ? 0 : (() => {
    const filled = v => !!(v && v !== 'N/A');
    const done   = v => !!(v === 'N/A' || (v && String(v).trim()));
    const fields = [
      filled(profile.name),
      filled(profile.avatar),
      filled(profile.location),
      filled(profile.state),
      filled(profile.venue_type),
      filled(profile.capacity),
      filled(profile.sound),
      filled(profile.tagline),
      filled(profile.bio),
      filled(profile.genre_string),
      done(profile.website),
      done(profile.instagram),
      done(profile.phone),
      done(profile.email || profile.contactEmail),
    ];
    return fields.filter(Boolean).length / fields.length * 100;
  })();

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.headerRow}>
        <div className={s.heading}>VENUE<br />DASHBOARD</div>
        {userId && (
          <button
            title="Preview your public profile"
            onClick={() => navigate(`/profile/${userId}?type=venue`)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Profile card — always visible, green accent */}
      <div className={s.profileCard} onClick={() => navigate('/industry/venue/setup')} style={{ cursor: 'pointer' }}>
        <div className={s.avatarBox}>
          {profile?.avatar
            ? <img src={profile.avatar} alt={profile.name} className={s.avatarImg} />
            : <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          }
        </div>
        <div className={s.profileInfo}>
          <div className={s.profileName}>{profile?.name || 'Set up your venue profile'}</div>
          <div className={s.profileSub}>{profile?.location || 'Add your venue details so promoters can find you'}</div>
          {profile?.sound ? <div className={s.profileGenres}>{profile.sound}</div> : null}
        </div>
        <div className={s.profileCta}>{profile?.name ? 'EDIT →' : 'SET UP →'}</div>
      </div>

      {/* Completion bar — host dash style */}
      {hasProfile && (
        <div className={s.completionWrap}>
          <div className={s.completionBar}>
            <div className={s.completionFill} style={{ width: `${completionPct}%` }} />
          </div>
          <p className={s.completionLabel}>COMPLETE YOUR PROFILE — {Math.round(completionPct)}%</p>
        </div>
      )}

      {/* Attention bar */}
      {(() => {
        const newEnq = allEnquiries.filter(e => (e.direction || 'incoming').toLowerCase() === 'incoming' && normaliseStatus(e) === 'new').length;
        if (newEnq === 0) return null;
        return (
          <div className={s.attention} onClick={() => { scrollToSection('section-enquiries'); setDirTab('INCOMING'); setStatusTab('NEW'); }}>
            <span className={s.attentionDot} />
            <span className={s.attentionText}>{newEnq} NEW ENQUIR{newEnq !== 1 ? 'IES' : 'Y'} — TAP TO REVIEW</span>
          </div>
        );
      })()}

      {/* Stats — scroll nav (position section at 35% from top) */}
      <div className={s.stats}>
        <Stat label="EVENTS"       value={loading ? '—' : events.length} onClick={() => scrollToSection('section-events')} />
        <Stat label="ENQUIRIES"    value={loading ? '—' : enquiryCount}  onClick={() => scrollToSection('section-enquiries')} />
        <Stat label="AVAIL. DATES" value={loading ? '—' : availCount}    onClick={() => scrollToSection('section-availability')} />
      </div>

      {/* Events */}
      <div id="section-events">
          <div className={s.subTabBar}>
            {[['UPCOMING', upcomingEvents.length], ['DRAFTS', draftEvents.length], ['PAST', pastEvents.length]].map(([t, count]) => (
              <button key={t} className={s.subTab}
                style={{ borderBottomColor: evtTab === t ? '#00E5A0' : 'transparent', color: evtTab === t ? 'var(--text)' : 'var(--muted)' }}
                onClick={() => { setEvtTab(t); setShowAllEvts(false); }}
              >{t}<span className={s.subTabCount}>{count}</span></button>
            ))}
          </div>
          {loading
            ? <p className={s.empty}>Loading…</p>
            : evtTabEvents.length === 0
              ? <p className={s.empty}>No {evtTab.toLowerCase()} events.</p>
              : <>
                  {evtTabEvents.length > 3 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                      <button className={s.viewAllBtn} onClick={() => setShowAllEvts(v => !v)}>{showAllEvts ? 'View less <' : 'View all >'}</button>
                    </div>
                  )}
                  <div className={s.evtList} style={showAllEvts ? { maxHeight: 'none', maskImage: 'none', WebkitMaskImage: 'none', overflowY: 'visible' } : {}}>
                    {evtTabEvents.map(ev => {
                      const isLive      = ev.status === 'live';
                      const isCompleted = ev.status === 'completed' || (isLive && (ev.config?.date || '') < todayStr);
                      const cfg         = ev.config || {};
                      const appsOpen    = cfg.applications_open === true || ev.applications_open === true;
                      const isPublic    = cfg.is_public !== false && ev.is_public !== false;
                      const statusLabel = isCompleted ? 'FINISHED' : isLive ? 'LIVE' : 'DRAFT';
                      const statusCol   = isCompleted ? 'var(--muted)' : isLive ? '#00e676' : 'var(--muted)';
                      const statusBg    = isCompleted ? 'rgba(120,120,160,.1)' : isLive ? 'rgba(0,230,118,.1)' : 'rgba(120,120,160,.1)';
                      const statusBdr   = isCompleted ? 'rgba(120,120,160,.3)' : isLive ? 'rgba(0,230,118,.35)' : 'rgba(120,120,160,.3)';
                      return (
                        <div key={ev.id} className={s.evtCardWrap} onClick={() => navigate(`/event/${ev.id}`)}>
                          <EventCard event={ev} noHover />
                          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: statusCol, background: statusBg, border: `1px solid ${statusBdr}`, borderRadius: 4, padding: '2px 7px' }}>{statusLabel}</span>
                          </div>
                          <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                            {isLive && !isCompleted && (
                              <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: appsOpen ? '#00e676' : 'var(--muted)', background: appsOpen ? 'rgba(0,230,118,.12)' : 'rgba(120,120,160,.12)', border: `1px solid ${appsOpen ? 'rgba(0,230,118,.4)' : 'rgba(120,120,160,.3)'}`, borderRadius: 4, padding: '2px 6px' }}>{appsOpen ? 'APPS OPEN' : 'APPS CLOSED'}</span>
                            )}
                            {!isCompleted && (
                              <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: isPublic ? '#00B4D8' : 'var(--muted)', background: isPublic ? 'rgba(0,180,216,.08)' : 'rgba(120,120,160,.08)', border: `1px solid ${isPublic ? 'rgba(0,180,216,.25)' : 'rgba(120,120,160,.25)'}`, borderRadius: 4, padding: '2px 6px' }}>{isPublic ? 'PUBLIC' : 'PRIVATE'}</span>
                            )}
                            {!isCompleted && (
                              <button style={{ fontSize: 10, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, color: '#fff', background: 'rgba(0,229,160,.35)', border: '1px solid rgba(0,229,160,.6)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                                onClick={e => { e.stopPropagation(); navigate(`/create-event?edit=${ev.id}`); }}>EDIT →</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
          }
          <button onClick={() => navigate('/create-event')} style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 12, background: 'linear-gradient(135deg, #99204d, #6b2e99)', color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, padding: 14, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'opacity .15s' }} onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>+ CREATE NEW EVENT</button>
      </div>

      {/* Availability */}
      <div id="section-availability" style={{ marginTop: 24 }}>
        <Section title="AVAILABLE DATES" subtitle="tap dates to add / remove" onAction={() => setShowAvailCal(true)} viewAll={availability.length > 0 ? 'View all >' : null} onViewAll={() => setShowAvailCal(true)}>
          {availability.length === 0
            ? <p className={s.empty}>No upcoming dates set.</p>
            : <div className={s.chips}>
                {availability.slice(0, window.innerWidth < 640 ? 8 : 12).map(d => (
                  <DateChip key={d} label={formatDisplayDate(d)} onClick={() => setShowAvailCal(true)} />
                ))}
              </div>
          }
        </Section>
        {showAvailCal && (
          <VenueAvailCalendar
            availability={localAvail ?? []}
            onToggle={toggleDate}
            onClose={() => setShowAvailCal(false)}
          />
        )}
      </div>

      {/* Enquiries */}
      <div id="section-enquiries">
        <Section title="ENQUIRIES" action={showAllEnq ? 'View less <' : 'View all >'} onAction={() => setShowAllEnq(v => !v)}>
          {/* Direction tabs */}
          <div className={s.enqDirTabs}>
            {DIR_TABS.map(({ key, color, rgb, subTabs }) => {
              const active = dirTab === key;
              const cnt = allEnquiries.filter(e => {
                if (key === 'BOOKED') { const st = (e.status||'').toLowerCase(); return st === 'booked' || st === 'accepted'; }
                return (e.direction || 'incoming').toLowerCase() === key.toLowerCase();
              }).length;
              return (
                <EnqTabBtn key={key} active={active} color={color} rgb={rgb} onClick={() => { setDirTab(key); setStatusTab(subTabs[0] || ''); }}>
                  {key}{cnt ? ' (' + cnt + ')' : ''}
                </EnqTabBtn>
              );
            })}
          </div>
          {/* Sub-tabs (only for INCOMING / OUTGOING) */}
          {(() => {
            const dir = DIR_TABS.find(d => d.key === dirTab);
            if (!dir || dir.subTabs.length === 0) return null;
            const accent = dir.color;
            const accentRgb = dir.rgb;
            return (
              <div className={s.enqSubTabs}>
                {dir.subTabs.map(sub => {
                  const activeSub = statusTab === sub;
                  const cnt = allEnquiries.filter(e => (e.direction || 'incoming').toLowerCase() === dirTab.toLowerCase() && normaliseStatus(e) === sub.toLowerCase()).length;
                  return (
                    <button key={sub} onClick={() => setStatusTab(sub)}
                      className={s.enqSubTab}
                      style={{ borderBottomColor: activeSub ? accent : 'transparent', color: activeSub ? accent : 'var(--muted)' }}>
                      {sub}
                      {cnt > 0 && (<span className={s.enqSubCount} style={activeSub ? { background: `rgba(${accentRgb},.18)`, color: accent } : {}}>{cnt}</span>)}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          <div className={s.searchWrap}>
            <span className={s.searchIcon}>🔍</span>
            <input className={s.searchInput} type="text" placeholder="Search by genre, vibe, act type…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {filteredEnq.length === 0
            ? (<p className={s.empty}>No {(dirTab === 'BOOKED' ? 'booked' : statusTab.toLowerCase())} enquiries{search ? ' matching your search' : ''}.</p>)
            : (<div style={showAllEnq ? {} : { maxHeight: 500, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {filteredEnq.map(enq => (
                  <EnquiryCard key={enq.id} enq={enq} onRespond={(id, status) =>
                    setEnquiries(allEnquiries.map(e => e.id === id ? { ...e, status } : e))
                  } />
                ))}
              </div>)
          }
        </Section>
      </div>

      {/* Following */}
      {(() => {
        const FILTER_TYPES = ['ALL', 'ARTIST', 'BAND', 'HOST', 'COMEDY'];
        const FILTER_LABELS = { ALL: 'ALL', ARTIST: 'DJ', BAND: 'BAND', HOST: 'HOST', COMEDY: 'SPOKEN' };
        const TYPE_MAP = { ARTIST: 'artist', BAND: 'band', HOST: 'host', COMEDY: 'standup', VENUE: 'venue' };
        const filtered = following.filter(p => followFilter === 'ALL' || p.type === TYPE_MAP[followFilter]);

        return (
          <div style={{ marginTop: 24 }}>
            {/* Header row */}
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>THE REGULARS</span>
              {following.length > 0 && <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{following.length}</span>}
              <div style={{ flex: 1 }} />
              {/* Portrait / landscape toggle — hidden in expanded view */}
              {!regularsShowAll && (
                <div style={{ display: 'flex', background: 'var(--card2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {[['portrait', '▦'], ['landscape', '☰']].map(([v, icon]) => (
                    <button key={v} onClick={() => setFollowView(v)} style={{ background: followView === v ? 'rgba(0,229,160,.18)' : 'none', border: 'none', color: followView === v ? '#00E5A0' : 'var(--muted)', padding: '5px 10px', cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'background .15s, color .15s' }}>{icon}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Filter pills row + View all on the right */}
            {(() => {
              const PILL_COLORS = { ALL: { col: 'var(--muted)', rgb: '150,150,170' }, ARTIST: { col: 'var(--neon2)', rgb: '0,229,255' }, BAND: { col: '#FF8C42', rgb: '255,140,66' }, HOST: { col: '#FF3399', rgb: '255,51,153' }, COMEDY: { col: '#FF88AA', rgb: '255,136,170' } };
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                    {FILTER_TYPES.map(f => {
                      const pc = PILL_COLORS[f] || PILL_COLORS.ALL;
                      const active = followFilter === f;
                      return (
                        <button key={f} onClick={() => setFollowFilter(f)} style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '4px 12px', borderRadius: 14, border: `1px solid`, borderColor: active ? pc.col : 'var(--border)', background: active ? `rgba(${pc.rgb},.15)` : 'var(--card2)', color: active ? pc.col : 'var(--muted)', cursor: 'pointer', transition: 'all .15s' }}>{FILTER_LABELS[f]}</button>
                      );
                    })}
                  </div>
                  {(regularsShowAll || filtered.length > 3) && (
                    <span onClick={() => { setRegularsShowAll(v => !v); setRegularsSearch(''); }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = regularsShowAll ? 'var(--text)' : 'var(--muted)'} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: regularsShowAll ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', opacity: regularsShowAll ? 1 : 0.7, flexShrink: 0, transition: 'opacity .15s, color .15s' }}>{regularsShowAll ? 'View less' : 'View all >'}</span>
                  )}
                </div>
              );
            })()}

            {loadingFollow ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>
            ) : following.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Follow artists from their profiles to build your roster here.</p>
            ) : filtered.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>No {followFilter.toLowerCase()}s in your following list.</p>
            ) : regularsShowAll ? (
              // Expanded: search + portrait grid
              <div>
                <input
                  value={regularsSearch}
                  onChange={e => setRegularsSearch(e.target.value)}
                  placeholder="Search name, location, vibe..."
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10, outline: 'none' }}
                />
                {(() => {
                  const q = regularsSearch.toLowerCase();
                  const visible = filtered.filter(p => !q || ['name','location','sound','type'].some(k => p[k]?.toLowerCase().includes(q)));
                  return visible.length === 0
                    ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>
                    : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
                        {visible.map(p => <PortraitCard key={p.user_id} profile={p} width={150} height={200} />)}
                      </div>;
                })()}
              </div>
            ) : followView === 'portrait' ? (
              // Compact: horizontal drag scroll
              <div ref={regularsDrag.ref} onMouseDown={regularsDrag.onMouseDown} onMouseMove={regularsDrag.onMouseMove} onMouseUp={regularsDrag.onMouseUp} onMouseLeave={regularsDrag.onMouseLeave} style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', cursor: 'grab', userSelect: 'none' }}>
                {filtered.map(p => (
                  <PortraitCard key={p.user_id} profile={p} width={150} height={200} />
                ))}
              </div>
            ) : (
              // Compact: landscape list
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(p => (
                  <ProfileCard key={p.user_id} item={p} actions={
                    <button
                      onClick={() => setInviteArtist(p)}
                      style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,229,160,.4)', background: 'rgba(0,229,160,.08)', color: '#00E5A0', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s' }}
                    >INVITE →</button>
                  } />
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
          onClose={() => setInviteArtist(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
        background: hov ? 'rgba(0,229,160,.06)' : 'rgba(255,255,255,.03)',
        border: hov ? '1px solid rgba(0,229,160,.25)' : '1px solid var(--border)',
        transition: 'background .2s, border-color .2s',
      }}
    >
      <p style={{ fontFamily: "'Bebas Neue'", fontSize: 26, color: '#00E5A0', letterSpacing: 1 }}>{value}</p>
      <p style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, fontFamily: "'Bebas Neue'" }}>{label}</p>
    </div>
  );
}

function VenueAvailCalendar({ availability, onToggle, onClose }) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  const year     = month.getFullYear();
  const monthIdx = month.getMonth();
  const label    = month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
  const firstDay = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const availSet = new Set(availability);
  const futureCount = availability.filter(d => d >= todayStr).length;

  const DAY_LABELS = ['S','M','T','W','T','F','S'];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#00E5A0' }}>VENUE AVAILABILITY</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Tap dates your venue is available for hire. Promoters will see this when browsing venues.</p>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => setMonth(new Date(year, monthIdx - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{label}</span>
          <button onClick={() => setMonth(new Date(year, monthIdx + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
        </div>
        {/* Day-of-week labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'", paddingBottom: 2 }}>{d}</div>
          ))}
        </div>
        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 16 }}>
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(monthIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isPast  = dateStr < todayStr;
            const isAvail = availSet.has(dateStr);
            const isToday = dateStr === todayStr;
            return (
              <div
                key={dateStr}
                onClick={() => !isPast && onToggle(dateStr)}
                style={{
                  textAlign: 'center', padding: '7px 2px', borderRadius: 6, fontSize: 13,
                  cursor: isPast ? 'default' : 'pointer',
                  background: isAvail ? 'rgba(0,229,160,.18)' : 'rgba(255,255,255,.04)',
                  color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? '#00E5A0' : 'var(--text)',
                  border: isAvail ? '1px solid rgba(0,229,160,.5)' : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
                  transition: 'background .15s',
                }}
              >{day}</div>
            );
          })}
        </div>
        {/* Count */}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {futureCount ? `${futureCount} date${futureCount !== 1 ? 's' : ''} marked available` : 'No dates marked yet'}
        </div>
      </div>
    </div>
  );
}


function Section({ title, subtitle, action, onAction, viewAll, onViewAll, green, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5 }}>
            <span style={{ color: '#fff' }}>{title}</span>
          </p>
          {subtitle && <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.3 }}>{subtitle}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {action && <button onClick={onAction} className={s.viewAllBtn}>{action}</button>}
        {viewAll && <button onClick={onViewAll} className={s.viewAllBtn}>{viewAll}</button>}
      </div>
      {children}
    </div>
  );
}

function HoverPill({ label, accentRgb, accent }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? `rgba(${accentRgb},.25)` : `rgba(${accentRgb},.1)`,
        border: `1px solid ${hov ? accent : `rgba(${accentRgb},.3)`}`,
        borderRadius: 20, fontSize: 10, padding: '2px 8px',
        color: accent, cursor: 'default', transition: 'all .15s',
      }}
    >{label}</span>
  );
}

function HoverProfileBtn({ expanded, onClick, compact }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
        fontFamily: "'Bebas Neue'", letterSpacing: 1.5,
        background: hov ? 'rgba(255,51,153,.22)' : 'rgba(255,51,153,.1)',
        border: `1px solid ${hov ? '#FF69B4' : 'rgba(255,51,153,.35)'}`,
        color: '#fff',
        ...(compact
          ? { fontSize: 10, padding: '3px 8px' }
          : { fontSize: 10, padding: '4px 10px' }),
      }}
    >{expanded ? 'HIDE ▲' : 'MORE INFO ▼'}</button>
  );
}

function HoverBtn({ onClick, disabled, base, hover, children }) {
  const [hov, setHov] = useState(false);
  const st = hov && !disabled ? hover : base;
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
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

function DateChip({ label, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      className={s.chip}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        cursor: 'pointer',
        color: hov ? '#fff' : undefined,
        borderColor: hov ? 'rgba(255,255,255,.3)' : undefined,
        background: hov ? 'rgba(255,255,255,.06)' : undefined,
      }}
    >{label}</span>
  );
}

function EnqTabBtn({ active, color, rgb, onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
        transition: 'background .15s, border-color .15s, color .15s',
        background: active ? `rgba(${rgb},.12)` : hov ? `rgba(${rgb},.08)` : 'transparent',
        border: `1.5px solid ${active ? color : hov ? `rgba(${rgb},.6)` : 'rgba(255,255,255,.12)'}`,
        color: active || hov ? color : 'var(--muted)',
      }}
    >{children}</button>
  );
}

function EnquiryCard({ enq, onRespond }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const { setPlayer } = usePlayer();
  const expandRef = useRef(null);

  useEffect(() => {
    if (expanded && expandRef.current) {
      setTimeout(() => {
        expandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 50);
    }
  }, [expanded]);
  const displayStatus = normaliseStatus(enq);
  const enqDir = (enq.direction || 'incoming').toLowerCase();

  const TYPE_ACCENT  = { artist: '#00E5FF', band: '#FF8C42', standup: '#FF88AA', host: '#FF3399' };
  const TYPE_RGB     = { artist: '0,229,255', band: '255,140,66', standup: '255,136,170', host: '255,51,153' };
  const TYPE_LABEL   = { artist: 'DJ / PRODUCER', band: 'BAND', standup: 'SPOKEN', host: 'HOST', venue: 'VENUE' };
  const accent    = TYPE_ACCENT[enq.applicant_type] || '#00E5FF';
  const accentRgb = TYPE_RGB[enq.applicant_type]    || '0,229,255';

  const statusColor = {
    new: '#FFD700', awaiting: '#FFD700',
    shortlisted: '#00B4D8', interested: '#00B4D8',
    accepted: '#00E5A0', booked: '#00E5A0',
    declined: 'var(--muted)',
  }[displayStatus] || '#FFD700';

  useState(() => {
    if (!enq.applicant_user_id) return;
    supabase.from('profiles').select('*').eq('user_id', enq.applicant_user_id).eq('type', enq.applicant_type || 'artist').maybeSingle()
      .then(({ data }) => data && setProfile(data));
  }, [enq.applicant_user_id]);

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await supabase.from('venue_enquiries').update({ status }).eq('id', enq.id);
    onRespond(enq.id, status);

    // Notify the artist/applicant
    const artistId = enq.applicant_user_id;
    const venueName = enq.venue_name || 'A venue';
    const eventName = enq.event_name || null;

    const NOTIF = {
      shortlisted:  { type: 'shortlisted',         message: `${venueName} shortlisted you${eventName ? ` for ${eventName}` : ''}.` },
      accepted:     { type: 'booking_confirmed',    message: `${venueName} accepted you${eventName ? ` for ${eventName}` : ''}. You're booked!` },
      booked:       { type: 'booking_confirmed',    message: `${venueName} confirmed your booking${eventName ? ` for ${eventName}` : ''}.` },
      declined:     { type: 'application_declined', message: `${venueName} passed on your application${eventName ? ` for ${eventName}` : ''}.` },
      interested:   { type: 'shortlisted',          message: `${venueName} is interested in your enquiry${eventName ? ` for ${eventName}` : ''}.` },
    };

    const notif = NOTIF[status];
    if (notif && artistId) {
      await writeNotification(artistId, notif.type, notif.message, { event_name: eventName, venue_name: venueName, enquiry_id: enq.id });
    }

    setBusy(false);
  }

  const p = profile || {};
  const name = p.name || enq.name || '—';
  const loc  = [p.location, p.state].filter(Boolean).join(', ');
  const avatar = p.avatar || null;
  const allTags = [...new Set([
    ...(p.genre_string || '').split(/[,·]/).map(s => s.trim()),
    ...(p.vibe_tags    || '').split(',').map(s => s.trim()),
    ...(p.card_pills   || '').split(',').map(s => s.trim()),
  ].filter(Boolean))];
  const dateLabel    = enq.date_requested ? formatDisplayDate(enq.date_requested) : enq.preferred_date ? formatDisplayDate(enq.preferred_date) : 'Flexible date';
  const appliedLabel = enq.created_at ? new Date(enq.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const sound = p.sound || p.genre_string?.split(/[·,]/).slice(0,3).join(' · ') || '';
  const bio   = p.bio ? p.bio.substring(0, 80) + (p.bio.length > 80 ? '…' : '') : '';

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Discover-style card */}
      <div className={ds.card} style={{ border: `1px solid rgba(${accentRgb},.35)`, cursor: 'default', marginBottom: 0, borderRadius: expanded ? '14px 14px 0 0' : 14 }}>
        {/* Avatar */}
        {avatar
          ? <img className={ds.cardAvatar} src={avatar} alt={name} style={{ borderColor: accent }} />
          : <div className={ds.cardAvatarPH} style={{ borderColor: accent }}>🎵</div>
        }
        {/* Info */}
        <div className={ds.cardInfo}>
          <div className={ds.cardNameRow}>
            <span className={ds.cardName}>{name}</span>
            <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>{TYPE_LABEL[(p.role || enq.applicant_type || 'artist').toLowerCase()] || (p.role || enq.applicant_type || 'artist').toUpperCase()}</span>
          </div>
          {loc && <div className={ds.cardLoc}>{loc}</div>}
          {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
          {/* Genre pills */}
          {allTags.length > 0 && (
            <div className={s.enqTags}>
              {allTags.slice(0, 5).map(g => (
                <HoverPill key={g} label={g} accentRgb={accentRgb} accent={accent} />
              ))}
            </div>
          )}
        </div>
        {/* Right: status pill → date box → profile button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span className={s.enqStatus} style={{ color: statusColor, borderColor: statusColor }}>
            {displayStatus.toUpperCase()}
          </span>
          {(() => {
            const raw = enq.date_requested || enq.preferred_date;
            if (!raw) return null;
            const d = new Date(raw + 'T12:00:00');
            const dn = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
            const mo = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();
            const num = d.getDate();
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid rgba(0,229,160,.5)', background: 'rgba(0,229,160,.08)', borderRadius: 7, padding: '4px 8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(0,229,160,.7)', lineHeight: 1 }}>{dn}</span>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(0,229,160,.7)', lineHeight: 1 }}>{mo}</span>
                </div>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 26, color: '#00E5A0', lineHeight: 1 }}>{num}</span>
              </div>
            );
          })()}
          <HoverProfileBtn expanded={expanded} onClick={() => setExpanded(e => !e)} />
        </div>
      </div>

      {/* Expanded profile details */}
      {expanded && profile && (
        <div ref={expandRef} style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {p.bio && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>ABOUT</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.bio}</span>
                {p.bio.length > 60 && <span onClick={() => setBioOpen(true)} style={{ color: 'var(--muted)', fontSize: 11, cursor: 'pointer', flexShrink: 0, letterSpacing: .5 }}>see more</span>}
              </div>
            </div>
          )}
          {[
            ['DATE REQ', dateLabel],
            ['APPLIED',  appliedLabel || null],
            ['SOUND',    p.sound],
            ['EST.',     p.years ? `Est. ${p.years}` : null],
            ['FEE',      [p.fee ? `$${p.fee}` : null, p.fee_type === 'paid' ? 'Paid' : p.fee_type === 'exposure' ? 'Exposure/door deal' : null].filter(Boolean).join(' — ') || null],
            ['EMAIL',    p.email || p.contactEmail],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>{label}</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{value}</div>
            </div>
          ))}
          {(p.mix_link || p.soundcloud || p.mixcloud) && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>MIX / DEMO</div>
              <button onClick={() => setPlayer({ url: p.mix_link || p.soundcloud || p.mixcloud, artistName: name })} style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: accent, cursor: 'pointer', textAlign: 'left' }}>Play demo</button>
            </div>
          )}
          {p.instagram && p.instagram !== 'N/A' && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>INSTAGRAM</div>
              {(() => { const h = p.instagram.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/?/i, '').replace(/\/$/, ''); return <a href={`https://instagram.com/${h}`} target="_blank" rel="noopener" style={{ fontSize: 13, color: accent }}>@{h}</a>; })()}
            </div>
          )}
          {enq.applicant_user_id && (
            <div style={{ padding: '10px 0 4px' }}>
              <button
                onClick={() => navigate('/profile/' + enq.applicant_user_id + '?type=' + (enq.applicant_type || 'artist'))}
                style={{ width: 'fit-content', background: `rgba(${accentRgb},.08)`, border: `1px solid rgba(${accentRgb},.4)`, borderRadius: 10, padding: '8px 14px', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: accent, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = `rgba(${accentRgb},.18)`; e.currentTarget.style.borderColor = accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = `rgba(${accentRgb},.08)`; e.currentTarget.style.borderColor = `rgba(${accentRgb},.4)`; }}
              >VIEW FULL PROFILE →</button>
            </div>
          )}
          {(() => {
            const declineBtn = (
              <HoverBtn onClick={() => respond('declined')} disabled={busy}
                base={{ bg: 'rgba(255,80,80,.06)', border: '1px solid rgba(255,80,80,.2)', color: 'var(--muted)' }}
                hover={{ bg: 'rgba(255,80,80,.2)', border: '1px solid #ff5050', color: '#ff5050' }}
              >DECLINE ✗</HoverBtn>
            );
            if (enqDir === 'incoming') {
              if (displayStatus === 'new') return (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <HoverBtn onClick={() => respond('shortlisted')} disabled={busy}
                    base={{ bg: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
                    hover={{ bg: 'rgba(0,180,216,.28)', border: '1px solid #00B4D8' }}
                  >SHORTLIST ★</HoverBtn>
                  <HoverBtn onClick={() => respond('accepted')} disabled={busy}
                    base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                    hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
                  >ACCEPT ✓</HoverBtn>
                  {declineBtn}
                </div>
              );
              if (displayStatus === 'shortlisted') return (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <HoverBtn onClick={() => respond('accepted')} disabled={busy}
                    base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                    hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
                  >ACCEPT ✓</HoverBtn>
                  {declineBtn}
                </div>
              );
            }
            if (enqDir === 'outgoing') {
              if (displayStatus === 'awaiting') return (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <HoverBtn onClick={() => respond('interested')} disabled={busy}
                    base={{ bg: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
                    hover={{ bg: 'rgba(0,180,216,.28)', border: '1px solid #00B4D8' }}
                  >INTERESTED ✓</HoverBtn>
                  {declineBtn}
                </div>
              );
              if (displayStatus === 'interested') return (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <HoverBtn onClick={() => respond('accepted')} disabled={busy}
                    base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                    hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
                  >CONFIRM ✓</HoverBtn>
                  {declineBtn}
                </div>
              );
            }
            if (displayStatus === 'accepted') return (
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <HoverBtn onClick={() => respond('booked')} disabled={busy}
                  base={{ bg: 'rgba(0,229,160,.15)', border: '1px solid rgba(0,229,160,.5)', color: '#00E5A0' }}
                  hover={{ bg: 'rgba(0,229,160,.35)', border: '1px solid #00E5A0' }}
                >CONFIRM BOOKED ✓</HoverBtn>
                {declineBtn}
              </div>
            );
            return null;
          })()}
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
