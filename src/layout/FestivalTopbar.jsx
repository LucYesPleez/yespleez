import Icon from '../components/Icon';
import FestivalSelector from './FestivalSelector';
import s from './FestivalTopbar.module.css';

/**
 * Shell chrome: which festival you are in, and the account-level controls
 * that follow you across every YesPleez portal.
 *
 * The bell and the message count are deliberately NOT portal-scoped. One
 * inbox, one bell, global badges — filtering belongs in the lists, never in
 * the badge.
 */
export default function FestivalTopbar({ festival, notificationCount = 0 }) {
  return (
    <header className={s.topbar}>
      <FestivalSelector festival={festival} />

      <div className={s.actions}>
        <button className={s.ghostBtn} type="button">
          <span className={s.publicLabel}>View Public Profile</span>
          <Icon name="external" size={15} />
        </button>

        <button className={s.iconBtn} type="button" aria-label="Notifications">
          <Icon name="bell" size={18} />
          {notificationCount > 0 && <span className={s.bellBadge}>{notificationCount}</span>}
        </button>

        <button className={s.user} type="button">
          <span className={s.avatar} />
          <span className={s.userText}>
            <span className={s.userRole}>Festival Director</span>
            <span className={s.userName}>Ben Anderson</span>
          </span>
          <Icon name="chevron" size={15} />
        </button>

        <button className={s.primaryBtn} type="button">
          <Icon name="plus" size={15} />
          New Announcement
        </button>
      </div>
    </header>
  );
}
