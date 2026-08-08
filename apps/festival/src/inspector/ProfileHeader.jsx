import { StatusBadge } from '../design-system';
import s from './ProfileHeader.module.css';

/**
 * Who this application is from — the fixed identity block above the tabs.
 *
 * Sits OUTSIDE the tab area on purpose. Whichever tab you are reading, you
 * should never have to scroll back or switch tabs to remember whose
 * application it is; and because it never re-renders on a tab change, the
 * panel has no visible movement when you move between tabs.
 *
 * ⭐ Identity is referenced, never copied. Everything here reads from the
 * applying profile; nothing is a stored duplicate of it.
 */
export default function ProfileHeader({ selection }) {
  if (!selection) return null;
  const { name, location, category, status } = selection;

  return (
    <div className={s.header}>
      <span className={s.avatar} />
      <div className={s.body}>
        <div className={s.nameRow}>
          <span className={s.name}>{name}</span>
        </div>
        <div className={s.meta}>
          {category && <span className={s.metaText}>{category}</span>}
          {category && location && <span className={s.sep}>·</span>}
          {location && <span className={s.metaText}>{location}</span>}
        </div>
        <div className={s.status}>
          {status && <StatusBadge status={status} />}
        </div>
      </div>
    </div>
  );
}
