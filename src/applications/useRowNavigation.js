import { useEffect, useRef } from 'react';

/**
 * KEYBOARD NAVIGATION for the applications list.
 *
 * ⭐ Arrowing moves the SELECTION, and the inspector follows. That is what a
 * review workspace is for: you hold J down and read four hundred applications
 * without touching the mouse. A version where arrows move a focus ring and
 * Enter then opens the detail doubles the keystrokes for the one action
 * people repeat most.
 *
 * ⛔ Navigation only. `S` / `A` / `D` for shortlist, accept and decline are
 * deliberately NOT bound: those are decisions that reach a real person, and
 * a decision shortcut wired before there is an undo path is how someone
 * declines an applicant with a stray keypress.
 *
 * Two guards that matter more than they look:
 *   · Typing is never intercepted — a `j` in the search box is a letter.
 *   · Modifier combinations pass through, so ⌘K, ⌘R and browser shortcuts
 *     keep working.
 */
export function useRowNavigation({ rows, selection, onSelect, onClear, enabled = true }) {
  /**
   * ⚠ THE SELECTION IS READ FROM A REF, NOT FROM THE CLOSURE.
   *
   * Key auto-repeat fires faster than React re-renders. Reading `selection`
   * from the effect's closure meant every keypress within one render tick
   * computed its index from the SAME starting row — so holding the key down
   * moved one row and stopped, which is precisely the case this hook exists
   * to serve. The ref is updated optimistically on each move so the next
   * keypress in the same tick continues from where the last one left off.
   */
  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  useEffect(() => {
    if (!enabled || !rows.length) return;

    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) {
        // Escape still works while typing — it is how you get back out.
        if (e.key === 'Escape') el.blur();
        return;
      }

      const current = selectionRef.current;
      const index = current ? rows.findIndex(r => r.id === current.id) : -1;
      let next = null;

      if (e.key === 'ArrowDown' || e.key === 'j') next = Math.min(rows.length - 1, index + 1);
      else if (e.key === 'ArrowUp' || e.key === 'k') next = index <= 0 ? 0 : index - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = rows.length - 1;
      else if (e.key === 'Escape') { selectionRef.current = null; onClear?.(); return; }
      else return;

      e.preventDefault();
      const row = rows[next];
      if (!row) return;
      // Optimistic, so a second keypress in this same tick continues from here
      // rather than recomputing from the row we started on.
      selectionRef.current = row;
      onSelect(row);

      // Keep the newly selected row on screen. `nearest` scrolls only when it
      // has to — `center` would jerk the list on every keystroke even when
      // the row was already comfortably visible.
      requestAnimationFrame(() => {
        document.querySelector(`[data-row-id="${row.id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `selection` is deliberately NOT a dependency — it is read from the ref.
    // Listing it would rebind the listener on every arrow key for no benefit.
  }, [rows, onSelect, onClear, enabled]);
}
