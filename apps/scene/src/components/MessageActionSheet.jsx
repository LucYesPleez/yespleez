import { useEffect } from 'react';
import ReactionBar from './ReactionBar';
import s from './MessageActionSheet.module.css';

/**
 * LONG PRESS → the reaction bar, and the actions beneath it.
 *
 * The Messenger pattern: the bar floats directly above the message you
 * pressed, the actions sit at the bottom of the screen, and the backdrop
 * dims everything else.
 *
 * ── ANCHORED TO A MEASURED RECT, NOT TO THE DOM ──────────────────────
 *
 * The caller measures the pressed message and passes its bounding rect. The
 * bar is then `position: fixed` against the viewport, which is the only way
 * it can escape the thread's scroll container without being clipped by it
 * or dragging with it mid-gesture.
 *
 * ⚠ THE BOTTOM NAV IS SACRED. The sheet stops at `--yp-nav-height` and the
 * backdrop stops there too. Nothing here may render beneath or over the
 * nav — see the constitutional UI rule.
 *
 * ── CLOSING IS INSTANT, DELIBERATELY ─────────────────────────────────
 *
 * There is an entrance animation and no exit one. An exit transition is
 * precisely what makes a menu feel heavy, and this is punctuation — it
 * should be gone before you have finished lifting your finger.
 */
export default function MessageActionSheet({
  rect, current = null, actions = [], onPick, onClose,
}) {
  // Escape closes, like every other dismissible surface in the app.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Above the message where there is room, below it when the message is near
  // the top of the screen. Without the flip, pressing the first message in a
  // thread would put the bar off-screen — which is exactly the message
  // someone scrolls back to react to.
  const BAR_H = 56;
  const above = rect ? rect.top > BAR_H + 12 : true;
  const top = rect
    ? (above ? rect.top - BAR_H : rect.bottom + 8)
    : null;

  return (
    <div className={s.backdrop} onClick={onClose} role="presentation">
      {rect && (
        <div
          className={s.barAnchor}
          style={{
            top,
            // Follows the side the message is on, clamped so a bar wider than
            // the remaining space cannot run off the edge.
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
          }}
        >
          <ReactionBar current={current} onPick={onPick} onDismiss={onClose} />
        </div>
      )}

      {actions.length > 0 && (
        <div className={s.sheet} onClick={e => e.stopPropagation()} role="menu">
          {actions.map(a => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className={`${s.action}${a.destructive ? ` ${s.destructive}` : ''}`}
              onClick={() => { a.onSelect?.(); onClose?.(); }}
            >
              <span className={s.actionIcon} aria-hidden="true">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
