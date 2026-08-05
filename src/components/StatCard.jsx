import Icon from './Icon';
import s from './StatCard.module.css';

/**
 * One number in the stats row.
 *
 * `delta` is optional and renders nothing when absent — never a dash, never a
 * zero. An absent comparison and a comparison of zero are different facts,
 * and the row must not claim the second when it only has the first.
 */
export default function StatCard({ label, value, delta, icon, tone = 'cyan' }) {
  return (
    <div className={`fp-panel ${s.card} ${s[tone] || ''}`}>
      <span className={s.icon}>
        <Icon name={icon} size={19} />
      </span>
      <div className={s.body}>
        <div className={s.label}>{label}</div>
        <div className={s.value}>{value}</div>
        {delta && <div className={s.delta}>{delta}</div>}
      </div>
    </div>
  );
}
