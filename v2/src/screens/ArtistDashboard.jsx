import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import s from './ArtistDashboard.module.css';
import EventCard from '../components/EventCard';

export default function ArtistDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllPast,     setShowAllPast]     = useState(false);
  const [showAvailEdit,  setShowAvailEdit]  = useState(false);
  const [newDate,        setNewDate]        = useState('');
  const [availSaving,    setAvailSaving]    = useState(false);
  const [unclaimedProf,  setUnclaimedProf]  = useState(null);
  const [claiming,       setClaiming]       = useState(false);
  // Local copies of mutable data (availability can be added/removed without refetch)
  const [availability, setAvailability] = useState([]);
  const [availLoaded,  setAvailLoaded]  = useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['artistDashboard', userId],
    queryFn: async () => {
      const [profRes, availRes, appsRes, gigsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'artist').maybeSingle(),
        supabase.from('artist_availability').select('available_date').eq('user_id', userId).gte('available_date', today()).order('available_date').limit(20),
        supabase.from('applications').select('id, status, event_id, created_at').eq('artist_id', userId).order('created_at', { ascending: false }).limit(10),
        supabase.from('claims').select('event_id').eq('user_id', userId),
      ]);

      // Load all gigs from claims, split client-side into upcoming/past
      const claimEventIds = [...new Set((gigsRes.data || []).map(c => c.event_id).filter(Boolean))];
      let allGigs = [];
      if (claimEventIds.length) {
        const { data: evs } = await supabase.from('events').select('id, name, config').in('id', claimEventIds);
        allGigs = evs || [];
      }
      const todayStr = today();
      const upcomingGigs = allGigs.filter(ev => (ev.config?.date || '') >= todayStr);
      const pastGigs     = allGigs.filter(ev => (ev.config?.date || '') < todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));

      // Load event names for applications
      const appEventIds = [...new Set((appsRes.data || []).map(a => a.event_id).filter(Boolean))];
      let appEvents = {};
      if (appEventIds.length) {
        const { data: evData } = await supabase.from('events').select('id, name, config').in('id', appEventIds);
        (evData || []).forEach(ev => { appEvents[ev.id] = ev; });
      }
      const applications = (appsRes.data || []).map(a => ({ ...a, event: appEvents[a.event_id] || null }));

      // Check for unclaimed profile by email
      let unclaimedProf = null;
      if (session?.user?.email) {
        const { data: unclaimed } = await supabase
          .from('unclaimed_profiles')
          .select('*')
          .eq('claim_email', session.user.email)
          .limit(1)
          .maybeSingle();
        unclaimedProf = unclaimed || null;
      }

      return {
        profile:      profRes.data,
        availability: (availRes.data || []).map(r => r.available_date),
        applications,
        gigCount:     (gigsRes.data || []).length,
        upcomingGigs,
        pastGigs,
        unclaimedProf,
      };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const applications = data?.applications || [];
  const gigCount     = data?.gigCount     || 0;
  const upcomingGigs = data?.upcomingGigs || [];
  const pastGigs     = data?.pastGigs     || [];

  // Sync mutable availability into local state so add/remove works without refetch
  useEffect(() => {
    if (data?.availability && !availLoaded) {
      setAvailability(data.availability);
      setAvailLoaded(true);
    }
  }, [data?.availability]);

  // Sync unclaimed profile
  useEffect(() => {
    if (data?.unclaimedProf !== undefined) setUnclaimedProf(data.unclaimedProf);
  }, [data?.unclaimedProf]);

  async function claimProfile() {
    if (!userId || !unclaimedProf || claiming) return;
    setClaiming(true);
    await supabase.from('profiles').upsert({
      user_id: userId,
      type: 'artist',
      name: unclaimedProf.name,
      sound: unclaimedProf.sound,
      genre_string: unclaimedProf.genre_string,
      bio: unclaimedProf.bio,
      mix_link: unclaimedProf.mix_link,
    }, { onConflict: 'user_id,type' });
    await supabase.from('unclaimed_profiles').delete().eq('claim_email', session.user.email);
    setUnclaimedProf(null);
    setClaiming(false);
  }

  async function addDate() {
    if (!newDate || !userId || availSaving) return;
    setAvailSaving(true);
    await supabase.from('artist_availability').upsert({ user_id: userId, available_date: newDate }, { onConflict: 'user_id,available_date' });
    if (!availability.includes(newDate)) {
      setAvailability(prev => [...prev, newDate].sort());
    }
    setNewDate('');
    setAvailSaving(false);
  }

  async function removeDate(date) {
    await supabase.from('artist_availability').delete().eq('user_id', userId).eq('available_date', date);
    setAvailability(prev => prev.filter(d => d !== date));
  }

  const hasProfile = !!profile;
  const completionPct = !hasProfile ? 0 : (() => {
    const filled = v => !!(v && v !== 'N/A');
    const done   = v => !!(v === 'N/A' || (v && v.trim && v.trim()));
    const fields = [
      filled(profile.name),
      filled(profile.avatar),
      filled(profile.location),
      filled(profile.sound),
      filled(profile.tagline),
      filled(profile.bio),
      filled(profile.genre_string),
      filled(profile.mix_link),
      filled(profile.card_pills),
      filled(profile.fee_type),
      filled(profile.emergency_name),
      profile.has_abn !== null && profile.has_abn !== undefined,
      done(profile.soundcloud),
      done(profile.mixcloud),
      done(profile.instagram),
      done(profile.youtube),
      done(profile.facebook),
    ];
    return fields.filter(Boolean).length / fields.length * 100;
  })();
  const genres = profile?.genre_string || '';

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.headerRow}>
        <div className={s.heading}>DJ /<br />PRODUCER</div>
        {userId && (
          <button
            title="Preview your public profile"
            onClick={() => navigate(`/profile/${userId}?type=artist`)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Profile card */}
      <div className={s.profileCard} onClick={() => navigate('/industry/artist/setup')}>
        <div className={s.avatarBox}>
          {profile?.avatar
            ? <img src={profile.avatar} alt={profile.name} className={s.avatarImg} />
            : <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0,229,255,.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          }
        </div>
        <div className={s.profileInfo}>
          <div className={s.profileName}>{profile?.name || 'Set up your artist profile'}</div>
          <div className={s.profileSub}>{profile?.sound || (profile ? profile.location : 'Promoters will see this — takes 2 mins')}</div>
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

      {/* Unclaimed profile banner */}
      {unclaimedProf && (
        <div style={{ background: 'rgba(0,229,255,.08)', border: '1.5px solid rgba(0,229,255,.35)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: 'var(--neon2)', marginBottom: 4 }}>
            🎧 PROFILE WAITING FOR YOU
          </p>
          <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>
            <strong>{unclaimedProf.name}</strong> was listed by a promoter — claim it to take ownership.
          </p>
          <button
            onClick={claimProfile}
            disabled={claiming}
            style={{ background: 'var(--neon2)', color: '#000', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '8px 20px', borderRadius: 8, opacity: claiming ? .6 : 1 }}
          >
            {claiming ? 'CLAIMING…' : 'CLAIM THIS PROFILE'}
          </button>
        </div>
      )}

      {/* Stats */}
      <div className={s.stats}>
        <StatBox label="GIGS PLAYED"  value={loading ? '—' : gigCount} />
        <StatBox label="APPLICATIONS" value={loading ? '—' : applications.length} />
        <StatBox label="AVAIL. DATES" value={loading ? '—' : availability.length} />
      </div>

      {/* Availability */}
      <Section title="MY AVAILABILITY" action="MANAGE" onAction={() => setShowAvailEdit(v => !v)}>
        {loading
          ? <p className={s.empty}>Loading…</p>
          : <>
              {availability.length === 0 && !showAvailEdit && <p className={s.empty}>No upcoming availability set.</p>}
              {availability.length > 0 && (
                <div className={s.chips}>
                  {availability.map(d => (
                    <span key={d} className={s.chip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {formatDisplayDate(d)}
                      {showAvailEdit && (
                        <button onClick={() => removeDate(d)} style={{ background: 'none', border: 'none', color: 'var(--neon)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {showAvailEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    type="date"
                    min={today()}
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    style={{ flex: 1, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                  <button
                    onClick={addDate}
                    disabled={!newDate || availSaving}
                    style={{ background: 'var(--neon2)', color: '#000', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '8px 16px', borderRadius: 8, opacity: availSaving ? .6 : 1 }}
                  >
                    ADD
                  </button>
                </div>
              )}
            </>
        }
      </Section>

      {/* Upcoming gigs */}
      <Section title="UPCOMING GIGS" action={upcomingGigs.length > 2 ? (showAllUpcoming ? 'View less ‹' : 'View all ›') : null} onAction={() => setShowAllUpcoming(v => !v)}>
        {loading
          ? <p className={s.empty}>Loading…</p>
          : upcomingGigs.length === 0
            ? <p className={s.empty}>No upcoming bookings yet.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(showAllUpcoming ? upcomingGigs : upcomingGigs.slice(0, 2)).map(ev =>
                  <EventCard key={ev.id} event={ev} badge="PLAYING" badgeColor="#00e676" />
                )}
              </div>
        }
      </Section>

      {/* Past gigs */}
      {(pastGigs.length > 0 || loading) && (
        <Section title="PAST GIGS" action={pastGigs.length > 2 ? (showAllPast ? 'View less ‹' : 'View all ›') : null} onAction={() => setShowAllPast(v => !v)}>
          {loading
            ? <p className={s.empty}>Loading…</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(showAllPast ? pastGigs : pastGigs.slice(0, 2)).map(ev =>
                  <EventCard key={ev.id} event={ev} badge="PLAYED" badgeColor="var(--muted)" />
                )}
              </div>
          }
        </Section>
      )}

      {/* Applications */}
      <Section title={<>MY APPLICATIONS {applications.length > 0 && !loading && <span className={s.appsBadge}>{applications.length}</span>}</>}>
        {loading
          ? <p className={s.empty}>Loading…</p>
          : applications.length === 0
            ? <p className={s.empty}>No applications submitted yet.</p>
            : applications.map(app => <AppRow key={app.id} app={app} />)
        }
      </Section>

      {/* Open calls CTA */}
      <button className={s.browseBtn} onClick={() => navigate('/discover')}>
        BROWSE OPEN EVENTS →
      </button>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className={s.statBox}>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function Section({ title, action, onAction, children }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHeader}>
        <p className={s.sectionTitle}>{title}</p>
        {action && <button className={s.sectionAction} onClick={onAction}>{action}</button>}
      </div>
      {children}
    </div>
  );
}

function AppRow({ app }) {
  const statusColor = { accepted: '#00e676', pending: '#ffb830', rejected: '#ff2d78' }[app.status] || '#7070a0';
  if (!app.event) return null;
  return (
    <EventCard
      event={app.event}
      badge={(app.status || 'PENDING').toUpperCase()}
      badgeColor={statusColor}
    />
  );
}
