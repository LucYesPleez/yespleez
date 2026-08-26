import { EmptyState } from '../../design-system';
import s from './ApplicationTab.module.css';

/**
 * WHAT THIS PERSON ACTUALLY SUBMITTED.
 *
 * ⚠⚠ This was a `StubTab` promising "the question set exactly as it was
 * answered" and rendering four grey bars. Meanwhile the answers WERE being
 * fetched — `applicationRepository` selects `answers` and the model carries
 * it — and read at exactly one place in the whole app, a table cell that
 * looked for the wrong keys. So a volunteer's days and departments were
 * collected, stored and then shown to nobody.
 *
 * ⭐ The table summarises ("4 days", "Front Gate +2"); this is where the list
 * lives. A fixed-width cell cannot name sixteen dates, and an organiser
 * allocating crew needs all of them.
 *
 * ⛔ RENDERS WHAT IS THERE AND NOTHING ELSE. An organiser who configured no
 * departments asked no department question, so there is no department section
 * — ⛔ never an empty heading, never a placeholder standing in for a question
 * that was never put (the rendering contract's absent ≠ unknown).
 */

/** '2026-11-12' → 'Thu 12 Nov'. ⛔ Built from parts: `new Date('2026-11-12')`
 *  parses as UTC midnight and prints the day before in Australia. */
function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return String(iso ?? '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ApplicationTab({ selection }) {
  const answers = selection?.answers ?? {};
  const days = Array.isArray(answers.days) ? answers.days : [];
  const departments = Array.isArray(answers.departments) ? answers.departments : [];

  // Anything the category asked that this tab has no dedicated section for.
  // ⭐ Future question sets show up here instead of vanishing silently.
  const extras = Object.entries(answers)
    .filter(([k]) => k !== 'days' && k !== 'departments')
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0));

  if (!days.length && !departments.length && !extras.length) {
    return (
      <EmptyState
        icon="inbox"
        title="Nothing was asked"
        note="This festival collected no extra answers for this category, so the profile is the whole application."
      />
    );
  }

  return (
    <div className={s.wrap}>
      {departments.length > 0 && (
        <section className={s.section}>
          <h3 className={s.heading}>Where they'd like to help</h3>
          <ul className={s.chips}>
            {departments.map(name => <li key={name} className={s.chip}>{name}</li>)}
          </ul>
        </section>
      )}

      {days.length > 0 && (
        <section className={s.section}>
          {/* ⭐ The count is in the heading because it is the number an
              organiser is actually scanning for; the dates answer "which". */}
          <h3 className={s.heading}>
            Available <span className={s.count}>{days.length === 1 ? '1 day' : `${days.length} days`}</span>
          </h3>
          <ul className={s.chips}>
            {days.map(iso => <li key={iso} className={s.chip}>{dayLabel(iso)}</li>)}
          </ul>
        </section>
      )}

      {extras.map(([key, value]) => (
        <section key={key} className={s.section}>
          <h3 className={s.heading}>{key}</h3>
          <p className={s.value}>{Array.isArray(value) ? value.join(' · ') : String(value)}</p>
        </section>
      ))}
    </div>
  );
}
