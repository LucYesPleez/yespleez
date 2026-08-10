import { snapshotEvaluation } from '@yespleez/requirements';

/**
 * THE ENQUIRY GATE — one predicate, two callers.
 *
 * P6: a venue declares STANDING requirements on its profile, and an act must
 * satisfy them before it may ask about a date.
 *
 * ⭐ WHY THIS IS A MODULE AND NOT TWO EXPRESSIONS IN JSX. The rule is needed in
 * two places: the button's disabled state, and the guard at the top of the
 * write path. ApplyButton learned this the hard way and says so — "re-checking
 * here keeps the rule in the write path rather than only in the styling",
 * because a disabled button is a suggestion and a guard is a rule. Two copies
 * of one predicate is two chances to change one and not the other, and the
 * failure would be silent: an enquiry that should have been blocked, sent.
 *
 * ⛔ THIS GATES ONE DIRECTION ONLY: applicant → venue. The venue-initiated
 * invitation path (InviteSheet, `initiated_by: 'venue'`) must never call this.
 * When the venue is doing the asking, requiring the artist to satisfy the
 * venue's own checklist first would invert the relationship — a venue with a
 * demanding checklist could make itself unable to invite anybody.
 *
 * ── ⭐⭐ EVERY UNKNOWN IS A BLOCK. THIS IS THE WHOLE DESIGN. ──
 *
 * Three separate things can be unknown, and each one used to read as "fine":
 *
 *   1. the venue's requirements are still loading   → `required` is null
 *   2. the verdict is still being computed          → `evaluating` is true
 *   3. the verdict belongs to a DIFFERENT act       → ids disagree
 *
 * All three block. The reason is the same in each case: an enquiry sent while
 * the answer is unknown is written with a NULL snapshot, and a null snapshot is
 * forever indistinguishable from "this venue asked for nothing". The record
 * cannot be repaired later because nothing survives to say what was true at the
 * time. A moment of a disabled button is recoverable; a wrong permanent record
 * is not.
 */

/**
 * ⚠ null AND [] ARE DIFFERENT HERE, AND THE DATABASE'S NULL IS NEITHER.
 *
 *   null / undefined  the requirements have NOT BEEN READ YET      → blocked
 *   []                the venue has been read and asks for nothing → allowed
 *
 * In the DATABASE, `profiles.required_items` NULL and '{}' both mean "asks for
 * nothing" — so the fetch collapses NULL to `[]` at the boundary
 * (`data?.required_items || []`). By the time a value reaches this function,
 * null can therefore only mean "not loaded", never "none declared". Keeping
 * the two apart in memory is the entire fix: initialising to `[]` made
 * "unknown" wear the costume of "no requirements".
 *
 * @param {object} args
 * @param {string[]|null} args.required  the venue's requirements, or null while unread
 * @param {object|null} args.evaluation  `evaluate()`'s verdict, or null
 * @param {boolean} args.evaluating      true while the verdict is being computed
 * @param {string|null} [args.actingProfileId]    the act about to send
 * @param {string|null} [args.evaluatedProfileId] the act the verdict describes
 * @returns {boolean}
 */
export function canSendEnquiry({
  required,
  evaluation,
  evaluating,
  actingProfileId,
  evaluatedProfileId,
} = {}) {
  // (1) UNKNOWN — the venue's requirements have not come back yet. Fail closed:
  // this venue may well demand a press kit, and we have no way to know.
  if (!Array.isArray(required)) return false;

  // Known, and empty: anyone may enquire. This is the normal case — the state
  // of every venue that has never opened the checklist.
  if (required.length === 0) return true;

  // (2) UNKNOWN — the verdict is mid-flight.
  if (evaluating) return false;
  if (!evaluation) return false;

  /**
   * (3) STALE — the verdict describes a different act than the one about to
   * send. Switching acting profile re-runs the evaluation, but for the render
   * between the switch and the effect, `evaluation` still holds the PREVIOUS
   * act's answer. Their band may hold a press kit their solo act does not, so
   * a stale pass is a real bypass, not a cosmetic flicker.
   *
   * Only enforced when both ids are known: callers that do not track the pair
   * keep the previous behaviour rather than being silently blocked forever.
   */
  if (actingProfileId && evaluatedProfileId && actingProfileId !== evaluatedProfileId) return false;

  return evaluation.canSubmit === true;
}

/**
 * The verdict to store on the enquiry row (P7), or null.
 *
 * NULL when the venue declared nothing — deliberately, because "no
 * requirements were asked" and "0 of 0 met" are different facts and readers
 * must render nothing rather than 0/0 (Rendering Contract R3).
 *
 * ⛔ Also null when `required` is null, i.e. unread. That combination must
 * never reach the database: `canSendEnquiry` refuses to let a send happen in
 * that state, so this is the second lock on the same door rather than a
 * supported outcome.
 *
 * `required` is passed through to snapshotEvaluation and copied INTO the
 * verdict on purpose: the venue may tighten its standing requirements next
 * month, and this row must keep naming what was actually asked today.
 */
export function enquirySnapshot({ required, evaluation } = {}) {
  if (!Array.isArray(required) || required.length === 0) return null;
  if (!evaluation) return null;
  return snapshotEvaluation(evaluation, required);
}
