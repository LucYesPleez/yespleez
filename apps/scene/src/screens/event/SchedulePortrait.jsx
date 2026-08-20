// § 7 · SET TIMES — the public portrait projection.
//
// ⭐⭐ SAME CARDS, SAME INTERACTION, NEW DATA SOURCE (owner, 2026-08-20).
// This renders `SlotCard` — the card the app already has, with its artist
// imagery, time and duration block, label pill and chevron — and it stays
// INTERACTIVE. ⛔ There is no public card design and no read-only variant.
// ⭐⭐ MULTI-STAGE IS THE STAGE PAGER (owner, 2026-08-20, ratified from the
// harness prototype): each stage is the approved vertical timeline, stages
// swipe sideways as snap pages with the neighbour peeking, and rows align by
// TIME across stages so the peek is the comparison. Single-stage stays the
// full-width vertical list. The time-column grid this replaced is dead.
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
import { timeAxis, cellsForStage } from '../../lib/schedulePortrait';
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

          {/* ⭐⭐ TWO LAYOUTS, ONE PER DAY, chosen by the resolver's own shape:
              single-stage = the chronological list; multi-stage = the STAGE
              PAGER (ratified from the harness prototype, owner 2026-08-20).
              Days themselves ALWAYS stack vertically — each day carries its
              own pager, and only STAGES go sideways. */}
          {shape.showStages
            ? <StagePager day={day} allMixSlots={allMixSlots} />
            : <TimelineDay day={day} allMixSlots={allMixSlots} />}
        </Fragment>
      ))}
    </section>
  );
}

/** ⭐ THE CARD, once, for both layouts — `isHost={false}` removes the host
    operations because `SlotCard` renders a control only where its handler
    exists and none are passed. ⛔ NOT read-only: the row expands, the mix
    plays, and VIEW PROFILE reaches the artist when one exists. */
function Card({ entry, allMixSlots }) {
  return (
    <SlotCard
      slot={entry.slot}
      claim={entry.claim}
      isHost={false}
      allMixSlots={allMixSlots}
    />
  );
}

/** SINGLE STAGE — the chronological list. Full-width cards, the page's own
    scroll, ⛔ nothing added around them. */
function TimelineDay({ day, allMixSlots }) {
  const entries = (day?.stages?.[0]?.slots) || [];
  return (
    <>
      {entries.map(entry => (
        <div className={s.row} key={entry.slot.id}>
          <Card entry={entry} allMixSlots={allMixSlots} />
        </div>
      ))}
    </>
  );
}

/**
 * MULTI STAGE — THE STAGE PAGER (⭐⭐ ratified from the harness prototype,
 * owner, 2026-08-20: "the festival fixture is how I want the normal set times
 * to be standard if there's multiple stages"). It replaced a sideways grid of
 * time columns, which is dead — ⛔ do not bring it back.
 *
 * Each stage is the SAME vertical timeline single-stage gets — full-width
 * SlotCards, top to bottom. Stages sit side by side as SNAP PAGES at 86%
 * width, so ~12% of the neighbour peeks at the edge: the app's own part-card
 * idiom doing the "you can swipe" hinting. No arrows, no tutorial.
 *
 * ⭐⭐ ONE CSS GRID, ⛔ NOT THREE INDEPENDENT COLUMNS. Every stage's card for a
 * given time shares a GRID ROW, so rows align across stages and THE PEEK IS
 * THE COMPARISON: the sliver beside MAIN's 9:00 card is what is on next door
 * at 9:00, and a swipe lands you at the same moment of the night. That
 * alignment is the whole answer to "what's on the other stage right now" —
 * ⛔ do not swap this for per-stage scrollers, which lose it.
 *
 * ⚠ A TRUE GAP IS NOT AN OPEN SLOT. A stage with no slot at an axis time
 * holds its row open with a quiet hatched spacer naming the time — that is
 * "the organiser scheduled nothing here", information, not filler. An OPEN
 * SLOT is a real slot with nobody booked and renders as the card saying so.
 *
 * ⭐ Stage chips ride above, under the day chips' own law: lit by the
 * sideways SCROLL (not the click), tap to jump, ⛔ never a filter.
 */
function StagePager({ day, allMixSlots }) {
  const scrollerRef = useRef(null);
  const [activeStage, setActiveStage] = useState(0);
  const stages = (day?.stages || []).filter(Boolean);
  const axis = timeAxis(day);
  const cellsByStage = stages.map(st => cellsForStage(st, axis));

  const jumpTo = i => {
    const el = scrollerRef.current;
    if (!el) return;
    const col = el.firstElementChild?.getBoundingClientRect().width || 0;
    el.scrollTo({ left: i * (col + PAGER_GAP_PX), behavior: 'smooth' });
  };
  const onScroll = e => {
    const el = e.currentTarget;
    const col = el.firstElementChild?.getBoundingClientRect().width || 1;
    const i = Math.round(el.scrollLeft / (col + PAGER_GAP_PX));
    setActiveStage(prev => (prev === i ? prev : i));
  };

  return (
    <>
      <div className={s.days}>
        {stages.map((st, i) => (
          <button
            key={st.id ?? 'implicit'}
            className={`${s.dayBtn} ${i === activeStage ? s.dayBtnOn : ''}`}
            aria-current={i === activeStage ? 'true' : undefined}
            /* The stage's accent carries the identity while unlit; the lit
               chip goes plain so "where you are" reads the same for stages
               as it does for days. */
            style={i !== activeStage && st.accent ? { color: st.accent } : undefined}
            onClick={() => jumpTo(i)}
          >
            {st.name}
          </button>
        ))}
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={s.pager}
        style={{ gridTemplateColumns: `repeat(${stages.length}, 86%)` }}
      >
        {/* Row 0 — the stage headings, and the snap targets. ⚠ CELLS ARE
            DIRECT GRID CHILDREN, ⛔ never wrapped per stage: a wrapper gives
            each stage its own formatting context and the rows stop sharing
            heights, which silently deletes the time alignment. */}
        {stages.map(st => (
          <div key={'h' + (st.id ?? 'implicit')} className={s.stagePageHead}>
            <span
              className={s.stageName}
              style={st.accent ? { '--accent': st.accent } : undefined}
            >{st.name}</span>
            <div className={s.stageLine} />
          </div>
        ))}

        {axis.map((col, rowIdx) => (
          <Fragment key={col.key}>
            {stages.map((st, sIdx) => {
              const entry = cellsByStage[sIdx][rowIdx];
              return entry ? (
                <div key={(st.id ?? 'implicit') + col.key}>
                  <Card entry={entry} allMixSlots={allMixSlots} />
                </div>
              ) : (
                <div key={(st.id ?? 'implicit') + col.key} className={`${s.gap} ${s.gapCell}`}>
                  <span className={s.gapLabel}>{col.time} {col.ampm} · NOTHING ON</span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </>
  );
}

/** ⚠ Must match the pager's column-gap in the stylesheet — the snap math and
    the chip scroll-spy both divide by column + gap. */
const PAGER_GAP_PX = 10;
