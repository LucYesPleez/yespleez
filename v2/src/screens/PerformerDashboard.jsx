import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import s from './ArtistDashboard.module.css'; // reuse identical layout styles
import EventCard from '../components/EventCard';

const CONFIG = {
  band: {
    headingLine1: 'BAND /',
    headingLine2: 'MUSO',
    gradient:    'linear-gradient(135deg,#FF4500,#FF8C42,#FFB830,#FFE066)',
    accent:      '#FF8C42',
    accentRgb:   '255,140,66',
    profileType: 'band',
    setupPlaceholder: 'Set up your band profile',
    setupSub:    'List your band, find gigs, connect with venues and promoters',
    availTable:  'artist_availability',
    browseLabel: 'BROWSE OPEN EVENTS →',
  },
  standup: {
    headingLine1: 'STAND UP',
    headingLine2: '/ POETRY',
    gradient:    'linear-gradient(90deg,#FF88AA,#BF5FFF)',
    accent:      '#FF88AA',
    accentRgb:   '255,136,170',
    profileType: 'standup',
    setupPlaceholder: 'Set up your comedy / poetry profile',
    setupSub:    'Create your profile to find open mics, festivals, and spoken word gigs',
    availTable:  'artist_availability',
    browseLabel: 'BROWSE OPEN CALLS →',
  },
};

