// § 2 · Event Summary — Identity
//
// Spec: docs/event-page-layout-spec.md § 2
//
// The page's headline: status, title, when, where, genres. UNCONTAINED — it
// sits on the background rather than in a card, so it reads as the heading of
// the page rather than as one item among the containers below it.
//
// Degradation follows the ratified ladder (Part 0 of the redesign doc):
//   · title and date are load-bearing — their absence is a broken record (R4)
//   · status shows only for a known temporal state; upcoming gets no pill
//   · time renders start, or start–end, and NEVER invents "– Late"
//   · location degrades venue+locality → venue → locality → omit
//   · genres are chips at 1+, else omitted
//
// The Favourite lives here now, beside the title — moved out of the Decision
// block on 2026-08-01. It is still an event-level action, not an artefact-level
// one, so it still does not sit on an image: Collect (§ 9) remains the page's
// only image overlay.

import { formatDateRange } from '../../lib/dates';
import { deriveEventStatus, STATUS_LABEL } from './eventStatus';
import { HeartIcon, CalendarIcon, ClockIcon, PinIcon } from './eventIcons';
import s from './EventSummary.module.css';

export default function EventIdentity({
  name, when = {}, where = {}, genres = [], now,
  favourited = false, onToggleFavourite = null,
}) {
  const status = deriveEventStatus(when, now);

  const timeLabel = formatTime(when);
  const dateLabel = when.date ? formatDateRange(when.date, when.endDate) : null;
  const placeLabel = formatPlace(where);

  // R1 · unknown. A low-confidence date is rendered, but qualified — never
  // presented as fact alongside a confirmed one.
  const unconfirmed = when.confidence && when.confidence !== 'confirmed';

  return (
    <div className={s.identity}>
      {status && (
        <span className={`${s.statusPill} ${status === 'on-now' ? s.statusOnNow : s.statusPast}`}>
          <span className={s.statusDot} />
          {STATUS_LABEL[status]}
        </span>
      )}

      <div className={s.titleRow}>
        <h1 className={s.title}>{name}</h1>
        {onToggleFavourite && (
          <button
            className={s.heartBtn + (favourited ? ' ' + s.heartBtnOn : '')}
            onClick={onToggleFavourite}
            aria-pressed={favourited}
            aria-label={favourited ? 'Remove from favourites' : 'Add to favourites'}
          >
            <HeartIcon size={19} filled={favourited} />
          </button>
        )}
      </div>

      {(dateLabel || placeLabel) && (
        <div className={s.meta}>
          {dateLabel && (
            <div className={s.metaRow}>
              {/* Calendar for the date, clock for the time — two facts, two
                  icons. One clock leading both read as though the whole row
                  were a time. */}
              <CalendarIcon size={15} className={s.metaIcon} />
              <span>
                {dateLabel}
                {timeLabel && (
                  <>
                    {' · '}
                    <ClockIcon size={13} className={s.timeIcon} />
                    {timeLabel}
                  </>
                )}
                {unconfirmed && <span className={s.qualifier}> (unconfirmed)</span>}
              </span>
            </div>
          )}
          {placeLabel && (
            <div className={s.metaRow}>
              <PinIcon size={15} className={s.metaIcon} />
              <span>{placeLabel}</span>
            </div>
          )}
        </div>
      )}

      {genres.length > 0 && (
        <div className={s.genres}>
          {genres.map(g => <span className={s.genre} key={g}>{g}</span>)}
        </div>
      )}
    </div>
  );
}

// Start alone, or start–end. An end time that was never recorded is not
// rendered as "– Late": that is a claim about when the event finishes, and the
// page does not get to make it.
function formatTime({ startTime, endTime }) {
  if (!startTime) return null;
  return endTime ? `${startTime} – ${endTime}` : startTime;
}

function formatPlace({ venue, locality, state }) {
  const area = [locality, state].filter(Boolean).join(' ');
  if (venue && area) return `${venue}, ${area}`;
  return venue || area || null;
}
