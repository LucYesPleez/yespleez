// § 7 · SET TIMES — the public portrait projection.
//
// ⭐⭐ S3, the first projection of the canonical schedule. It reads
// `resolveSchedule` and NOTHING ELSE: no second grouping, no reshaping, no
// "just this once" transform in a render function. If this file ever needs a
// fact the resolver does not provide, the resolver gains it — that is the whole
// meaning of ONE SCHEDULING MODEL, MANY VIEWS (S2, ratified 2026-08-20).
//
// ⛔⛔ THIS IS NOT `DaySlots`. DaySlots is the HOST's surface: drag, fill, edit,
// remove, demote, pin, lock — a control panel that renders for a punter with
// every control nulled, which is why the public schedule has read like an admin
// screen. This is the public one. It has no handlers, no host state, and no
// concept of editing; ⛔ do not add one. The host editor keeps DaySlots
// unchanged.
//
// ── THE TWO PORTRAIT LAYOUTS ─────────────────────────────────────────
//
// ⭐ SINGLE STAGE → a chronological timeline. Time down the left, act beside
// it. That is the whole of a pub gig's schedule and it should look like it
// (brief §7): ⛔ no stage column, no horizontal scroll, no grid.
//
// ⭐ MULTI STAGE → time runs HORIZONTALLY across the top, stages run
// vertically down the side, and the schedule scrolls sideways through the
// evening (brief §5). The stage identity stays anchored while time moves,
// which is what lets somebody see where they are and what is next.
//
// ⛔ Landscape is NOT here (brief §6, S3 scope). It is a different projection
// of the same resolved object and lands separately.

import { useState, Fragment } from 'react';
import { scheduleShape } from '../../lib/scheduleModel';
import { portraitMode, timeAxis, cellsForStage, publicCell } from '../../lib/schedulePortrait';
import s from './SchedulePortrait.module.css';

function ActCard({ cell, onOpenArtist, compact = false }) {
  if (cell.kind === 'gap') return <div className={s.gap} aria-hidden="true" />;

  if (cell.kind === 'open' || cell.kind === 'pending') {
    return (
      <div className={`${s.card} ${s.cardQuiet} ${compact ? s.cardCompact : ''}`}>
        <span className={s.quietText}>
          {cell.kind === 'pending' ? 'PENDING' : 'OPEN'}
        </span>
        {cell.slot?.label && <span className={s.label}>{cell.slot.label}</span>}
      </div>
    );
  }

  const { claim, slot: slotRow } = cell;
  const profile = claim.profile || null;
  const avatar = profile?.avatar_thumb || profile?.avatar || null;
  /* ⛔ TAPPABLE ONLY WITH SOMEWHERE TO GO. A typed billing name has no profile
     behind it, and a card that highlights and does nothing is the dead
     affordance R3 forbids — it still renders, because the act is still playing. */
  const openable = !!(onOpenArtist && claim.profile_id);
  const Tag = openable ? 'button' : 'div';

  return (
    <Tag
      type={openable ? 'button' : undefined}
      className={`${s.card} ${openable ? s.cardOpenable : ''} ${compact ? s.cardCompact : ''}`}
      onClick={openable ? () => onOpenArtist(claim) : undefined}
    >
      {avatar
        ? <img className={s.avatar} src={avatar} alt="" loading="lazy" />
        : <span className={`${s.avatar} ${s.avatarFallback}`} aria-hidden="true">
            {String(claim.name || '?').trim().charAt(0).toUpperCase()}
          </span>}
      <span className={s.cardText}>
        <span className={s.name}>{claim.name}</span>
        {slotRow?.label && <span className={s.label}>{slotRow.label}</span>}
      </span>
    </Tag>
  );
}

