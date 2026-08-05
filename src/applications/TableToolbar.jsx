import { useState } from 'react';
import { Button, Popover, MenuItem, MenuCheckItem, MenuDivider } from '../design-system';
import SearchBar from './SearchBar';
import FilterBar from './FilterBar';
import { SORT_OPTIONS } from '../config/filters';
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
 *
 * ⛔ Sort and Columns record a choice and do nothing else. Neither sorts nor
 * hides anything — the menus exist so the interaction is settled before a
 * data layer makes them mean something.
 */
export default function TableToolbar({
  columns = [],
  sort = 'newest',
  onSort,
  onSearch,
  selectedCount = 0,
  onClearSelection,
}) {
  const [hidden, setHidden] = useState([]);

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
      <SearchBar onChange={onSearch} />
      <FilterBar />
      <span className={s.spacer} />

      <div className={s.right}>
        <Popover
          align="end"
          title="Sort by"
          button={props => (
            <Button {...props} variant="quiet" size="sm" icon="sort">
              {SORT_OPTIONS.find(o => o.value === sort)?.label}
            </Button>
          )}
        >
          {({ close }) => SORT_OPTIONS.map(o => (
            <MenuItem
              key={o.value}
              label={o.label}
              selected={sort === o.value}
              onClick={() => { onSort?.(o.value); close(); }}
            />
          ))}
        </Popover>

        <Popover
          align="end"
          title="Columns"
          action={hidden.length ? 'Show all' : undefined}
          onAction={() => setHidden([])}
          button={props => (
            <Button {...props} variant="quiet" size="sm" icon="columns" aria-label="Choose columns" />
          )}
        >
          {/* Applicant and Status are offered as permanently checked and
              disabled rather than omitted. A column you cannot hide should
              say so; leaving it out of the list reads as an oversight. */}
          {columns.map(col => {
            const locked = col.priority == null;
            return (
              <MenuCheckItem
                key={col.key}
                label={col.label}
                meta={locked ? 'Always' : undefined}
                checked={locked || !hidden.includes(col.key)}
                onClick={() => {
                  if (locked) return;
                  setHidden(h => h.includes(col.key)
                    ? h.filter(k => k !== col.key)
                    : [...h, col.key]);
                }}
              />
            );
          })}
          <MenuDivider />
          <MenuItem label="Reset to category default" icon="columns" onClick={() => setHidden([])} />
        </Popover>

        <Button variant="secondary" size="sm" icon="export">Export</Button>
      </div>
    </div>
  );
}
