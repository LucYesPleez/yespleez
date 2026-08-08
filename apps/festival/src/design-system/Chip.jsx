import s from './Chip.module.css';

/**
 * SELECTABLE CHIPS — the audience picker, and eventually the filter popovers.
 *
 * A chip row rather than a multi-select dropdown: choosing an audience is a
 * decision you want to SEE, all at once, while you read the recipient count
 * next to it. A dropdown hides the answer behind a click at exactly the
 * moment the reader needs it in view.
 *
 * ⛔ Controlled and stateless. `selected` comes in, `onChange` goes out. The
 * group filters nothing and counts nothing — a caller that knows what the
 * chips mean does that.
 */

export function Chip({ label, count, selected, onClick, disabled }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!selected}
      disabled={disabled}
      className={`${s.chip} ${selected ? s.on : ''}`}
      onClick={onClick}
    >
      {label}
      {/* Zero shows here. A chip's count says how many exist in that slice,
          which is different from a badge claiming your attention. */}
      {count != null && <span className={s.count}>{count}</span>}
    </button>
  );
}

export function ChipGroup({ label, options = [], selected = [], onChange, action, onAction }) {
  function toggle(value) {
    onChange?.(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value],
    );
  }

  return (
    <div className={s.group}>
      {(label || action) && (
        <div className={s.groupHead}>
          {label && <span className={s.groupLabel}>{label}</span>}
          {action && (
            <button type="button" className={s.groupAction} onClick={onAction}>{action}</button>
          )}
        </div>
      )}
      <div className={s.chips} role="group" aria-label={label}>
        {options.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            count={o.count}
            selected={selected.includes(o.value)}
            onClick={() => toggle(o.value)}
          />
        ))}
      </div>
    </div>
  );
}
