import Icon from './Icon';
import s from './ListRow.module.css';

/**
 * One row in a list — team members, categories, sent announcements, threads.
 *
 * Four lists in this product share this anatomy: something on the left, a
 * title with a subtitle, something on the right. Writing it four times is how
 * you end up with four row heights and three truncation rules.
 *
 * ⚠ THE ROW IS NEVER THE BUTTON. It was, and that produced a `<button>` inside
 * a `<button>` the moment a row carried an action in its trail — invalid HTML,
 * and in practice it means clicking the trail button also fires the row.
 *
 * So the row is a plain element, and only the lead + body are wrapped in the
 * clickable control. Trailing actions sit outside it and are independently
 * reachable, which is also what a keyboard user expects: one tab stop for
 * "open this", another for "act on this".
 */
export default function ListRow({
  avatar = false,
  icon,
  title,
  meta,
  badge,
  trail,
  onClick,
}) {
  const lead = (avatar || icon) && (
    <span className={s.lead}>
      {avatar
        ? <span className={s.avatar} />
        : <span className={s.iconBox}><Icon name={icon} size={17} /></span>}
    </span>
  );

  const body = (
    <span className={s.body}>
      <span className={s.titleRow}>
        <span className={s.title}>{title}</span>
        {badge}
      </span>
      {meta && <span className={s.meta}>{meta}</span>}
    </span>
  );

  return (
    <div className={`${s.row} ${onClick ? s.interactive : ''}`}>
      {onClick ? (
        <button type="button" className={s.main} onClick={onClick}>
          {lead}
          {body}
        </button>
      ) : (
        <>
          {lead}
          {body}
        </>
      )}
      {trail && <span className={s.trail}>{trail}</span>}
    </div>
  );
}
