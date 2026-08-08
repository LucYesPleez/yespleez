import { SectionCard, Button, Icon, EmptyState } from '../design-system';
import s from './panels.module.css';

/**
 * "Today's Activity" — what has happened, not what awaits you.
 *
 * ⭐ That distinction is the whole design. The stat cards above answer "what
 * needs me"; this panel answers "what moved". Mixing the two teaches people
 * to read both as urgent, and then neither gets read.
 *
 * Consequently a zero here is meaningful and IS shown — "0 declined today" is
 * a fact about the day. That is the opposite of the badge law, and the
 * difference is exactly that badges claim your attention and these do not.
 */
const ITEMS = [
  { key: 'music',     icon: 'music',     value: 12, label: 'New music applications',  tone: 'pink' },
  { key: 'review',    icon: 'clock',     value: 3,  label: 'Awaiting review',         tone: 'gold' },
  { key: 'volunteer', icon: 'volunteer', value: 4,  label: 'New volunteers',          tone: 'cyan' },
  { key: 'accepted',  icon: 'check',     value: 1,  label: 'Accepted',                tone: 'green' },
  { key: 'messages',  icon: 'messages',  value: 2,  label: 'New messages',            tone: 'purple' },
  { key: 'declined',  icon: 'cross',     value: 0,  label: 'Declined',                tone: 'pink' },
];

export default function ActivityPanel({ items = ITEMS, loading = false }) {
  return (
    <SectionCard
      title="Today's Activity"
      actions={<Button variant="ghost" size="sm" iconRight="chevron">Today</Button>}
    >
      {items.length === 0 && !loading ? (
        <EmptyState
          icon="clock"
          title="Nothing yet today"
          body="Activity appears here as applications arrive and decisions are made."
          compact
        />
      ) : (
        <div className={s.grid}>
          {items.map(item => (
            <div key={item.key} className={s.stat}>
              <span className={`${s.statIcon} ${s[item.tone] || ''}`}>
                <Icon name={item.icon} size={15} />
              </span>
              <div>
                <div className={s.statValue}>{item.value}</div>
                <div className={s.statLabel}>{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
