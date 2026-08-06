/**
 * THE DATA CONTRACT.
 *
 * ⭐ These shapes are the RATIFIED UNIFIED MODEL, not a convenience shape for
 * whatever storage happens to exist first. That is the whole point of writing
 * them down before a repository implements them.
 *
 * The Festival MVP may ship against its own tables so it can be live for a
 * real festival without waiting for the platform-wide applications
 * unification. That is a deliberate, costed decision — but it comes with a
 * trap: if the temporary storage's shape reaches the UI, the later migration
 * stops being a data move and becomes a rewrite of every screen.
 *
 * So the UI only ever sees THIS vocabulary. A repository's job is to speak it,
 * whatever it is talking to underneath.
 *
 * Vocabulary is fixed by the specification and must not be widened here:
 *   status  draft · submitted · in_review · shortlisted · accepted · declined
 *           · withdrawn        (waitlisted is reserved, not implemented)
 *   target  event
 *
 * ⭐ An application targets an EVENT — the platform's own `events` row, owned
 * by the festival profile. `festival_edition` is gone: it was a parallel
 * concept with no public URL, and an event already carries the dates, the
 * poster and the page people apply from.
 *
 * ⭐ THE ORGANISATION AND THE OCCURRENCE ARE TWO TYPES, and the nesting is what
 * keeps them apart. A Festival has no dates and is never "open" — it runs for
 * thirty years. Its EVENT has both. ⛔ Do not flatten `event` up into Festival
 * for a caller's convenience; that is precisely how a name and someone else's
 * dates end up rendered as one heading.
 *
 * @typedef {Object} Festival
 * @property {string}  id
 * @property {string}  name
 * @property {string}  [tagline]
 * @property {string}  [description]
 * @property {string}  [location]
 * @property {string}  [website]
 * @property {?FestivalEvent} event      the occurrence in context; null if none exists yet
 *
 * @typedef {Object} FestivalEvent
 * @property {string}  id
 * @property {string}  name
 * @property {?string} startsOn          ISO date
 * @property {?string} endsOn            ISO date
 * @property {boolean} applicationsOpen  derived: any category currently open
 *
 * @typedef {Object} Category
 * @property {string}  id
 * @property {string}  key               matches the ratified role keys
 * @property {string}  label
 * @property {string}  icon
 * @property {string}  noun              'stall', 'volunteer' — for empty states
 * @property {string[]} columns          column keys, see config/columns.js
 * @property {number}  count
 * @property {string}  [opensAt]
 * @property {string}  [closesAt]
 * @property {'open'|'scheduled'|'closed'|'paused'} state
 * @property {'hold'|'immediate'} decisionMode   D-05 — per category, never per festival
 *
 * @typedef {Object} Application
 * @property {string}  id
 * @property {string}  targetType        'event'
 * @property {string}  targetId
 * @property {string}  categoryKey
 * @property {string}  fromProfileId     the identity that applied — referenced, never copied
 * @property {string}  name              display only; resolved from the profile
 * @property {string}  [location]
 * @property {string}  status
 * @property {string}  [stage]
 * @property {string}  [submittedAt]
 * @property {string|null} decidedAt
 * @property {string|null} outcomeReleasedAt   null = the applicant still sees "In review"
 * @property {Object}  answers
 *
 * @typedef {Object} Page
 * @property {Array}   items
 * @property {number}  total             ALWAYS exact — an approximate count in a
 *                                       review workspace is worse than none
 * @property {number}  page
 * @property {number}  pageSize
 */

export const STATUSES = [
  'draft', 'submitted', 'in_review', 'shortlisted', 'accepted', 'declined', 'withdrawn',
];

/**
 * The applicant-facing mapping. ONE place, per principle P15 — organisers see
 * the workflow, applicants see the outcome. Shortlisting is never exposed.
 */
export function applicantFacingStatus(application) {
  const { status, outcomeReleasedAt } = application;
  if (status === 'draft') return 'Draft';
  if (status === 'withdrawn') return 'Withdrawn';
  if (status === 'accepted' || status === 'declined') {
    if (!outcomeReleasedAt) return 'In review';
    return status === 'accepted' ? 'Accepted' : 'Not selected';
  }
  if (status === 'submitted') return 'Submitted';
  return 'In review';
}
