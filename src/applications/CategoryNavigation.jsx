import { NavLink } from 'react-router-dom';
import { Icon } from '../design-system';
import { CATEGORIES, ALL_CATEGORY } from '../config/categories';
import s from './CategoryNavigation.module.css';

/**
 * ⭐ CATEGORIES AS TABS, NOT PAGES.
 *
 * This component is the whole reason the sidebar has six entries instead of
 * fifteen. Every category is a view of ONE workspace: the table, the toolbar,
 * the pagination and the inspector never unmount when you move between them,
 * so switching from Music to Volunteers costs nothing and loses nothing.
 *
 * Rendered from `config/categories.js`. Adding "Sponsors" next year is one
 * entry there — no route, no screen, no component.
 *
 * These are links rather than buttons on purpose: the category belongs in the
 * URL so a view is shareable with a colleague and survives a reload.
 */
export default function CategoryNavigation() {
  const tabs = [ALL_CATEGORY, ...CATEGORIES];

  return (
    <nav className={s.nav} aria-label="Application categories">
      {tabs.map(cat => (
        <NavLink
          key={cat.key}
          to={cat.key === 'all' ? '/applications' : `/applications/${cat.key}`}
          end={cat.key === 'all'}
          className={({ isActive }) => [s.tab, isActive && s.active].filter(Boolean).join(' ')}
        >
          <Icon name={cat.icon} size={16} className={s.icon} />
          {cat.label}
          <span className={s.count}>{cat.count}</span>
        </NavLink>
      ))}
    </nav>
  );
}
