import { NavLink } from 'react-router-dom';
import Icon from '../components/Icon';
import s from './FestivalSidebarItem.module.css';

/**
 * One navigation row. Every sidebar entry — top level or nested category —
 * is this component; there is no second row implementation to drift.
 *
 * ⛔ THE BADGE LAW: a number means "N things await your decision", and `null`
 * NEVER renders as `0`. A zero badge trains people to ignore badges, and the
 * absence of a badge is itself the signal that nothing is waiting.
 */
export default function FestivalSidebarItem({
  to,
  label,
  icon,
  count = null,
  nested = false,
  end = false,
}) {
  const showBadge = typeof count === 'number' && count > 0;

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [s.item, nested && s.nested, isActive && s.active].filter(Boolean).join(' ')
      }
    >
      {icon && <Icon name={icon} size={17} className={s.icon} />}
      <span className={s.label}>{label}</span>
      {showBadge && <span className={s.badge}>{count}</span>}
    </NavLink>
  );
}
