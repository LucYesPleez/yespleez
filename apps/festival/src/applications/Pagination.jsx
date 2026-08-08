import { Icon } from '../design-system';
import s from './Pagination.module.css';

/**
 * Pagination chrome.
 *
 * ⛔ NO PAGING LOGIC. It computes which page numbers to DISPLAY — that is
 * layout arithmetic, not business logic — and reports clicks upward.
 *
 * The window is fixed-width so the bar never changes size as you move
 * through pages. A control row that reflows under the cursor causes
 * mis-clicks, and this one sits directly below a list people scan quickly.
 */
function pageWindow(current, total, span = 5) {
  if (total <= span + 2) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(span / 2);
  const start = Math.min(Math.max(1, current - half), total - span + 1);
  return Array.from({ length: span }, (_, i) => start + i);
}

export default function Pagination({
  page = 1,
  pageSize = 20,
  total = 0,
  onPage,
  onPageSize,
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const window = pageWindow(page, lastPage);
  const showLast = window[window.length - 1] < lastPage;

  return (
    <div className={s.bar}>
      <span className={s.summary}>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </span>

      <div className={s.pages}>
        <button
          className={s.page}
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage?.(page - 1)}
        >
          ‹
        </button>

        {window.map(p => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? 'page' : undefined}
            className={[s.page, p === page && s.current].filter(Boolean).join(' ')}
            onClick={() => onPage?.(p)}
          >
            {p}
          </button>
        ))}

        {showLast && (
          <>
            <span className={s.gap}>…</span>
            <button className={s.page} type="button" onClick={() => onPage?.(lastPage)}>{lastPage}</button>
          </>
        )}

        <button
          className={s.page}
          type="button"
          aria-label="Next page"
          disabled={page >= lastPage}
          onClick={() => onPage?.(page + 1)}
        >
          ›
        </button>
      </div>

      <button className={s.perPage} type="button" onClick={() => onPageSize?.()}>
        {pageSize} per page <Icon name="chevron" size={13} />
      </button>
    </div>
  );
}
