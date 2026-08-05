import { Icon, Button } from '../design-system';
import FestivalSelector from './FestivalSelector';
import AnnouncementButton from './AnnouncementButton';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { useSession } from '../auth/useSession';
import s from './TopBar.module.css';

/**
 * Shell chrome: which festival you are in, and the account-level controls that
 * follow you across every YesPleez portal.
 *
 * ⛔ The bell and the message count are NOT portal-scoped. One inbox, one
 * bell, global totals — a user must never miss a message because they were in
 * the wrong room. Filtering by portal belongs in the lists, never in a badge.
 *
 * ⚠ Both badges default to 0 because messaging and notifications are not wired
 * yet. They previously defaulted to 4 and 3, which put two unread counts on
 * screen for an account with no messages at all.
 */

/**
 * "16 – 19 January 2027", or one date, or nothing.
 *
 * Returns null rather than a placeholder when a festival has no dates set:
 * absent is not the same as unknown, and a lone calendar icon beside an empty
 * string is a visual hole.
 */
function formatDates(startsOn, endsOn) {
  if (!startsOn && !endsOn) return null;
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  const start = startsOn ? new Date(startsOn) : null;
  const end = endsOn ? new Date(endsOn) : null;
  if (start && end) {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    return sameMonth
      ? `${start.getDate()} – ${end.toLocaleDateString('en-AU', opts)}`
      : `${start.toLocaleDateString('en-AU', opts)} – ${end.toLocaleDateString('en-AU', opts)}`;
  }
  return (start || end).toLocaleDateString('en-AU', opts);
}

export default function TopBar({ notifications = 0, messages = 0 }) {
  const { festivals } = useRepositories();
  const { data: festival } = useQuery(() => festivals.getCurrent(), []);
  const { user } = useSession();

  // Scene's sign-up stores a display name in user metadata; fall back to the
  // email rather than inventing a title. The old "Festival Director" was a
  // placeholder, and a fabricated role on a real account is a lie the UI
  // cannot walk back.
  const displayName = user?.user_metadata?.name || user?.email || '';

  return (
    <header className={s.topbar}>
      <FestivalSelector
        festival={festival && {
          ...festival,
          dates: formatDates(festival.startsOn, festival.endsOn),
        }}
      />

      <div className={s.actions}>
        {/* Was a dead button labelled "View Public Profile". There is no public
            profile page yet; the application page IS the public face, so it
            says what it does and goes where it says. */}
        {festival?.eventId && (
          <Button
            variant="secondary"
            iconRight="external"
            onClick={() => window.open(
              `${window.location.origin}${window.location.pathname}#/apply/${festival.eventId}`,
              '_blank',
            )}
          >
            <span className={s.publicLabel}>View application page</span>
          </Button>
        )}

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
            <span className={s.userName}>{displayName}</span>
          </span>
          <Icon name="chevron" size={15} />
        </button>

        <AnnouncementButton />
      </div>
    </header>
  );
}
