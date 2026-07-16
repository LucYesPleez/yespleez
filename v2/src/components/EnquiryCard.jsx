import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDisplayDate } from '../lib/dates';
import { normaliseStatus } from '../lib/enquiryUtils';
import { formatLocation } from '../lib/formatLocation';
import { socialProfileUrl, socialHandle, ensureHttps } from '../lib/socialLinks';
import ds from '../screens/DiscoverScreen.module.css';
import DateBox from './DateBox';
import { PROFILE_TYPES } from '../lib/profileTypes';


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

const STATUS_COLOR = {
  new: '#FFD700', awaiting: '#FFD700',
  shortlisted: '#00B4D8', interested: '#00B4D8',
  accepted: '#00E5A0', booked: '#00E5A0',
  declined: 'var(--muted)',
};

// "What happens next" — same status set as STATUS_COLOR, worded per
// direction (incoming = you received this; outgoing = you sent this).
const NEXT_STEPS = {
  incoming: {
    new:         'Awaiting your review — shortlist or respond when ready.',
    shortlisted: "You've shortlisted this — accept or decline when ready.",
    accepted:    "You've accepted this — it's confirmed.",
    booked:      "You've accepted this — it's confirmed.",
    declined:    'You declined this.',
  },
  outgoing: {
    awaiting:    'Waiting for a response.',
    interested:  "They're interested — confirm to lock it in.",
    accepted:    'Accepted — confirm to finalise the booking.',
    booked:      'Booked and confirmed.',
    declined:    'This was declined.',
  },
};

export default function EnquiryCard({ enq, onRespond, onPlayDemo }) {
  const navigate = useNavigate();
  const [busy, setBusy]       = useState(false);
  const [profile, setProfile] = useState(enq.profile || null);
  const [expanded, setExpanded] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const expandRef = useRef(null);


  useEffect(() => {
    // M5.1 (D7): resolve by the enquiry row's applicant_profile_id; legacy
    // user_id+type lookup only when no profile id is present.
    if (enq.profile || (!enq.applicant_profile_id && !enq.applicant_user_id)) return;
    const q = enq.applicant_profile_id
      ? supabase.from('profiles').select('*').eq('id', enq.applicant_profile_id).maybeSingle()
      : supabase.from('profiles').select('*').eq('user_id', enq.applicant_user_id).eq('type', enq.applicant_type || 'artist').maybeSingle();
    q.then(({ data }) => data && setProfile(data));
  }, [enq.applicant_profile_id, enq.applicant_user_id, enq.profile]);

  const displayStatus = normaliseStatus(enq);
  const enqDir        = (enq.direction || 'incoming').toLowerCase();
  const accentPt      = PROFILE_TYPES[enq.applicant_type];
  const accent        = accentPt?.accent || '#00E5FF';
  const accentRgb     = accentPt?.rgb    || '0,229,255';
  const statusColor   = STATUS_COLOR[displayStatus] || '#FFD700';
  const nextStepsCopy = NEXT_STEPS[enqDir]?.[displayStatus] || '';

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond?.(enq.id, status);
    setBusy(false);
  }

  const p            = profile || {};
  const name         = p.name || enq.name || '—';
  const loc          = formatLocation(p);
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

  const dateRaw = enq.date_requested || enq.preferred_date || null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        position: 'relative', overflow: 'hidden', minHeight: 100,
        border: `1px solid rgba(${accentRgb},.35)`, cursor: 'default', marginBottom: 0,
        borderRadius: (expanded || nextStepsCopy) ? '14px 14px 0 0' : 14,
        borderBottom: nextStepsCopy ? 'none' : `1px solid rgba(${accentRgb},.35)`,
      }}>
        {/* Background image — same technique as EventCard: absolutely-positioned
            cover image + gradient overlay, content sits on top. */}
        <img src={avatar || accentPt?.defaultImage || PROFILE_TYPES.artist.defaultImage} alt={name}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(10,10,20,.92) 0%, rgba(10,10,20,.55) 50%, rgba(10,10,20,.82) 100%)' }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={ds.cardNameRow}>
              <span className={ds.cardName}>{name}</span>
              <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>
                {PROFILE_TYPES[(p.role || enq.applicant_type || 'artist').toLowerCase()]?.shortLabel || (p.role || enq.applicant_type || 'artist').toUpperCase()}
              </span>
            </div>
            {enq.event_name && (
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>
                {enq.event_name}
              </div>
            )}
            {loc   && <div className={ds.cardLoc}>{loc}</div>}
            {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '2px 7px' }}>
              {displayStatus.toUpperCase()}
            </span>
            {dateRaw && <DateBox date={dateRaw} size="sm" />}
            <HoverProfileBtn expanded={expanded} onClick={() => {
              const next = !expanded;
              setExpanded(next);
              // Mark as seen the moment the enquiree actually opens a brand-new
              // incoming enquiry — reuses the same onRespond callback every
              // dashboard already wires up for accept/decline/shortlist, so
              // this works everywhere EnquiryCard is used with no new prop.
              if (next && enqDir === 'incoming' && displayStatus === 'new') respond('seen');
            }} />
          </div>
        </div>
      </div>

      {nextStepsCopy && (
        <div style={{
          fontSize: 11, color: 'var(--muted)', padding: '6px 14px',
          background: 'rgba(255,255,255,.02)',
          border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none',
          borderRadius: expanded ? 0 : '0 0 14px 14px',
        }}>
          {nextStepsCopy}
        </div>
      )}

      {expanded && profile && (
        <div ref={expandRef} style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {/* The applicant's curated "Your 5 Tags" (card_pills) — their final
              identity, so it gets the signature Glow Pill display. */}
          {allTags.length > 0 && (
            <div className="glow-pills" style={{ marginBottom: 8 }}>
              {allTags.slice(0, 8).map(g => (
                <span key={g} className="glow-pill">{g}</span>
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
              <button onClick={() => onPlayDemo?.({ url: ensureHttps(p.mix_link) || socialProfileUrl('soundcloud', p.soundcloud) || socialProfileUrl('mixcloud', p.mixcloud), artistName: name })} style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: accent, cursor: 'pointer', textAlign: 'left' }}>Play demo</button>
            </div>
          )}
          {p.instagram && p.instagram !== 'N/A' && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>INSTAGRAM</div>
              <a href={socialProfileUrl('instagram', p.instagram)} target="_blank" rel="noopener" style={{ fontSize: 13, color: accent }}>@{socialHandle('instagram', p.instagram)}</a>
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
