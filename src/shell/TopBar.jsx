import { Icon, Button } from '../design-system';
import FestivalSelector from './FestivalSelector';
import AnnouncementButton from './AnnouncementButton';
import { FESTIVAL, CURRENT_USER } from '../config/navigation';
import s from './TopBar.module.css';

/**
 * Shell chrome: which festival you are in, and the account-level controls that
 * follow you across every YesPleez portal.
 *
 * ⛔ The bell and the message count are NOT portal-scoped. One inbox, one
 * bell, global totals — a user must never miss a message because they were in
 * the wrong room. Filtering by portal belongs in the lists, never in a badge.
 */
export default function TopBar({ notifications = 3, messages = 4 }) {
  return (
    <header className={s.topbar}>
      <FestivalSelector festival={FESTIVAL} />

      <div className={s.actions}>
        <Button variant="secondary" iconRight="external">
          <span className={s.publicLabel}>View Public Profile</span>
        </Button>

        <span className={s.divider} />

        <button className={s.iconBtn} type="button" aria-label={`Messages, ${messages} unread`}>
          <Icon name="messages" size={18} />
          {messages > 0 && <span className={s.badge}>{messages}</span>}
        </button>

        <button className={s.iconBtn} type="button" aria-label={`Notifications, ${notifications} unread`}>
          <Icon name="bell" size={18} />
          {notifications > 0 && <span className={s.badge}>{notifications}</span>}
        </button>

        <button className={s.user} type="button">
          <span className={s.avatar} />
          <span className={s.userText}>
            <span className={s.userRole}>{CURRENT_USER.role}</span>
            <span className={s.userName}>{CURRENT_USER.name}</span>
          </span>
          <Icon name="chevron" size={15} />
        </button>

        <AnnouncementButton />
      </div>
    </header>
  );
}
