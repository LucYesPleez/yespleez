import { NavLink } from 'react-router-dom';
import { Icon } from '../design-system';
import s from './SidebarItem.module.css';

/**
 * One navigation destination.
 *
 * ⛔ THE BADGE LAW: a number means "N things await your decision". `null`,
 * `undefined` and `0` all render NOTHING. A zero badge trains people to
 * ignore badges, and the absence of one is itself the signal that nothing is
 * waiting.
 *
 * `end` is set for Applications so that `/applications/music` still marks the
 * parent active — the category is a view of that destination, not a
 * different one.
 */
export default function SidebarItem({ to, label, icon, count }) {
  const showBadge = typeof count === 'number' && count > 0;

  return (
    <NavLink
      to={to}
      className={({ isActive }) => [s.item, isActive && s.active].filter(Boolean).join(' ')}
    >
      {icon && <Icon name={icon} size={18} className={s.icon} />}
      <span className={s.label}>{label}</span>
      {showBadge && <span className={s.badge}>{count}</span>}
    </NavLink>
  );
}
