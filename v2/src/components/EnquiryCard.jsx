import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDisplayDate } from '../lib/dates';
import { normaliseStatus } from '../lib/enquiryUtils';
import ds from '../screens/DiscoverScreen.module.css';


export function HoverPill({ label, accentRgb, accent }) {
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

export function HoverProfileBtn({ expanded, onClick, compact }) {
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

export function HoverBtn({ onClick, disabled, base, hover, children }) {
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

const TYPE_ACCENT = { artist: '#00E5FF', band: '#FF8C42', standup: '#FF88AA', host: '#FF3399', venue: '#00E5A0' };
const TYPE_RGB    = { artist: '0,229,255', band: '255,140,66', standup: '255,136,170', host: '255,51,153', venue: '0,229,160' };
const TYPE_LABEL  = { artist: 'DJ / PRODUCER', band: 'BAND', standup: 'SPOKEN', host: 'HOST', venue: 'VENUE' };

const STATUS_COLOR = {
  new: '#FFD700', awaiting: '#FFD700',
  shortlisted: '#00B4D8', interested: '#00B4D8',
  accepted: '#00E5A0', booked: '#00E5A0',
  declined: 'var(--muted)',
};

export default function EnquiryCard({ enq, onRespond, onPlayDemo }) {
  const navigate = useNavigate();
  const [busy, setBusy]       = useState(false);
  const [profile, setProfile] = useState(enq.profile || null);
  const [expanded, setExpanded] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const expandRef = useRef(null);


  useEffect(() => {
    if (enq.profile || !enq.applicant_user_id) return;
    supabase.from('profiles').select('*').eq('user_id', enq.applicant_user_id).eq('type', enq.applicant_type || 'artist').maybeSingle()
      .then(({ data }) => data && setProfile(data));
  }, [enq.applicant_user_id, enq.profile]);

  const displayStatus = normaliseStatus(enq);
  const enqDir        = (enq.direction || 'incoming').toLowerCase();
  const accent        = TYPE_ACCENT[enq.applicant_type] || '#00E5FF';
  const accentRgb     = TYPE_RGB[enq.applicant_type]    || '0,229,255';
  const statusColor   = STATUS_COLOR[displayStatus] || '#FFD700';

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond?.(enq.id, status);
    setBusy(false);
  }

  const p            = profile || {};
  const name         = p.name || enq.name || '—';
  const loc          = [p.location, p.state].filter(Boolean).join(', ');
  const avatar       = p.avatar || null;
  const allTags      = (p.card_pills || '').split(/[,·]/).map(s => s.trim()).filter(Boolean);
  const dateLabel    = enq.date_requested ? formatDisplayDate(enq.date_requested) : enq.preferred_date ? formatDisplayDate(enq.preferred_date) : 'Flexible date';
  const appliedLabel = enq.created_at ? new Date(enq.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const sound        = p.sound || p.genre_string?.split(/[·,]/).slice(0, 3).join(' · ') || '';

  const declineBtn = (
    <HoverBtn onClick={() => respond('declined')} disabled={busy}
      base={{ bg: 'rgba(255,80,80,.06)', border: '1px solid rgba(255,80,80,.2)', color: 'var(--muted)' }}
      hover={{ bg: 'rgba(255,80,80,.2)', border: '1px solid #ff5050', color: '#ff5050' }}
    >DECLINE ✗</HoverBtn>
  );

  function ActionButtons() {
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
      if (displayStatus === 'accepted') return (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <HoverBtn onClick={() => respond('booked')} disabled={busy}
            base={{ bg: 'rgba(0,229,160,.15)', border: '1px solid rgba(0,229,160,.5)', color: '#00E5A0' }}
            hover={{ bg: 'rgba(0,229,160,.35)', border: '1px solid #00E5A0' }}
          >CONFIRM BOOKED ✓</HoverBtn>
          {declineBtn}
        </div>
      );
    }
    return null;
  }

  const dateBox = (() => {
    const raw = enq.date_requested || enq.preferred_date;
    if (!raw) return null;
    const d = new Date(raw + 'T12:00:00');
    return {
      dn:  d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase(),
      mo:  d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase(),
      num: d.getDate(),
    };
  })();

  return (
    <div style={{ marginBottom: 8 }}>
      <div className={ds.card} style={{ border: `1px solid rgba(${accentRgb},.35)`, cursor: 'default', marginBottom: 0, borderRadius: expanded ? '14px 14px 0 0' : 14 }}>
        {avatar
          ? <img className={ds.cardAvatar} src={avatar} alt={name} style={{ borderColor: accent }} />
          : <div className={ds.cardAvatarPH} style={{ borderColor: accent }}>🎵</div>
        }
        <div className={ds.cardInfo}>
          <div className={ds.cardNameRow}>
            <span className={ds.cardName}>{name}</span>
            <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>
              {TYPE_LABEL[(p.role || enq.applicant_type || 'artist').toLowerCase()] || (p.role || enq.applicant_type || 'artist').toUpperCase()}
            </span>
          </div>
          {loc   && <div className={ds.cardLoc}>{loc}</div>}
          {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '2px 7px' }}>
            {displayStatus.toUpperCase()}
          </span>
          {dateBox && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid rgba(0,229,160,.5)', background: 'rgba(0,229,160,.08)', borderRadius: 7, padding: '4px 8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(0,229,160,.7)', lineHeight: 1 }}>{dateBox.dn}</span>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: 'rgba(0,229,160,.7)', lineHeight: 1 }}>{dateBox.mo}</span>
              </div>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 26, color: '#00E5A0', lineHeight: 1 }}>{dateBox.num}</span>
            </div>
          )}
          <HoverProfileBtn expanded={expanded} onClick={() => setExpanded(e => !e)} />
        </div>
      </div>

      {expanded && profile && (
        <div ref={expandRef} style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {allTags.slice(0, 8).map(g => (
                <HoverPill key={g} label={g} accentRgb={accentRgb} accent="#fff" />
              ))}
            </div>
          )}
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
              <button onClick={() => onPlayDemo?.({ url: p.mix_link || p.soundcloud || p.mixcloud, artistName: name })} style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: accent, cursor: 'pointer', textAlign: 'left' }}>Play demo</button>
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
                onClick={() => {
                  // M5: canonical id from the fetched profile row, or the
                  // enquiry row's applicant_profile_id; legacy URL only as a
                  // fallback (redirect shim covers it).
                  const pid = p?.id || enq.applicant_profile_id;
                  navigate(pid
                    ? '/profile/' + pid + '?type=' + (enq.applicant_type || 'artist')
                    : '/profile/' + enq.applicant_user_id + '?type=' + (enq.applicant_type || 'artist'));
                }}
                style={{ width: 'fit-content', background: 'rgba(255,51,153,.1)', border: '1px solid rgba(255,51,153,.35)', borderRadius: 8, padding: '4px 10px', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: '#fff', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,51,153,.22)'; e.currentTarget.style.borderColor = '#FF69B4'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,51,153,.1)'; e.currentTarget.style.borderColor = 'rgba(255,51,153,.35)'; }}
              >VIEW FULL PROFILE →</button>
            </div>
          )}
          <ActionButtons />
        </div>
      )}

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
