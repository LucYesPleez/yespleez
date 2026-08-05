import { Icon } from '../design-system';
import s from './FestivalSelector.module.css';

/**
 * Which festival — and which edition of it — you are working on.
 *
 * The whole block is the switch target, not just the chevron: the thing a
 * person wants to click is the festival's name, and a 16px chevron beside a
 * 21px title is a smaller target than the title itself.
 *
 * ⭐ Applications-open state is shown here rather than buried in Settings.
 * "Are we still taking applications?" is the question an organiser asks most
 * often, and it should be answered by the chrome without navigating.
 */
export default function FestivalSelector({ festival, onSwitch }) {
  if (!festival) return null;

  return (
    <button className={s.selector} type="button" onClick={onSwitch} aria-label="Switch festival or edition">
      <span className={s.poster} />
      <span className={s.body}>
        <span className={s.titleRow}>
          <span className={s.title}>{festival.name}</span>
          <span className={s.chevron}><Icon name="chevron" size={16} /></span>
          <span className={`${s.status} ${festival.applicationsOpen ? '' : s.closed}`}>
            <span className={s.dot} />
            {festival.applicationsOpen ? 'Applications Open' : 'Applications Closed'}
          </span>
        </span>
        {/* Absent is not unknown: a festival with no dates set yet shows no
            date line at all, rather than an icon beside an empty string. */}
        {(festival.dates || festival.location) && (
          <span className={s.meta}>
            {festival.dates && (
              <span className={s.metaItem}><Icon name="calendar" size={13} />{festival.dates}</span>
            )}
            {festival.location && (
              <span className={s.metaItem}><Icon name="location" size={13} />{festival.location}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}
