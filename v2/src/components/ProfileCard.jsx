import { useNavigate } from 'react-router-dom';
import s from './ProfileCard.module.css';
import { PROFILE_TYPES, profileIdentity } from '../lib/profileTypes';
import { profileUrl } from '../lib/profileResolution';
import { formatLocation } from '../lib/formatLocation';
import { selectedPerformanceRoleLabels } from '../lib/profileTaxonomy';
import UnclaimedBadge from './UnclaimedBadge';

/**
 * Flat magenta, full opacity — the same colour PortraitCard's edge uses
 * (see the note there), on both the card's own border and the small avatar
 * thumbnail. One colour everywhere a card needs an edge, replacing the
 * per-type accent border this used to carry.
 *
 * ⚠ A COPY, same as PortraitCard's. Nothing links the two definitions.
 */
const CARD_EDGE = 'rgb(255,79,216)';

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
export default function ProfileCard({ item, badge, badgeColor, actions, onClick }) {
  const navigate = useNavigate();
  if (!item) return null;
  // 10F: one resolver, no artist sentinel. `item.type || 'artist'` then
  // `TYPE_STYLES[type] || TYPE_STYLES.artist` meant a row with a missing type
  // rendered as a cyan "DJ / PROD." with a DJ's photo — twice over.
  const type  = String(item.type || '').toLowerCase();
  const pt    = profileIdentity(type);
  const ts    = { col: pt.accent, rgb: pt.rgb, label: pt.shortLabel, emoji: pt.emoji };
  const loc   = formatLocation(item);
  const sound = item.sound || item.genre_string?.split(' · ').slice(0, 3).join(' · ') || '';
  const img   = item.avatar_thumb || item.avatar || null;
  // 10F: null for an unknown type — see UNKNOWN_PROFILE. There is no neutral
  // placeholder asset, and borrowing a real type's photo is what this pass exists
  // to stop. A malformed row now shows no image rather than a stranger's.
  const defaultImg = pt.defaultImage;
  // Standup: one pill per selected performance role (Comedy/Poetry), data-
  // driven so a future role works everywhere with no call-site change.
  const roleLabels = type === 'standup' ? selectedPerformanceRoleLabels(item.genre_string) : [];
  // `.filter(Boolean)` because ts.label is null for a Personal profile
  // (PUNTER_PROFILE.shortLabel) — without it this rendered an EMPTY chip, a
  // small dash-shaped pill with no text, on every punter row. Same bug as
  // PortraitCard had, missed here until the screenshot showed it.
  const typeLabels = (roleLabels.length ? roleLabels : [ts.label]).filter(Boolean);

  return (
    <div
      className={s.card}
      style={{ '--accent': ts.col, '--accent-rgb': ts.rgb, border: `1.5px solid ${CARD_EDGE}` }}
      onClick={() => {
        // An OPTIONAL override, not a new default. Messenger's contact list
        // reuses this card but must open the CONVERSATION rather than the
        // public profile — that list exists for talking to people. Every
        // existing caller passes nothing and keeps the navigation below.
        if (onClick) { onClick(item); return; }
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
        <img className={s.avatar} src={img || defaultImg} alt={item.name} style={{ borderColor: CARD_EDGE }} />
        <div className={s.info}>
          <div className={s.nameRow}>
            <span className={s.name}>{item.name}</span>
            {typeLabels.map((l, i) => (
              <span key={i} className={s.typeBadge} style={{ color: ts.col, background: `rgba(${ts.rgb},.15)`, borderColor: `rgba(${ts.rgb},.3)` }}>{l}</span>
            ))}
            {/* Sits after the type badge, same order as ProfileScreen's meta
                row. .nameRow is already flex with a 7px gap and wraps, so this
                needs no spacing of its own. */}
            <UnclaimedBadge profile={item} />
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
