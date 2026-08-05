import StatCard from '../overview/StatCard';
import ActivityPanel from '../overview/ActivityPanel';
import MessagesPanel from '../overview/MessagesPanel';
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
 * Every card links to a pre-filtered view. A number you cannot act on is
 * decoration.
 */
const CARDS = [
  { key: 'total',       label: 'Total Applications', value: '384', delta: '↑ 23% vs last year',  trend: 'up',   icon: 'inbox',  tone: 'purple', to: '/applications' },
  { key: 'new',         label: 'New This Week',      value: '37',  delta: '↑ 12 new today',      trend: 'up',   icon: 'plus',   tone: 'cyan',   to: '/applications' },
  { key: 'reviewing',   label: 'Awaiting Review',    value: '62',  delta: '↓ 8 since yesterday', trend: 'down', icon: 'clock',  tone: 'gold',   to: '/applications' },
  { key: 'shortlisted', label: 'Shortlisted',        value: '28',  delta: '↑ 5 since yesterday', trend: 'up',   icon: 'star',   tone: 'fire',   to: '/applications' },
  { key: 'accepted',    label: 'Accepted',           value: '16',  delta: '↑ 3 since yesterday', trend: 'up',   icon: 'check',  tone: 'green',  to: '/applications' },
  { key: 'declined',    label: 'Declined',           value: '14',  delta: '↑ 2 since yesterday', trend: 'up',   icon: 'cross',  tone: 'pink',   to: '/applications' },
];

export default function OverviewScreen() {
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

      <div className={s.statsRow}>
        {CARDS.map(({ key, ...card }) => <StatCard key={key} {...card} />)}
      </div>

      <div className={s.twoUp}>
        <ActivityPanel />
        <MessagesPanel />
      </div>
    </div>
  );
}
