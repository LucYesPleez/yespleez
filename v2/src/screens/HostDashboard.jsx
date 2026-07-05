import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './HostDashboard.module.css';
import ds from './DiscoverScreen.module.css';
import GlobalEventCard from '../components/EventCard';
import ProfileCard from '../components/ProfileCard';
import { getEventBadges } from '../lib/eventBadges';

export default function HostDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const userId = userIdProp || session?.user?.id;
  const navigate = useNavigate();

  const [activeTab,      setActiveTab]      = useState('events');
  const [evtTab,         setEvtTab]         = useState('UPCOMING');
  const [showAllEvts,    setShowAllEvts]    = useState(false);
  const [appTab,         setAppTab]         = useState('NEW');
  const [appSearch,      setAppSearch]      = useState('');
  const [allApps,        setAllApps]        = useState([]);
  const [appProfiles,    setAppProfiles]    = useState({});
  const [loadingApps,    setLoadingApps]    = useState(false);
  const [lineups,        setLineups]        = useState([]);
  const [loadingLineups, setLoadingLineups] = useState(false);
  const [following,      setFollowing]      = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
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

  // Load applications lazily
  useEffect(() => {
    if (activeTab !== 'applications' || !userId || appsLoaded.current) return;
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
          .select('user_id, name, avatar, type, sound, genre_string, location, bio, mix_link').in('user_id', artistIds);
        const map = {};
        (profs || []).forEach(p => { map[p.user_id] = p; });
        setAppProfiles(map);
      }
      setLoadingApps(false);
    }
    loadApps();
  }, [activeTab, userId]);

  // Load lineups lazily
  useEffect(() => {
    if (activeTab !== 'lineups' || !userId || lineupsLoaded.current) return;
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
      setLineups(Object.values(grouped).filter(g => g.event));
      setLoadingLineups(false);
    }
    loadLineups();
  }, [activeTab, userId]);

  // Load following on mount
  useEffect(() => {
    if (!userId) return;
    setLoadingFollowing(true);
    async function loadFollowing() {
      const { data: rows } = await supabase.from('follows')
        .select('entity_id').eq('user_id', userId).neq('entity_type', 'event');
      const ids = (rows || []).map(r => r.entity_id).filter(Boolean);
      if (!ids.length) { setLoadingFollowing(false); return; }
      const { data: profs } = await supabase.from('profiles')
        .select('user_id, name, avatar, type, sound, genre_string, location, bio').in('user_id', ids);
      // Dedupe by user_id, preferring venue/artist over punter
      const seen = {};
      (profs || []).forEach(p => {
        if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p;
      });
      setFollowing(Object.values(seen));
      setLoadingFollowing(false);
    }
    loadFollowing();
  }, [userId]);

  async function respondApp(appId, status) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
  }

  // Event map for app cards
  const evtMap = Object.fromEntries(events.map(e => [e.id, e]));

  // Pre-compute event lists
  const todayStr    = new Date().toISOString().split('T')[0];
  const draftEvents    = events.filter(ev => ev.status === 'draft');
  const liveEvents     = events.filter(ev => ev.status === 'live' && (ev.config?.date || '') >= todayStr);
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && ev.status !== 'completed' && (ev.config?.date || '') >= todayStr)
                               .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  const pastEvents     = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') < todayStr)
                               .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
  const evtTabEvents   = evtTab === 'UPCOMING' ? upcomingEvents
                       : evtTab === 'LIVE'     ? liveEvents
                       : evtTab === 'DRAFTS'   ? draftEvents
                       : pastEvents;

  // Pre-compute application lists
  const newApps       = allApps.filter(a => a.status === 'pending');
  const tentativeApps = allApps.filter(a => a.status === 'tentative');
  const acceptedApps  = allApps.filter(a => a.status === 'accepted');
  const declinedApps  = allApps.filter(a => a.status === 'rejected' || a.status === 'declined');
  const filteredApps  = appTab === 'NEW'       ? newApps
                      : appTab === 'TENTATIVE' ? tentativeApps
                      : appTab === 'ACCEPTED'  ? acceptedApps
                      : appTab === 'DECLINED'  ? declinedApps
                      : [];
  const searchedApps = !appSearch.trim() ? filteredApps
    : filteredApps.filter(app => {
        const q = appSearch.toLowerCase();
        const p = appProfiles[app.artist_id] || {};
        return (app.artist_name || '').toLowerCase().includes(q)
          || (p.name || '').toLowerCase().includes(q)
          || (p.genre_string || '').toLowerCase().includes(q)
          || (p.sound || '').toLowerCase().includes(q)
          || (app.note || '').toLowerCase().includes(q);
      });

  // Needs attention
  const attentionItems = [];
  if ((newAppsCount ?? 0) > 0)  attentionItems.push(`${newAppsCount} new application${newAppsCount !== 1 ? 's' : ''}`);
  if (draftEvents.length  > 0)  attentionItems.push(`${draftEvents.length} unpublished event${draftEvents.length !== 1 ? 's' : ''}`);

  const genres = profile?.genre_string || '';
  const hasProfile = !!profile;
  const completionPct = !hasProfile ? 0
    : [profile.name, profile.avatar, profile.location, profile.sound, profile.tagline, profile.genre_string, profile.bio, profile.website]
        .filter(Boolean).length / 8 * 100;

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.headerRow}>
        <div className={s.heading}>HOST /<br />PROMOTER</div>
        {userId && (
          <button
            title="Preview your public profile"
            onClick={() => navigate(`/profile/${userId}`)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Profile card */}
      <div className={s.profileCard} onClick={() => navigate('/industry/host/setup')}>
        <div className={s.avatarBox}>
          {profile?.avatar
            ? <img src={profile.avatar} alt={profile.name} className={s.avatarImg} />
            : <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,51,153,.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2"/><line x1="9" y1="5.5" x2="15" y2="5.5" strokeWidth="1.5" strokeLinecap="round"/></svg>
          }
        </div>
        <div className={s.profileInfo}>
          <div className={s.profileName}>{profile?.name || 'Set up your host profile'}</div>
          <div className={s.profileSub}>{profile?.location || 'Add your details so artists can find you'}</div>
          {genres ? <div className={s.profileGenres}>{genres.split(' · ').slice(0, 4).join(' · ')}</div> : null}
        </div>
        <div className={s.profileCta}>{profile?.name ? 'EDIT →' : 'SET UP →'}</div>
      </div>

      {/* Completion bar */}
      {hasProfile && (
        <div className={s.completionWrap}>
          <div className={s.completionBar}>
            <div className={s.completionFill} style={{ width: `${completionPct}%` }} />
          </div>
          <p className={s.completionLabel}>COMPLETE YOUR PROFILE — {Math.round(completionPct)}%</p>
        </div>
      )}

      {/* Needs Attention */}
      {attentionItems.length > 0 && (
        <div className={s.attention}>
          <span className={s.attentionDot} />
          <span className={s.attentionText}>{attentionItems.join(' · ')}</span>
        </div>
      )}

      {/* Stats — tappable nav */}
      <div className={s.stats}>
        <StatBox label="EVENTS"       value={loadingEvents ? '—' : events.length}               active={activeTab === 'events'}       onClick={() => setActiveTab('events')} />
        <StatBox label="APPLICATIONS" value={newAppsCount === null ? '—' : newAppsCount}         active={activeTab === 'applications'} onClick={() => setActiveTab('applications')} />
        <StatBox label="LINEUP SLOTS" value={lineupSlotsCount === null ? '—' : lineupSlotsCount} active={activeTab === 'lineups'}      onClick={() => setActiveTab('lineups')} />
      </div>

      {/* ── EVENTS TAB ── */}
      {activeTab === 'events' && (
        <div>
          <div className={s.subTabBar}>
            {[
              ['UPCOMING', upcomingEvents.length],
              ['DRAFTS',   draftEvents.length],
              ['PAST',     pastEvents.length],
            ].map(([t, count]) => (
              <button key={t} className={s.subTab}
                style={{ borderBottomColor: evtTab === t ? 'var(--neon2)' : 'transparent', color: evtTab === t ? 'var(--text)' : 'var(--muted)' }}
                onClick={() => { setEvtTab(t); setShowAllEvts(false); }}
              >
                {t}<span className={s.subTabCount}>{count}</span>
              </button>
            ))}
          </div>
          {loadingEvents
            ? <p className={s.empty}>Loading events…</p>
            : evtTabEvents.length === 0
              ? <p className={s.empty}>No {evtTab.toLowerCase()} events.</p>
              : <><div className={s.evtListHeader}>
                  {evtTabEvents.length > 3 && <button className={s.viewAll} style={{ marginLeft:'auto' }} onClick={() => setShowAllEvts(v => !v)}>{showAllEvts ? 'Show less ↑' : 'View all →'}</button>}
                </div>
                <div className={s.evtList} style={showAllEvts ? { maxHeight:'none', maskImage:'none', WebkitMaskImage:'none', overflowY:'visible' } : {}}>
                  {evtTabEvents.map(ev => {
                    const isLive      = ev.status === 'live';
                    const isCompleted = ev.status === 'completed' || (isLive && (ev.config?.date || '') < todayStr);
                    const cfg      = ev.config || {};
                    const appsOpen = cfg.applications_open === true || ev.applications_open === true;
                    const isPublic = cfg.is_public !== false && ev.is_public !== false;
                    const statusLabel = isCompleted ? 'FINISHED' : isLive ? 'LIVE' : 'DRAFT';
                    const statusCol   = isCompleted ? 'var(--muted)' : isLive ? '#00e676' : 'var(--muted)';
                    const statusBg    = isCompleted ? 'rgba(120,120,160,.1)' : isLive ? 'rgba(0,230,118,.1)' : 'rgba(120,120,160,.1)';
                    const statusBdr   = isCompleted ? 'rgba(120,120,160,.3)' : isLive ? 'rgba(0,230,118,.35)' : 'rgba(120,120,160,.3)';
                    return (
                      <div key={ev.id} className={s.evtCardWrap} onClick={() => navigate(`/event/${ev.id}`)}>
                        <GlobalEventCard event={ev} noHover />
                        <div style={{ position:'absolute', top:12, right:12, display:'flex', gap:4, alignItems:'center' }}>
                          {getEventBadges(ev.config?.genres || '', ev.name || '').map(p => (
                            <span key={p.label} style={{ fontSize:9, fontFamily:"'DM Sans',sans-serif", fontWeight:700, letterSpacing:.8, color: p.col, background: p.bg, borderRadius:6, padding:'3px 8px' }}>{p.label}</span>
                          ))}
                          <span style={{ fontSize:9, fontFamily:"'Bebas Neue'", letterSpacing:1.2, color: statusCol, background: statusBg, border:`1px solid ${statusBdr}`, borderRadius:4, padding:'2px 7px' }}>
                            {statusLabel}
                          </span>
                        </div>
                        <div style={{ position:'absolute', bottom:12, right:12, display:'flex', gap:6, alignItems:'center' }}>
                          {isLive && !isCompleted && (
                            <span style={{ fontSize:9, fontFamily:"'Bebas Neue'", letterSpacing:1.2, color: appsOpen ? '#00e676' : 'var(--muted)', background: appsOpen ? 'rgba(0,230,118,.12)' : 'rgba(120,120,160,.12)', border:`1px solid ${appsOpen ? 'rgba(0,230,118,.4)' : 'rgba(120,120,160,.3)'}`, borderRadius:4, padding:'2px 6px' }}>
                              {appsOpen ? 'APPS OPEN' : 'APPS CLOSED'}
                            </span>
                          )}
                          {!isCompleted && (
                            <span style={{ fontSize:9, fontFamily:"'Bebas Neue'", letterSpacing:1.2, color: isPublic ? 'var(--neon2)' : 'var(--muted)', background: isPublic ? 'rgba(0,229,255,.08)' : 'rgba(120,120,160,.08)', border:`1px solid ${isPublic ? 'rgba(0,229,255,.25)' : 'rgba(120,120,160,.25)'}`, borderRadius:4, padding:'2px 6px' }}>
                              {isPublic ? 'PUBLIC' : 'PRIVATE'}
                            </span>
                          )}
                          {!isCompleted && (
                            <button
                              style={{ fontSize:10, fontFamily:"'Bebas Neue'", letterSpacing:1.5, color:'#fff', background:'rgba(255,51,153,.45)', border:'1px solid rgba(255,51,153,.6)', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}
                              onClick={e => { e.stopPropagation(); navigate(`/create-event?edit=${ev.id}`); }}
                            >EDIT →</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div></>
          }
          <button className={s.createBtn} onClick={() => navigate('/create-event')}>
            + CREATE NEW EVENT
          </button>
        </div>
      )}

      {/* ── APPLICATIONS TAB ── */}
      {activeTab === 'applications' && (
        <div>
          {/* Pill tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { key: 'NEW',       color: '#FFD700', rgb: '255,215,0',   count: newApps.length },
              { key: 'TENTATIVE', color: '#00B4D8', rgb: '0,180,216',   count: tentativeApps.length },
              { key: 'ACCEPTED',  color: '#00E5A0', rgb: '0,229,160',   count: acceptedApps.length },
              { key: 'DECLINED',  color: '#888',    rgb: '120,120,160', count: declinedApps.length },
              { key: 'INVITED',   color: '#FF88AA', rgb: '255,136,170', count: 0 },
            ].map(({ key, color, rgb, count }) => (
              <PillTab key={key} label={count > 0 ? key + ' (' + count + ')' : key}
                color={color} rgb={rgb} active={appTab === key} onClick={() => setAppTab(key)} />
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              placeholder="Search by name, genre, vibe…"
              value={appSearch}
              onChange={e => setAppSearch(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px 10px 36px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {loadingApps ? (
            <p className={s.empty}>Loading applications…</p>
          ) : appTab === 'INVITED' ? (
            <p className={s.empty}>Send invites directly from an artist's profile.</p>
          ) : searchedApps.length === 0 ? (
            <p className={s.empty}>No {appTab.toLowerCase()} applications{appSearch ? ' matching your search' : ''}.</p>
          ) : (
            <div>
              {searchedApps.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  prof={appProfiles[app.artist_id] || {}}
                  event={evtMap[app.event_id]}
                  onRespond={respondApp}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LINEUPS TAB ── */}
      {activeTab === 'lineups' && (
        <div>
          {loadingLineups ? (
            <p className={s.empty}>Loading lineups…</p>
          ) : lineups.length === 0 ? (
            <p className={s.empty}>No confirmed artists yet. Accept applications to build your lineup.</p>
          ) : (
            lineups.map(({ event: ev, artists }) => {
              const evName = ev.name || ev.config?.name || 'Untitled Event';
              const evDate = ev.config?.date ? new Date(ev.config.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
              return (
                <div key={ev.id} className={s.lineupGroup}>
                  <div className={s.lineupGroupHeader}>
                    <span className={s.lineupEventName}>{evName}</span>
                    {evDate && <span className={s.lineupEventDate}>{evDate}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                    {artists.map(a => {
                      const prof = a.profile || {};
                      const item = { ...prof, user_id: a.artist_id, name: prof.name || a.artist_name || `Artist #${a.artist_id?.slice(0,6)}`, type: prof.type || 'artist' };
                      return <ProfileCard key={a.id} item={item} badge="CONFIRMED" badgeColor="#00e676" />;
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── FOLLOWING — always at bottom ── */}
      <div className={s.followingSection}>
        <div className={s.followingHead}>
          <span className={s.followingLabel}>FOLLOWING</span>
          {following.length > 0 && <span className={s.followingCount}>{following.length}</span>}
        </div>
        {loadingFollowing ? (
          <p className={s.empty}>Loading…</p>
        ) : following.length === 0 ? (
          <p className={s.empty}>Follow artists from their profiles to build your roster here.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {following.map(prof => (
              <ProfileCard key={prof.user_id} item={prof} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, onClick, active }) {
  return (
    <div
      className={s.statBox}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', borderColor: active ? 'rgba(255,51,153,.5)' : undefined, transition: 'border-color .15s' }}
    >
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
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
    await onRespond(app.id, status);
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
          {allTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {allTags.slice(0, 5).map(g => (
                <span key={g} style={{ background: `rgba(${accentRgb},.1)`, border: `1px solid rgba(${accentRgb},.3)`, borderRadius: 20, fontSize: 10, padding: '2px 8px', color: accent }}>{g}</span>
              ))}
            </div>
          )}
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
