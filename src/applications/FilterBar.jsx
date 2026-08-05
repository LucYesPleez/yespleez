import { Icon } from '../design-system';
import s from './FilterBar.module.css';

/**
 * The filter controls.
 *
 * ⛔ NO FILTERING LOGIC. Every control is presentational and inert. What this
 * component fixes now is the SHAPE — how many filters fit, what an applied
 * one looks like, where "Clear" goes — so that wiring them later changes
 * behaviour without moving a pixel.
 *
 * They are `<button>`s, not `<select>`s, deliberately: each will open a
 * multi-select popover with counts, and swapping a native select for a
 * popover later would be a rewrite rather than a fill-in.
 *
 * `applied` is rendered from a prop so the "filters are on" treatment is
 * built and reviewable now, not discovered when the data layer arrives.
 */
const FILTERS = [
  { key: 'status',    label: 'Status' },
  { key: 'stage',     label: 'Stage' },
  { key: 'country',   label: 'Country',  collapsible: true },
  { key: 'submitted', label: 'Submitted', collapsible: true },
];

export default function FilterBar({ applied = {}, onOpen, onClear }) {
  const appliedCount = Object.values(applied).filter(Boolean).length;

  return (
    <div className={s.bar}>
      {FILTERS.map(f => {
        const count = applied[f.key];
        return (
          <button
            key={f.key}
            type="button"
            className={[s.filter, f.collapsible && s.collapsible, count && s.applied].filter(Boolean).join(' ')}
            onClick={() => onOpen?.(f.key)}
          >
            {f.label}
            {count ? <span className={s.appliedCount}>{count}</span> : <Icon name="chevron" size={14} />}
          </button>
        );
      })}

      <button type="button" className={s.filter} onClick={() => onOpen?.('more')}>
        <Icon name="filter" size={14} /> More
      </button>

      {/* Only offered once there is something to clear — a permanently
          visible "Clear" implies filters are on when none are. */}
      {appliedCount > 0 && (
        <button type="button" className={s.clear} onClick={onClear}>
          Clear all
        </button>
      )}
    </div>
  );
}