export default function SchedulePortrait({ resolved, onOpenArtist = null }) {
  const shape = scheduleShape(resolved);
  const [dayIdx, setDayIdx] = useState(0);

  /* R1 · absent. No schedule is not an empty grid with nothing in it. */
  if (!shape.hasSchedule) return null;

  const days = resolved.days || [];
  const day = days[Math.min(dayIdx, days.length - 1)] || days[0];
  const mode = portraitMode(resolved);

  return (
    <section className={s.schedule}>
      <div className={s.head}>
        <h2 className={s.heading}>SET TIMES</h2>
        {/* ⚠ The count is SLOTS, and it is the day's, not the event's — a
            reader looking at Sunday is not helped by Saturday's total. */}
        <span className={s.count}>
          {(day?.stages || []).reduce((n, st) => n + (st.slots?.length || 0), 0)}
        </span>
      </div>

      {shape.showDayPicker && (
        <div className={s.days} role="tablist" aria-label="Schedule day">
          {days.map((d, i) => (
            <button
              key={d.dayIndex}
              role="tab"
              aria-selected={i === dayIdx}
              className={`${s.dayBtn} ${i === dayIdx ? s.dayBtnOn : ''}`}
              onClick={() => setDayIdx(i)}
            >
              {/* ⚠ The day's own name when it has one, else its date, else its
                  ordinal. ⛔ Never "Day undefined": a day with an unparseable
                  event date still has to say something. */}
              {d.name || d.date || `DAY ${d.dayIndex + 1}`}
            </button>
          ))}
        </div>
      )}

      {mode === 'timeline' ? (
        <TimelineDay day={day} onOpenArtist={onOpenArtist} />
      ) : (
        <StageGridDay day={day} onOpenArtist={onOpenArtist} />
      )}
    </section>
  );
}

/** SINGLE STAGE — a chronological list. Time left, act beside it. */
function TimelineDay({ day, onOpenArtist }) {
  const entries = (day?.stages?.[0]?.slots) || [];
  return (
    <div className={s.timeline}>
      {entries.map(entry => {
        const cell = publicCell(entry);
        return (
          <div className={s.row} key={entry.slot.id}>
            <div className={s.time}>
              <span className={s.timeNum}>{entry.slot.time}</span>
              <span className={s.timeAmPm}>{entry.slot.ampm}</span>
            </div>
            <div className={s.rowCard}>
              <ActCard cell={cell} onOpenArtist={onOpenArtist} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * MULTI STAGE — time across the top, stages down the side, scrolling sideways.
 *
 * ⚠ THE STAGE COLUMN IS STICKY, and that is the mechanism the whole layout
 * depends on: the reader must not lose which row they are reading while the
 * evening scrolls past. `position: sticky; left: 0` inside the scroller.
 */
function StageGridDay({ day, onOpenArtist }) {
  const axis = timeAxis(day);
  return (
    <div className={s.gridScroll}>
      <div className={s.grid} style={{ '--cols': axis.length }}>
        <div className={`${s.gridCell} ${s.stageHead} ${s.axisHead}`} />
        {axis.map(col => (
          <div className={`${s.gridCell} ${s.axisHead}`} key={col.key}>
            <span className={s.timeNum}>{col.time}</span>
            <span className={s.timeAmPm}>{col.ampm}</span>
          </div>
        ))}

        {/* ⚠⚠ CELLS ARE DIRECT GRID CHILDREN — ⛔ never wrapped in a row div.
            A wrapper makes each stage its own formatting context, so the
            columns stop sharing a track and the sticky stage cell has nothing
            to stick within. The row structure is expressed by the column
            count, not by nesting. */}
        {(day?.stages || []).map(stage => (
          <Fragment key={stage.id ?? 'implicit'}>
            <div
              className={`${s.gridCell} ${s.stageHead}`}
              style={stage.accent ? { '--accent': stage.accent } : undefined}
            >
              <span className={s.stageName}>{stage.name}</span>
            </div>
            {cellsForStage(stage, axis).map((entry, i) => (
              <div className={s.gridCell} key={axis[i].key}>
                <ActCard cell={publicCell(entry)} onOpenArtist={onOpenArtist} compact />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
