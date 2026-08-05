import Icon from './Icon';
import s from './ListRow.module.css';

/**
 * One row in a list — team members, categories, sent announcements, threads.
 *
 * Four lists in this product have the same anatomy: something on the left,
 * a title with a subtitle, something on the right. Writing that four times is
 * how they end up with four different row heights and three different
 * truncation rules.
 *
 * Renders as a `<button>` only when it does something. A row that looks
 * clickable and is not is worse than one that plainly is not.
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
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      className={`${s.row} ${onClick ? s.clickable : ''}`}
      onClick={onClick}
      {...(onClick ? { type: 'button' } : {})}
    >
      {(avatar || icon) && (
        <span className={s.lead}>
          {avatar
            ? <span className={s.avatar} />
            : <span className={s.iconBox}><Icon name={icon} size={17} /></span>}
        </span>
      )}

      <span className={s.body}>
        <span className={s.titleRow}>
          <span className={s.title}>{title}</span>
          {badge}
        </span>
        {meta && <span className={s.meta}>{meta}</span>}
      </span>

      {trail && <span className={s.trail}>{trail}</span>}
    </Tag>
  );
}
