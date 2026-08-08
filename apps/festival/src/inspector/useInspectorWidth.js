import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * The docked inspector's width, and the drag that changes it.
 *
 * The width has always been the CSS variable `--fp-inspector-width`; this
 * hook is the listener that writes to it. Nothing about the layout changes —
 * which is what "reserved seam" was supposed to mean.
 *
 * ⭐ PERSISTED. A pane you resized that resets on reload does not read as
 * "not implemented", it reads as broken. This is a UI preference, not
 * application state, so localStorage is the whole store.
 *
 * ⭐ CLAMPED, and the clamp is a product decision. Below MIN the four
 * decision buttons start truncating, and a Decline button reading "Decl…" is
 * exactly the control you cannot afford to make ambiguous. Above MAX the
 * table loses the columns that make it worth scanning.
 */
const MIN = 320;
const MAX = 620;
const DEFAULT = 380;
const KEY = 'fp.inspectorWidth';

function readStored() {
  const raw = Number(localStorage.getItem(KEY));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT;
  return Math.min(MAX, Math.max(MIN, raw));
}

export function useInspectorWidth() {
  const [width, setWidth] = useState(readStored);
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  // One writer for the variable. Setting it on documentElement rather than
  // the panel means the grid column and the panel can never disagree.
  useEffect(() => {
    document.documentElement.style.setProperty('--fp-inspector-width', `${width}px`);
  }, [width]);

  const onPointerDown = useCallback(e => {
    e.preventDefault();
    setDragging(true);

    const move = ev => {
      // Coalesce to one update per frame; a pointermove fires far faster
      // than the browser can lay out a table of several hundred rows.
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const next = window.innerWidth - ev.clientX;
        setWidth(Math.min(MAX, Math.max(MIN, next)));
      });
    };

    const up = () => {
      cancelAnimationFrame(frame.current);
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Read back from the DOM rather than from state: the last frame may
      // not have committed when the pointer is released.
      const committed = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--fp-inspector-width'), 10);
      if (Number.isFinite(committed)) localStorage.setItem(KEY, String(committed));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  /** Set and remember in one step — the two must never diverge. */
  const commit = useCallback(next => {
    setWidth(prev => {
      const clamped = Math.min(MAX, Math.max(MIN, typeof next === 'function' ? next(prev) : next));
      localStorage.setItem(KEY, String(clamped));
      return clamped;
    });
  }, []);

  /** Double-click the grip to return to the designed width. */
  const reset = useCallback(() => commit(DEFAULT), [commit]);

  /**
   * Keyboard resize — a drag handle nobody can reach is not a control.
   * Persists exactly like the drag does: a width that survives a mouse drag
   * but forgets a keyboard one is a difference nobody would ever guess at.
   */
  const onKeyDown = useCallback(e => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); commit(w => w + step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); commit(w => w - step); }
    if (e.key === 'Home')       { e.preventDefault(); reset(); }
  }, [commit, reset]);

  useEffect(() => {
    // While dragging, stop the pointer selecting table text it passes over.
    document.body.style.userSelect = dragging ? 'none' : '';
    document.body.style.cursor = dragging ? 'col-resize' : '';
    return () => { document.body.style.userSelect = ''; document.body.style.cursor = ''; };
  }, [dragging]);

  return { width, dragging, onPointerDown, onKeyDown, reset, min: MIN, max: MAX };
}
