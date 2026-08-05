import { NavLink } from 'react-router-dom';
import Icon from './Icon';
import { APPLICATION_CATEGORIES } from '../config/navigation';
import s from './ApplicationsToolbar.module.css';

/**
 * Search, filters and export.
 *
 * UI ONLY — no filtering logic, no search logic, deliberately. Every control
 * is rendered and inert so the layout is settled before behaviour lands; a
 * control that appears later moves everything around it.
 *
 * The filter controls are `<button>`s rather than `<select>`s because each
 * will open a multi-select popover, and swapping a native select for a
 * popover later would be a rewrite rather than a fill-in.
 */
export default function ApplicationsToolbar({ activeCategory }) {
  return (
    <>
      <div className={s.tabs}>
        <NavLink to="/applications" end className={({ isActive }) =>
          [s.tab, isActive && s.tabActive].filter(Boolean).join(' ')}>
          All <span className={s.tabCount}>384</span>
        </NavLink>
        {APPLICATION_CATEGORIES.map(cat => (
          <NavLink
            key={cat.key}
            to={`/applications/${cat.key}`}
            className={({ isActive }) =>
              [s.tab, isActive && s.tabActive].filter(Boolean).join(' ')}
          >
            {cat.label} <span className={s.tabCount}>{cat.count}</span>
          </NavLink>
        ))}
      </div>

      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon name="search" size={16} />
          <input
            className={s.searchInput}
            type="search"
            placeholder="Search applications…"
            aria-label={`Search ${activeCategory || 'all'} applications`}
          />
        </label>

        <button className={s.select} type="button">All Status <Icon name="chevron" size={14} /></button>
        <button className={s.select} type="button">All Stages <Icon name="chevron" size={14} /></button>
        <button className={s.select} type="button">All Countries <Icon name="chevron" size={14} /></button>
        <button className={s.select} type="button">All Genres <Icon name="chevron" size={14} /></button>
        <button className={s.select} type="button"><Icon name="filter" size={14} /> Filters</button>

        <span className={s.spacer} />

        <button className={s.export} type="button">
          <Icon name="export" size={15} /> Export
        </button>
      </div>
    </>
  );
}
