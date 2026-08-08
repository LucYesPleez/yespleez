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
 */

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
  availability: { key: 'availability', label: 'Availability',     cell: 'muted', width: 130, priority: 1 },
  frontage:     { key: 'frontage',     label: 'Frontage',         cell: 'muted', width: 110, priority: 1 },
  power:        { key: 'power',        label: 'Power',            cell: 'muted', width: 110, priority: 1 },
  duration:     { key: 'duration',     label: 'Duration',         cell: 'muted', width: 110, priority: 1 },
  scale:        { key: 'scale',        label: 'Scale',            cell: 'muted', width: 110, priority: 1 },
  campSize:     { key: 'campSize',     label: 'People',           cell: 'muted', width: 100, priority: 1 },
  footprint:    { key: 'footprint',    label: 'Footprint',        cell: 'muted', width: 110, priority: 1 },
  country:      { key: 'country',      label: 'Country',          cell: 'muted', width: 110, priority: 1 },
  stage:        { key: 'stage',        label: 'Stage',            cell: 'stage', width: 130, priority: 2 },
  status:       { key: 'status',       label: 'Status',           cell: 'status', width: 130 },
  date:         { key: 'date',         label: 'Applied',          cell: 'muted', width: 115, priority: 1 },
};

/** Resolve a category's column keys into definitions, skipping unknown keys. */
export function columnsFor(category) {
  return (category?.columns || []).map(key => COLUMNS[key]).filter(Boolean);
}
