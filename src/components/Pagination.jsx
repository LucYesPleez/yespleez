import Icon from './Icon';
import s from './Pagination.module.css';

/**
 * Pagination chrome. No paging logic — the page buttons are inert and the
 * summary is a placeholder string.
 *
 * The result count is always exact and always visible, which is the one thing
 * this bar has to get right once it is wired: an approximate count in a review
 * workspace is worse than none, because people plan their day around it.
 */
export default function Pagination({ summary = 'Showing 1 to 20 of 384 applications', pages = [1, 2, 3, 4, 5], current = 1, last = 10 }) {
  return (
    <div className={s.bar}>
      <span className={s.summary}>{summary}</span>

      <div className={s.pages}>
        <button className={s.page} type="button" aria-label="Previous page">‹</button>
        {pages.map(p => (
          <button
            key={p}
            type="button"
            className={[s.page, p === current && s.current].filter(Boolean).join(' ')}
          >
            {p}
          </button>
        ))}
        <span className={s.gap}>…</span>
        <button className={s.page} type="button">{last}</button>
        <button className={s.page} type="button" aria-label="Next page">›</button>
      </div>

      <span className={s.perPage}>
        20 per page <Icon name="chevron" size={13} />
      </span>
    </div>
  );
}
