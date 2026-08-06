import { Icon } from '../design-system';
import s from './EventSelector.module.css';

/**
 * WHICH EVENT you are working on.
 *
 * ⭐ THE TITLE IS THE EVENT, NOT THE FESTIVAL. This control switches events, so
 * it must name one — a selector titled with the organisation reads identically
 * in 2026 and 2027, and the organiser gets no confirmation that the switch they
 * just made took effect. The festival is the poster and the Festival screen;
 * the chrome answers "which year am I in".
 *
 * The whole block is the switch target, not just the chevron: the thing a
 * person wants to click is the name, and a 16px chevron beside a 21px title is
 * a smaller target than the title itself.
 *
 * ⭐ Applications-open state is shown here rather than buried in Settings.
 * "Are we still taking applications?" is the question an organiser asks most
 * often, and it should be answered by the chrome without navigating.
 *
 * ⚠ A festival with no events yet falls back to its own name and drops the
 * chevron, the status and the meta line — there is nothing to switch between
 * and nothing is open. Absent, not unknown.
 */
export default function EventSelector({ festivalName, event, dates, location, onSwitch, ...rest }) {
  if (!festivalName && !event) return null;

  return (
    // `rest` carries Popover's trigger props (ref, aria-expanded, onClick) so
    // the whole block opens the event menu rather than only the chevron.
    <button
      className={s.selector}
      type="button"
      onClick={onSwitch}
      aria-label={event ? 'Switch event' : 'No events yet'}
      {...rest}
    >
      <span className={s.poster} />
      <span className={s.body}>
        <span className={s.titleRow}>
          <span className={s.title}>{event ? event.name : festivalName}</span>
          {event && (
            <>
              <span className={s.chevron}><Icon name="chevron" size={16} /></span>
              <span className={`${s.status} ${event.applicationsOpen ? '' : s.closed}`}>
                <span className={s.dot} />
                {event.applicationsOpen ? 'Applications Open' : 'Applications Closed'}
              </span>
            </>
          )}
        </span>
        {/* Absent is not unknown: an event with no dates set yet shows no date
            line at all, rather than an icon beside an empty string. */}
        {event && (dates || location) && (
          <span className={s.meta}>
            {dates && (
              <span className={s.metaItem}><Icon name="calendar" size={13} />{dates}</span>
            )}
            {location && (
              <span className={s.metaItem}><Icon name="location" size={13} />{location}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}
