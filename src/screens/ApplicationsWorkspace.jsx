import ApplicationsToolbar from '../components/ApplicationsToolbar';
import ApplicationsTable from '../components/ApplicationsTable';
import Pagination from '../components/Pagination';
import { PLACEHOLDER_ROWS } from '../config/placeholderRows';
import s from './screens.module.css';

/**
 * Toolbar → table → pagination, the three sections of the workspace.
 *
 * Composed here rather than inside a screen so the dashboard and every
 * category route render the identical workspace. Selection is lifted to the
 * shell (`useInspector`) because the inspector is a sibling of this pane, not
 * a child of it.
 */
export default function ApplicationsWorkspace({ category, selection, onSelect }) {
  return (
    <section className={`fp-panel ${s.workspace}`}>
      <div className={s.workspaceHeader}>
        <span className={s.workspaceTitle}>Applications</span>
      </div>

      <ApplicationsToolbar activeCategory={category} />

      <ApplicationsTable
        rows={PLACEHOLDER_ROWS}
        selectedId={selection?.id}
        onSelect={onSelect}
      />

      <Pagination />
    </section>
  );
}
