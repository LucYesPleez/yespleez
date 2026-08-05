import Icon from './Icon';
import Button from './Button';
import s from './states.module.css';

/**
 * A surface with nothing in it — designed, never blank.
 *
 * ⛔ THE RULE THIS COMPONENT EXISTS TO ENFORCE: absent, withheld and unknown
 * are three different things, and only one of them is silence.
 *   · absent   — there is genuinely nothing. Say so plainly.
 *   · withheld — something exists but is not being shown yet. SAY THAT; going
 *                quiet steals the reveal and reads as a bug.
 *   · unknown  — we do not know. Qualify it; never state it as fact.
 *
 * So an empty state always renders something. A blank region is never an
 * acceptable answer, because the reader cannot tell it apart from a failure.
 */
export default function EmptyState({
  icon = 'search',
  title,
  body,
  action,
  onAction,
  compact = false,
}) {
  return (
    <div className={`${s.empty} ${compact ? s.emptyCompact : ''}`}>
      {icon && (
        <span className={s.emptyIcon}>
          <Icon name={icon} size={21} />
        </span>
      )}
      <span className={s.emptyTitle}>{title}</span>
      {body && <span className={s.emptyBody}>{body}</span>}
      {action && (
        <div className={s.emptyAction}>
          <Button variant="secondary" size="sm" onClick={onAction}>{action}</Button>
        </div>
      )}
    </div>
  );
}
