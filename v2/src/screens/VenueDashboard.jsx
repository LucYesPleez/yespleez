import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import EventCard from '../components/EventCard';
import s from './VenueDashboard.module.css';
import ds from './DiscoverScreen.module.css';

const ENQ_TABS = [
  { key: 'PENDING',  color: '#FFD700', rgb: '255,215,0' },
  { key: 'TENTATIVE', color: '#00B4D8', rgb: '0,180,216' },
  { key: 'ACCEPTED',  color: '#00E5A0', rgb: '0,229,160' },
];

export default function VenueDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const [enquiries,      setEnquiries]      = useState([]);
  const [enqTab,         setEnqTab]         = useState('PENDING');
  const [search,         setSearch]         = useState('');
  const [localAvail,     setLocalAvail]     = useState(null);
  const [showAvailCal,   setShowAvailCal]   = useState(false);
  const [showAllEvents,  setShowAllEvents]  = useState(false);
  const [showAllEnq,     setShowAllEnq]     = useState(false);
  const [showAllAvail,   setShowAllAvail]   = useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['venueDashboard', userId],
    queryFn: async () => {
      const [profRes, availRes, enqRes, evtRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'venue').maybeSingle(),
        supabase.from('venue_availability').select('available_date').eq('user_id', userId).gte('available_date', today()).order('available_date').limit(10),
        supabase.from('venue_enquiries').select('*').eq('venue_user_id', userId).order('created_at', { ascending: false }).limit(100),
        // Upcoming events where config->venue matches profile name — approximated with host_id for now
        supabase.from('events').select('id, name, config').eq('host_id', userId).eq('status', 'live').order('created_at', { ascending: false }).limit(200),
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
  const upcomingEvts = data?.upcomingEvts || [];

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
        const st = (e.status || 'pending').toLowerCase();
        return st === enqTab.toLowerCase();
      })
      .filter(e => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
  }, [allEnquiries, enqTab, search]);

  const hasProfile = !!profile;
  const eventsHosted  = upcomingEvts.length;
  const enquiryCount  = allEnquiries.length;
  const availCount    = availability.length;
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

      {/* Completion bar */}
      {hasProfile && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 2, color: 'var(--muted)' }}>PROFILE COMPLETION</span>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, color: '#00E5A0' }}>{Math.round(completionPct)}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${completionPct}%`, background: 'linear-gradient(90deg, #00E5A0, #00B4D8)', borderRadius: 3, transition: 'width .4s' }} />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className={s.stats}>
        <Stat label="EVENTS HOSTED" value={loading ? '—' : eventsHosted} />
        <Stat label="ENQUIRIES"     value={loading ? '—' : enquiryCount} />
        <Stat label="AVAIL. DATES"  value={loading ? '—' : availCount} />
      </div>

      {/* Availability */}
      <Section title="VENUE AVAILABILITY" action="MANAGE" onAction={() => setShowAvailCal(true)} viewAll={availability.length > 0 ? (showAllAvail ? 'View less ‹' : 'View all ›') : null} onViewAll={() => setShowAllAvail(v => !v)}>
        {availability.length === 0
          ? <p className={s.empty}>No upcoming dates set.</p>
          : <div className={s.chips} style={showAllAvail ? {} : { maxHeight: '72px', overflow: 'hidden' }}>
              {availability.map(d => (
                <span key={d} className={s.chip} style={enquiredDates.has(d) ? { color: '#00E5A0', borderColor: 'rgba(0,229,160,.4)', background: 'rgba(0,229,160,.12)' } : {}}>
                  {formatDisplayDate(d)}
                </span>
              ))}
            </div>
        }
      </Section>

      {/* Availability calendar modal */}
      {showAvailCal && (
        <VenueAvailCalendar
          availability={localAvail ?? []}
          onToggle={toggleDate}
          onClose={() => setShowAvailCal(false)}
        />
      )}

      {/* Upcoming events */}
      <Section title="UPCOMING EVENTS" action={showAllEvents ? 'View less ‹' : 'View all ›'} onAction={() => setShowAllEvents(v => !v)}>
        {upcomingEvts.length === 0
          ? <p className={s.empty}>No upcoming events.</p>
          : showAllEvents
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcomingEvts.map(ev => <EventCard key={ev.id} event={ev} />)}
              </div>
            : <div style={{ maxHeight: 292, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {upcomingEvts.map(ev => <EventCard key={ev.id} event={ev} />)}
              </div>
        }
      </Section>

      {/* Enquiries */}
      <Section title="ENQUIRIES" action={showAllEnq ? 'View less ‹' : 'View all ›'} onAction={() => setShowAllEnq(v => !v)}>
        {/* Tabs */}
        <div className={s.enqTabs}>
          {ENQ_TABS.map(({ key, color, rgb }) => {
            const active = enqTab === key;
            const cnt = (data?.enquiries || []).filter(e => e.status?.toLowerCase() === key.toLowerCase() || (!e.status && key === 'PENDING')).length;
            return (
              <button
                key={key}
                onClick={() => setEnqTab(key)}
                style={{
                  fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
                  padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                  background: active ? `rgba(${rgb},.12)` : 'transparent',
                  border: `1.5px solid ${active ? color : 'rgba(255,255,255,.12)'}`,
                  color: active ? color : 'var(--muted)',
                }}
              >{key}{cnt ? ` (${cnt})` : ''}</button>
            );
          })}
        </div>

        {/* Search */}
        <div className={s.searchWrap}>
          <span className={s.searchIcon}>🔍</span>
          <input
            className={s.searchInput}
            type="text"
            placeholder="Search by genre, vibe, act type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Enquiry cards — 3 and a bit visible, scrollable */}
        {filteredEnq.length === 0
          ? <p className={s.empty}>No {enqTab.toLowerCase()} enquiries{search ? ' matching your search' : ''}.</p>
          : <div style={showAllEnq ? {} : { maxHeight: 500, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {filteredEnq.map(enq => (
                <EnquiryCard key={enq.id} enq={enq} onRespond={(id, status) =>
                  setEnquiries(allEnquiries.map(e => e.id === id ? { ...e, status } : e))
                } />
              ))}
            </div>
        }
      </Section>

      {/* Find Promoters */}
      <button
        onClick={() => navigate('/discover')}
        style={{
          display: 'block', width: '100%', marginBottom: 12,
          background: 'linear-gradient(135deg, #00E5A0, #00B4D8)',
          color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2,
          padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
        }}
      >FIND PROMOTERS</button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px', background: 'rgba(0,229,160,.05)', borderRadius: 10, border: '1px solid rgba(0,229,160,.2)' }}>
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

function Section({ title, action, onAction, viewAll, onViewAll, green, children }) {
  const accent = green ? '#00E5A0' : 'var(--neon2)';
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid var(--border)`, paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: accent }}>{title}</p>
          {action === 'MANAGE' && <button onClick={onAction} style={{ background: 'none', color: accent, fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, border: `1px solid ${accent}`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>MANAGE</button>}
        </div>
        {action && action !== 'MANAGE' && <button onClick={onAction} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{action}</button>}
        {viewAll && <button onClick={onViewAll} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{viewAll}</button>}
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
        color: hov ? '#FF69B4' : '#FF3399',
        ...(compact
          ? { fontSize: 10, padding: '3px 8px' }
          : { fontSize: 10, padding: '4px 10px' }),
      }}
    >{expanded ? 'HIDE ▲' : 'VIEW FULL PROFILE ▼'}</button>
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

