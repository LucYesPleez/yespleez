import { Icon, StatusBadge, Popover, MenuItem, MenuDivider } from '../design-system';
import { columnClass } from './columnClass';
import s from './ApplicationsTable.module.css';

/**
 * One row, rendered from the column definitions its category declares.
 *
 * The row does not know what a "genre" or a "cuisine" is — it knows six cell
 * renderers. That is what lets one table serve nine categories without
 * branching on category anywhere.
 *
 * ⭐ R1 — absent, blank and unknown are three different things. A column the
 * category never asks for renders nothing; a column that was asked and left
 * empty renders a dimmed dash. A reviewer must be able to tell "we didn't ask"
 * from "they didn't answer".
 */
function Cell({ column, application }) {
  /**
   * A column resolves against the application itself first, then its answers.
   * Identity and workflow live on the record (`name`, `status`, `stage`);
   * everything a category asked for lives in `answers`. Looking in both, in
   * that order, is what lets one renderer serve every category without the
   * table knowing which fields belong where.
   */
  const value = application[column.key] ?? application.answers?.[column.key];

  if (column.cell === 'applicant') {
    return (
      <div className={s.applicant}>
        <span className={s.avatar} />
        <div className={s.who}>
          <div className={s.name}>{application.name}</div>
          <div className={s.where}>{application.location}</div>
        </div>
      </div>
    );
  }

  if (value == null || value === '') return <span className={s.blank}>—</span>;

  switch (column.cell) {
    case 'status': return <StatusBadge status={value} />;
    case 'tag':    return <span className={s.tag}>{value}</span>;
    case 'stage':  return <span className={s.stage}><span className={s.stageDot} />{value}</span>;
    case 'muted':  return <span className={s.muted}>{value}</span>;
    default:       return value;
  }
}

export default function ApplicationsRow({ application, columns, active, ticked, onSelect, onTick }) {
  return (
    <tr
      /* The keyboard navigation hook scrolls by this attribute — it needs a
         handle on the DOM node without the table holding refs to every row. */
      data-row-id={application.id}
      className={[s.row, active && s.rowActive, ticked && s.rowTicked].filter(Boolean).join(' ')}
      onClick={() => onSelect(application)}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(application); }
      }}
      aria-selected={active}
    >
      <td className={s.cell}>
        {/* Stops propagation: ticking a row for a bulk action must not also
            open it in the inspector. Two different intentions, two targets. */}
        <span
          role="checkbox"
          aria-checked={!!ticked}
          tabIndex={-1}
          className={`${s.check} ${ticked ? s.checkOn : ''}`}
          onClick={e => { e.stopPropagation(); onTick?.(application); }}
        >
          <Icon name="check" size={11} strokeWidth={2.6} />
        </span>
      </td>

      {columns.map(col => (
        <td
          key={col.key}
          /* Same class source as the header's <th> — see columnClass.js. */
          className={columnClass(col, s.cell)}
        >
          <Cell column={col} application={application} />
        </td>
      ))}

      {/* The row's own click opens the inspector, so everything in this cell
          stops propagation — opening a menu must never also change what the
          inspector is showing behind it. */}
      <td className={s.cell} onClick={e => e.stopPropagation()}>
        <Popover
          align="end"
          button={props => (
            <button
              {...props}
              type="button"
              className={s.menuBtn}
              aria-label={`Actions for ${application.name}`}
            >
              <Icon name="dots" size={16} />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuItem label="Open in inspector" icon="inbox"
                onClick={() => { onSelect(application); close(); }} />
              <MenuItem label="Message applicant" icon="messages" onClick={close} />
              <MenuDivider />
              <MenuItem label="Shortlist" icon="star"  onClick={close} />
              <MenuItem label="Accept"    icon="check" onClick={close} />
              <MenuItem label="Decline"   icon="cross" danger onClick={close} />
            </>
          )}
        </Popover>
      </td>
    </tr>
  );
}
