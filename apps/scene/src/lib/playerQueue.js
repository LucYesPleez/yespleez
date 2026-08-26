/**
 * THE DEMO QUEUE — what plays next, and what played last.
 *
 * ⚠⚠ THE QUEUE USED TO EAT WHAT IT PLAYED. Advancing was
 * `const [next, ...rest] = playlist`, which dropped the current demo on the
 * floor. Nothing was wrong with it while the player only went forwards — and
 * it meant a back button had nothing to go back TO. The history had to exist
 * before the control could.
 *
 * ⭐⭐ FORWARD AND BACK ARE EXACT INVERSES. `rewind(advance(q))` is `q`. That is
 * the property worth having and the one worth testing: without it a demo gets
 * lost, or heard twice in a row, and both look like the queue "glitching"
 * rather than like a bug anybody can name.
 *
 * ⭐ Pure and extracted so those invariants can be checked without a player, a
 * widget or a browser — the preview pane cannot play media at all, so a test
 * driving the real thing would prove nothing.
 *
 * Shape: `{ ...entry, playlist: [entry], played: [entry] }`. `played` is a
 * stack with the newest last; `playlist` is a queue with the next first.
 */

/** The current entry, stripped of the queue it is carrying. */
function bare(entry) {
  if (!entry) return null;
  const { playlist: _p, played: _q, ...rest } = entry;
  return rest;
}

/** Is there anywhere to go? */
export function hasNext(state) { return Boolean(state?.playlist?.length); }
export function hasPrev(state) { return Boolean(state?.played?.length); }

/**
 * Move to the next demo, remembering the one being left.
 *
 * @returns the new state, or null when the queue is empty — which the caller
 *          renders as "close the player", the same outcome as a single mix
 *          finishing.
 */
export function advance(state) {
  if (!hasNext(state)) return null;
  const [next, ...rest] = state.playlist;
  return {
    ...bare(next),
    playlist: rest,
    played: [...(state.played || []), bare(state)],
  };
}

/**
 * Go back to the demo played before this one.
 *
 * ⚠ The current entry returns to the FRONT of the queue, so stepping back and
 * forward again lands exactly where it started rather than skipping it.
 *
 * @returns the new state, or the state unchanged when there is no history —
 *          ⛔ never null. Back with nothing behind it is a restart, which the
 *          player handles; it must not close anything.
 */
export function rewind(state) {
  if (!hasPrev(state)) return state;
  const history = state.played;
  const prev = history[history.length - 1];
  return {
    ...bare(prev),
    played: history.slice(0, -1),
    playlist: [bare(state), ...(state.playlist || [])],
  };
}
