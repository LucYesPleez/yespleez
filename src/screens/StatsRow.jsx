import StatCard from '../components/StatCard';
import s from './screens.module.css';

/**
 * The six-card stats row.
 *
 * Its own component because both the dashboard and the applications workspace
 * show it, and a copy in each is how the two stop matching.
 *
 * ⛔ Every card here should eventually mean "N things await your decision".
 * The counts are placeholders; the deltas are strings, not computed values.
 */
const CARDS = [
  { key: 'total',       label: 'Total Applications', value: '384', delta: '↑ 23% vs last year',  icon: 'dashboard', tone: 'purple' },
  { key: 'new',         label: 'New This Week',      value: '37',  delta: '↑ 12 new today',      icon: 'plus',      tone: 'cyan' },
  { key: 'reviewing',   label: 'Awaiting Review',    value: '62',  delta: '↓ 8 since yesterday', icon: 'clock',     tone: 'gold' },
  { key: 'shortlisted', label: 'Shortlisted',        value: '28',  delta: '↑ 5 since yesterday', icon: 'star',      tone: 'fire' },
  { key: 'accepted',    label: 'Accepted',           value: '16',  delta: '↑ 3 since yesterday', icon: 'check',     tone: 'green' },
  { key: 'declined',    label: 'Declined',           value: '14',  delta: '↑ 2 since yesterday', icon: 'cross',     tone: 'pink' },
];

export default function StatsRow() {
  return (
    <div className={s.statsRow}>
      {/* `key` destructured out, never spread — see FestivalSidebar. */}
      {CARDS.map(({ key, ...card }) => <StatCard key={key} {...card} />)}
    </div>
  );
}
