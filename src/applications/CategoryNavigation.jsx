import { useRef, useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../design-system';
import { CATEGORIES, ALL_CATEGORY } from '../config/categories';
import s from './CategoryNavigation.module.css';

/**
 * ⭐ CATEGORIES AS TABS, NOT PAGES.
 *
 * This is the whole reason the sidebar has six entries instead of fifteen.
 * Every category is a view of ONE workspace: the table, the toolbar, the
 * pagination and the inspector never unmount, so switching from Music to
 * Volunteers costs nothing and loses nothing.
 *
 * Rendered from `config/categories.js`. Adding "Sponsors" next year is one
 * entry there — no route, no screen, no component.
 *
 * Links rather than buttons: the category belongs in the URL so a view is
 * shareable with a colleague and survives a reload.
 *
 * ── THE FADE ──
 * Ten categories do not fit a docked-inspector pane, and the portal shows no
 * scrollbars anywhere. Without a cue the last two categories read as MISSING
 * rather than off-screen. The fade appears only when the strip actually
 * overflows and disappears at the end of the scroll, so it never implies
 * content that is not there.
 */
export default function CategoryNavigation() {
  const tabs = [ALL_CATEGORY, ...CATEGORIES];
  const navRef = useRef(null);
  const [fade, setFade] = useState(0);

  const measure = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft;
    // Ease the last 40px so the cue fades out rather than snapping off.
    setFade(Math.max(0, Math.min(1, remaining / 40)));
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // The pane resizes when the inspector opens or the window changes, and
    // neither fires a scroll event — observe the box itself.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [measure]);

  // Keep the active tab in view when the category changes from elsewhere
  // (a stat card on Overview, a shared link) — otherwise you land on a
  // workspace whose current category is scrolled out of sight.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });

  return (
    <div className={s.frame} style={{ '--fade': fade }}>
      <nav className={s.nav} ref={navRef} aria-label="Application categories">
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
    </div>
  );
}