function EnquiryCard({ enq, onRespond }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const isPending = !enq.status || enq.status === 'pending';

  const TYPE_ACCENT = { artist: '#00E5FF', band: '#FF8C42', standup: '#FF88AA', host: '#FF3399' };
  const TYPE_RGB    = { artist: '0,229,255', band: '255,140,66', standup: '255,136,170', host: '255,51,153' };
  const accent    = TYPE_ACCENT[enq.applicant_type] || '#00E5FF';
  const accentRgb = TYPE_RGB[enq.applicant_type]    || '0,229,255';

  const statusColor = { accepted: '#00E5A0', tentative: '#00B4D8', pending: '#FFD700', declined: 'var(--muted)' }[enq.status] || '#FFD700';

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
            <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>{(enq.applicant_type || 'artist').toUpperCase()}</span>
          </div>
          {loc && <div className={ds.cardLoc}>{loc}</div>}
          {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
          {/* Genre pills */}
          {allTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {allTags.slice(0, 5).map(g => (
                <HoverPill key={g} label={g} accentRgb={accentRgb} accent={accent} />
              ))}
            </div>
          )}
        </div>
        {/* Right: status pill → date box → profile button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span className={s.enqStatus} style={{ color: statusColor, borderColor: statusColor }}>
            {(enq.status || 'PENDING').toUpperCase()}
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
        <div style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
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
              <a href={p.mix_link || p.soundcloud || p.mixcloud} target="_blank" rel="noopener" style={{ fontSize: 13, color: accent, flex: 1, wordBreak: 'break-all' }}>▶ Play demo</a>
            </div>
          )}
          {p.instagram && p.instagram !== 'N/A' && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>INSTAGRAM</div>
              {(() => { const h = p.instagram.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/?/i, '').replace(/\/$/, ''); return <a href={`https://instagram.com/${h}`} target="_blank" rel="noopener" style={{ fontSize: 13, color: accent }}>@{h}</a>; })()}
            </div>
          )}
          {isPending && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <HoverBtn
                onClick={() => respond('accepted')} disabled={busy}
                base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
              >ACCEPT ✓</HoverBtn>
              <HoverBtn
                onClick={() => respond('tentative')} disabled={busy}
                base={{ bg: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
                hover={{ bg: 'rgba(0,180,216,.28)', border: '1px solid #00B4D8' }}
              >TENTATIVE</HoverBtn>
              <HoverBtn
                onClick={() => respond('declined')} disabled={busy}
                base={{ bg: 'rgba(255,140,0,.06)', border: '1px solid rgba(255,140,0,.2)', color: 'var(--muted)' }}
                hover={{ bg: 'rgba(255,140,0,.2)', border: '1px solid #FF8C00', color: '#FF8C00' }}
              >DECLINE ✗</HoverBtn>
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
