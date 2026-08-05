import { Button } from '../design-system';
import SearchBar from './SearchBar';
import FilterBar from './FilterBar';
import s from './TableToolbar.module.css';

/**
 * Search, filters, and the actions that operate on the table.
 *
 * ⭐ SELECTION REPLACES THE TOOLBAR — it does not add a second bar beneath
 * it. An extra bar pushes the table down the moment you tick a checkbox,
 * which loses your place in a list you were part-way through scanning. Same
 * height, same position, different contents.
 *
 * The bulk actions are deliberately the same four verbs as the inspector's
 * decision row, in the same order. One applicant or forty, the vocabulary and
 * the muscle memory do not change.
 */
export default function TableToolbar({ selectedCount = 0, onClearSelection }) {
  if (selectedCount > 0) {
    return (
      <div className={s.selectionBar}>
        <span className={s.selectionCount}>{selectedCount} selected</span>
        <div className={s.selectionActions}>
          <Button variant="intent" tone="shortlist" size="sm" icon="star">Shortlist</Button>
          <Button variant="intent" tone="accept"    size="sm" icon="check">Accept</Button>
          <Button variant="intent" tone="decline"   size="sm" icon="cross">Decline</Button>
          <Button variant="quiet"  size="sm" icon="export">Export selection</Button>
        </div>
        <span className={s.spacer} />
        <Button variant="ghost" size="sm" onClick={onClearSelection}>Clear</Button>
      </div>
    );
  }

  return (
    <div className={s.toolbar}>
      <SearchBar />
      <FilterBar />
      <span className={s.spacer} />
      <div className={s.right}>
        <Button variant="quiet" size="sm" icon="sort">Sort</Button>
        <Button variant="quiet" size="sm" icon="columns" aria-label="Choose columns" />
        <Button variant="secondary" size="sm" icon="export">Export</Button>
      </div>
    </div>
  );
}
