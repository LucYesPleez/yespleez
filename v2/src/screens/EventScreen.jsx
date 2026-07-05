import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { formatDateRange } from '../lib/dates';
import Skeleton from '../components/Skeleton';
import s from './EventScreen.module.css';
import { likedEvents } from '../lib/likedEvents';


export default function EventScreen() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { session, isGuest } = useSession();

  const [liked,        setLiked]        = useState(() => likedEvents.has(id));
  const [likedBusy,    setLikedBusy]    = useState(false);
  const [showManage,   setShowManage]   = useState(false);
  const [appCounts,    setAppCounts]    = useState({ total: 0, accepted: 0 });
  const [appsOpen,     setAppsOpen]     = useState(null);
  const isRealEvent = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['event', id],
    queryFn: async () => {
      const { data: ev } = await supabase.from('events').select('*').eq('id', id).single();
      if (!ev) { navigate('/'); return null; }
      const { data: claimsData } = await supabase
        .from('claims').select('slot_id, name, genre, sound, user_id, card_pills').eq('event_id', id);
      const map = {};
      (claimsData || []).forEach(c => { map[c.slot_id] = c; });
      return { event: ev, claims: map };
    },
    enabled: !!id,
  });

  const event  = data?.event  || null;
  const claims = data?.claims || {};

  // Load like state once event is fetched
  useEffect(() => {
    if (!event || !session?.user?.id || !isRealEvent) return;
    if (likedEvents.has(id)) return; // already confirmed this session
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', id).maybeSingle()
      .then(({ data: fol }) => {
        if (fol) { likedEvents.add(id); setLiked(true); }
      });
  }, [event?.id, session?.user?.id, isRealEvent]);

  // Load application counts for host
  useEffect(() => {
    if (!event || session?.user?.id !== event.host_id) return;
    setAppsOpen(event.applications_open !== false);
    supabase.from('applications').select('status').eq('event_id', id)
      .then(({ data: apps }) => {
        if (!apps) return;
        setAppCounts({ total: apps.length, accepted: apps.filter(a => a.status === 'accepted').length });
      });
  }, [event?.id, session?.user?.id]);

  if (loading) return (
    <div className={s.screen} style={{ padding: '72px 16px 80px', maxWidth: 680, margin: '0 auto', boxSizing: 'border-box' }}>
      <Skeleton height={280} radius={12} style={{ marginBottom: 16 }} />
      <Skeleton width="70%" height={32} style={{ marginBottom: 10 }} />
      <Skeleton width="45%" height={14} style={{ marginBottom: 24 }} />
      <Skeleton height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="60%" height={14} />
    </div>
  );
  if (!event)  return null;

  const cfg    = event.config || {};
  const isHost = session?.user?.id === event.host_id;

  const eventDateStr = cfg.endDate || cfg.date;
  const isPast = eventDateStr ? new Date(eventDateStr + 'T23:59:59') < new Date() : false;

  async function toggleLike() {
    if (!session?.user?.id || likedBusy || !isRealEvent) return;
    setLikedBusy(true);
    if (liked) {
      const { error } = await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', id);
      if (!error) { likedEvents.delete(id); setLiked(false); }
      else console.error('unfollow error:', error);
    } else {
      const { error } = await supabase.from('follows').insert({ user_id: session.user.id, entity_id: id, entity_type: 'event', entity_name: event.name });
      if (!error) { likedEvents.add(id); setLiked(true); }
      else console.error('follow error:', error.message, error.code, error.details, error.hint);
    }
    setLikedBusy(false);
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: event.name, url }); } catch (_) {}
    } else {
      try { await navigator.clipboard.writeText(url); } catch (_) {}
    }
  }

  const poster     = cfg.poster || null;
  const posterFull = cfg.poster_full || poster;
  const genres = cfg.genres || '';
  const days   = cfg.days || [];

  const totalSlots   = days.reduce((n, d) => n + (d.slots?.length || 0), 0);
  const takenSlots   = days.reduce((n, d) => n + (d.slots || []).filter(sl => claims[sl.id]).length, 0);
  const lineupPct    = totalSlots > 0 ? Math.round((takenSlots / totalSlots) * 100) : 0;

  async function toggleAppsOpen() {
    const next = !appsOpen;
    setAppsOpen(next);
    await supabase.from('events').update({ applications_open: next }).eq('id', id);
  }

  return (
    <div className={s.screen}>
      {poster && <div className={s.heroBg} style={{ backgroundImage: `url(${posterFull})` }} />}
      <div className={s.heroBgDark} />
      <div className={s.heroBgFade} />

      <div className={s.content}>
        {/* Poster */}
        {poster && (
          <div className={s.posterWrap}>
            <img className={s.poster} src={posterFull} alt={event.name} />
          </div>
        )}

        {/* Header */}
        <header className={s.header}>
          <h1 className={s.eventTitle}>{event.name}</h1>
          {(cfg.date || cfg.venue) && (
            <div className={s.eventMeta}>
              {cfg.date && formatDateRange(cfg.date, cfg.endDate)}
              {cfg.date && cfg.venue && '  ·  '}
              {cfg.venue}
            </div>
          )}
          {genres && <div className={s.eventGenres}>{genres}</div>}
        </header>

        {/* Sync bar */}
        <div className={s.syncBar}>
          <div className={s.syncDot + (!isPast && event.status === 'live' ? ' ' + s.syncDotLive : '')} />
          <span>{isPast ? 'PAST EVENT' : event.status === 'live' ? 'LIVE NOW' : 'NOT LIVE'}</span>
        </div>

        {/* Apply bar — non-host, applications open */}
        {!isHost && !isGuest && event.applications_open && (
          <ApplyButton eventId={id} userId={session?.user?.id} />
        )}

        {/* Manage Event panel — owner only */}
        {isHost && (
          <div className={s.managePanel}>
            <div className={s.managePanelHeader}>
              <span className={s.managePanelTitle}>MANAGE EVENT</span>
              <span className={s.managePanelStatus + (appsOpen ? ' ' + s.managePanelStatusOpen : '')}>
                {appsOpen ? '● Applications Open' : '○ Applications Closed'}
              </span>
            </div>
            <div className={s.managePanelStats}>
              <div className={s.manageStat}>
                <span className={s.manageStatNum}>{appCounts.total}</span>
                <span className={s.manageStatLabel}>Applications</span>
              </div>
              <div className={s.manageStatDivider} />
              <div className={s.manageStat}>
                <span className={s.manageStatNum}>{appCounts.accepted}</span>
                <span className={s.manageStatLabel}>Accepted</span>
              </div>
              <div className={s.manageStatDivider} />
              <div className={s.manageStat}>
                <span className={s.manageStatNum}>{totalSlots > 0 ? `${lineupPct}%` : '—'}</span>
                <span className={s.manageStatLabel}>Lineup</span>
              </div>
            </div>
            <button className={s.manageBtn} onClick={() => navigate(`/create-event?edit=${id}`)}>MANAGE EVENT ›</button>
          </div>
        )}

        {/* Manage Event sheet */}
        {showManage && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:10000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
               onClick={() => setShowManage(false)}>
            <div style={{ background:'#13131f', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:480, maxHeight:'80vh', overflowY:'auto', paddingBottom:'calc(env(safe-area-inset-bottom, 0px) + 16px)', boxShadow:'0 -4px 40px rgba(0,0,0,0.6)', border:'1px solid rgba(255,255,255,0.07)', borderBottom:'none' }}
                 onClick={e => e.stopPropagation()}>
              {/* drag handle */}
              <div style={{ display:'flex', justifyContent:'center', padding:'12px 0 4px' }}>
                <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.15)' }} />
              </div>
              <div style={{ padding:'10px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin:0, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:'0.1em', background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>MANAGE EVENT</p>
                <p style={{ margin:'2px 0 0', fontSize:12, color:'var(--muted)', letterSpacing:'0.02em' }}>{event.name}</p>
              </div>
              <ManageSection label="Event">
                <ManageItem icon={<EditIcon />} label="Edit Event Details" onClick={() => { setShowManage(false); navigate(`/create-event?edit=${id}`); }} />
              </ManageSection>
              <ManageSection label="Applications">
                <ManageItem icon={<InboxIcon />} label="View Applications" onClick={() => { setShowManage(false); navigate(`/event/${id}/applications`); }} />
                <ManageItem icon={appsOpen ? <LockIcon /> : <UnlockIcon />} label={appsOpen ? 'Close Applications' : 'Open Applications'} onClick={() => { toggleAppsOpen(); setShowManage(false); }} />
              </ManageSection>
              <ManageSection label="Management">
                <ManageItem icon={<CopyIcon />} label="Duplicate Event" onClick={() => setShowManage(false)} muted />
                <ManageItem icon={<TrashIcon />} label="Delete Event" onClick={() => setShowManage(false)} danger />
              </ManageSection>
            </div>
          </div>
        )}

        {cfg.ticketLink && (
          <a href={cfg.ticketLink} target="_blank" rel="noopener noreferrer" className={s.ticketBtn}>
            🎟 BUY TICKETS
          </a>
        )}

        {/* Days + slots */}
        {days.map((day, di) => (
          <div key={di} className={s.daySection}>
            {day.name && (
              <div className={s.dayDivider}>
                <span className={s.dayName}>{day.name}</span>
                <div className={s.dayLine} />
              </div>
            )}
            {(day.slots || []).map(slot => (
              <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]} />
            ))}
          </div>
        ))}

        {/* Tally */}
        {totalSlots > 0 && (
          <div className={s.tally}>
            <strong>{takenSlots}</strong> of <strong>{totalSlots}</strong> slots filled
          </div>
        )}

        {/* About */}
        {cfg.bio && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>ABOUT</div>
            <div className={s.infoText}>{cfg.bio}</div>
          </div>
        )}

        {/* Location */}
        {cfg.location && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>LOCATION</div>
            <div className={s.infoText}>{cfg.location}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApplyButton({ eventId, userId }) {
  const [status,        setStatus]        = useState(null);
  const [note,          setNote]          = useState('');
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [checked,       setChecked]       = useState(false);
  const [artistProfile, setArtistProfile] = useState(null);

  useEffect(() => {
    if (!userId || !eventId) { setChecked(true); return; }
    supabase.from('applications').select('status').eq('event_id', eventId).eq('artist_id', userId).maybeSingle()
      .then(({ data }) => { setStatus(data?.status || null); setChecked(true); });
  }, [eventId, userId]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('name,sound,genre_string,mix_link').eq('user_id', userId).neq('type', 'punter').limit(1).maybeSingle()
      .then(({ data }) => setArtistProfile(data));
  }, [userId]);

  if (!checked) return null;
  if (!userId)  return null;

  if (status) {
    const col = { accepted: 'var(--green)', pending: 'var(--gold)', rejected: 'var(--muted)' }[status] || 'var(--muted)';
    return (
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: col }}>
          APPLICATION {status.toUpperCase()}
        </p>
      </div>
    );
  }

  async function submit() {
    setLoading(true);
    const { error } = await supabase.from('applications').insert({
      event_id: eventId,
      artist_id: userId,
      status: 'pending',
      note,
      artist_name: artistProfile?.name,
      genre: artistProfile?.genre_string,
      mix_link: artistProfile?.mix_link,
      avatar_url: artistProfile?.avatar,
    });
    setLoading(false);
    if (!error) { setStatus('pending'); setOpen(false); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button className={s.applyBtn} onClick={() => setOpen(true)}>APPLY TO PLAY</button>
      ) : (
        <div className={s.applyForm}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>YOUR APPLICATION</p>
          {artistProfile && (
            <p style={{ fontSize: 12, color: 'var(--neon2)', marginBottom: 8, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
              APPLYING AS: {artistProfile.name} · {artistProfile.sound || artistProfile.genre_string || ''}
            </p>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Add a note for the host (optional)…" rows={3}
            style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpen(false)}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: 10, borderRadius: 8 }}>CANCEL</button>
            <button onClick={submit} disabled={loading} className={s.applyBtn} style={{ flex: 2 }}>
              {loading ? '…' : 'SEND APPLICATION'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDur(mins) {
  if (!mins) return null;
  const m = Number(mins);
  if (!m) return null;
  if (m < 60) return `${m} mins`;
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr${h !== 1 ? 's' : ''}`;
}

const LABEL_PALETTE = ['#FFB830', '#BF5FFF', '#00E5A0', '#FF6B6B', '#FF8C42', '#7BC8F6'];
function labelColor(label) {
  if (!label) return '#FFB830';
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xFFFFFF;
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}
function stripEmoji(str) {
  return str?.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim() || '';
}

function HeadphoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
    </svg>
  );
}

function SlotCard({ slot, claim }) {
  const artistName  = claim?.name  || 'Open Slot';
  const artistGenre = claim?.genre || claim?.sound || '';
  const pills       = Array.isArray(claim?.card_pills) ? claim.card_pills : [];
  const isEmpty     = !claim;
  const durLabel    = fmtDur(slot.dur ?? slot.duration);
  const cleanLabel  = slot.label ? stripEmoji(slot.label) : null;
  const col         = cleanLabel ? labelColor(cleanLabel) : 'var(--neon)';

  return (
    <div className={s.slot + (isEmpty ? ' ' + s.slotEmpty : '')}>
      <div className={s.timeBlock}>
        <div className={s.timeNum}>{slot.time || '—'}</div>
        {slot.ampm && <div className={s.timeAmPm}>{slot.ampm}</div>}
        {durLabel && <div className={s.timeDur}>{durLabel}</div>}
      </div>
      <div className={s.slotInfo}>
        <div className={s.djNameRow}>
          <HeadphoneIcon />
          <span className={s.djName} style={{ color: isEmpty ? 'var(--muted)' : 'var(--text)' }}>{artistName}</span>
        </div>
        {(artistGenre || pills.length > 0) && (
          <div className={s.djPills}>
            {artistGenre && <span className={s.genrePill}>{artistGenre}</span>}
            {pills.map((p, i) => <span key={i} className={s.djPill}>{p}</span>)}
          </div>
        )}
        {cleanLabel && (
          <div style={{ marginTop: 5 }}>
            <span className={s.slotLabel} style={{ background: col, color: '#0a0a0f', borderColor: col }}>
              {cleanLabel}
            </span>
          </div>
        )}
      </div>
      <span className={s.slotChevron}>›</span>
    </div>
  );
}

function EditIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function InboxIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>; }
function LockIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function UnlockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>; }
function CopyIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function TrashIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }

function ManageSection({ label, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 4 }}>
      <p style={{ margin: 0, padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', fontFamily: "'Bebas Neue',sans-serif", fontSize: 11 }}>{label}</p>
      {children}
    </div>
  );
}

function ManageItem({ icon, label, onClick, danger, muted }) {
  return (
    <button onClick={onClick} style={{ display:'flex', alignItems:'center', gap:14, width:'100%', padding:'14px 20px', background:'none', border:'none', cursor:muted ? 'default' : 'pointer', textAlign:'left', fontFamily:'inherit', opacity:muted ? 0.38 : 1, borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', color: danger ? '#ff4d6d' : 'var(--muted)' }}>{icon}</span>
      <span style={{ fontSize:14, color: danger ? '#ff4d6d' : 'var(--text)', fontWeight:500, letterSpacing:'0.01em' }}>{label}</span>
      {muted && <span style={{ marginLeft:'auto', fontSize:10, color:'var(--muted)', letterSpacing:'0.08em', fontFamily:"'Bebas Neue',sans-serif" }}>SOON</span>}
    </button>
  );
}
