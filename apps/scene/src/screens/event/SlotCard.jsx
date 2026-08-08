// EP-00 · extracted verbatim from EventScreen.jsx.
// One slot row. Renders read-only for the public view and editable for the
// host editor — the difference is entirely in the props it is given.
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../../lib/supabase';
import { usePlayer, useSession } from '../../App';
// The follow-this-artist action inside an expanded slot needs all four of
// these. They were free identifiers in EventScreen.jsx — resolved there by its
// own imports — so extracting SlotCard without them would have been a
// ReferenceError on the first tap. Caught by `oxlint --deny no-undef`.
import { getPersonalProfileId } from '../../lib/actingProfile';
import { resolveProfileId } from '../../lib/resolveProfileId';
import { track, EVENTS } from '../../lib/analytics';
import { socialProfileUrl, ensureHttps } from '../../lib/socialLinks';
import UnclaimedBadge from '../../components/UnclaimedBadge';
import { parseDurMins, fmtDur, labelColor, stripEmoji } from './slotUtils';
import s from '../EventScreen.module.css';

function HeadphoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
    </svg>
  );
}

export default function SlotCard({ slot, claim, onFill, onEdit, onRemove, onPin, isHost, isSortable, isActiveSort, isDragOverlay, allMixSlots = [], locked = false }) {
  const [expanded,      setExpanded]      = useState(false);
  const [genreShowAll, setGenreShowAll] = useState(false);
  const pillHintRef = useRef(null);
  const [hostNote,      setHostNote]      = useState('');
  const [artistBrief,   setArtistBrief]   = useState('');
  const [notesBoxOpen,  setNotesBoxOpen]  = useState(false);
  const [briefOpen,     setBriefOpen]     = useState(false);
  const [hostNoteOpen,  setHostNoteOpen]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [followed,      setFollowed]      = useState(false);
  const [followBusy,    setFollowBusy]    = useState(false);
  const [confirm,       setConfirm]       = useState(null); // 'replace' | 'remove'

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
    disabled: !isSortable,
  });
  const navigate = useNavigate();
  const { session } = useSession();

  useEffect(() => {
    if (!session?.user?.id || !claim?.user_id || session.user.id === claim.user_id) return;
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', claim.user_id).maybeSingle()
      .then(({ data }) => setFollowed(!!data));
  }, [session?.user?.id, claim?.user_id]);

  useEffect(() => {
    if (!expanded) { setGenreShowAll(false); return; }
    if (!pillHintRef.current || genreShowAll) return;
    const el = pillHintRef.current;
    if (el.scrollWidth <= el.clientWidth) return;
    const t1 = setTimeout(() => el.scrollTo({ left: 48, behavior: 'smooth' }), 200);
    const t2 = setTimeout(() => el.scrollTo({ left: 0, behavior: 'smooth' }), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [expanded]);

  const { player, setPlayer } = usePlayer();
  const claimStatus   = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
  const isConfirmed   = claimStatus === 'confirmed';
  const isDraft       = claimStatus === 'draft';
  const artistName    = claim?.name || '';
  const publicName    = (!isHost && !isConfirmed && claim) ? 'PENDING' : artistName;
  const isEmpty       = !claim || (!isHost && isDraft);
  const rawDur     = parseDurMins(slot.dur ?? slot.duration);
  const durLabel   = fmtDur(rawDur > 0 ? rawDur : 60);
  const cleanLabel = slot.label ? stripEmoji(slot.label) : null;
  const col        = slot.labelColor || (cleanLabel ? labelColor(cleanLabel) : '#FFB830');

  // Single descriptor pill matching v1: sound > card_pills > genre
  const descriptor = claim?.sound || claim?.card_pills || claim?.genre || '';

  const borderCol = slot.pinned ? '#FFB830' : (isEmpty && !isDraft) ? 'var(--border)' : isDraft ? 'rgba(255,255,255,.18)' : 'var(--neon)';

  return (
    <div
      ref={setNodeRef}
      style={{ marginBottom: 8, opacity: isDragging ? 0 : isDragOverlay ? 0.85 : 1, transform: CSS.Transform.toString(transform), transition, boxShadow: isDragOverlay ? '0 8px 32px rgba(0,0,0,.5)' : undefined }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Drag handle — only in editor mode */}
        {isSortable && (
          <div
            {...attributes}
            {...listeners}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, flexShrink: 0, cursor: 'grab', borderRadius: expanded ? '10px 0 0 0' : '10px 0 0 10px', background: 'rgba(255,255,255,.04)', border: `1px solid ${borderCol}`, borderRight: 'none', color: 'rgba(255,255,255,.3)' }}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
              <circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
              <circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
            </svg>
          </div>
        )}
        <div
          className={s.slot + (isEmpty ? ' ' + s.slotEmpty : '')}
          style={{ border: `1px solid ${borderCol}`, borderLeft: player?.url && player.url === claim?.mix_link ? '2px solid var(--neon2)' : `1px solid ${borderCol}`, borderRadius: isSortable ? (expanded ? '0 10px 0 0' : '0 10px 10px 0') : (expanded ? '10px 10px 0 0' : 10), cursor: 'pointer', marginBottom: 0, flex: 1 }}
          onClick={() => {
            if (isEmpty && onFill) { onFill(); return; }
            if (!isHost && !isConfirmed) return; // pending slot — not expandable in public view
            setExpanded(v => !v);
          }}
        >
        <div className={s.timeBlock} style={{ '--divider-col': borderCol }}>
          <div className={s.timeNum}>{slot.time || '—'}</div>
          {slot.ampm && <div className={s.timeAmPm}>{slot.ampm}</div>}
          {durLabel && <div className={s.timeDur}>{durLabel}</div>}
        </div>
        <div className={s.slotInfo}>
          <div className={s.djNameRow}>
            <HeadphoneIcon />
            <span className={s.djName} style={{ color: isEmpty ? 'var(--muted)' : publicName === 'PENDING' ? 'var(--muted)' : isDraft ? 'rgba(255,255,255,.6)' : 'var(--text)', fontStyle: isEmpty ? 'italic' : 'normal' }}>
              {isEmpty ? 'Open slot' : publicName}
            </span>
            {/* Identity before slot status, same order as every other surface.
                .djNameRow is already flex with a 6px gap and .djName carries
                nowrap + ellipsis, so the name yields width and the badge needs
                no spacing of its own. */}
            <UnclaimedBadge profile={claim?.profile} />
            {isHost && isDraft && (
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'rgba(255,255,255,.35)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>DRAFT</span>
            )}
            {player?.url && player.url === claim?.mix_link && (
              <div className={s.eqBars}>
                {[
                  { dur: '0.7s', delay: '0s',    maxH: 11 },
                  { dur: '0.5s', delay: '0.1s',  maxH: 13 },
                  { dur: '0.6s', delay: '0.2s',  maxH: 10 },
                  { dur: '0.8s', delay: '0.05s', maxH: 12 },
                ].map((b, i) => (
                  <div key={i} className={s.eqBar} style={{ height: 4, animation: `yp-bar${i+1} ${b.dur} ${b.delay} ease-in-out infinite` }} />
                ))}
              </div>
            )}
          </div>
          {descriptor && (isHost || isConfirmed) && (
            <span style={{ display: 'inline-block', marginTop: 3, fontSize: 11, fontFamily: "'DM Sans',sans-serif", color: 'var(--neon2)', whiteSpace: 'nowrap', maxWidth: '100%' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 4 }}>
          {claim?.mix_link && (isHost || isConfirmed) && (
            <button
              onClick={e => {
                e.stopPropagation();
                if (player?.url === claim.mix_link) { setPlayer(null); return; }
                const idx = allMixSlots.findIndex(m => m.url === claim.mix_link);
                const playlist = idx >= 0 ? allMixSlots.slice(idx + 1) : [];
                setPlayer({ url: claim.mix_link, artistName: claim.name, playlist });
              }}
              className={player?.url === claim.mix_link ? s.playBtnActive : ''}
              style={{
                width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'border-color .15s',
                border: player?.url === claim.mix_link ? '1.5px solid rgba(255,255,255,.45)' : '1px solid rgba(255,255,255,.2)',
                background: player?.url === claim.mix_link ? undefined : 'rgba(255,255,255,.06)',
              }}
            >
              <svg width="10" height="11" viewBox="0 0 9 10" fill={player?.url === claim.mix_link ? '#fff' : 'rgba(255,255,255,.8)'}><polygon points="0,0 9,5 0,10"/></svg>
            </button>
          )}
          {(isHost || isConfirmed) && <span className={s.slotChevron} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>}
        </div>
        </div>
      </div>

      {expanded && !isEmpty && (isHost || isConfirmed || claim) && (
        <div style={{ background: 'var(--card2)', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 16px' }}>

          {/* Genre pills — when a card_pills value exists, this IS the performer's
              curated "Your 5 Tags" (their final identity), so it gets the
              signature Glow Pill. Falls back to the raw genre field otherwise,
              which keeps its existing look (that's not the curated 5). */}
          {(claim?.card_pills?.length || claim?.genre) && (() => {
            const usingCardPills = !!claim.card_pills?.length;
            const raw = usingCardPills ? claim.card_pills : claim.genre;
            const all = Array.isArray(raw)
              ? raw
              : raw.split(/[·,|/]+/).map(g => g.trim()).filter(Boolean);
            const SHOW = 6;
            const visible = genreShowAll ? all : all.slice(0, SHOW);
            const rest = all.length - visible.length;
            return (
              <div ref={genreShowAll ? null : pillHintRef} style={{ display: 'flex', flexWrap: genreShowAll ? 'wrap' : 'nowrap', gap: 5, marginBottom: 14, overflowX: genreShowAll ? 'visible' : 'auto', overflowY: 'hidden', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {visible.map(g => (
                  usingCardPills
                    ? <span key={g} className="glow-pill" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                    : <span key={g} style={{ fontSize: 10, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)', color: '#fff', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                ))}
                {!genreShowAll && rest > 0 && (
                  <button onClick={e => { e.stopPropagation(); setGenreShowAll(true); }}
                    style={{ fontSize: 12, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', color: 'var(--muted)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    +{rest} more
                  </button>
                )}
              </div>
            );
          })()}

          {/* Public row — Follow | Social icons | View Full Profile */}
          {claim?.user_id && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {/* Follow — left */}
              {session?.user?.id && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    if (followBusy) return;
                    setFollowBusy(true);
                    if (followed) {
                      await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', claim.user_id);
                      setFollowed(false);
                    } else {
                      const targetProfileId = await resolveProfileId(claim.user_id, 'artist');
                      // M6 (R6.1): from_profile_id is the follower (Personal);
                      // target_profile_id is who is being followed. Two ends,
                      // two columns — never conflate them.
                      const fromProfileId = await getPersonalProfileId(session.user.id);
                      await supabase.from('follows').insert({ user_id: session.user.id, from_profile_id: fromProfileId, entity_id: claim.user_id, entity_type: 'artist', entity_name: claim.name, target_profile_id: targetProfileId });
                      track(EVENTS.FOLLOWED, { entity_type: 'artist' });
                      setFollowed(true);
                    }
                    setFollowBusy(false);
                  }}
                  style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, border: '1.5px solid transparent', background: 'linear-gradient(var(--card),var(--card)) padding-box, linear-gradient(135deg,#00E5FF,#BF5FFF) border-box', color: '#fff', display: 'flex', alignItems: 'center', gap: 5, transition: 'opacity .15s' }}
                >
                  {followed
                    ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> FOLLOWING</>
                    : <>+ FOLLOW</>
                  }
                </button>
              )}

              {/* Social icons — centre, brand colours */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', opacity: 0.8 }}>
                {claim.instagram && (
                  <a href={socialProfileUrl('instagram', claim.instagram)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#F58529"/><stop offset="40%" stopColor="#DD2A7B"/><stop offset="100%" stopColor="#8134AF"/></linearGradient></defs>
                      <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig)"/>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" stroke="url(#ig)"/>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke="url(#ig)" strokeWidth="2.5"/>
                    </svg>
                  </a>
                )}
                {(claim.soundcloud || claim.mix_link?.includes('soundcloud')) && (
                  <a href={socialProfileUrl('soundcloud', claim.soundcloud) || ensureHttps(claim.mix_link)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="20" height="14" viewBox="0 0 24 16" fill="#FF5500">
                      <path d="M1.4 9.8c0-.5.4-.9.9-.9s.9.4.9.9v3.8c0 .5-.4.9-.9.9s-.9-.4-.9-.9V9.8zm2.4-.9c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v4.7c0 .6-.5 1.1-1.1 1.1S3.8 14.2 3.8 13.6V8.9zm2.5-.4c0-.7.6-1.3 1.3-1.3s1.3.6 1.3 1.3v5.1c0 .7-.6 1.3-1.3 1.3S6.3 14.3 6.3 13.6V8.5zm2.6-.3c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v5.4c0 .8-.6 1.4-1.4 1.4s-1.4-.6-1.4-1.4V8.2zm2.7.1c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6V8.3zm2.7-.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v5.8c0 1-.8 1.8-1.8 1.8s-1.8-.8-1.8-1.8V7.7zm2.8 1.1c0-1 .8-1.9 1.9-1.9s1.9.8 1.9 1.9v4.5c0 1-.8 1.9-1.9 1.9s-1.9-.8-1.9-1.9V8.8zm3-2c-.1 0-.3 0-.4.1C21.3 3.9 18.9 2 16.1 2c-1 0-1.9.3-2.7.7-.3.2-.4.4-.4.5v10.4c0 .2.1.3.3.3h8.9c.7 0 1.3-.6 1.3-1.3V8.8c0-1.1-.9-2-2-2z"/>
                    </svg>
                  </a>
                )}
                {(claim.mixcloud || claim.mix_link?.includes('mixcloud')) && (
                  <a href={socialProfileUrl('mixcloud', claim.mixcloud) || ensureHttps(claim.mix_link)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="22" height="14" viewBox="0 0 32 16" fill="#52AAD8">
                      <path d="M20 2c-3.3 0-6.1 2.2-6.9 5.2-.6-.4-1.3-.6-2.1-.6-2.2 0-3.9 1.8-3.9 4s1.7 4 3.9 4h13.1c2 0 3.6-1.6 3.6-3.6 0-1.8-1.3-3.3-3-3.5V7c0-3.3-2.7-5-4.7-5zM4.5 6C2 6.2 0 8.4 0 11v.1C-.9 11.5-1.5 12.5-1.5 13.5c0 1.7 1.3 3 3 3H2V6H1.5c-.7 0-1.3.3-1.8.6C-.7 5.5.1 4.5 1 3.8c.2-.2.5-.3.8-.4h.3c.4 0 .8.2 1.1.4l.2.3c-.4.2-.7.6-.9 1.2-.1.2-.1.5-.1.7H4.5z"/>
                    </svg>
                  </a>
                )}
                {claim.youtube && (
                  <a href={socialProfileUrl('youtube', claim.youtube)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="20" height="14" viewBox="0 0 24 16" fill="#FF0000">
                      <path d="M23.5 2.5a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.4A3 3 0 0 0 .5 2.5 31 31 0 0 0 0 8a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1C4.5 16 12 16 12 16s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 8a31 31 0 0 0-.5-5.5zM9.75 11.5v-7L16 8l-6.25 3.5z"/>
                    </svg>
                  </a>
                )}
                {claim.website && (
                  <a href={ensureHttps(claim.website)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </a>
                )}
              </div>

              {/* View Full Profile — right */}
              <button
                onClick={e => { e.stopPropagation(); navigate(claim.profile_id ? `/profile/${claim.profile_id}?prefer=performer` : `/profile/${claim.user_id}?prefer=performer`); }}
                style={{ flexShrink: 0, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, background: 'none', border: 'none', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              ><span style={{ background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>VIEW PROFILE →</span></button>
            </div>
          )}

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

            return isHost ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: statusChip.bg, border: `1px solid ${statusChip.border}`, color: statusChip.color, borderRadius: 6, padding: '3px 10px' }}>
                    {statusChip.icon}{statusChip.label}
                  </span>
                  {claimedByArtist && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.15)', color: 'var(--muted)', borderRadius: 6, padding: '3px 10px' }}>
                      ACCEPTED BY ARTIST
                    </span>
                  )}
                  {isConfirmed && (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirm('replace'); }}
                      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.35)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s, border-color .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,120,.2)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.6)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,45,120,.08)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.35)'; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                      REPLACE ARTIST
                    </button>
                  )}
                </div>
              </div>
            ) : null;
          })()}

          {isHost && (
            <>
              {/* Primary action — only show big button when slot not yet confirmed */}
              {!isConfirmed && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); onFill?.(); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--neon)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,120,.5)'}
                    style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,45,120,.5)', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .15s' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    <span style={{ color: '#fff' }}>BOOK ARTIST</span>
                  </button>
                </>
              )}

              {/* Confirm dialog */}
              {confirm && (
                <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.3)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <p style={{ margin: '0 0 10px', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2, color: '#fff' }}>
                    {confirm === 'remove' ? 'REMOVE this artist from the slot?' : 'REPLACE this artist with someone else?'}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setConfirm(null); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: 'var(--muted)', cursor: 'pointer' }}
                    >CANCEL</button>
                    <button
                      onClick={() => { setConfirm(null); if (confirm === 'remove') onRemove?.(); else onFill?.(); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#FF2D78', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: '#fff', cursor: 'pointer' }}
                    >{confirm === 'remove' ? 'YES, REMOVE' : 'YES, REPLACE'}</button>
                  </div>
                </div>
              )}

              {/* Manage actions — hidden when set times are locked */}
              {!locked && (
                <div style={{ paddingTop: 0, marginBottom: 14 }}>
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
                      onClick={e => { e.stopPropagation(); setConfirm('remove'); }}
                      danger
                    />
                  </div>
                </div>
              )}

              {/* Notes accordion */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 4 }}>
                <button
                  onClick={e => { e.stopPropagation(); setNotesBoxOpen(v => !v); }}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--text)' }}>NOTES</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0, transform: notesBoxOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                {notesBoxOpen && (
                  <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '4px 12px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>

                    {/* Artist Brief */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <button onClick={e => { e.stopPropagation(); setBriefOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>ARTIST BRIEF</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Visible to artist</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: briefOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {briefOpen && (
                        <div style={{ paddingBottom: 10 }} onClick={e => e.stopPropagation()}>
                          <textarea value={artistBrief} onChange={e => setArtistBrief(e.target.value)} onClick={e => e.stopPropagation()} placeholder="Arrive time, load-in instructions, set length, guest list…" rows={3}
                            style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: 10, color: 'var(--neon2)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            Visible to artist
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Host Notes */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <button onClick={e => { e.stopPropagation(); setHostNoteOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>HOST NOTES</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Private to organisers</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: hostNoteOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {hostNoteOpen && (
                        <div style={{ paddingBottom: 10 }} onClick={e => e.stopPropagation()}>
                          <textarea value={hostNote} onChange={e => setHostNote(e.target.value)} onClick={e => e.stopPropagation()} placeholder="Rider notes, agreements, anything relevant…" rows={3}
                            style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            Only visible to organisers
                          </div>
                        </div>
                      )}
                    </div>

                    {/* History */}
                    <div>
                      <button onClick={e => { e.stopPropagation(); setHistoryOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 16 3 11 8 11"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>HISTORY</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Changes & activity</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {historyOpen && (
                        <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {claim?.created_at && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{claimStatus === 'name_added' ? 'Name added' : 'Booked'}</span>
                              <span>{(() => { const d = Date.now() - new Date(claim.created_at).getTime(); const days = Math.floor(d/86400000); const hrs = Math.floor(d/3600000); return days >= 1 ? `${days}d ago` : hrs >= 1 ? `${hrs}hr ago` : 'just now'; })()}</span>
                            </div>
                          )}
                          {claimStatus === 'confirmed' && claim?.updated_at && claim.updated_at !== claim.created_at && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>Confirmed by artist</span>
                              <span>{(() => { const d = Date.now() - new Date(claim.updated_at).getTime(); const days = Math.floor(d/86400000); const hrs = Math.floor(d/3600000); return days >= 1 ? `${days}d ago` : hrs >= 1 ? `${hrs}hr ago` : 'just now'; })()}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

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
