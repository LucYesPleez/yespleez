/**
 * Editing an event.
 *
 * ⛔ THE ONE RULE THIS PACKAGE EXISTS TO KEEP: it must never learn which
 * application is rendering it. No mode, no isX flag, no branch on the caller's
 * identity. Everything that differs between callers arrives as an argument —
 * the category vocabulary, the profile-type labels, the components that touch
 * storage, and the adornments.
 *
 * If something here ever seems to need to know who is asking, that is evidence
 * the boundary is drawn in the wrong place. Report it; do not add the flag.
 *
 * What travels with the editor, because it is genuinely editing:
 *   EventEditorForm       the form
 *   useEventEditorState   form state, dirty tracking, upload orchestration
 *   the model             emptyEventForm · fromConfig · toConfig · makeId · generateSlots
 *
 * What does NOT, and why:
 *   hero rules      → @yespleez/event-presentation  (how an event LOOKS, wherever shown)
 *   requirements    → @yespleez/requirements        (asked-for vs held, whoever asks)
 */

export { default as EventEditorForm } from './EventEditorForm.jsx';
export { useEventEditorState } from './useEventEditorState.js';
export {
  emptyEventForm,
  fromConfig,
  toConfig,
  makeId,
  generateSlots,
} from './eventEditorModel.js';
