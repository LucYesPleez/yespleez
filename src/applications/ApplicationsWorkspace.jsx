import { useState } from 'react';
import { Button, EmptyState } from '../design-system';
import { useShell } from '../shell/shellContext';
import CategoryNavigation from './CategoryNavigation';
import TableToolbar from './TableToolbar';
import ApplicationsTable from './ApplicationsTable';
import Pagination from './Pagination';
import { useRowNavigation } from './useRowNavigation';
import { columnsFor } from '../config/columns';
import { PLACEHOLDER_ROWS } from '../config/placeholderRows';
import s from './ApplicationsWorkspace.module.css';

/**
 * THE PRIMARY WORKSPACE OF THE PORTAL.
 *
 * Composition, top to bottom:
 *   header · CategoryNavigation · TableToolbar · ApplicationsTable · Pagination
 *
 * A fixed frame. Only the table body scrolls, so the tabs, toolbar and
 * pagination never leave the screen — someone four hundred rows deep can
 * change a filter without scrolling back up.
 *
 * ⭐ Nothing here branches on category. The category supplies a column set, a
 * count and a noun; the workspace is identical for all nine. That is what
 * makes "add a category" a config entry rather than a project.
 *
 * State held: which rows are ticked for a bulk action. That is UI state — it
 * has no meaning outside this screen and no data layer would own it. Selection
 * for review lives in the shell, because the inspector is a sibling pane.
 */
export default function ApplicationsWorkspace({ category }) {
  const { selection, select, clear } = useShell();
  const [ticked, setTicked] = useState([]);

  const columns = columnsFor(category);
  const rows = PLACEHOLDER_ROWS;

  // ↑ ↓ / j k move the selection and the inspector follows; Escape clears.
  // Decision shortcuts are deliberately unbound — see useRowNavigation.
  useRowNavigation({ rows, selection, onSelect: select, onClear: clear });

  function toggleTick(row) {
    setTicked(prev =>
      prev.includes(row.id) ? prev.filter(id => id !== row.id) : [...prev, row.id]);
  }

  return (
    <section className={`fp-panel ${s.workspace}`}>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <span className={s.title}>{category.label}</span>
          <span className={s.subtitle}>
            {category.count} {category.count === 1 ? category.noun : `${category.noun}s`}
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
        selectedCount={ticked.length}
        onClearSelection={() => setTicked([])}
      />

      <ApplicationsTable
        rows={rows}
        columns={columns}
        selectedId={selection?.id}
        tickedIds={ticked}
        onSelect={select}
        onTick={toggleTick}
        emptyState={
          <EmptyState
            icon={category.icon}
            title={`No ${category.noun}s yet`}
            body={`Applications appear here as soon as they are submitted. Nothing has arrived for ${category.label} yet.`}
          />
        }
      />

      <Pagination page={1} pageSize={20} total={category.count} />
    </section>
  );
}
