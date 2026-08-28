import s from './ParticipationBadge.module.css';

/**
 * WHERE A PERSON IS IN THEIR PARTICIPATION — ⛔ NOT where an application is.
 *
 * ⚠⚠ THIS IS A SECOND VOCABULARY AND IT MUST STAY SEPARATE. `StatusBadge`
 * owns exactly one meaning: an application's workflow (submitted, in_review,
 * shortlisted...). Participation has its own ladder (accepted, confirmed,
 * checked_in, completed...), and only the word "accepted" appears in both.
 *
 * ⛔ Do not widen StatusBadge to cover these. Its own history is the argument:
 * `Tag` exists because Settings borrowed StatusBadge to get a coloured pill
 * for a role, and a role ended up expressed in the vocabulary of an
 * application's workflow. Two vocabularies in one component is the same
 * mistake one layer up — and the applications table already lived through a
 * column holding two vocabularies at once, which left whole tabs empty.
 *
 * ⚠ An unknown status renders as ITSELF in the neutral tone rather than
 * vanishing: a row that disappears because of an unrecognised value looks
 * like data loss.
 */
const LABELS = {
  applied:      'Applied',
  accepted:     'Accepted',
  confirmed:    'Confirmed',
  checked_in:   'Checked in',
  participated: 'Participated',
  completed:    'Completed',
  cancelled:    'Cancelled',
  withdrawn:    'Withdrawn',
  rejected:     'Rejected',
  no_show:      'No show',
  invited:      'Invited',
};

/**
 * ⭐ THE TONE TRACKS CONFIDENCE, NOT SENTIMENT. Green is "this is settled and
 * happened"; cyan is "agreed, not yet proven"; muted is "no longer part of
 * it". ⛔ Cancelled and withdrawn are not FAILURES and must not wear the alarm
 * colour — someone pulling out is ordinary, and colouring it like a rejection
 * would make a roster read as a list of problems.
 */
const TONES = {
  applied:      'pending',
  invited:      'pending',
  accepted:     'agreed',
  confirmed:    'agreed',
  checked_in:   'done',
  participated: 'done',
  completed:    'done',
  cancelled:    'gone',
  withdrawn:    'gone',
  rejected:     'gone',
  no_show:      'gone',
};

export default function ParticipationBadge({ status }) {
  const tone = TONES[status] || 'gone';
  const label = LABELS[status] || status;
  return <span className={`${s.badge} ${s[tone]}`}>{label}</span>;
}
