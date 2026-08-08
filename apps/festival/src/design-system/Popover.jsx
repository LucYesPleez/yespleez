import { useState, useRef, useEffect, useCallback, useId } from 'react';
import s from './Popover.module.css';

/**
 * AN ANCHORED FLOATING PANEL — the primitive behind every menu in the portal.
 *
 * Six controls wanted this and had nothing: Sort, Columns, the four filters,
 * More, and the row overflow menu. Six hand-rolled dropdowns is six sets of
 * click-outside handling, six focus bugs, and six different ideas about which
 * way a menu opens.
 *
 * Dependency-free on purpose. A positioning library is the right answer for
 * tooltips that must never clip inside scrolling virtualised content; these
 * are toolbar menus with a known anchor, and `position: absolute` plus a flip
 * check is the whole requirement.
 *
 * What it guarantees:
 *   · Escape closes and RETURNS FOCUS to the trigger. A menu that closes and
 *     drops focus to <body> strands keyboard users mid-toolbar.
 *   · Click outside closes, but a click INSIDE does not — multi-select
 *     filters are the main use, and closing on every tick would make
 *     choosing three statuses take three trips.
 *   · Flips above its trigger when there is not room below.
 */
export default function Popover({ button, align = 'start', title, action, onAction, children }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  const close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    if (!open) return;

    function onDocPointer(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    // `pointerdown` rather than `click`: a click that begins outside and ends
    // inside should still close, and it feels immediate rather than lagging
    // the mouse-up.
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  // Decide direction once per opening, from the trigger's position. Measured
  // rather than assumed: the toolbar sits near the top on Applications and
  // much lower on a scrolled Settings page.
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setFlip(window.innerHeight - rect.bottom < 260);
  }, [open]);

  return (
    <span className={s.wrap} ref={wrapRef}>
      {button({
        ref: triggerRef,
        onClick: toggle,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
      })}

      {open && (
        <div
          id={panelId}
          role="menu"
          className={`${s.panel} ${s[align]} ${flip ? s.up : ''}`}
        >
          {(title || action) && (
            <div className={s.header}>
              <span className={s.title}>{title}</span>
              {action && (
                <button type="button" className={s.clear} onClick={onAction}>{action}</button>
              )}
            </div>
          )}
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </span>
  );
}
