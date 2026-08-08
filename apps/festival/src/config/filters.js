/**
 * FILTER DEFINITIONS.
 *
 * Data, like the categories and the columns. A new filter is an entry here —
 * FilterBar renders whatever this describes and has no knowledge of what any
 * particular filter means.
 *
 * ⛔ These describe the CONTROLS, not a query. Nothing here filters anything;
 * the values exist so the popovers are real and the applied-state treatment
 * is reviewable before a data layer arrives.
 *
 * The status values match the applicant-facing vocabulary exactly. An
 * organiser filtering by a word the applicant never sees would be filtering
 * by a concept that does not exist outside this screen.
 */

export const FILTERS = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'new',         label: 'New' },
      { value: 'reviewing',   label: 'Reviewing' },
      { value: 'shortlisted', label: 'Shortlisted' },
      { value: 'accepted',    label: 'Accepted' },
      { value: 'declined',    label: 'Declined' },
      { value: 'withdrawn',   label: 'Withdrawn' },
    ],
  },
  {
    key: 'stage',
    label: 'Stage',
    options: [
      { value: 'unopened',    label: 'Not yet opened' },
      { value: 'reviewing',   label: 'Reviewing' },
      { value: 'shortlisted', label: 'Shortlisted' },
      { value: 'decided',     label: 'Decided' },
    ],
  },
  {
    key: 'country',
    label: 'Country',
    collapsible: true,
    options: [
      { value: 'AUS', label: 'Australia' },
      { value: 'NZL', label: 'New Zealand' },
      { value: 'DEU', label: 'Germany' },
      { value: 'FRA', label: 'France' },
      { value: 'GBR', label: 'United Kingdom' },
    ],
  },
  {
    key: 'submitted',
    label: 'Submitted',
    collapsible: true,
    single: true,
    options: [
      { value: '24h',  label: 'Last 24 hours' },
      { value: '7d',   label: 'Last 7 days' },
      { value: '30d',  label: 'Last 30 days' },
      { value: 'all',  label: 'Any time' },
    ],
  },
  {
    key: 'flags',
    label: 'More',
    icon: 'filter',
    options: [
      { value: 'has_notes',    label: 'Has notes' },
      { value: 'has_messages', label: 'Has unread messages' },
      { value: 'has_files',    label: 'Files attached' },
      { value: 'unopened',     label: 'Not yet opened' },
    ],
  },
];

export const SORT_OPTIONS = [
  { value: 'newest',  label: 'Newest first' },
  { value: 'oldest',  label: 'Oldest first' },
  { value: 'name',    label: 'Name A–Z' },
  { value: 'updated', label: 'Recently updated' },
];
