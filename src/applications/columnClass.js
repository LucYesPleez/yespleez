import s from './ApplicationsTable.module.css';

/**
 * The responsive class for one column — used by the HEADER and the ROW.
 *
 * ⚠ THIS EXISTS BECAUSE THEY DIVERGED ONCE. The priority classes were applied
 * to `<td>` and not to `<th>`, so at a narrow pane four cells hid while eight
 * headers stayed. With `table-layout: fixed` that does not merely leave a gap
 * — the remaining cells lay out under the WRONG headers, so every row read as
 * empty in the applicant column with the name silently under "Category".
 *
 * One function, two callers. A header and its cells cannot disagree about
 * whether a column exists.
 */
export function columnClass(col, ...extra) {
  return [
    col.priority === 1 && s.p1,
    col.priority === 2 && s.p2,
    ...extra,
  ].filter(Boolean).join(' ');
}
