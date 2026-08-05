import Icon from '../components/Icon';
import s from './FestivalSelector.module.css';

/**
 * Identity block for the festival currently being worked on: artwork, name,
 * application state, dates and location.
 *
 * The chevron is the future edition/festival switcher. It is rendered and
 * inert — a control that will exist should hold its place rather than appear
 * later and move everything, and a missing control reads as a bug while a
 * quiet one reads as "not yet".
 */
export default function FestivalSelector({ festival }) {
  if (!festival) return null;

  return (
    <div className={s.selector}>
      <div className={s.poster} />
      <div className={s.body}>
        <div className={s.titleRow}>
          <span className={s.title}>{festival.name}</span>
          <button className={s.switch} type="button" aria-label="Switch festival" disabled>
            <Icon name="chevron" size={16} />
          </button>
          {festival.applicationsOpen && (
            <span className={s.status}>
              <span className={s.dot} />
              Applications Open
            </span>
          )}
        </div>
        <div className={s.meta}>
          <span className={s.metaItem}>
            <Icon name="calendar" size={13} />
            {festival.dates}
          </span>
          <span className={s.metaItem}>
            <Icon name="location" size={13} />
            {festival.location}
          </span>
        </div>
      </div>
    </div>
  );
}
