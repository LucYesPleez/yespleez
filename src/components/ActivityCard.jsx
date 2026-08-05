import Icon from './Icon';
import s from './WidgetCard.module.css';

/**
 * "Today's Activity" — a bottom widget.
 *
 * Every number here answers "what happened", not "what awaits you". The
 * decision-shaped counts belong in the stats row; mixing the two teaches
 * people to read both as urgent.
 */
const ITEMS = [
  { key: 'music',     icon: 'music',     value: 12, label: 'New Music Applications',     tone: 'pink' },
  { key: 'review',    icon: 'clock',     value: 3,  label: 'Awaiting Review',            tone: 'gold' },
  { key: 'volunteer', icon: 'volunteer', value: 4,  label: 'New Volunteer Applications', tone: 'cyan' },
  { key: 'accepted',  icon: 'check',     value: 1,  label: 'Application Accepted',       tone: 'green' },
  { key: 'messages',  icon: 'messages',  value: 2,  label: 'New Messages',               tone: 'purple' },
  { key: 'declined',  icon: 'cross',     value: 0,  label: 'Application Declined',       tone: 'pink' },
];

export default function ActivityCard({ title = "Today's Activity" }) {
  return (
    <section className={`fp-panel ${s.card}`}>
      <div className={s.header}>
        <span className={s.title}>{title}</span>
        <button className={s.action} type="button">
          Today <Icon name="chevron" size={13} />
        </button>
      </div>
      <div className={s.body}>
        <div className={s.grid}>
          {ITEMS.map(item => (
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
      </div>
    </section>
  );
}
