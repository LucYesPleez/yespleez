/**
 * HOW A REQUIREMENT STATE READS ON SCREEN.
 *
 * Plain .js, not .jsx, deliberately: Node's test runner cannot load .jsx, so
 * anything living beside the markup is untestable in this monorepo. The RULE
 * that decides what a reader sees is exactly the part worth testing, so it
 * lives here and the component imports it.
 *
 * ⛔ NO ENGINE WORDS ON SCREEN. The engine's states are `absent` / `withheld` /
 * `satisfied` / `unknown`; the reader sees a mark and a label, never the state.
 */

/**
 * The mark and colour for each state.
 *
 * ⭐ `withheld` shows the SAME tick as `satisfied`. 'N/A' is a real answer, not
 * a gap (Rendering Contract R1) — someone asked for a website who said they
 * have none has answered, and showing that as missing would demand they invent
 * one to get through a gate.
 */
export const STATE_UI = {
  satisfied: { mark: '✓', color: '#00E5A0' },
  withheld:  { mark: '✓', color: '#00E5A0' },
  absent:    { mark: '○', color: 'var(--muted)' },
  unknown:   { mark: '·', color: 'var(--muted)' },
};

/**
 * Does this state count as met?
 *
 * ⚠ Fails toward NOT met for anything unrecognised. A new state added to the
 * engine must be classified here deliberately — silently reading as satisfied
 * would let someone through a gate they have not passed.
 */
export function isMet(state) {
  return state === 'satisfied' || state === 'withheld';
}

/** The UI for a state, never undefined — an unknown state renders as unknown. */
export function stateUi(state) {
  return STATE_UI[state] || STATE_UI.unknown;
}
