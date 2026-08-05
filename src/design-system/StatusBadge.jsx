import s from './StatusBadge.module.css';

/**
 * The ORGANISER-facing status vocabulary — the workflow, not the outcome.
 *
 * ⭐ P15: organisers see the workflow, applicants see the outcome. This badge
 * appears in the table and the inspector, both organiser surfaces, so it
 * speaks the internal vocabulary in full. The narrower applicant-facing
 * mapping lives in `data/types.js` and is the ONLY other place a status
 * becomes words.
 *
 * Keys are exactly the ratified set. `waitlisted` is reserved and not
 * implemented; when it arrives it is one entry here and one tone below.
 *
 * ⚠ An unknown status renders as ITSELF in the neutral tone rather than
 * vanishing — a row that disappears because of an unrecognised value looks
 * like data loss. This component shipped once rendering a raw `submitted`
 * key, which is exactly how that drift announces itself: visibly, in the
 * wrong colour, rather than silently.
 */
const LABELS = {
  draft:       'Draft',
  submitted:   'Submitted',
  in_review:   'In review',
  shortlisted: 'Shortlisted',
  accepted:    'Accepted',
  declined:    'Declined',
  withdrawn:   'Withdrawn',
};

const TONES = {
  draft:       'draft',
  submitted:   'new',
  in_review:   'reviewing',
  shortlisted: 'shortlisted',
  accepted:    'accepted',
  declined:    'declined',
  withdrawn:   'withdrawn',
};

export default function StatusBadge({ status, showDot = false }) {
  const tone = TONES[status] || 'withdrawn';
  const label = LABELS[status] || status;

  return (
    <span className={`${s.badge} ${s[tone]}`}>
      {showDot && <span className={s.dot} />}
      {label}
    </span>
  );
}
