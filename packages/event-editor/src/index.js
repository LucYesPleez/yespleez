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
  // Pure shape converters for hosts that store slots as ROWS rather than in
  // `config.days`. ⛔ No database knowledge travels with them — the consumer
  // owns the reading and writing, as it already does for poster uploads.
  rowsToDays,
  daysToRows,
  /* ⭐⭐ THE DATE RANGE AND THE RUNNING ORDER ARE ONE THING. A Fri–Sun festival
     is ONE event with three days inside it. These let a consumer state the span,
     date each day, and see when the two halves have drifted apart.
     ⛔ `reconcileDays` only ever ADDS: a slot can hold a booked artist, so
     removing a day is always the organiser's decision, never the form's. */
  spanDays,
  dayDate,
  dayDateLabel,
  dayRangeCheck,
  reconcileDays,
} from './eventEditorModel.js';

/* ⭐⭐ IS THIS ALREADY AN EVENT? Warns when somebody is about to create a second
   row describing an event that already exists. ⛔⛔ It WARNS, it never blocks:
   two different gigs at one venue on one night are completely normal.
   ⛔ No database knowledge travels with it — the consumer fetches candidates. */
export {
  findRelatedEvents,
  namesLookRelated,
  normaliseEventName,
  REASON as DUPLICATE_REASON,
} from './duplicateEvents.js';
