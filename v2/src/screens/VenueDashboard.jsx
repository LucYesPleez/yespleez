import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { useSession, usePlayer } from '../App';
import { today, formatDisplayDate } from '../lib/dates';
import PortraitCard from '../components/PortraitCard';
import FollowingSection, { FOLLOW_FILTER_CONFIGS } from '../components/FollowingSection';
import ProfileCard from '../components/ProfileCard';
import InviteSheet from '../components/InviteSheet';
import EnquiryCard, { HoverPill, HoverProfileBtn, HoverBtn } from '../components/EnquiryCard';
import { normaliseStatus, STATUS_TAB_COLOR } from '../lib/enquiryUtils';
import EnquiryPanel from '../components/EnquiryPanel';
import DashboardHeader from '../components/DashboardHeader';
import DashboardProfileCard from '../components/DashboardProfileCard';
import NotificationBar from '../components/NotificationBar';
import DashboardStats from '../components/DashboardStats';
import EventsSection from '../components/EventsSection';
import { useDragScroll } from '../hooks/useDragScroll';
import { resolveProfileId } from '../lib/resolveProfileId';
import s from './VenueDashboard.module.css';
import ds from './DiscoverScreen.module.css';
import { PROFILE_TYPES } from '../lib/profileTypes';

export default function VenueDashboard({ userId: userIdProp }) {
  const { session } = useSession();
  const { setPlayer } = usePlayer();
  const navigate = useNavigate();
  const userId = userIdProp || session?.user?.id;
  const [enquiries,      setEnquiries]      = useState([]);
  const [localAvail,     setLocalAvail]     = useState(null);
  const [showAvailCal,   setShowAvailCal]   = useState(false);
  const [showAllEnq,     setShowAllEnq]     = useState(false);
  const [following,      setFollowing]      = useState([]);
  const [inviteArtist,   setInviteArtist]   = useState(null);
  const [loadingFollow,  setLoadingFollow]  = useState(false);
  const [followView,       setFollowView]       = useState('portrait'); // 'portrait' | 'landscape'
  const [followFilter,     setFollowFilter]     = useState('ALL');
  const [regularsShowAll,  setRegularsShowAll]  = useState(false);
  const [regularsSearch,   setRegularsSearch]   = useState('');
  const regularsDrag = useDragScroll('venue-dashboard-regulars');
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 640);

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 640);
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);

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

      // Batch-fetch applicant profiles so EnquiryCard skips per-card Supabase calls.
      // M5.1 (D3): resolve by the enquiry row's applicant_profile_id (an id names
      // exactly the typed profile the old user_id+type key-pair approximated);
      // legacy join kept only for rows without one.
      const enqs = enqRes.data || [];
      const applicantCols = 'id, user_id, name, avatar, avatar_thumb, type, bio, sound, genre_string, location, mix_link, tagline, card_pills';
      const pidEnqs = enqs.filter(e => e.applicant_profile_id);
      const uidEnqs = enqs.filter(e => !e.applicant_profile_id && e.applicant_user_id);
      const [pidProfs, uidProfs] = await Promise.all([
        pidEnqs.length ? supabase.from('profiles').select(applicantCols).in('id', pidEnqs.map(e => e.applicant_profile_id)) : Promise.resolve({ data: [] }),
        uidEnqs.length ? supabase.from('profiles').select(applicantCols).in('user_id', uidEnqs.map(e => e.applicant_user_id)) : Promise.resolve({ data: [] }),
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
  const availability = localAvail ?? data?.availability ?? [];
  const events       = data?.upcomingEvts || [];
  const todayStr     = new Date().toISOString().split('T')[0];
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && ev.status !== 'completed' && (ev.config?.date || '') >= todayStr)
                               .sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  const draftEvents    = events.filter(ev => ev.status === 'draft');
  const pastEvents     = events.filter(ev => ev.status !== 'draft' && (ev.config?.date || '') < todayStr)
                               .sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));

  if (data?.availability && localAvail === null) setLocalAvail(data.availability);

  async function toggleDate(dateStr) {
    if (!userId) return;
    const avail = localAvail ?? [];
    const wasAvail = avail.includes(dateStr);
    setLocalAvail(wasAvail ? avail.filter(d => d !== dateStr) : [...avail, dateStr].sort());
    if (wasAvail) {
      await supabase.from('venue_availability').delete().eq('user_id', userId).eq('available_date', dateStr);
    } else {
      const profileId = await resolveProfileId(userId, 'venue');
      await supabase.from('venue_availability').upsert({ user_id: userId, available_date: dateStr, profile_id: profileId }, { onConflict: 'user_id,available_date' });
    }
  }

  // enquiries kept in local state so optimistic respond() updates work
  const allEnquiries = enquiries.length ? enquiries : (data?.enquiries || []);

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
      await writeNotification(artistId, notif.type, notif.message, { event_name: eventName, venue_name: venueName, enquiry_id: id });
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
      (fPidRes.data || []).forEach(p => { seen[p.id] = p; });
      (fUidRes.data || []).forEach(p => { if (!seen[p.user_id] || p.type !== 'punter') seen[p.user_id] = p; });
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
      done(profile.contact_email),
    ];
    return fields.filter(Boolean).length / fields.length * 100;
  })();

  return (
    <div className={s.screen}>
      <DashboardHeader line1="VENUE" line2="DASHBOARD" userId={userId} profileId={profile?.id} profileType="venue" gradient={PROFILE_TYPES.venue.gradient} />

      <DashboardProfileCard
        profile={profile}
        accent={PROFILE_TYPES.venue.accent}
        gradient={PROFILE_TYPES.venue.gradient}
        icon={<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
        setupRoute="/industry/venue/setup"
        subtitle={profile?.location || 'Add your venue details so promoters can find you'}
        genres={profile?.sound}
        completionPct={hasProfile ? completionPct : undefined}
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
        tabs={{ UPCOMING: upcomingEvents, DRAFTS: draftEvents, PAST: pastEvents }}
        loading={loading}
        accent="#00E5A0"
      />

      {/* Availability */}
      <div id="section-availability" style={{ marginTop: 40 }}>
        <Section title="AVAILABLE DATES" subtitle="tap dates to add / remove" action={availability.length > 0 ? 'View all >' : null} onAction={() => setShowAvailCal(true)}>
          {availability.length === 0
            ? null
            : <div className={s.chips}>
                {availability.slice(0, isNarrow ? 8 : 12).map(d => (
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
      <div id="section-enquiries" style={{ marginTop: 40 }}>
        <Section title="ENQUIRIES" action={showAllEnq ? 'View less <' : 'View all >'} onAction={() => setShowAllEnq(v => !v)}>
          <EnquiryPanel
            enquiries={allEnquiries}
            onRespond={handleEnquiryRespond}
            onPlayDemo={setPlayer}
          />
        </Section>
      </div>

      {/* Following */}
      <FollowingSection
        following={following}
        loading={loadingFollow}
        followView={followView}
        setFollowView={setFollowView}
        followFilter={followFilter}
        setFollowFilter={setFollowFilter}
        followShowAll={regularsShowAll}
        setFollowShowAll={setRegularsShowAll}
        followSearch={regularsSearch}
        setFollowSearch={setRegularsSearch}
        followDrag={regularsDrag}
        sectionTitle="THE REGULARS"
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
          onClose={() => setInviteArtist(null)}
        />
      )}
    </div>
  );
}


function VenueAvailCalendar({ availability, onToggle, onClose }) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const year        = month.getFullYear();
  const monthIdx    = month.getMonth();
  const label       = month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
  const firstDay    = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const availSet    = new Set(availability);
  const futureCount = availability.filter(d => d >= todayStr).length;
  const DAY_LABELS  = ['S','M','T','W','T','F','S'];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#00E5A0' }}>VENUE AVAILABILITY</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Tap dates your venue is available for hire. Promoters will see this when browsing venues.</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => setMonth(new Date(year, monthIdx - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{label}</span>
          <button onClick={() => setMonth(new Date(year, monthIdx + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'", paddingBottom: 2 }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 16 }}>
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day     = i + 1;
            const dateStr = `${year}-${String(monthIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isPast  = dateStr < todayStr;
            const isAvail = availSet.has(dateStr);
            const isToday = dateStr === todayStr;
            return (
              <div key={dateStr} onClick={() => !isPast && onToggle(dateStr)} style={{
                textAlign: 'center', padding: '7px 2px', borderRadius: 6, fontSize: 13,
                cursor: isPast ? 'default' : 'pointer',
                background: isAvail ? 'rgba(0,229,160,.18)' : 'rgba(255,255,255,.04)',
                color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? '#00E5A0' : 'var(--text)',
                border: isAvail ? '1px solid rgba(0,229,160,.5)' : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
                transition: 'background .15s',
              }}>{day}</div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {futureCount ? `${futureCount} date${futureCount !== 1 ? 's' : ''} marked available` : 'No dates marked yet'}
        </div>
      </div>
    </div>
  );
}

function DateChip({ label, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span className={s.chip} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ cursor: 'pointer', color: hov ? '#fff' : undefined, borderColor: hov ? 'rgba(255,255,255,.3)' : undefined, background: hov ? 'rgba(255,255,255,.06)' : undefined }}
    >{label}</span>
  );
}

function Section({ title, subtitle, action, onAction, children }) {
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
      </div>
      {children}
    </div>
  );
}


