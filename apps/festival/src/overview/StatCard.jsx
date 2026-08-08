import { Link } from 'react-router-dom';
import { Icon, Skeleton } from '../design-system';
import s from './StatCard.module.css';

/**
 * One number on the Overview.
 *
 * ⭐ A stat card should be a DOOR, not a display. Every number an organiser
 * reads prompts the same next thought — "show me those" — so cards with a
 * `to` render as links into a pre-filtered workspace. A number you cannot act
 * on is decoration.
 *
 * `loading` renders a skeleton in the value's exact place, so the card does
 * not resize when the real figure lands.
 *
 * `delta` renders nothing when absent — never a dash, never "0%". An absent
 * comparison and a comparison of zero are different facts.
 */
export default function StatCard({
  label,
  value,
  delta,
  trend,
  icon,
  tone = 'cyan',
  to,
  loading = false,
}) {
  const inner = (
    <>
      <span className={s.icon}><Icon name={icon} size={19} /></span>
      <span className={s.body}>
        <span className={s.label}>{label}</span>
        <span className={s.value}>
          {loading ? <Skeleton width={54} height={22} shape="block" /> : value}
        </span>
        {delta && !loading && (
          <span className={`${s.delta} ${trend === 'up' ? s.up : trend === 'down' ? s.down : ''}`}>
            {delta}
          </span>
        )}
      </span>
    </>
  );

  const className = `fp-panel ${s.card} ${s[tone] || ''} ${to ? s.clickable : ''}`;

  if (to) return <Link to={to} className={className}>{inner}</Link>;
  return <div className={className}>{inner}</div>;
}
