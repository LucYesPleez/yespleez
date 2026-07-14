import { useNavigate } from 'react-router-dom';
import { profileUrl } from '../lib/profileResolution';
import { formatLocation } from '../lib/formatLocation';
import { selectedPerformanceRoleLabels } from '../lib/profileTaxonomy';

const PILL_STYLES = {
  artist:  { bg: '#00E5FF', dark: true,  label: 'DJ / PRODUCER' },
  host:    { bg: '#FF3399', dark: false, label: 'HOST' },
  band:    { bg: '#FF8C42', dark: true,  label: 'BAND' },
  venue:   { bg: '#00E5A0', dark: true,  label: 'VENUE' },
  standup: { bg: '#FF88AA', dark: true,  label: 'COMEDY' },
};

const DEFAULT_IMAGE = {
  artist:  '/defaultdj.png',
  band:    '/defaultband.png',
  standup: '/defaultmic.png',
  venue:   '/defaultvenueblur.png',
  host:    '/defaultpromoter.jpg',
};

/**
 * Props:
 *   profile  – { user_id, name, type, avatar, location, sound }
 *   onClick  – optional click handler (falls back to navigate /profile/:id)
 *   width    – card width in px (default 150)
 *   height   – card height in px (default 200)
 */
export default function PortraitCard({ profile: p, onClick, width = 150, height = 200 }) {
  const navigate = useNavigate();
  const type = (p?.type || 'artist').toLowerCase();
  const pill = PILL_STYLES[type] || { bg: '#00E5FF', dark: true, label: type.toUpperCase() };
  const label = type === 'standup' ? 'COMEDY' : (PILL_STYLES[type]?.label || type.toUpperCase());
  // Standup: one pill per selected performance role (Comedy/Poetry), data-
  // driven so a future role works everywhere with no call-site change.
  const roleLabels = type === 'standup' ? selectedPerformanceRoleLabels(p?.genre_string) : [];
  const pillLabels = roleLabels.length ? roleLabels : [label];
  // M5: canonical profile.id URL; legacy user_id URL only as a fallback for
  // callers whose selects don't carry `id` yet (the redirect shim covers it).
  const handleClick = onClick || (() => navigate(p?.id ? profileUrl(p) : `/profile/${p?.user_id}?type=${type}`));
  const soundTags = p?.sound ? p.sound.split(/\s*[·,/]\s*/).map(t => t.trim()).filter(Boolean).slice(0, 5) : [];

  return (
    <div
      onClick={handleClick}
      style={{ flexShrink: 0, width, height, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', position: 'relative', background: 'linear-gradient(135deg,rgba(255,45,120,.4),rgba(157,78,221,.3))', transition: 'transform .18s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = ''}
    >
      {/* avatar image */}
      <img src={p?.avatar_thumb || p?.avatar || DEFAULT_IMAGE[type]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" decoding="async" />
      {/* gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,.08) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.6) 75%,rgba(0,0,0,.88) 100%)' }} />
      {/* type pill(s) */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
        {pillLabels.map((l, i) => (
          <span key={i} style={{ background: pill.bg, color: pill.dark ? '#0a0a0f' : '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 9, fontWeight: 700, letterSpacing: .8, fontFamily: "'DM Sans',sans-serif" }}>
            {l}
          </span>
        ))}
      </div>
      {/* info */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: '#fff', lineHeight: 1.1 }}>{p?.name}</div>
        {formatLocation(p) && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatLocation(p)}</div>}
        {p?.sound && <div style={{ fontSize: 10, color: '#00E5FF', marginTop: 5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.sound}</div>}
      </div>
    </div>
  );
}
