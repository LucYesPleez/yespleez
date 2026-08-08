import { REACTIONS } from '../lib/reactions';
import HandIcon from './HandIcon';
import s from './ReactionBar.module.css';

/**
 * THE REACTION BAR — the row of emoji a long press reveals.
 *
 * ⚠ IT RENDERS THE REGISTRY, IT DOES NOT KNOW THE REACTIONS.
 *
 * Every glyph, its order and its label come from `lib/reactions.js`. This
 * component contains no emoji and no list. Adding an eighth reaction is an
 * entry there plus a value in the MR1 CHECK — never an edit here. That is
 * the whole point of building it as infrastructure rather than as a row of
 * eight buttons.
 *
 * ⚠ THERE IS NO "MORE" BUTTON AND NO PICKER, BY DECISION. The set is fixed.
 * A picker would turn a one-tap gesture into a browse, and the reactions
 * exist to be fast punctuation, not a decision.
 *
 * ── THE HAND IS NOT IN HERE ──────────────────────────────────────────
 *
 * The Yes lives on the composer and on double-tap, and is stored in its own
 * column. Owner's decision: it is not an emoji and must not be grouped with
 * them, because making it one of N equal choices is how it gets used less.
 * `HandIcon` is imported only for a future registry entry flagged `custom`,
 * which nothing uses today.
 */
export default function ReactionBar({ current = null, onPick, onDismiss }) {
  return (
    <div
      className={s.bar}
      role="group"
      aria-label="React to this message"
      // The bar sits above a message the user long-pressed. A tap that lands
      // on the bar's own padding must not fall through to the backdrop and
      // close it — the target is small and the miss is common.
      onClick={e => e.stopPropagation()}
    >
      {REACTIONS.map((r, i) => {
        const active = current === r.key;
        return (
          <button
            key={r.key}
            type="button"
            className={`${s.btn}${active ? ` ${s.active}` : ''}`}
            // Staggered entrance, left to right. Small enough to read as one
            // movement rather than as eight things arriving separately.
            style={{ animationDelay: `${i * 18}ms` }}
            aria-label={r.label}
            aria-pressed={active}
            title={r.label}
            onClick={() => { onPick?.(r.key); onDismiss?.(); }}
          >
            <span className={s.glyph}>
              {r.custom ? <HandIcon size={26} /> : r.emoji}
            </span>
          </button>
        );
      })}
    </div>
  );
}
