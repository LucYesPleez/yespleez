import { useState } from 'react';
import { Icon, Popover, MenuCheckItem, MenuItem } from '../design-system';
import { FILTERS } from '../config/filters';
import s from './FilterBar.module.css';

/**
 * The filter controls.
 *
 * ⛔ NO FILTERING LOGIC. Each control records what was chosen and shows it;
 * nothing narrows the table. What is settled here is the SHAPE — how many
 * filters fit, what an applied one looks like, where "Clear all" appears —
 * so wiring them later changes behaviour without moving a pixel.
 *
 * ⭐ AN APPLIED FILTER IS VISIBLY ON, and shows how many values it carries. A
 * filtered list that looks identical to an unfiltered one is how people
 * conclude the product has lost their data — and then reload, and then email
 * support about applications that were never missing.
 *
 * Multi-select popovers do NOT close on click. Choosing three statuses should
 * not mean three trips; single-select ones close immediately, and the
 * checkbox-versus-tick distinction is what tells you which is which before
 * you click.
 */
export default function FilterBar() {
  const [applied, setApplied] = useState({});

  function toggleValue(filterKey, value, single) {
    setApplied(prev => {
      const current = prev[filterKey] || [];
      if (single) return { ...prev, [filterKey]: current[0] === value ? [] : [value] };
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [filterKey]: next };
    });
  }

  const appliedCount = Object.values(applied).filter(v => v?.length).length;

  return (
    <div className={s.bar}>
      {FILTERS.map(filter => {
        const values = applied[filter.key] || [];
        const on = values.length > 0;

        return (
          <Popover
            key={filter.key}
            title={filter.label}
            action={on ? 'Clear' : undefined}
            onAction={() => setApplied(p => ({ ...p, [filter.key]: [] }))}
            button={props => (
              <button
                {...props}
                type="button"
                className={[s.filter, filter.collapsible && s.collapsible, on && s.applied]
                  .filter(Boolean).join(' ')}
              >
                {filter.icon && <Icon name={filter.icon} size={14} />}
                {filter.label}
                {on
                  ? <span className={s.appliedCount}>{values.length}</span>
                  : <Icon name="chevron" size={14} />}
              </button>
            )}
          >
            {({ close }) => filter.options.map(o => (
              filter.single ? (
                <MenuItem
                  key={o.value}
                  label={o.label}
                  selected={values.includes(o.value)}
                  onClick={() => { toggleValue(filter.key, o.value, true); close(); }}
                />
              ) : (
                <MenuCheckItem
                  key={o.value}
                  label={o.label}
                  checked={values.includes(o.value)}
                  onClick={() => toggleValue(filter.key, o.value, false)}
                />
              )
            ))}
          </Popover>
        );
      })}

      {/* Offered only once there is something to clear — a permanently
          visible "Clear all" implies filters are on when none are. */}
      {appliedCount > 0 && (
        <button type="button" className={s.clear} onClick={() => setApplied({})}>
          Clear all
        </button>
      )}
    </div>
  );
}
