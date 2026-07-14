import { useState } from 'react';
import ds from '../screens/DiscoverScreen.module.css';
import { formatLocation } from '../lib/formatLocation';
import { socialProfileUrl, socialHandle, ensureHttps } from '../lib/socialLinks';

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

export default function ApplicationCard({ app, prof, event, onRespond, onAssign }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [bioOpen, setBioOpen]   = useState(false);
  const isPending   = app.status === 'pending';
  const isTentative = app.status === 'tentative';

  const TYPE_ACCENT = { artist: '#00E5FF', band: '#FF8C42', standup: '#FF88AA', dj: '#00E5FF', host: '#FF3399' };
  const TYPE_RGB    = { artist: '0,229,255', band: '255,140,66', standup: '255,136,170', dj: '0,229,255', host: '255,51,153' };
  const pType     = prof?.type || 'artist';
  const accent    = TYPE_ACCENT[pType] || '#00E5FF';
  const accentRgb = TYPE_RGB[pType]    || '0,229,255';

  const STATUS_COLOR = { confirmed: '#00E5A0', offered: '#FF8C42', accepted: '#FF8C42', rejected: '#888', declined: '#888', pending: '#FFD700', tentative: '#00B4D8' };
  const STATUS_LABEL = { confirmed: 'CONFIRMED', offered: 'OFFERED', accepted: 'OFFERED', rejected: 'DECLINED', declined: 'DECLINED', pending: 'PENDING', tentative: 'SHORTLISTED' };
  const statusColor = STATUS_COLOR[app.status] || '#FFD700';
  const statusLabel = STATUS_LABEL[app.status] || 'PENDING';

  const p      = prof || {};
  const name   = p.name || app.artist_name || '—';
  const loc    = formatLocation(p);
  const avatar = p.avatar || app.avatar_url || null;
  const sound  = p.sound || (p.genre_string || '').split(/[·,]/).slice(0, 3).join(' · ') || app.genre || '';
  const allTags = (p.card_pills || '').split(/[,·]/).map(t => t.trim()).filter(Boolean);

  const evName = event?.name || '—';
  const evDateBox = (() => {
    const raw = event?.config?.date;
    const d = raw ? new Date(raw + 'T12:00:00') : null;
    if (!d || isNaN(d.getTime())) return null;
    return {
      dn:  d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase(),
      mo:  d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase(),
      num: d.getDate(),
    };
  })();

  const appliedLabel = app.created_at
    ? new Date(app.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const mixLink = ensureHttps(app.mix_link || p.mix_link);

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond(app.id, status, app.artist_id, evName);
    setBusy(false);
  }

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
            <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>{pType.toUpperCase()}</span>
          </div>
          {loc   && <div className={ds.cardLoc}>{loc}</div>}
          {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
        </div>
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

      {expanded && (
        <div style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {allTags.slice(0, 8).map(g => (
                <span key={g} style={{ background: `rgba(${accentRgb},.1)`, border: `1px solid rgba(${accentRgb},.3)`, borderRadius: 20, fontSize: 10, padding: '2px 8px', color: accent }}>{g}</span>
              ))}
            </div>
          )}
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
              <a href={socialProfileUrl('instagram', p.instagram)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: accent }}>@{socialHandle('instagram', p.instagram)}</a>
            </div>
          )}
          {isPending && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <AppBtn onClick={() => respond('tentative')} disabled={busy}
                base={{ bg: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
                hover={{ bg: 'rgba(0,180,216,.28)', border: '1px solid #00B4D8' }}
              >SHORTLIST ✓</AppBtn>
              <AppBtn onClick={() => respond('rejected')} disabled={busy}
                base={{ bg: 'rgba(120,120,160,.06)', border: '1px solid rgba(120,120,160,.2)', color: 'var(--muted)' }}
                hover={{ bg: 'rgba(255,140,0,.18)', border: '1px solid #FF8C00', color: '#FF8C00' }}
              >DECLINE ✗</AppBtn>
            </div>
          )}
          {isTentative && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <AppBtn onClick={() => onAssign && onAssign(app, prof)} disabled={busy}
                base={{ bg: 'rgba(0,229,160,.1)', border: '1px solid rgba(0,229,160,.4)', color: '#00E5A0' }}
                hover={{ bg: 'rgba(0,229,160,.28)', border: '1px solid #00E5A0' }}
              >ASSIGN SLOT →</AppBtn>
              <AppBtn onClick={() => respond('rejected')} disabled={busy}
                base={{ bg: 'rgba(120,120,160,.06)', border: '1px solid rgba(120,120,160,.2)', color: 'var(--muted)' }}
                hover={{ bg: 'rgba(255,140,0,.18)', border: '1px solid #FF8C00', color: '#FF8C00' }}
              >DECLINE ✗</AppBtn>
            </div>
          )}
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
