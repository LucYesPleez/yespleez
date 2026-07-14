import { useNavigate } from 'react-router-dom';
import s from './ProfileCard.module.css';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { profileUrl } from '../lib/profileResolution';
import { formatLocation } from '../lib/formatLocation';
import { selectedPerformanceRoleLabels } from '../lib/profileTaxonomy';

// Re-exported in { col, rgb, label, emoji } shape — DiscoverScreen and others depend on this export.
// `label` here is the compact badge/pill form (PROFILE_TYPES.shortLabel) — this
// component's own `.typeBadge` pill is a tight space, same as PortraitCard's.
export const TYPE_STYLES = Object.fromEntries(
  Object.entries(PROFILE_TYPES).map(([type, pt]) => [
    type,
    { col: pt.accent, rgb: pt.rgb, label: pt.shortLabel, emoji: pt.emoji },
  ])
);

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
  const loc   = formatLocation(item);
  const sound = item.sound || item.genre_string?.split(' · ').slice(0, 3).join(' · ') || '';
  const img   = item.avatar_thumb || item.avatar || null;
  const defaultImg = (PROFILE_TYPES[type] || PROFILE_TYPES.artist).defaultImage;
  // Standup: one pill per selected performance role (Comedy/Poetry), data-
  // driven so a future role works everywhere with no call-site change.
  const roleLabels = type === 'standup' ? selectedPerformanceRoleLabels(item.genre_string) : [];
  const typeLabels = roleLabels.length ? roleLabels : [ts.label];

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
      <img className={s.bgImg} src={img || defaultImg} alt="" />
      <div className={s.bgOverlay} />

      {/* Content sits above overlay */}
      <div className={s.content}>
        {/* Avatar thumbnail on the left */}
        <img className={s.avatar} src={img || defaultImg} alt={item.name} style={{ borderColor: ts.col }} />
        <div className={s.info}>
          <div className={s.nameRow}>
            <span className={s.name}>{item.name}</span>
            {typeLabels.map((l, i) => (
              <span key={i} className={s.typeBadge} style={{ color: ts.col, background: `rgba(${ts.rgb},.15)`, borderColor: `rgba(${ts.rgb},.3)` }}>{l}</span>
            ))}
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
