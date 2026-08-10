/**
 * The checklist — the one UI for declaring what you require.
 *
 * A SEPARATE ENTRY POINT from the engine on purpose. `@yespleez/requirements`
 * is pure logic with no dependencies and must stay importable by anything;
 * this half needs React. Splitting the export means a consumer that only
 * evaluates requirements never pulls a component into its graph, and React
 * stays a peerDependency of the package rather than a hard one.
 *
 *   import { evaluate } from '@yespleez/requirements';            // logic
 *   import RequirementChecklist from '@yespleez/requirements/checklist';
 */
/**
 * TWO COMPONENTS, OPPOSITE JOBS — see the docblock on RequirementsVerdict.
 *
 *   RequirementChecklist  the INPUT.     Ticked by whoever is asking.  Writes.
 *   RequirementsVerdict   the READ-ONLY. Shown to whoever is asked.    Renders.
 *
 * ⛔ Do not merge them behind a `readOnly` flag. They share a registry, not a
 * responsibility, and the flag would be the first thing to grow a second one.
 */
export { default } from './RequirementChecklist.jsx';
export { default as RequirementChecklist } from './RequirementChecklist.jsx';
export { default as RequirementsVerdict } from './RequirementsVerdict.jsx';
export { isMet, stateUi, STATE_UI } from './verdictState.js';
export { toggleRequirement } from './toggleRequirement.js';
