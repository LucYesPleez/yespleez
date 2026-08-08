import { NavLink } from 'react-router-dom';
import { Icon } from '../design-system';
import s from './BottomNav.module.css';

/**
 * THE COMPANION'S NAVIGATION — five destinations, and they never move.
 *
 * ⭐ Stable navigation is ratified law: a destination is a MAP, not a
 * recommendation, and a map that redraws itself teaches nothing. So People
 * appears here from day one and answers with an empty state rather than
 * vanishing until it has rows.
 *
 * ⛔ Five, not six. Event and Settings live under More — they are configuration,
 * and configuration is desktop-weighted work that a phone reaches for
 * occasionally rather than lives in.
 */
const TABS = [
  { to: '/companion',        label: 'Home',   icon: 'dashboard', end: true },
  { to: '/applications',     label: 'Apps',   icon: 'inbox' },
  { to: '/companion/people', label: 'People', icon: 'volunteer' },
  { to: '/messages',         label: 'Comms',  icon: 'messages' },
  { to: '/companion/more',   label: 'More',   icon: 'dots' },
];

export default function BottomNav() {
  return (
    <nav className={s.nav} aria-label="Festival Companion">
      {TABS.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `${s.tab} ${isActive ? s.active : ''}`}
        >
          <Icon name={icon} size={20} />
          <span className={s.label}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
