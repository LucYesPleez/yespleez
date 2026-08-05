import s from './StatusBadge.module.css';

/**
 * The applicant-facing status vocabulary, and nothing outside it.
 *
 * ⛔ The internal workflow set is wider than this on purpose — organisers see
 * the workflow, applicants see the outcome. An unknown status renders as
 * itself in the neutral tone rather than vanishing: a row that disappears
 * because of an unrecognised value looks like data loss.
 */
const LABELS = {
  new:         'New',
  reviewing:   'Reviewing',
  shortlisted: 'Shortlisted',
  accepted:    'Accepted',
  declined:    'Declined',
  withdrawn:   'Withdrawn',
};

export default function StatusBadge({ status, showDot = false }) {
  const tone = s[status] ? status : 'withdrawn';
  const label = LABELS[status] || status;

  return (
    <span className={`${s.badge} ${s[tone]}`}>
      {showDot && <span className={s.dot} />}
      {label}
    </span>
  );
}
