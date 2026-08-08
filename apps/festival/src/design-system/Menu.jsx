import Icon from './Icon';
import s from './Popover.module.css';

/**
 * The things that go inside a Popover.
 *
 * Two item shapes, deliberately distinguishable at a glance:
 *   · MenuItem     — an action or a single choice. A tick marks the current
 *                    one; picking it closes the menu.
 *   · MenuCheckItem — a multi-select filter value. A checkbox, and picking it
 *                    does NOT close, because choosing three statuses should
 *                    not mean three trips.
 *
 * A tick and a checkbox meaning different things is the point. If both were
 * ticks, nobody could tell which menus close on click and which accumulate.
 */

export function MenuItem({ label, meta, icon, selected, danger, disabled, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`${s.item} ${danger ? s.danger : ''}`}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={15} />}
      <span className={s.itemLabel}>{label}</span>
      {meta && <span className={s.itemMeta}>{meta}</span>}
      {/* Rendered always, hidden by opacity — a tick that appears and
          disappears shifts every label beside it by 15px. */}
      <span className={`${s.tick} ${selected ? s.tickOn : ''}`}>
        <Icon name="check" size={14} strokeWidth={2.4} />
      </span>
    </button>
  );
}

export function MenuCheckItem({ label, meta, checked, onClick }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={!!checked}
      className={s.item}
      onClick={onClick}
    >
      <span className={`${s.check} ${checked ? s.checkOn : ''}`}>
        <Icon name="check" size={11} strokeWidth={2.8} />
      </span>
      <span className={s.itemLabel}>{label}</span>
      {meta != null && <span className={s.itemMeta}>{meta}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <div className={s.divider} role="separator" />;
}
