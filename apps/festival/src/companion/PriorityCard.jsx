import { useNavigate } from 'react-router-dom';
import { Icon } from '../design-system';
import s from './PriorityCard.module.css';

/**
 * ONE PRIORITY. Signal, reason, action — all three, always.
 *
 * ⭐ The whole card is the control. On a phone the action is the point of the
 * card, and a small button in the corner of a tappable-looking block is a
 * smaller target than the block itself.
 *
 * ⛔ NO DISMISS AFFORDANCE, deliberately, and do not add one. A dismissed item
 * is a second state that drifts from the fact underneath it: dismiss
 * "applications close tomorrow" and tomorrow the screen is empty while
 * applications still close today. Items leave when the FACT changes.
 *
 * ⛔ The action label is a verb and a destination, never "Open" or "View" —
 * the card has already worked out where to go, so it says where.
 */
export default function PriorityCard({ item }) {
  const navigate = useNavigate();
  const { tone = 'info', icon, signal, reason, actionLabel, to } = item;

  return (
    <button
      type="button"
      className={`${s.card} ${s[tone]}`}
      onClick={() => navigate(to)}
    >
      <span className={s.mark}>
        <Icon name={icon} size={18} />
      </span>

      <span className={s.body}>
        <span className={s.signal}>{signal}</span>
        <span className={s.reason}>{reason}</span>
        <span className={s.action}>
          {actionLabel}
          <Icon name="chevron" size={15} />
        </span>
      </span>
    </button>
  );
}
