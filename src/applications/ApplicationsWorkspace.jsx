import { useState } from 'react';
import { Button, EmptyState } from '../design-system';
import { useShell } from '../shell/shellContext';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import CategoryNavigation from './CategoryNavigation';
import TableToolbar from './TableToolbar';
import ApplicationsTable from './ApplicationsTable';
import Pagination from './Pagination';
import { useRowNavigation } from './useRowNavigation';
import { columnsFor } from '../config/columns';
import s from './ApplicationsWorkspace.module.css';

/**
 * THE PRIMARY WORKSPACE OF THE PORTAL.
 *
 *   header · CategoryNavigation · TableToolbar · ApplicationsTable · Pagination
 *
 * A fixed frame: only the table body scrolls, so the tabs, toolbar and
 * pagination never leave the screen — someone four hundred rows deep can
 * change a filter without scrolling back up.
 *
 * ⭐ Nothing here branches on category. The category supplies a column set, a
 * count and a noun; the workspace is identical for all nine.
 *
 * ⭐ READS THROUGH A REPOSITORY, never from a constant. Search, filters, sort
 * and paging are ARGUMENTS TO A QUERY, not operations this component performs
 * on an array it was handed. That is what lets the same screen work against
 * ten placeholder rows today and four hundred database rows later without
 * moving the logic out of the component first.
 *
 * State held here is UI state only: which page, which sort, what was typed,
 * which rows are ticked. Selection for review lives in the shell, because the
 * inspector is a sibling pane.
 */
export default function ApplicationsWorkspace({ categoryKey }) {
  const { selection, select, clear } = useShell();
  const { categories, applications } = useRepositories();

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [ticked, setTicked] = useState([]);

  const cat = useQuery(() => categories.get(categoryKey), [categoryKey]);
  const category = cat.data;

  const result = useQuery(
    () => applications.list({ categoryKey, search, sort, page, pageSize: 20 }),
    [categoryKey, search, sort, page],
  );

  const rows = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  const columns = columnsFor(category);

  // ↑ ↓ / j k move the selection and the inspector follows; Escape clears.
  // Decision shortcuts are deliberately unbound — see useRowNavigation.
  useRowNavigation({ rows, selection, onSelect: select, onClear: clear });

  function toggleTick(row) {
    setTicked(prev =>
      prev.includes(row.id) ? prev.filter(id => id !== row.id) : [...prev, row.id]);
  }

  /** Any change to the query returns to the first page — page 4 of a new
      result set is a blank table that looks like a failure. */
  function requery(fn) {
    return (...args) => { setPage(1); fn(...args); };
  }

  return (
    <section className={`fp-panel ${s.workspace}`}>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <span className={s.title}>{category?.label ?? 'Applications'}</span>
          <span className={s.subtitle}>
            {result.loading && !result.data
              ? 'Loading…'
              : `${total} ${total === 1 ? category?.noun : `${category?.noun}s`}`}
          </span>
        </div>
        <div className={s.headerActions}>
          <span className={s.keyHint}>
            <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Esc</kbd> to clear
          </span>
          <Button variant="quiet" size="sm" icon="clock">Open windows</Button>
        </div>
      </header>

      <CategoryNavigation />

      <TableToolbar
        columns={columns}
        sort={sort}
        onSort={requery(setSort)}
        onSearch={requery(setSearch)}
        selectedCount={ticked.length}
        onClearSelection={() => setTicked([])}
      />

      <ApplicationsTable
        rows={rows}
        columns={columns}
        loading={result.loading}
        error={result.error}
        selectedId={selection?.id}
        tickedIds={ticked}
        onSelect={select}
        onTick={toggleTick}
        onRetry={result.reload}
        emptyState={
          <EmptyState
            icon={category?.icon || 'inbox'}
            title={search ? 'Nothing matches' : `No ${category?.noun ?? 'application'}s yet`}
            body={search
              ? `No applications match “${search}”. Clearing the search brings the list back.`
              : `Applications appear here as soon as they are submitted. Nothing has arrived for ${category?.label ?? 'this category'} yet.`}
          />
        }
      />

      <Pagination page={page} pageSize={20} total={total} onPage={setPage} />
    </section>
  );
}
