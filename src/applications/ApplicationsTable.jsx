import { EmptyState, LoadingState } from '../design-system';
import ApplicationsRow from './ApplicationsRow';
import { columnClass } from './columnClass';
import s from './ApplicationsTable.module.css';

/**
 * THE SINGLE SOURCE OF TRUTH about how an application renders.
 *
 * One table serves every category. What varies is the column set, resolved
 * from configuration and handed in — never a branch on category inside here,
 * and never a second table for a category that needs a different column.
 *
 * It renders three states and owns none of them: loading, empty, and rows.
 * Which one applies is the caller's decision, because only the caller knows
 * whether zero rows means "still fetching", "nothing matches your filters" or
 * "nobody has applied yet" — and those need three different messages.
 *
 * Virtualisation drops in at the tbody without any row or screen changing.
 */
export default function ApplicationsTable({
  rows = [],
  columns,
  loading = false,
  error = null,
  selectedId,
  tickedIds = [],
  onSelect,
  onTick,
  onRetry,
  emptyState,
}) {
  const showEmpty = !loading && !error && rows.length === 0;

  return (
    <div className={s.wrap}>
      <table className={s.table}>
        <thead className={s.head}>
          <tr>
            <th className={s.colCheck} scope="col">
              <span className="sr-only">Select</span>
            </th>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                /* Same class source as the row's <td> — see columnClass.js.
                   A header that hides on a different rule than its cells
                   silently misaligns every row. */
                className={columnClass(col, s.sortable)}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
            <th className={s.colMenu} scope="col" />
          </tr>
        </thead>

        {!loading && !error && !showEmpty && (
          <tbody>
            {rows.map(row => (
              <ApplicationsRow
                key={row.id}
                application={row}
                columns={columns}
                active={row.id === selectedId}
                ticked={tickedIds.includes(row.id)}
                onSelect={onSelect}
                onTick={onTick}
              />
            ))}
          </tbody>
        )}
      </table>

      {loading && <LoadingState variant="rows" rows={8} />}

      {/* ⛔ A failed load is an ERROR, not an empty state. "No applications"
          when the request failed tells an organiser their applicants have
          vanished — the single most alarming thing this screen could say,
          and it would be a lie. */}
      {error && (
        <EmptyState
          icon="cross"
          title="Couldn’t load applications"
          body="Something went wrong fetching this list. Your applications are safe — this is a display problem."
          action="Try again"
          onAction={onRetry}
        />
      )}

      {showEmpty && (emptyState || (
        <EmptyState
          icon="inbox"
          title="No applications"
          body="Nothing here yet. Applications appear as soon as they are submitted."
        />
      ))}
    </div>
  );
}
