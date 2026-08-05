import FestivalSidebarItem from './FestivalSidebarItem';
import { APPLICATION_CATEGORIES, PRIMARY_NAV, SECONDARY_NAV } from '../config/navigation';
import s from './FestivalSidebar.module.css';

/**
 * Workspace navigation. Renders entirely from `config/navigation.js` — adding
 * a category is a data entry, never a change here.
 *
 * This is the DESKTOP workspace nav. The portal-level tab set (Explore ·
 * Apps · Messages · Me) is a separate, mobile-first concern and is not built
 * yet; the layout is structured so it can be introduced without touching this
 * component.
 */
export default function FestivalSidebar() {
  return (
    <aside className={s.sidebar}>
      <div className={s.brand}>
        <div className={s.wordmark}>
          YESPLEEZ
          <span className={s.subMark}>FESTIVAL PORTAL</span>
        </div>
      </div>

      <nav className={s.nav}>
        {/* `key` is destructured out rather than spread — React 19 treats a
            key arriving via spread as an error, and the config's `key` field
            is an identifier for us, not a prop for the component. */}
        {PRIMARY_NAV.map(({ key, ...item }) => (
          <FestivalSidebarItem key={key} {...item} />
        ))}

        <div className={s.sectionLabel}>Applications</div>
        {APPLICATION_CATEGORIES.map(cat => (
          <FestivalSidebarItem
            key={cat.key}
            to={`/applications/${cat.key}`}
            label={cat.label}
            icon={cat.key}
            count={cat.count}
            nested
          />
        ))}

        <div className={s.divider} />

        {SECONDARY_NAV.map(({ key, ...item }) => (
          <FestivalSidebarItem key={key} {...item} />
        ))}
      </nav>

      <div className={s.footer}>
        <FestivalSidebarItem to="/help" label="Help & Support" icon="profile" />
      </div>
    </aside>
  );
}
