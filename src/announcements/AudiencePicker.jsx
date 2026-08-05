import { ChipGroup, Callout } from '../design-system';
import { CATEGORIES } from '../config/categories';
import { recipientCount } from './recipientCount';
import s from './Announcements.module.css';

/**
 * WHO RECEIVES THIS.
 *
 * ⭐ The recipient count is the point of this component. An announcement is
 * irreversible and reaches hundreds of people, so the one fact that must be
 * impossible to miss is HOW MANY — shown live, beside the choices, before
 * anything is written.
 *
 * ⛔ NO FILTERING LOGIC. The count is a sum over the category registry, which
 * is arithmetic on numbers already on screen, not a query. Status narrowing
 * has no counts to sum yet, and the component says so rather than inventing
 * a figure — a confidently wrong recipient count is worse than an honest
 * "not narrowed yet".
 */

const STATUSES = [
  { value: 'submitted',   label: 'Submitted' },
  { value: 'reviewing',   label: 'In review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'accepted',    label: 'Accepted' },
  { value: 'declined',    label: 'Not selected' },
];

export default function AudiencePicker({ categories, statuses, onCategories, onStatuses }) {
  const count = recipientCount(categories);
  const narrowed = statuses.length > 0;

  return (
    <div className={s.audience}>
      <ChipGroup
        label="Categories"
        options={CATEGORIES.map(c => ({ value: c.key, label: c.label, count: c.count }))}
        selected={categories}
        onChange={onCategories}
        action={categories.length ? 'Clear' : 'All categories'}
        onAction={() => onCategories([])}
      />

      <ChipGroup
        label="Application status"
        options={STATUSES}
        selected={statuses}
        onChange={onStatuses}
        action={statuses.length ? 'Clear' : 'Any status'}
        onAction={() => onStatuses([])}
      />

      <div className={s.countBox}>
        <span className={s.countValue}>{narrowed ? '—' : count}</span>
        <span className={s.countLabel}>
          {narrowed
            ? 'Recipients are not counted until status filtering is wired'
            : categories.length
              ? `recipients across ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`
              : 'recipients — everyone who has applied'}
        </span>
      </div>

      {narrowed && (
        <Callout tone="warn" title="This audience is narrowed">
          A status filter is applied, so the number above is not yet the real total. It will be exact
          before anything can be sent — an approximate recipient count is worse than none.
        </Callout>
      )}
    </div>
  );
}
