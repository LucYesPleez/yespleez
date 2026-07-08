import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { formatDateRange } from '../lib/dates';
import Skeleton from '../components/Skeleton';
import ApplicationCard from '../components/ApplicationCard';
import FillSlotModal from '../components/FillSlotModal';
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
  const [eventTab,     setEventTab]     = useState('LINEUP');
  const [showEditor,   setShowEditor]   = useState(false);
  const [allApps,      setAllApps]      = useState([]);
  const [appProfiles,  setAppProfiles]  = useState({});
  const [editSetTimes, setEditSetTimes] = useState(false);
  const [editingSlot,  setEditingSlot]  = useState(null);
  const [fillSlot,     setFillSlot]     = useState(null);
  const [localDays,    setLocalDays]    = useState(null);
  const [viewAsPunter, setViewAsPunter] = useState(false);
  const queryClient = useQueryClient();
  const dragFrom = useRef(null); // { dayIdx, slotIdx }
  const isRealEvent = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['event', id],
    queryFn: async () => {
      const { data: ev } = await supabase.from('events').select('*').eq('id', id).single();
      if (!ev) { navigate('/'); return null; }
      const { data: claimsData } = await supabase
        .from('claims').select('slot_id, name, genre, sound, user_id, card_pills, updated_at, created_at, status').eq('event_id', id);
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

  // Load applications + profiles for host
  useEffect(() => {
    if (!id || !session?.user?.id) return;
    let cancelled = false;
    async function loadApps() {
      const { data: apps } = await supabase
        .from('applications')
        .select('*')
        .eq('event_id', id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const rows = apps || [];
      setAppCounts({ total: rows.length, accepted: rows.filter(a => a.status === 'accepted').length });
      setAllApps(rows);
      const artistIds = [...new Set(rows.map(a => a.artist_id).filter(Boolean))];
      if (artistIds.length) {
        const { data: profs } = await supabase.from('profiles')
          .select('user_id, name, avatar, type, sound, genre_string, location, bio, mix_link, card_pills, vibe_tags')
          .in('user_id', artistIds);
        if (!cancelled) {
          const map = {};
          (profs || []).forEach(p => { map[p.user_id] = p; });
          setAppProfiles(map);
        }
      }
    }
    loadApps();
    return () => { cancelled = true; };
  }, [id, session?.user?.id]);

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
  const effectiveIsHost = isHost && !viewAsPunter;

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

  function reorderSlot(dayIdx, fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const baseDays = localDays ?? (event.config?.days || []);
    const newDays = baseDays.map((day, di) => {
      if (di !== dayIdx) return day;
      const slots = [...(day.slots || [])];
      const [moved] = slots.splice(fromIdx, 1);
      slots.splice(toIdx, 0, moved);
      return { ...day, slots };
    });
    setLocalDays(newDays);
    supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
  }

  async function removeArtist(slotId) {
    if (!window.confirm('Remove this artist from the slot?')) return;
    await supabase.from('claims').delete().eq('slot_id', slotId).eq('event_id', id);
    // Force refetch
    window.location.reload();
  }

  async function saveSlot(dayIdx, slotIdx, updated) {
    const baseDays = localDays ?? (event.config?.days || []);
    const newDays = baseDays.map((day, di) =>
      di !== dayIdx ? day : {
        ...day,
        slots: day.slots.map((sl, si) => si !== slotIdx ? sl : { ...sl, ...updated }),
      }
    );
    await supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
    setLocalDays(newDays);
    setEditingSlot(null);
  }

  async function togglePin(dayIdx, slotIdx) {
    const baseDays = localDays ?? (event.config?.days || []);
    const slot = baseDays[dayIdx]?.slots?.[slotIdx];
    if (!slot) return;
    const newDays = baseDays.map((day, di) =>
      di !== dayIdx ? day : {
        ...day,
        slots: day.slots.map((sl, si) => si !== slotIdx ? sl : { ...sl, pinned: !sl.pinned }),
      }
    );
    await supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
    setLocalDays(newDays);
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: event.name, url }); } catch (_) {}
    } else {
      try { await navigator.clipboard.writeText(url); } catch (_) {}
    }
  }

  const shortList  = allApps.filter(a => a.status === 'tentative');
  const pipeline   = allApps.filter(a => a.status === 'pending');

  async function respondApp(appId, status, artistId, evtName) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    setAppCounts(prev => ({
      total: prev.total,
      accepted: status === 'accepted' ? prev.accepted + 1 : status === 'rejected' ? Math.max(0, prev.accepted - 1) : prev.accepted,
    }));
    if (status === 'tentative' || status === 'accepted') {
      try {
        await supabase.from('notifications').insert({
          user_id: artistId,
          type: status,
          message: status === 'tentative'
            ? `You've been shortlisted for ${evtName}.`
            : `You've been accepted to perform at ${evtName}!`,
          event_id: id,
        });
      } catch (_) {}
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
        {!effectiveIsHost && !isGuest && event.applications_open && (
          <ApplyButton eventId={id} userId={session?.user?.id} />
        )}

        {/* Punter preview banner */}
        {isHost && viewAsPunter && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,184,48,.1)', border: '1px solid rgba(255,184,48,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFB830" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, color: '#FFB830' }}>PUNTER VIEW — this is how the event looks to the public</span>
            </div>
            <button onClick={() => setViewAsPunter(false)} style={{ background: 'none', border: 'none', color: '#FFB830', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}

        {/* Manage Event panel — owner only */}
        {effectiveIsHost && (
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className={s.manageBtn} style={{ flex: 1 }} onClick={() => navigate(`/create-event?edit=${id}`)}>MANAGE EVENT ›</button>
              <button
                onClick={() => setShowEditor(v => !v)}
                style={{
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  whiteSpace: 'nowrap', border: '1px solid transparent',
                  background: showEditor
                    ? 'linear-gradient(135deg,#00E5A0,#00B4D8)'
                    : 'linear-gradient(#0f0f1a,#0f0f1a) padding-box, linear-gradient(135deg,#00E5A0,#00B4D8) border-box',
                }}
              >
                <span style={showEditor
                  ? { color: '#0f0f1a' }
                  : { background: 'linear-gradient(135deg,#00E5A0,#00B4D8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }
                }>
                  {showEditor ? 'EDITOR ON' : 'EDITOR OFF'}
                </span>
              </button>
              {/* View as Punter */}
              <button
                onClick={() => { setViewAsPunter(true); setShowEditor(false); }}
                title="View as punter"
                style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)',
                  transition: 'background .15s, border-color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,48,.15)'; e.currentTarget.style.borderColor = 'rgba(255,184,48,.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; }}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Sub-tabs — host only, editor mode */}
        {effectiveIsHost && showEditor && (
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { key: 'LINEUP', label: 'LINEUP' },
              { key: 'SHORTLIST', label: `SHORT LIST${shortList.length ? ` (${shortList.length})` : ''}` },
              { key: 'PIPELINE', label: `PIPELINE${pipeline.length ? ` (${pipeline.length})` : ''}` },
            ].map(tab => (
              <button key={tab.key} onClick={() => setEventTab(tab.key)}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
                  padding: '10px 4px 8px',
                  color: eventTab === tab.key ? '#fff' : 'var(--muted)',
                  borderBottom: eventTab === tab.key ? '2px solid var(--neon2)' : '2px solid transparent',
                  transition: 'color .15s',
                }}
              >{tab.label}</button>
            ))}
          </div>
        )}

        {/* SHORT LIST tab */}
        {effectiveIsHost && showEditor && eventTab === 'SHORTLIST' && (
          <div>
            {shortList.length === 0
              ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>No artists shortlisted yet.</p>
              : shortList.map(app => <ApplicationCard key={app.id} app={app} prof={appProfiles[app.artist_id]} event={event} onRespond={respondApp} />)
            }
          </div>
        )}

        {/* PIPELINE tab */}
        {effectiveIsHost && showEditor && eventTab === 'PIPELINE' && (
          <div>
            {pipeline.length === 0
              ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>No pending applications.</p>
              : pipeline.map(app => <ApplicationCard key={app.id} app={app} prof={appProfiles[app.artist_id]} event={event} onRespond={respondApp} />)
            }
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

        {/* Days + slots — LINEUP tab (or non-host) */}
        {(!effectiveIsHost || !showEditor || eventTab === 'LINEUP') && (localDays ?? days).map((day, di) => (
          <div key={di} className={s.daySection}>
            {day.name && (
              <div className={s.dayDivider}>
                <span className={s.dayName}>{day.name}</span>
                <div className={s.dayLine} />
                {effectiveIsHost && di === 0 && (
                  <button
                    onClick={() => setEditSetTimes(v => !v)}
                    style={{
                      flexShrink: 0, fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                      padding: '4px 10px', borderRadius: 6, border: `1px solid ${editSetTimes ? 'var(--neon2)' : 'rgba(0,229,255,0.3)'}`,
                      cursor: 'pointer', background: editSetTimes ? 'var(--neon2)' : 'transparent',
                      color: editSetTimes ? '#0a0a0f' : 'var(--neon2)', transition: 'all .15s',
                    }}
                  >{editSetTimes ? 'LOCK' : 'EDIT'}</button>
                )}
              </div>
            )}
            {(day.slots || []).map((slot, si) => (
              <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
                isHost={effectiveIsHost}
                onFill={effectiveIsHost ? () => setFillSlot({ slot }) : null}
                onEdit={effectiveIsHost ? () => setEditingSlot({ dayIdx: di, slotIdx: si, slot }) : null}
                onRemove={effectiveIsHost ? () => removeArtist(slot.id) : null}
                onPin={effectiveIsHost ? () => togglePin(di, si) : null}
                dragHandlers={effectiveIsHost && editSetTimes && !slot.pinned ? {
                  draggable: true,
                  onDragStart: () => { dragFrom.current = { dayIdx: di, slotIdx: si }; },
                  onDragOver:  e => e.preventDefault(),
                  onDrop:      e => { e.preventDefault(); if (dragFrom.current?.dayIdx === di) reorderSlot(di, dragFrom.current.slotIdx, si); dragFrom.current = null; },
                } : null}
              />
            ))}
          </div>
        ))}

        {(!effectiveIsHost || !showEditor || eventTab === 'LINEUP') && <>
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
        </>}
      </div>

      {editingSlot && (
        <SlotEditModal
          slot={editingSlot.slot}
          onSave={updated => saveSlot(editingSlot.dayIdx, editingSlot.slotIdx, updated)}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {fillSlot && (
        <FillSlotModal
          slot={fillSlot.slot}
          eventId={id}
          acceptedArtists={allApps.filter(a => a.status === 'accepted')}
          acceptedProfiles={appProfiles}
          onFilled={() => { setFillSlot(null); queryClient.invalidateQueries({ queryKey: ['event', id] }); }}
          onClose={() => setFillSlot(null)}
        />
      )}
    </div>
  );
}

function SlotEditModal({ slot, onSave, onClose }) {
  const [time,       setTime]       = useState(slot.time  || '');
  const [ampm,       setAmpm]       = useState(slot.ampm  || 'PM');
  const [dur,        setDur]        = useState(String(slot.dur ?? slot.duration ?? ''));
  const [label,      setLabel]      = useState(stripEmoji(slot.label || ''));
  const [labelCol,   setLabelCol]   = useState(slot.labelColor || '');
  const [saving,     setSaving]     = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ time, ampm, dur: dur ? Number(dur) : null, label, labelColor: labelCol });
    setSaving(false);
  }

  const field = { width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const lbl   = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', display: 'block', marginBottom: 5 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '24px 20px 28px', width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2 }}>EDIT SLOT</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <span style={lbl}>TIME</span>
            <input style={field} value={time} onChange={e => setTime(e.target.value)} placeholder="9:00" />
          </div>
          <div>
            <span style={lbl}>AM/PM</span>
            <select style={{ ...field, padding: '10px 8px' }} value={ampm} onChange={e => setAmpm(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div>
            <span style={lbl}>DURATION (mins)</span>
            <input style={field} type="number" value={dur} onChange={e => setDur(e.target.value)} placeholder="90" />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span style={lbl}>LABEL (optional)</span>
          <div style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, overflow: 'hidden' }}>
            <input style={{ ...field, border: 'none', borderBottom: '1px solid rgba(255,255,255,.08)', borderRadius: 0 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SUNSET SET" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,255,255,.03)' }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'var(--muted)', flexShrink: 0 }}>COLOUR</span>
              {['', ...LABEL_PALETTE].map((col, i) => (
                <button key={i} onClick={() => setLabelCol(col)}
                  style={{
                    width: 16, height: 16, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                    background: col || 'rgba(255,255,255,.15)',
                    border: labelCol === col ? `2px solid #fff` : '2px solid transparent',
                    boxSizing: 'border-box', padding: 0,
                    transition: 'border-color .1s',
                  }} />
              ))}
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, background: saving ? 'rgba(255,255,255,.08)' : 'var(--neon2)', color: saving ? 'var(--muted)' : '#0a0a0f' }}
        >{saving ? 'SAVING…' : 'SAVE SLOT'}</button>
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

function parseDurMins(raw) {
  if (!raw) return 0;
  const n = Number(raw);
  if (n > 0) return n;
  const s = String(raw);
  const hr = s.match(/^([\d.]+)\s*hrs?$/i);
  if (hr) return Math.round(parseFloat(hr[1]) * 60);
  const mn = s.match(/^([\d.]+)\s*mins?$/i);
  if (mn) return Math.round(parseFloat(mn[1]));
  return 0;
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

function SlotCard({ slot, claim, onFill, onEdit, onRemove, onPin, isHost, dragHandlers }) {
  const [expanded,      setExpanded]      = useState(false);
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [hostNote,      setHostNote]      = useState('');
  const [followed,      setFollowed]      = useState(false);
  const [followBusy,    setFollowBusy]    = useState(false);
  const navigate = useNavigate();
  const { session } = useSession();
  const claimStatus   = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
  const isConfirmed   = claimStatus === 'confirmed';
  const artistName    = claim?.name || '';
  const publicName    = (!isHost && !isConfirmed && claim) ? 'PENDING' : artistName;
  const isEmpty       = !claim;
  const rawDur     = parseDurMins(slot.dur ?? slot.duration);
  const durLabel   = fmtDur(rawDur > 0 ? rawDur : 60);
  const cleanLabel = slot.label ? stripEmoji(slot.label) : null;
  const col        = slot.labelColor || (cleanLabel ? labelColor(cleanLabel) : '#FFB830');

  // Single descriptor pill matching v1: sound > card_pills > genre
  const descriptor = claim?.sound || claim?.card_pills || claim?.genre || '';

  const borderCol = slot.pinned ? '#FFB830' : isEmpty ? 'var(--border)' : 'var(--neon)';

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        className={s.slot + (isEmpty ? ' ' + s.slotEmpty : '')}
        style={{ border: `1px solid ${borderCol}`, borderRadius: expanded ? '10px 10px 0 0' : 10, cursor: 'pointer', marginBottom: 0 }}
        onClick={() => isEmpty && onFill ? onFill() : setExpanded(v => !v)}
        {...(dragHandlers || {})}
      >
        <div className={s.timeBlock} style={{ '--divider-col': borderCol }}>
          <div className={s.timeNum}>{slot.time || '—'}</div>
          {slot.ampm && <div className={s.timeAmPm}>{slot.ampm}</div>}
          {durLabel && <div className={s.timeDur}>{durLabel}</div>}
        </div>
        <div className={s.slotInfo}>
          <div className={s.djNameRow}>
            <HeadphoneIcon />
            <span className={s.djName} style={{ color: isEmpty ? 'var(--muted)' : publicName === 'PENDING' ? 'var(--muted)' : 'var(--text)', fontStyle: isEmpty ? 'italic' : 'normal' }}>
              {isEmpty ? 'Open slot' : publicName}
            </span>
          </div>
          {descriptor && (isHost || isConfirmed) && (
            <span style={{ display: 'inline-block', marginTop: 5, fontSize: 11, fontFamily: "'DM Sans',sans-serif", color: 'var(--neon2)', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {descriptor}
            </span>
          )}
          {cleanLabel && (
            <div style={{ marginTop: 5 }}>
              <span style={{ display: 'inline-block', fontFamily: "'Bebas Neue',sans-serif", fontSize: 9, letterSpacing: 2, color: col, border: `1px solid ${col}`, padding: '2px 8px', borderRadius: 2 }}>
                {cleanLabel}
              </span>
            </div>
          )}
        </div>
        <span className={s.slotChevron} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
      </div>

      {expanded && !isEmpty && (isHost || isConfirmed) && (
        <div style={{ background: 'var(--card2)', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 16px' }}>

          {/* Genre pills */}
          {(claim?.card_pills || claim?.genre) && (() => {
            const raw = claim.card_pills || claim.genre;
            const all = Array.isArray(raw)
              ? raw
              : raw.split(/[\·,|]+/).map(g => g.trim()).filter(Boolean);
            const visible = genreExpanded ? all : all.slice(0, 5);
            const rest = all.length - 5;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                {visible.map(g => (
                  <span key={g} style={{ fontSize: 10, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)', color: '#fff', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>{g}</span>
                ))}
                {!genreExpanded && rest > 0 && (
                  <button onClick={e => { e.stopPropagation(); setGenreExpanded(true); }}
                    style={{ fontSize: 12, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', color: 'var(--muted)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    +{rest} more
                  </button>
                )}
              </div>
            );
          })()}

          {/* Status */}
          {(() => {
            const claimStatus = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
            const updatedAgo = (claim?.created_at || claim?.updated_at) ? (() => {
              const diff = Date.now() - new Date(claim.created_at || claim.updated_at).getTime();
              const days = Math.floor(diff / 86400000);
              const hrs  = Math.floor(diff / 3600000);
              if (days >= 1) return `${days} day${days !== 1 ? 's' : ''} ago`;
              if (hrs  >= 1) return `${hrs} hr${hrs  !== 1 ? 's' : ''} ago`;
              return 'just now';
            })() : null;

            const statusChip = {
              name_added: { label: 'NAME ADDED',  bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)',  icon: null },
              pending:    { label: 'PENDING',      bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)',  color: '#FFB830',        icon: null },
              confirmed:  { label: 'BOOKED',       bg: 'rgba(0,200,100,.10)',  border: 'rgba(255,255,255,.15)', color: '#00C864',
                icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
            }[claimStatus] || { label: claimStatus.toUpperCase(), bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null };

            const claimedByArtist = claimStatus === 'confirmed' && !!claim?.user_id;

            return (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: updatedAgo ? 6 : 0 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: statusChip.bg, border: `1px solid ${statusChip.border}`, color: statusChip.color, borderRadius: 6, padding: '3px 10px' }}>
                    {statusChip.icon}
                    {statusChip.label}
                  </span>
                  {claimedByArtist && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.15)', color: 'var(--muted)', borderRadius: 6, padding: '3px 10px' }}>
                      CLAIMED BY ARTIST
                    </span>
                  )}
                </div>
                {updatedAgo && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: .3 }}>
                    {claimStatus === 'name_added' ? 'Name added' : claimStatus === 'pending' ? 'Awaiting confirmation' : 'Confirmed'} · {updatedAgo}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Public artist actions — shown to everyone when confirmed */}
          {isConfirmed && claim?.user_id && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                onClick={e => {
                  e.stopPropagation();
                  navigate(`/profile/${claim.user_id}`);
                }}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)', cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.35)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.18)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                VIEW PROFILE
              </button>
              {session?.user?.id && session.user.id !== claim.user_id && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    if (followBusy) return;
                    setFollowBusy(true);
                    if (followed) {
                      await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', claim.user_id);
                      setFollowed(false);
                    } else {
                      await supabase.from('follows').insert({ user_id: session.user.id, entity_id: claim.user_id, entity_type: 'artist', entity_name: claim.name });
                      setFollowed(true);
                    }
                    setFollowBusy(false);
                  }}
                  style={{ flexShrink: 0, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, border: followed ? 'none' : '1px solid rgba(0,229,255,.4)', background: followed ? 'var(--neon2)' : 'rgba(0,229,255,.07)', color: followed ? '#0a0a0f' : 'var(--neon2)', display: 'flex', alignItems: 'center', gap: 6, transition: 'background .15s, color .15s' }}
                >
                  {followed
                    ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> FOLLOWING</>
                    : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> FOLLOW</>
                  }
                </button>
              )}
            </div>
          )}

          {isHost && (
            <>
              {/* Primary action */}
              <button
                onClick={e => { e.stopPropagation(); onFill?.(); }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--neon)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,120,.5)'}
                style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,45,120,.5)', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .15s' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                <span style={{ color: '#fff' }}>BOOK ARTIST</span>
              </button>
              <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', margin: '0 0 14px' }}>Change or rebook this slot</p>

              {/* Manage actions */}
              <div style={{ paddingTop: 4, marginBottom: 14 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 8 }}>MANAGE SLOT</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <SlotManageBtn
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                    label="EDIT SLOT" sub="Time, duration & details"
                    accent="#4A9EFF"
                    onClick={e => { e.stopPropagation(); onEdit?.(); }}
                  />
                  <SlotManageBtn
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                    label={slot.pinned ? 'LOCKED' : 'LOCK SLOT'} sub="Prevent this slot from moving"
                    accent="#FFB830"
                    onClick={e => { e.stopPropagation(); onPin?.(); }}
                  />
                  <SlotManageBtn
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>}
                    label="REMOVE" sub="Remove this artist from slot"
                    onClick={e => { e.stopPropagation(); onRemove?.(); }}
                    danger
                  />
                </div>
              </div>

              {/* Private notes */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif", marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>PRIVATE NOTES</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontSize: 9 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    ONLY VISIBLE TO YOU
                  </span>
                </div>
                <textarea
                  value={hostNote}
                  onChange={e => setHostNote(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  placeholder="Rider notes, agreements, anything relevant…"
                  rows={2}
                  style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                />
                {claim?.updated_at && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                    Last updated {(() => {
                      const diff = Date.now() - new Date(claim.updated_at).getTime();
                      const days = Math.floor(diff / 86400000);
                      const hrs  = Math.floor(diff / 3600000);
                      const mins = Math.floor(diff / 60000);
                      if (days >= 1) return `${days} day${days !== 1 ? 's' : ''} ago`;
                      if (hrs  >= 1) return `${hrs} hr${hrs  !== 1 ? 's' : ''} ago`;
                      if (mins >= 1) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
                      return 'just now';
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SlotManageBtn({ icon, label, sub, onClick, accent = '#888', danger }) {
  const hex = danger ? '#FF2D78' : accent;
  const rgb = {
    '#4A9EFF': '74,158,255',
    '#FFB830': '255,184,48',
    '#FF2D78': '255,45,120',
    '#888':    '136,136,136',
  }[hex] || '136,136,136';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <button onClick={onClick}
        onMouseEnter={e => { e.currentTarget.style.background = `rgba(${rgb},.2)`; e.currentTarget.style.borderColor = hex; }}
        onMouseLeave={e => { e.currentTarget.style.background = `rgba(${rgb},.07)`; e.currentTarget.style.borderColor = `rgba(${rgb},.35)`; }}
        style={{ width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 6px', borderRadius: 10, border: `1px solid rgba(${rgb},.35)`, background: `rgba(${rgb},.07)`, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}>
        <span style={{ color: hex, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: hex, lineHeight: 1.1 }}>{label}</span>
      </button>
      <span style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.3, textAlign: 'center' }}>{sub}</span>
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
