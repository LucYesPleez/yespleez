import { useNavigate } from 'react-router-dom';
import s from './ProfileCard.module.css';
import { profileUrl } from '../lib/profileResolution';

export const TYPE_STYLES = {
  host:    { col: '#FF3399',     rgb: '255,51,153',  label: 'HOST',           emoji: '🎛️' },
  artist:  { col: 'var(--neon2)',rgb: '0,229,255',   label: 'DJ / PRODUCER',  emoji: '🎧' },
  band:    { col: '#FF8C42',     rgb: '255,140,66',  label: 'BAND',           emoji: '🎸' },
  standup: { col: '#FF88AA',     rgb: '255,136,170', label: 'COMEDY',         emoji: '🎤' },
  venue:   { col: '#00E5A0',     rgb: '0,229,160',   label: 'VENUE',          emoji: '📍' },
};

/**
 * Props:
 *   item      – profile row: { user_id, name, type, avatar, location, state, sound, genre_string, bio }
 *   badge     – optional label overlay (e.g. "PENDING", "BOOKED")
 *   badgeColor – colour for badge
 *   actions   – optional JSX rendered below the card (accept/decline buttons etc.)
 */
export default function ProfileCard({ item, badge, badgeColor, actions }) {
  const navigate = useNavigate();
  if (!item) return null;
  const type  = item.type || 'artist';
  const ts    = TYPE_STYLES[type] || TYPE_STYLES.artist;
  const loc   = [(item.suburb || item.location), item.state].filter(Boolean).join(', ');
  const sound = item.sound || item.genre_string?.split(' · ').slice(0, 3).join(' · ') || '';
  const img   = item.avatar_thumb || item.avatar || null;

  return (
    <div
      className={s.card}
      style={{ '--accent': ts.col, '--accent-rgb': ts.rgb, border: `1.5px solid rgba(${ts.rgb},.6)` }}
      onClick={() => {
        // M5: canonical profile.id URL; legacy fallback only for callers whose
        // selects don't carry `id` yet (the redirect shim covers it).
        if (item.id) navigate(profileUrl(item));
        else if (item.user_id) navigate(`/profile/${item.user_id}?type=${(item.type || '').toLowerCase()}`);
      }}
    >
      {/* Background image + overlay — same treatment as EventCard list rows */}
      {img
        ? <img className={s.bgImg} src={img} alt="" />
        : <div className={s.bgPH} />
      }
      <div className={s.bgOverlay} />

      {/* Content sits above overlay */}
      <div className={s.content}>
        {/* Avatar thumbnail on the left */}
        {img
          ? <img className={s.avatar} src={img} alt={item.name} style={{ borderColor: ts.col }} />
          : <div className={s.avatarPH} style={{ borderColor: ts.col, color: ts.col }}>{ts.emoji}</div>
        }
        <div className={s.info}>
          <div className={s.nameRow}>
            <span className={s.name}>{item.name}</span>
            <span className={s.typeBadge} style={{ color: ts.col, background: `rgba(${ts.rgb},.15)`, borderColor: `rgba(${ts.rgb},.3)` }}>{ts.label}</span>
            {badge && (
              <span className={s.statusBadge} style={{ color: badgeColor || '#fff', background: badgeColor ? `${badgeColor}22` : 'rgba(255,255,255,.1)', borderColor: badgeColor || '#fff' }}>
                {badge}
              </span>
            )}
          </div>
          {loc   && <div className={s.loc}><PinIcon />{loc}</div>}
          {sound && <div className={s.sound} style={{ color: ts.col }}>{sound}</div>}
        </div>
        {actions && <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 3 }}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}
