/**
 * COLUMN DEFINITIONS for the applications table.
 *
 * One registry, referenced by key from `categories.js`. A category showing
 * "Cuisine" instead of "Genre" is a configuration difference, not a different
 * table — which is what keeps ApplicationsTable the single source of truth
 * about how a row renders.
 *
 * `width` is fixed because the table is `table-layout: fixed`: the header and
 * every row must agree on widths at any row count, and a column that resizes
 * with its content makes a long list visibly twitch while it renders.
 *
 * `priority` drives responsive hiding — the higher the number, the sooner the
 * column goes. `applicant` and `status` have no priority and never hide: the
 * two questions a reviewer always needs answered are "who" and "where are we
 * up to with them".
 *
 * ⭐⭐ `value(application)` — AN EXPLICIT RESOLVER, and it exists because the
 * implicit one lied.
 *
 * The row used to resolve a cell as `application[key] ?? answers[key]`, which
 * silently renders a dash whenever the key does not happen to match what was
 * stored. ⚠⚠ Measured 2026-08-27: a volunteer's ANSWERS ARE COLLECTED AND
 * STORED CORRECTLY, and four of their six columns rendered "—" anyway —
 * `availability` looked for `answers.availability` while Scene writes
 * `answers.days`; `date` looked for `date` while the model field is
 * `submittedAt`. ⛔ And a dash in this table MEANS "asked and not answered"
 * (see ApplicationsRow), so the organiser was told the opposite of the truth
 * about every volunteer.
 *
 * A column that needs to reach anywhere but its own key now says so.
 */

/** "4 days", or nothing at all. ⛔ Never a bare count of an absent list. */
function daysSummary(days) {
  if (!Array.isArray(days) || days.length === 0) return null;
  return days.length === 1 ? '1 day' : `${days.length} days`;
}

/**
 * "Front Gate", or "Front Gate +2".
 *
 * ⚠ The full list belongs to the inspector. A fixed-width cell that tries to
 * name six departments truncates mid-word and tells the reviewer less than a
 * count does.
 */
function departmentsSummary(names) {
  if (!Array.isArray(names) || names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

/** "26 Aug", local. ⛔ Not `toISOString().slice(...)` — that is the UTC day. */
function appliedOn(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export const COLUMNS = {
  applicant:    { key: 'applicant',    label: 'Applicant',        cell: 'applicant' },
  category:     { key: 'category',     label: 'Category',         cell: 'tag',   width: 160, priority: 2 },
  genre:        { key: 'genre',        label: 'Genre',            cell: 'tag',   width: 150, priority: 2 },
  discipline:   { key: 'discipline',   label: 'Discipline',       cell: 'tag',   width: 150, priority: 2 },
  cuisine:      { key: 'cuisine',      label: 'Cuisine',          cell: 'tag',   width: 150, priority: 2 },
  topic:        { key: 'topic',        label: 'Workshop',         cell: 'text',  width: 180, priority: 2 },
  outlet:       { key: 'outlet',       label: 'Outlet',           cell: 'text',  width: 160, priority: 2 },
  trades:       { key: 'trades',       label: 'Sells',            cell: 'text',  width: 160, priority: 2 },
  rig:          { key: 'rig',          label: 'Rig',              cell: 'text',  width: 170, priority: 2 },
  skills:       { key: 'skills',       label: 'Skills',           cell: 'tag',   width: 160, priority: 2 },
  /* ⭐ Reads `answers.days` — what Scene actually writes. */
  availability: { key: 'availability', label: 'Available',        cell: 'muted', width: 120, priority: 1,
                  value: a => daysSummary(a.answers?.days) },
  /* ⭐ WHICH DEPARTMENTS a volunteer offered — the fact the whole category
     exists to collect, and it was rendered nowhere in the organiser app. */
  departments:  { key: 'departments',  label: 'Preferred',        cell: 'tag',   width: 175, priority: 2,
                  value: a => departmentsSummary(a.answers?.departments) },
  frontage:     { key: 'frontage',     label: 'Frontage',         cell: 'muted', width: 110, priority: 1 },
  power:        { key: 'power',        label: 'Power',            cell: 'muted', width: 110, priority: 1 },
  duration:     { key: 'duration',     label: 'Duration',         cell: 'muted', width: 110, priority: 1 },
  scale:        { key: 'scale',        label: 'Scale',            cell: 'muted', width: 110, priority: 1 },
  campSize:     { key: 'campSize',     label: 'People',           cell: 'muted', width: 100, priority: 1 },
  footprint:    { key: 'footprint',    label: 'Footprint',        cell: 'muted', width: 110, priority: 1 },
  country:      { key: 'country',      label: 'Country',          cell: 'muted', width: 110, priority: 1 },
  stage:        { key: 'stage',        label: 'Stage',            cell: 'stage', width: 130, priority: 2 },
  status:       { key: 'status',       label: 'Status',           cell: 'status', width: 130 },
  /* ⭐ Reads `submittedAt` — the model's field. Keyed `date` because that is
     what every category's column list already says. */
  date:         { key: 'date',         label: 'Applied',          cell: 'muted', width: 115, priority: 1,
                  value: a => appliedOn(a.submittedAt) },
};

/** Resolve a category's column keys into definitions, skipping unknown keys. */
export function columnsFor(category) {
  return (category?.columns || []).map(key => COLUMNS[key]).filter(Boolean);
}
