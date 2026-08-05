import ApplicationsRow from './ApplicationsRow';
import s from './ApplicationsTable.module.css';

const COLUMNS = [
  { key: 'check',     label: '',                   className: s.colCheck },
  { key: 'applicant', label: 'Applicant',          className: null },
  { key: 'genre',     label: 'Genre / Category',   className: `${s.colGenre} ${s.hideMd}` },
  { key: 'country',   label: 'Country',            className: `${s.colCountry} ${s.hideLg}` },
  { key: 'stage',     label: 'Stage',              className: `${s.colStage} ${s.hideMd}` },
  { key: 'status',    label: 'Status',             className: s.colStatus },
  { key: 'date',      label: 'Date',               className: `${s.colDate} ${s.hideLg}` },
  { key: 'menu',      label: '',                   className: s.colMenu },
];

/**
 * The applications list.
 *
 * A real `<table>` with `table-layout: fixed` and a sticky header, not a grid
 * of divs: the header and the rows must agree on column widths at any row
 * count, and semantics come free.
 *
 * Rows are rendered plainly for now. Virtualisation is the obvious next step
 * — the workspace is specified to hold thousands of applications — and it
 * drops in here without any row or screen changing.
 */
export default function ApplicationsTable({ rows, selectedId, onSelect }) {
  return (
    <div className={s.wrap}>
      <table className={s.table}>
        <thead className={s.head}>
          <tr>
            {COLUMNS.map(col => (
              <th key={col.key} className={col.className || undefined} scope="col">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <ApplicationsRow
              key={row.id}
              application={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
