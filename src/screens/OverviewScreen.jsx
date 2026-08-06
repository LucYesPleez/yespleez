import StatCard from '../overview/StatCard';
import ActivityPanel from '../overview/ActivityPanel';
import MessagesPanel from '../overview/MessagesPanel';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { useShell } from '../shell/shellContext';
import s from './screens.module.css';

/**
 * OVERVIEW — a lightweight summary, deliberately NOT a working screen.
 *
 * ⭐ The Applications workspace is where the work happens. This page answers
 * one question — "what needs me today?" — and every answer is a door into
 * that workspace. There is no table here on purpose: two places to review
 * applications means two places to fix every bug, and people would learn
 * whichever one they landed on first.
 *
 * ⚠ Every figure below used to be invented — 384 applications over a database
 * holding two. A summary screen that states a number it did not measure is
 * worse than one that states nothing, because a reader cannot tell which
 * numbers to trust once they find one that lies.
 *
 * ⭐ DELTAS ARE ABSENT UNLESS COMPUTABLE. There is no audit log, so "↑ 5 since
 * yesterday" is unknowable. The one real delta is today's arrivals, which is a
 * subset of this week's and therefore actually derivable.
 */
const CARDS = [
  { key: 'total',       label: 'Total Applications', field: 'total',          icon: 'inbox',  tone: 'purple' },
  { key: 'new',         label: 'New This Week',      field: 'newThisWeek',    icon: 'plus',   tone: 'cyan' },
  { key: 'reviewing',   label: 'Awaiting Review',    field: 'awaitingReview', icon: 'clock',  tone: 'gold' },
  { key: 'shortlisted', label: 'Shortlisted',        field: 'shortlisted',    icon: 'star',   tone: 'fire' },
  { key: 'accepted',    label: 'Accepted',           field: 'accepted',       icon: 'check',  tone: 'green' },
  { key: 'declined',    label: 'Declined',           field: 'declined',       icon: 'cross',  tone: 'pink' },
];

export default function OverviewScreen() {
  const { applications } = useRepositories();
  // Follows the selected event and any decision taken elsewhere in the portal.
  const { dataVersion } = useShell();
  const { data, loading } = useQuery(() => applications.stats(), [dataVersion]);

  const today = data?.today;

  /**
   * ⭐ A zero here is MEANINGFUL and is shown — "0 declined today" is a fact
   * about the day, the opposite of the badge law. What is dropped instead is
   * anything with no source at all: there is no messaging in this portal, so
   * "New messages" is gone rather than reported as zero, which would claim a
   * working feature.
   */
  const activity = today ? [
    { key: 'music',     icon: 'music',     value: today.musicToday,      label: 'New music applications', tone: 'pink' },
    { key: 'review',    icon: 'clock',     value: data.awaitingReview,   label: 'Awaiting review',        tone: 'gold' },
    { key: 'volunteer', icon: 'volunteer', value: today.volunteersToday, label: 'New volunteers',         tone: 'cyan' },
    { key: 'accepted',  icon: 'check',     value: today.acceptedToday,   label: 'Accepted today',         tone: 'green' },
    { key: 'newToday',  icon: 'inbox',     value: today.newToday,        label: 'Arrived today',          tone: 'purple' },
    { key: 'declined',  icon: 'cross',     value: today.declinedToday,   label: 'Declined today',         tone: 'pink' },
  ] : [];

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Overview</h1>
          <p className={s.pageSubtitle}>
            Where the festival stands today. Every figure opens the applications workspace.
          </p>
        </div>
      </header>

      <div className={s.stack}>
        <div className={s.statsRow}>
          {CARDS.map(({ key, field, ...card }) => (
            <StatCard
              key={key}
              {...card}
              loading={loading}
              value={data?.[field] ?? 0}
              // The only honest delta: today's arrivals are a subset of the
              // week's, so it can be derived rather than remembered.
              delta={key === 'new' && today?.newToday ? `↑ ${today.newToday} today` : undefined}
              trend={key === 'new' && today?.newToday ? 'up' : undefined}
              to="/applications"
            />
          ))}
        </div>

        <div className={s.twoUp}>
          <ActivityPanel items={activity} loading={loading} />
          {/* ⛔ No messaging exists in this portal, and inventing three
              conversations was the most misleading thing on the screen. The
              empty state says what is true; when messaging is wired it reads
              the platform's shared inbox, never a festival-local one. */}
          <MessagesPanel messages={[]} />
        </div>
      </div>
    </div>
  );
}
