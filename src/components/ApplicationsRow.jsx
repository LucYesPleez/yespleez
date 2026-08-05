import Icon from './Icon';
import StatusBadge from './StatusBadge';
import s from './ApplicationsTable.module.css';

/**
 * One row of the applications list.
 *
 * Shares the table's CSS module rather than owning a second one: a row and
 * its header must agree on column widths, and two files is how they stop
 * agreeing.
 *
 * Presentational and controlled — it holds no state and decides nothing. The
 * table says whether it is selected; clicking asks the table to change that.
 */
export default function ApplicationsRow({ application, selected, onSelect }) {
  const { name, location, genre, country, stage, status, date } = application;

  return (
    <tr
      className={[s.row, selected && s.rowActive].filter(Boolean).join(' ')}
      onClick={() => onSelect(application)}
    >
      <td className={s.cell}>
        <span className={s.checkbox} />
      </td>

      <td className={s.cell}>
        <div className={s.applicant}>
          <span className={s.avatar} />
          <div className={s.who}>
            <div className={s.name}>{name}</div>
            <div className={s.where}>{location}</div>
          </div>
        </div>
      </td>

      <td className={`${s.cell} ${s.hideMd}`}>
        {genre && <span className={s.genre}>{genre}</span>}
      </td>

      <td className={`${s.cell} ${s.hideLg}`}>
        <span className={s.muted}>{country}</span>
      </td>

      <td className={`${s.cell} ${s.hideMd}`}>
        <span className={s.stage}>
          <span className={s.stageDot} />
          {stage}
        </span>
      </td>

      <td className={s.cell}>
        <StatusBadge status={status} />
      </td>

      <td className={`${s.cell} ${s.hideLg}`}>
        <span className={s.muted}>{date}</span>
      </td>

      <td className={s.cell}>
        <button
          className={s.menuBtn}
          type="button"
          aria-label="Row actions"
          onClick={e => e.stopPropagation()}
        >
          <Icon name="dots" size={16} />
        </button>
      </td>
    </tr>
  );
}
