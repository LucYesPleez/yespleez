// § 7 · SET TIMES — the public portrait projection.
//
// ⭐⭐ SAME CARDS, SAME INTERACTION, NEW DATA SOURCE (owner, 2026-08-20).
// This renders `SlotCard` — the card the app already has, with its artist
// imagery, time and duration block, label pill and chevron — and it stays
// INTERACTIVE. ⛔ There is no public card design, no read-only variant, and
// ⛔⛔ NO REDUCED-WIDTH CARD ANYWHERE (owner, same day): an earlier draft laid
// multi-stage out as a sideways grid of 236px columns, and the owner stopped
// it on sight. The schedule scrolls DOWN the page at full width.
//
// ⭐⭐ EVERY DAY IS ON THE PAGE, IN ORDER (owner, 2026-08-20). Saturday flows
// straight into Sunday under a day heading — ⛔ the days are NOT tabbed panels.
// The owner's reason is the closing set: a night that ends at 1:00 AM puts its
// final act on the NEXT day's slot list (Solstice's 12:00 AM Lounge Sessions
// is Sunday's row 10), so a tab boundary would hide the end of Saturday night
// behind a click — one act, alone, on its own page. The day buttons are
// QUICK-JUMPS that scroll, ⛔ never filters that hide.
//
// ── THE SHAPE ────────────────────────────────────────────────────────
//
//   day jump buttons (only when there is more than one day)
//   SATURDAY ───────────────
//   full-width SlotCard …
//   SUNDAY ─────────────────
//   full-width SlotCard …
//   …one vertical scroll, the page's own.
//
// ⭐ WHAT THIS COMPONENT ACTUALLY IS: a projection of `resolveSchedule`. It
// decides how days and stages are sectioned. ⛔ It does not group rows, and
// ⛔ it does not decide what a card looks like — SlotCard owns that, including
// what a punter may see (draft = open, unconfirmed = PENDING).
//
// ⛔ Landscape is NOT here (brief §6) — a different projection of the same
// resolved object; `lib/schedulePortrait.js` holds the axis machinery it needs.

import { useRef, useState, useEffect, Fragment } from 'react';
import { scheduleShape } from '../../lib/scheduleModel';
import SlotCard from './SlotCard';
import s from './SchedulePortrait.module.css';

/** ⚠ Name first, date second, ordinal last — never "Day undefined". */
function dayLabel(d) {
  return d.name || d.date || `DAY ${d.dayIndex + 1}`;
}

/* Where a day heading counts as "reached": just under the app's fixed header.
   ⚠ Must stay in step with `scroll-margin-top` in the stylesheet, or a jump
   lands on a day whose chip does not light. */
const DAY_REACHED_PX = 96;

export default function SchedulePortrait({ resolved, allMixSlots = [] }) {
  const shape = scheduleShape(resolved);
  const dayRefs = useRef({});
  const days = resolved?.days || [];

  /**
   * ⭐ THE CHIP SAYS WHERE YOU ARE, ⛔ IT NEVER DECIDES WHAT YOU SEE (owner,
   * 2026-08-20 — "the chip for Sunday can be there to let you know you're
   * looking at Sunday, but I don't want that to be the only way to see it").
   * Every day is always on the page; the highlighted chip just tracks the
   * scroll. The last day whose heading has passed the header line is current.
   */
  const [activeDay, setActiveDay] = useState(days[0]?.dayIndex ?? 0);
  /* ⚠ Depends on `resolved?.days`, ⛔ not the `days` const above — that one
     carries a `|| []` fallback which mints a fresh array whenever the schedule
     is absent, so the effect would re-subscribe every render. Same lesson as
     the schedule memo in useEventData. */
  useEffect(() => {
    const list = resolved?.days || [];
    if (list.length < 2) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      let current = list[0]?.dayIndex ?? 0;
      for (const d of list) {
        const el = dayRefs.current[d.dayIndex];
        if (el && el.getBoundingClientRect().top <= DAY_REACHED_PX) current = d.dayIndex;
      }
      setActiveDay(prev => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [resolved?.days]);

  /* R1 · absent. No schedule is not an empty section with nothing in it. */
  if (!shape.hasSchedule) return null;

  return (
    <section className={s.schedule}>
      <div className={s.head}>
        <h2 className={s.heading}>SET TIMES</h2>
        {/* The whole event's count — every day is on this page. */}
        <span className={s.count}>{resolved.slotCount}</span>
      </div>

      {shape.showDayPicker && (
        <div className={s.days}>
          {days.map(d => (
            <button
              key={d.dayIndex}
              className={`${s.dayBtn} ${d.dayIndex === activeDay ? s.dayBtnOn : ''}`}
              aria-current={d.dayIndex === activeDay ? 'true' : undefined}
              /* ⭐ A JUMP, ⛔ NOT A FILTER. It scrolls the day's heading into
                 view; every other day stays exactly where it was. The lit
                 state comes from the SCROLL, not the click — so it stays
                 honest when the reader scrolls there themselves. */
              onClick={() => dayRefs.current[d.dayIndex]
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {dayLabel(d)}
            </button>
          ))}
        </div>
      )}

      {days.map(day => (
        <Fragment key={day.dayIndex}>
          {/* ⚠ The divider only when there is a second day to divide from —
              a single-night gig gets no heading over its own schedule. */}
          {days.length > 1 && (
            <div
              className={s.dayDivider}
              ref={el => { dayRefs.current[day.dayIndex] = el; }}
            >
              <span className={s.dayName}>{dayLabel(day)}</span>
              <div className={s.dayLine} />
            </div>
          )}

          {(day.stages || []).map(stage => {
            /* ⚠ A stage with nothing on THIS day contributes nothing here — a
               heading over an empty stretch is a visual hole, and a vertical
               stack has no columns that need holding open. */
            if (!stage.slots?.length) return null;
            return (
              <Fragment key={stage.id ?? 'implicit'}>
                {/* ⭐ Stage headings exist only on a multi-stage event —
                    `shape.showStages` is the resolver's own answer, and one
                    named stage is still single-stage. */}
                {shape.showStages && (
                  <div className={s.stageDivider}>
                    <span
                      className={s.stageName}
                      style={stage.accent ? { '--accent': stage.accent } : undefined}
                    >{stage.name}</span>
                    <div className={s.stageLine} />
                  </div>
                )}
                {stage.slots.map(entry => (
                  <div className={s.row} key={entry.slot.id}>
                    {/* ⭐ ONE CARD, EVERYWHERE, FULL WIDTH. `isHost={false}`
                        removes the host operations because `SlotCard` renders
                        a control only where its handler exists and none are
                        passed. ⛔ That is NOT read-only: the row expands, the
                        mix plays, and VIEW PROFILE reaches the artist when one
                        exists. */}
                    <SlotCard
                      slot={entry.slot}
                      claim={entry.claim}
                      isHost={false}
                      allMixSlots={allMixSlots}
                    />
                  </div>
                ))}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </section>
  );
}