export default function PerformerDashboard({ userId: userIdProp, role }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const cfg = CONFIG[role] || CONFIG.band;

  const { data, isLoading: loading } = useQuery({
    queryKey: ['performerDashboard', userId, role],
    queryFn: async () => {
      const [profRes, availRes, appsRes, gigsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', cfg.profileType).maybeSingle(),
        supabase.from(cfg.availTable).select('available_date').eq('user_id', userId).gte('available_date', today()).order('available_date').limit(10),
        supabase.from('applications').select('id, status, event_id, created_at').eq('artist_id', userId).order('created_at', { ascending: false }).limit(10),
        supabase.from('claims').select('event_id').eq('user_id', userId),
      ]);
      const appEventIds = [...new Set((appsRes.data || []).map(a => a.event_id).filter(Boolean))];
      let appEvents = {};
      if (appEventIds.length) {
        const { data: evData } = await supabase.from('events').select('id, name, config').in('id', appEventIds);
        (evData || []).forEach(ev => { appEvents[ev.id] = ev; });
      }
      const applications = (appsRes.data || []).map(a => ({ ...a, event: appEvents[a.event_id] || null }));

      // Load all gig events, split client-side
      const claimEventIds = [...new Set((gigsRes.data || []).map(c => c.event_id).filter(Boolean))];
      let allGigs = [];
      if (claimEventIds.length) {
        const { data: evs } = await supabase.from('events').select('id, name, config').in('id', claimEventIds);
        allGigs = evs || [];
      }
      const todayStr = today();
      const upcomingGigs = allGigs.filter(ev => (ev.config?.date || '') >= todayStr);
      const pastGigs     = allGigs.filter(ev => (ev.config?.date || '') < todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));

      return {
        profile:      profRes.data,
        availability: (availRes.data || []).map(r => r.available_date),
        applications,
        gigCount:     (gigsRes.data || []).length,
        upcomingGigs,
        pastGigs,
      };
    },
    enabled: !!userId,
  });

  const profile      = data?.profile      || null;
  const availability = data?.availability || [];
  const applications = data?.applications || [];
  const gigCount     = data?.gigCount     || 0;
  const upcomingGigs = data?.upcomingGigs || [];
  const pastGigs     = data?.pastGigs     || [];
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllPast,     setShowAllPast]     = useState(false);

  const hasProfile = !!profile;
  const completionPct = !hasProfile ? 0
    : [profile.name, profile.sound, profile.avatar, profile.genre_string, profile.mix_link, profile.tagline]
        .filter(Boolean).length / 6 * 100;
  const profileComplete = completionPct >= 100;
  const genres = profile?.genre_string || '';

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.headerRow}>
        <div className={s.heading} style={{ background: cfg.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {cfg.headingLine1}<br />{cfg.headingLine2}
        </div>
        {userId && (
          <button
            title="Preview your public profile"
            onClick={() => navigate(`/profile/${userId}?type=${cfg.profileType}`)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Profile card — accent color */}
      <div className={s.profileCard} onClick={() => navigate(`/industry/${cfg.profileType}/setup`)} style={{
        background: `rgba(${cfg.accentRgb},.06)`,
        borderColor: `rgba(${cfg.accentRgb},.25)`,
      }}>
        <div className={s.avatarBox} style={{
          background: `rgba(${cfg.accentRgb},.12)`,
          borderColor: `rgba(${cfg.accentRgb},.3)`,
        }}>
          {profile?.avatar
            ? <img src={profile.avatar} alt={profile.name} className={s.avatarImg} />
            : <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={cfg.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          }
        </div>
        <div className={s.profileInfo}>
          <div className={s.profileName}>{profile?.name || cfg.setupPlaceholder}</div>
          <div className={s.profileSub}>{profile?.sound || (profile ? profile.location : cfg.setupSub)}</div>
          {genres ? <div className={s.profileGenres} style={{ color: cfg.accent }}>{genres.split(' · ').slice(0,4).join(' · ')}</div> : null}
        </div>
        <div className={s.profileCta} style={{ color: cfg.accent }}>{profile?.name ? 'EDIT →' : 'SET UP →'}</div>
      </div>

      {hasProfile && !profileComplete && (
        <div className={s.completionWrap}>
          <div className={s.completionBar}>
            <div className={s.completionFill} style={{ width: `${completionPct}%`, background: cfg.accent }} />
          </div>
          <p className={s.completionLabel}>COMPLETE YOUR PROFILE — {Math.round(completionPct)}%</p>
        </div>
      )}

      <div className={s.stats}>
        <Stat label="GIGS PLAYED"  value={loading ? '—' : gigCount}            accent={cfg.accent} />
        <Stat label="APPLICATIONS" value={loading ? '—' : applications.length} accent={cfg.accent} />
        <Stat label="AVAIL. DATES" value={loading ? '—' : availability.length} accent={cfg.accent} />
      </div>

      <Section title="MY AVAILABILITY" action="MANAGE" accent={cfg.accent}>
        {loading
          ? <p className={s.empty}>Loading…</p>
          : availability.length === 0
            ? <p className={s.empty}>No upcoming availability set.</p>
            : <div className={s.chips}>
                {availability.map(d => (
                  <span key={d} className={s.chip} style={{ color: cfg.accent, borderColor: `rgba(${cfg.accentRgb},.35)` }}>
                    {formatDisplayDate(d)}
                  </span>
                ))}
              </div>
        }
      </Section>

      <Section title="UPCOMING GIGS" accent={cfg.accent} action={upcomingGigs.length > 2 ? (showAllUpcoming ? 'View less ‹' : 'View all ›') : null} onAction={() => setShowAllUpcoming(v => !v)}>
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

      {(pastGigs.length > 0 || loading) && (
        <Section title="PAST GIGS" accent={cfg.accent} action={pastGigs.length > 2 ? (showAllPast ? 'View less ‹' : 'View all ›') : null} onAction={() => setShowAllPast(v => !v)}>
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

      <Section title="MY APPLICATIONS" accent={cfg.accent}>
        {loading
          ? <p className={s.empty}>Loading…</p>
          : applications.length === 0
            ? <p className={s.empty}>No applications yet.</p>
            : applications.map(app => <AppRow key={app.id} app={app} />)
        }
      </Section>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={s.statBox}>
      <div className={s.statValue} style={{ color: accent }}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function Section({ title, action, onAction, accent, children }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHeader}>
        <p className={s.sectionTitle}>{title}</p>
        {action && (
          <button className={s.sectionAction} style={{ color: accent, borderColor: `${accent}66` }} onClick={onAction}>
            {action}
          </button>
        )}
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
