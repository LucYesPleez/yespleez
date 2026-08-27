// EP-00d · the day + slot list, shared by the public view and the host editor.
//
// Extracted verbatim. The difference between "punter reading the set times" and
// "host dragging them around" is entirely in the props: without `editable`
// there is no DndContext at all, and without `isHost` every action handler is
// null. Nothing here reads session or host state directly.
import { useState, useRef, useLayoutEffect, Fragment } from 'react';
/* ⭐ SHARED TEMPORAL GEOMETRY, and nothing else. The public schedule grows its
   own markup from these same functions, so the two projections cannot disagree
   about which row a set belongs on. ⛔ No component is shared between them. */
import { slotGrid, stageGaps, nearestCentred, centreOn } from '../../lib/schedulePortrait';
import { useDragScroll } from '../../hooks/useDragScroll';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay,
} from '@dnd-kit/core';
/* ⛔⛔ NO `SortableContext` (owner, 2026-08-16). A sortable exists to reorder a
   LIST; these are FIXED TIME SLOTS and never reorder. Its per-item transforms
   were the source of every drop artefact chased today — snap-back, replay,
   bounce. ⛔ Do not reintroduce it "for the animation". */
import { supabase } from '../../lib/supabase';
import SlotCard from './SlotCard';
import s from '../EventScreen.module.css';

/**
 * ⭐⭐ THE HOST'S STAGE PAGER. Stages sit SIDE BY SIDE as snap pages with the
 * neighbour peeking, and rows align by TIME across them so the peek is the
 * comparison — the multi-stage design ratified 2026-08-20.
 *
 * ⛔⛔ THIS IS THE HOST PROJECTION, ⛔ NOT `SchedulePortrait`. That component is
 * the ratified READ-ONLY projection and stays untouched: it hardwires
 * `isHost={false}`, while every host verb and the whole drag-and-drop live
 * here. Threading host editing through the public schedule would make the
 * punter's page responsible for the organiser's behaviour.
 *
 * ⭐ WHAT IS GENUINELY SHARED is the temporal geometry, and only that:
 * `timeAxis`, `cellsForStage` and the three measurement helpers in
 * `lib/schedulePortrait.js`. So the two projections cannot disagree about which
 * row a 9:00 PM set belongs on, while sharing no markup and no stylesheet.
 *
 * ⚠⚠ CELLS ARE DIRECT GRID CHILDREN, ⛔ never wrapped per stage. A wrapper gives
 * each stage its own formatting context, the rows stop sharing heights, and the
 * time alignment silently disappears — the layout still looks plausible, which
 * is what makes it dangerous.
 */
function StagePages({ stages, renderCell, dayKey, sync }) {
  const drag = useDragScroll();
  const scrollerRef = drag.ref;
  const active = sync.index;

  /**
   * ⚠⚠ TWO SHAPES MEET HERE, and this is the whole adapter.
   *
   * `timeAxis` and `cellsForStage` were written for `resolveSchedule`, whose
   * stage slots are ENTRIES — `{ slot, claim }`. This component's stages come
   * from `groupSlotsIntoDays`, whose slots are the render slots themselves.
   * Passing the latter straight in read `entry.slot.time` off a plain slot and
   * threw `Cannot read properties of undefined`.
   *
   * ⭐ Wrapping here rather than changing the shared functions keeps the public
   * projection's contract exactly as it was. ⛔ Do not "simplify" this by
   * making the geometry tolerate two shapes — one of them would then be
   * undocumented, and the next caller would pick the wrong one.
   */
  const paged = stages.map(st => ({
    ...st,
    slots: (st.slots || []).map(sl => (sl && sl.slot ? sl : { slot: sl })),
  }));
  /**
   * ⭐⭐ A CONTINUOUS 15-MINUTE GRID, ⛔ not a row per start time. Each card
   * occupies the intervals it actually runs for — an hour is 4, ninety minutes
   * is 6 — so the running order reads as a shape and length on the page is
   * length in the room.
   *
   * ⚠ It also removes every "nothing on" filler. Those existed only to hold
   * columns aligned when one stage started at an hour another did not; on a
   * continuous grid an empty interval is simply empty.
   */
  const grid = slotGrid({ stages: paged }, 15);
  /* ⭐ The stretches with nothing programmed, ONE card per stretch.
     ⛔ NOT after the last act: a blank under the stage close reads as time
     still to fill. A stage that never ran at all keeps its blank. */
  const gaps = stageGaps(grid, { includeTrailing: false });

  const heads = () => Array.from(
    scrollerRef.current?.querySelectorAll(`.${s.stagePageHead}`) || []);

  const jumpTo = i => {
    sync.set(i, dayKey);
    centreOn(scrollerRef.current, heads()[i]);
  };

  /**
   * ⭐⭐ ONE STAGE ACROSS THE WHOLE EVENT. Swiping any day moves every day, so
   * the rooms stay stacked under one another and the festival reads down a
   * single column. ⛔ A per-day stage would mean page 2 is the DJ stage on
   * Friday and the workshops on Sunday, which is what "only Saturday moved"
   * looked like.
   */
  /**
   * ⛔⛔ A PAGER BEING SCROLLED BY THE SYNC MUST NEVER BROADCAST. This is the
   * whole cure for the pagers bouncing back and forth.
   *
   * ⚠⚠ WHAT WENT WRONG: excluding only the INITIATOR is not enough. The other
   * days smooth-scroll, their own `onScroll` fires part-way through that
   * animation, and mid-flight the nearest page is still the OLD one — so they
   * broadcast it, `from` flips to them, the day under the hand stops being
   * excluded, and it gets dragged back. Then it re-broadcasts. That is the
   * oscillation, and it is self-sustaining.
   *
   * ⭐ So a programmatic scroll is flagged, and the flag suppresses broadcasting
   * until the page actually arrives. ⛔ Do not replace this with a timer: the
   * smooth scroll has no fixed duration, and a timeout either cuts it off or
   * leaves the pager mute.
   */
  const programmatic = useRef(false);

  const onScroll = () => {
    const next = nearestCentred(scrollerRef.current, heads());
    if (programmatic.current) {
      if (next === sync.index) programmatic.current = false;   // arrived
      return;
    }
    if (next !== sync.index) sync.set(next, dayKey);
  };

  /* ⭐ THE HAND ALWAYS WINS. Touching a pager cancels its programmatic flag, so
     a sync that is still settling can never swallow a real swipe — and a flag
     left stranded by an interrupted animation cannot mute the pager forever. */
  const takeOver = () => { programmatic.current = false; };

  /**
   * ⚠⚠ THE INITIATOR IS EXCLUDED, and that is what stops a feedback loop. The
   * day under the hand is already where it should be; scrolling it again from
   * here fights the drag, and its own `onScroll` would then re-broadcast and
   * yank every other day back. ⛔ Never sync the pager that reported the change.
   */
  useLayoutEffect(() => {
    if (sync.from === dayKey) return;
    const el = scrollerRef.current;
    const head = heads()[sync.index];
    if (!el || !head) return;
    if (nearestCentred(el, heads()) === sync.index) { programmatic.current = false; return; }
    programmatic.current = true;
    centreOn(el, head);
  }, [sync.index, sync.from, dayKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⭐⭐ SNAP IS SUSPENDED FOR THE LENGTH OF A DRAG, AND ⛔ ONLY A DRAG.
   * `scroll-snap-type: x mandatory` re-snaps after every write to `scrollLeft`,
   * so the drag hook's 1:1 tracking gets yanked back on every mousemove and the
   * pager reads as immovable. ⭐ Restoring it IS the release animation: the
   * browser settles to the nearest page itself, so there is no easing code of
   * our own and no half-stage resting state to design around.
   */
  const suspend = () => { if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = 'none'; };
  const restore = () => { if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = ''; };

  return (
    <>
      <div className={s.stageChips}>
        {stages.map((st, i) => (
          <button
            key={st.id ?? 'implicit'}
            type="button"
            className={`${s.stageChip} ${i === active ? s.stageChipOn : ''}`}
            aria-current={i === active ? 'true' : undefined}
            onClick={() => jumpTo(i)}
          >
            {st.name || 'STAGE'}
          </button>
        ))}
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        /* ⭐ Every way a human can start moving this thing clears the flag:
           mouse, finger and wheel. ⛔ Missing one of them leaves that input
           unable to change the stage while a sync is settling. */
        onWheel={takeOver}
        onTouchStart={takeOver}
        onPointerDown={takeOver}
        onMouseDown={e => { suspend(); takeOver(); drag.onMouseDown(e); }}
        onMouseUp={e => { drag.onMouseUp(e); restore(); }}
        onMouseMove={drag.onMouseMove}
        /* ⚠ Leaving the scroller ends the drag (the hook's own rule), so snap
           has to come back here too, or dragging out leaves it permanently
           unsnapped and every later swipe rests mid-stage. */
        onMouseLeave={e => { drag.onMouseLeave(e); restore(); }}
        className={s.stagePager}
        /* ⚠⚠ EVERY CELL IS PLACED EXPLICITLY, so there is no auto-flow to fight
           and no filler to invent. Row 1 is the headings; the slot rows are the
           day's intervals. ⛔ Do not add `grid-auto-flow`: a card that failed to
           set its own row would then silently land wherever there was space. */
        style={{
          gridTemplateColumns: `repeat(${stages.length}, 88%)`,
          /* ⚠⚠ `minmax(interval, auto)`, ⛔ NOT a fixed interval. An interval is
             the MINIMUM height of a row, not its ceiling. With a fixed height an
             expanded card had nowhere to grow and rendered ON TOP of the act
             below it.
             ⭐ Rows are shared by every column, so a row that grows pushes the
             rest of the schedule down in ALL stages at once — the alignment
             survives expansion instead of being broken by it. */
          gridTemplateRows: `auto repeat(${grid.rows}, minmax(var(--slot-interval), auto))`,
        }}
      >
        {stages.map((st, i) => (
          <div
            key={'h' + (st.id ?? 'implicit')}
            className={s.stagePageHead}
            style={{ gridRow: 1, gridColumn: i + 1 }}
          >
            <span className={s.stagePageName}>{st.name || 'STAGE'}</span>
          </div>
        ))}

        {/* ⭐⭐ AN EMPTY STRETCH IS AN EMPTY CARD, ⛔ not a texture behind the column.
            A quiet two hours reads as one blank card sitting in the running
            order, the same shape as the cards either side of it.
            ⛔ ONE PER STRETCH, ⛔ never one per interval — eight stacked tiles
            for a quiet two hours is the 'nothing on' filler this grid removed.
            ⛔ It carries NO time and NO text: the cards either side already say
            when the gap is. */}
        {gaps.map((runs, i) => runs.map(run => (
          <div
            key={'gap' + i + '-' + run.row}
            aria-hidden="true"
            className={s.stagePageFill}
            style={{ gridColumn: i + 1, gridRow: `${run.row + 1} / span ${run.span}` }}
          />
        )))}

        {stages.map((st, sIdx) => (
          <Fragment key={'c' + (st.id ?? 'implicit')}>
            {grid.stages[sIdx].map(cell => (
              <div
                key={cell.entry.slot.id}
                /**
                 * ⭐ TWO DEGREES OF SHORT, because they are two different
                 * problems. ⛔ Not a fixed pixel height: change
                 * `--slot-interval` and these still mean "under an hour" and
                 * "half an hour or less".
                 *
                 *   short (< 4 intervals)  the padding gives way and the
                 *                          contents centre. Everything is still
                 *                          said.
                 *   tiny  (<= 2 intervals) there is genuinely no room, so AM/PM
                 *                          and the length come off.
                 *
                 * ⚠⚠ ONE RULE WAS NOT ENOUGH. `span < 4` stripped the length
                 * from a 40 minute set as well as a 30 minute one, and a 40
                 * minute card is 3 intervals with room to spare.
                 */
                className={[
                  s.stagePageCell,
                  cell.span < 4 ? s.stagePageCellShort : '',
                  cell.span <= 2 ? s.stagePageCellTiny : '',
                ].filter(Boolean).join(' ')}
                /* ⭐ `+ 1` for the heading row. ⛔ The span is the set's real
                   length: a 90 minute act is genuinely taller than an hour one,
                   which is the whole point of the grid. */
                /* ⚠⚠ THE HEIGHT IS SET IN PIXELS HERE, ⛔ not with `height: 100%`.
                   The rows are `minmax(interval, auto)` so a card can grow when
                   it expands — which makes the row height INDEFINITE, and a
                   percentage height against an indefinite parent is ignored. The
                   cards silently fell back to their natural 88px and every set
                   looked an hour long again. A `calc` off the interval is the
                   same number, expressed so it always resolves. */
                style={{
                  gridRow: `${cell.row + 1} / span ${cell.span}`,
                  gridColumn: sIdx + 1,
                  minHeight: `calc(var(--slot-interval) * ${cell.span})`,
                }}
              >
                {renderCell(cell.entry.slot)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  );
}

export default function DaySlots({
  eventId, days, claims, allMixSlots,
  isHost = false, editable = false, isLocked = false, viewerProfileId = null,
  onFill, onEdit, onRemove, onDemote, onPin, onNotify, onChanged, onLocalMove,
}) {
  /**
   * ⭐⭐ `onChanged` — HOW THE CALLER REFRESHES ITSELF AFTER A DRAG.
   *
   * ⛔⛔ THIS COMPONENT USED TO ASSUME ITS CONSUMER'S CACHE. Every path below
   * read and invalidated `['event', eventId]`, which is the EVENT PAGE's key.
   * The dashboard keys on `['hostDashboard', userId]` and its own `lineups`
   * state, so on that screen the optimistic update found no cache to patch and
   * the invalidation refreshed nothing anybody was reading: the row animated,
   * snapped back, and looked like a failed write.
   *
   * ⚠ That is the CONSUMER-IDENTITY RULE — a shared component learning about
   * one consumer is a finding, not a detail. The event-page cache work stays
   * (it is that page's, and it is what makes the drag feel instant), but a
   * second consumer now has a way to say "and refresh me too".
   */
  const queryClient = useQueryClient();
  const [activeSlotId, setActiveSlotId] = useState(null);
  /* ⛔ `justDropped` is GONE with the sortable transforms it existed to
     suppress. Nothing animates on drop any more, so there is nothing to
     exempt the dropped card from. */

  /**
   * ⭐⭐ FLIP — the DISPLACED act travels to its new slot.
   *
   * ⚠⚠ THE ROWS DO NOT MOVE, so this cannot be a layout animation. When Madds
   * lands on Elbow's slot, Elbow does not slide anywhere — its NAME simply
   * appears in a different fixed cell, which reads as teleporting.
   *
   * ⭐ So: measure each act's rectangle BEFORE the swap, and after the swap put
   * it back where it was with a transform and release it. The act appears to
   * travel between cells while the cells themselves never budge.
   *
   * ⛔ THE DROPPED ACT IS EXCLUDED (`skipClaimId`). It is already under the
   * pointer where it was let go; animating it from its old slot is exactly the
   * "goes back and flicks to the new spot" this whole rebuild removed.
   */
  const nodeRefs   = useRef({});   // slotId → the row element
  const pendingFlip = useRef(null); // { rects: {claimId: DOMRect}, skipClaimId }

  useLayoutEffect(() => {
    const pending = pendingFlip.current;
    if (!pending) return;
    pendingFlip.current = null;

    for (const [slotId, el] of Object.entries(nodeRefs.current)) {
      const claimId = claims[slotId]?.id;
      if (!el || !claimId || claimId === pending.skipClaimId) continue;
      const before = pending.rects[claimId];
      if (!before) continue;
      const dy = before.top - el.getBoundingClientRect().top;
      /* ⚠ Sub-pixel drift is not a move. */
      if (Math.abs(dy) < 1) continue;

      /* ⚠ Put it back, THEN release it on the next frame — a transform and its
         transition applied in the same frame animate from nothing. */
      el.style.transition = 'none';
      el.style.transform  = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .38s cubic-bezier(.22, .9, .3, 1)';
        el.style.transform  = '';
      });
    }
  }, [claims]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  /**
   * ⛔⛔ WRITES `slot_uuid`, ⛔ NOT `slot_id`.
   *
   * ⚠⚠ Both columns exist (§8 item 15: transitional, kept in sync by
   * `trg_performances_sync_slot_uuid`), but `slot_uuid` is the REAL FK and it
   * is what `indexPerformances` and every read key on. `slot_id` is the legacy
   * TEXT key — the blob keys like `sat_1` — so the old code here was writing a
   * UUID into the legacy text column and hoping the trigger sorted it out.
   *
   * ⛔ Do not "restore" the slot_id write. If a row's two columns disagree,
   * the read follows `slot_uuid` and the drag appears to have done nothing.
   */
  /**
   * ⭐⭐ WRITES EVERY ACT WHOSE SLOT ACTUALLY CHANGED — one row, or five.
   *
   * ⚠⚠ This replaced a two-row SWAP. A shuffle moves an arbitrary number of
   * acts, so the write follows the plan rather than assuming a pair.
   *
   * ⛔ Only genuinely moved rows are touched — writing the whole day on every
   * drag would stamp `updated_at` on performances nobody moved.
   *
   * ⚠ Issued in parallel: `lineup_members` has no uniqueness constraint on the
   * slot, so an intermediate state with two acts on one slot is legal and
   * transient. ⛔ Serialising them would not make it safer, only slower.
   */
  async function persistReorder(ids, nextBySlot, prevSlotOfClaim) {
    const updates = [];
    ids.forEach(sid => {
      const c = nextBySlot[sid];
      if (c?.id && prevSlotOfClaim[c.id] !== sid) updates.push({ performanceId: c.id, slotId: sid });
    });

    const results = await Promise.all(updates.map(u =>
      supabase.from('performances').update({ slot_uuid: u.slotId }).eq('id', u.performanceId),
    ));

    /**
     * ⚠⚠ THIS ONE SURVIVES, BUT ONLY WHEN THERE IS SOMETHING TO SAY.
     *
     * ⛔ An RLS-filtered UPDATE returns NO error and changes NOTHING, so a null
     * error is ⛔ not proof the write landed — but a non-null one IS proof it
     * did not, and that was invisible for most of a day.
     *
     * ⚠ It was an unconditional `console.log` on every drag, which is noise in
     * a production console and is why it read as leftover instrumentation. ⭐
     * `console.warn` only when a write actually reported failure: silent on the
     * happy path, loud on the one that cost a day.
     */
    const writeErrors = results.map(r => r.error?.message).filter(Boolean);
    if (writeErrors.length) {
      console.warn('[YesPleez] set-times reorder: some rows did not save', {
        moved: updates.length, errors: writeErrors,
      });
    }

    queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    onChanged?.();
  }

  const id = eventId;
  const effectiveIsHost = isHost;
  const showEditor = editable;

  /**
   * ⭐⭐ THE STAGE IS AN EVENT-WIDE CHOICE, ⛔ NOT A PER-DAY ONE. Every day
   * renders the same stages in the same order, so one index positions all of
   * them and the rooms line up under each other down the page.
   *
   * `from` records WHICH day reported the change, so that day can be left alone
   * while the others follow it. Without it the pager under the hand gets
   * scrolled by its own broadcast.
   */
  const [stageSync, setStageSync] = useState({ index: 0, from: null });
  const sync = {
    index: stageSync.index,
    from: stageSync.from,
    set: (index, from) => setStageSync(prev => (
      prev.index === index && prev.from === from ? prev : { index, from })),
  };

  /**
   * ⭐⭐ ONE BLOCK PER (DAY, STAGE). `groupSlotsIntoDays` nests stages inside a
   * day — the shape `resolveSchedule` uses and the shape the ratified stage
   * PAGER needs — while this component still renders a flat list of blocks and
   * therefore needs no stage logic of its own. That is what keeps its
   * drag-and-drop, its FLIP measuring and its reorder untouched.
   *
   * ⚠ A day with no `stages` (every single-stage event, which is almost all of
   * them) passes through as itself, so nothing about those changes at all.
   *
   * ⚠⚠ THIS IS NOT THE PAGER YET. Ratified 2026-08-20: stages sit SIDE BY SIDE
   * as snap pages with the neighbour peeking, rows aligned by time. These are
   * stacked blocks. They read correctly and in the right order; they are not
   * the approved layout, and ⛔ this note stays until they are.
   */
  return days.map((day, di) => {
    const slots = day.slots || [];

    /**
     * ⭐⭐ THE STAGES OF THIS DAY, as pages. `groupSlotsIntoDays` nests them
     * inside the day; ⛔ this never reconstructs them from `stage_id`.
     *
     * ⚠ A day with no stages becomes ONE unnamed page, so everything below has
     * a single shape to render and the single-stage path is not a branch that
     * can drift — it is the same code with one page.
     */
    const stages = day.stages?.length
      ? day.stages
      : [{ id: null, name: '', accent: null, slots }];
    const single = stages.length <= 1;

    /**
     * ⭐⭐ ONE DEFINITION OF A HOST SLOT CARD, spread at every call site.
     *
     * ⚠⚠ IT USED TO BE INLINED TWICE, and the pager would have made three. The
     * two copies had already drifted — the read-only branch guards its handlers
     * with `effectiveIsHost &&` and the sortable branch does not — and this file
     * already carries a note that inlining at a call site is where both of its
     * handler defects lived. ⛔ Do not expand this back out.
     *
     * ⛔⛔ `&& onX` IS LOAD BEARING. Wrapping a handler that was never passed
     * hands SlotCard a truthy function, so the button renders and pressing it
     * calls `undefined(slot)` and THROWS. ⭐ It composes with SlotCard's rule
     * that a control exists only where its verb does, which is what lets the
     * dashboard ask for EDIT SLOT and nothing else.
     *
     * ⛔⛔ `isLocked` DOES NOT NULL THESE (owner, 2026-08-16). SlotCard renders a
     * control only where its handler exists, so nulling them here deleted the
     * buttons before the muting rule could grey them. `locked` is passed
     * separately: the handler says the verb EXISTS, the flag says it is not
     * available right now. ⛔ Two different questions.
     */
    const hostSlotProps = slot => ({
      slot,
      claim: claims[slot.id],
      isHost: effectiveIsHost,
      viewerProfileId,
      locked: isLocked,
      allMixSlots,
      onFill:   effectiveIsHost && onFill   ? () => onFill(slot)   : null,
      /* ⭐ P6.3 · sending is a WORKSPACE act, so only the event page passes this.
         ⛔ The dashboard leaves it undefined and the chip stays a chip. */
      onNotify: effectiveIsHost && onNotify ? () => onNotify(slot) : null,
      onEdit:   effectiveIsHost && onEdit   ? () => onEdit(slot)   : null,
      onRemove: effectiveIsHost && onRemove ? () => onRemove(slot) : null,
      /* ⭐ CLEAR SET TIME vs MOVE TO SHORTLIST — two outcomes, two handlers.
         ⛔ Never one prop with a flag. */
      onDemote: effectiveIsHost && onDemote ? () => onDemote(slot) : null,
      onPin:    effectiveIsHost && onPin    ? () => onPin(slot)    : null,
    });

    /** The extras only the draggable rendering needs. */
    const sortableProps = slot => ({
      isSortable: !isLocked && !slot.pinned && !!claims[slot.id] && claims[slot.id].status !== 'declined',
      isActiveSort: slot.id === activeSlotId,
      /* ⭐ Hands the row element up so FLIP can measure it. */
      registerNode: el => { nodeRefs.current[slot.id] = el; },
    });
    /* ⛔ `sortableIds` is gone with SortableContext. Each slot registers itself
       as a droppable in SlotCard, so no list of ids is needed here. */
    const activeSlot = activeSlotId ? slots.find(sl => sl.id === activeSlotId) : null;

    function handleDragEnd({ active, over }) {
      setActiveSlotId(null);
      /**
       * ⚠⚠ THE INSTRUMENTATION IS GONE (2026-08-17) — the cause was named and
       * the log said it would be removed once it was.
       *
       * ⚠ WHAT IT EXISTED TO DISTINGUISH IS KEPT AS COMMENTS. Every guard here
       * returns SILENTLY, so from the outside "the sensor never armed", "the
       * claim did not resolve" and "the target was pinned" are one observation:
       * nothing happened. ⛔ If a drag goes dead again, the four exits below
       * are the four suspects — ⭐ instrument them again rather than theorising,
       * which is what three failed rounds proved.
       */

      // 1 · No target, or dropped on itself.
      if (!over || active.id === over.id) return;
      const sourceClaim = claims[active.id];
      /* 2 · ⚠ If this fires, `claims` is keyed differently from `slot.id` — the
         single most likely dashboard-vs-event-page divergence. */
      if (!sourceClaim) return;
      // 3 · The target slot is pinned, and a pinned slot does not accept a drop.
      if (slots.find(sl => sl.id === over.id)?.pinned) return;

      /**
       * ⭐⭐ AN INSERT, ⛔ NOT A SWAP (owner, 2026-08-16: "if I move fewrf from
       * 11 to Elbow 8, the cards in between are supposed to shuffle down. 11
       * and 8 are not to swap").
       *
       * ⚠⚠ A swap exchanges two acts and leaves everyone else alone. Dragging
       * an act up a running order is a MOVE: it takes the target time and
       * everybody from there down shifts one slot later, exactly like dropping
       * a row into a list.
       *
       * ⭐ So the day is read as an ORDERED ARRAY OF OCCUPANTS — empties
       * included, because an empty slot is a real position that can absorb the
       * shift — then spliced. `[null, Elbow, Madds, null, fewrf]` with fewrf
       * moved to index 1 becomes `[null, fewrf, Elbow, Madds, null]`: Elbow and
       * Madds each move one later, and 11:00 empties out.
       *
       * ⛔ The empties are NOT filtered out first. Doing that would march every
       * act up past open slots and silently compact the running order.
       */
      const ids = slots.map(sl => sl.id);

      /**
       * ⛔⛔ A PINNED SLOT DOES NOT MOVE — IT IS PINNED (owner, 2026-08-16).
       *
       * ⚠⚠ So the shuffle runs over the MOVABLE slots only. A pinned slot is
       * lifted out of the ordering entirely: its occupant stays exactly where
       * it is, and the acts shifting past it flow around into the next
       * unpinned slot.
       *
       * ⛔ Splicing the full list instead would carry a pinned act along with
       * everyone else — which is the one thing pinning exists to prevent, and
       * it would do it silently.
       *
       * ⚠ The source is already guaranteed unpinned (`isSortable` excludes a
       * pinned slot, so it has no grip) and so is the target (guarded above).
       */
      const pinnedIds  = new Set(slots.filter(sl => sl.pinned).map(sl => sl.id));
      const movableIds = ids.filter(sid => !pinnedIds.has(sid));

      const fromIdx = movableIds.indexOf(active.id);
      const toIdx   = movableIds.indexOf(over.id);
      // 4 · The slot is pinned, or is not in this day at all.
      if (fromIdx < 0 || toIdx < 0) return;

      const occupants = movableIds.map(sid => claims[sid] || null);
      const [moved]   = occupants.splice(fromIdx, 1);
      occupants.splice(toIdx, 0, moved);

      /* slotId → who ends up there. ⚠ Absent key = the slot ends up EMPTY. */
      const nextBySlot = {};
      /* ⭐ Pinned slots keep their occupant, untouched by the splice. */
      pinnedIds.forEach(sid => { if (claims[sid]) nextBySlot[sid] = claims[sid]; });
      movableIds.forEach((sid, i) => { if (occupants[i]) nextBySlot[sid] = occupants[i]; });

      /* ⚠ Where each act sat BEFORE, so only genuinely moved rows are written.
         ⛔ Writing all of them would touch untouched performances on every drag. */
      const prevSlotOfClaim = {};
      Object.entries(claims).forEach(([sid, c]) => { if (c?.id) prevSlotOfClaim[c.id] = sid; });


      /* ⭐ Snapshot every act's position BEFORE the swap — the "F" of FLIP.
         ⛔ Must happen before `onLocalMove` below, or the rectangles measured
         are the ones we are about to animate away from. */
      const rects = {};
      for (const [slotId, el] of Object.entries(nodeRefs.current)) {
        const cid = claims[slotId]?.id;
        if (el && cid) rects[cid] = el.getBoundingClientRect();
      }
      pendingFlip.current = { rects, skipClaimId: sourceClaim.id };

      // Optimistic update — the whole day's new order, in the query cache
      const currentData = queryClient.getQueryData(['event', id]);
      if (currentData) {
        const newClaims = { ...currentData.claims };
        /* ⛔ Every slot in the day is rewritten, ⛔ not just two — a shuffle
           can touch any number of them, and a slot that ends up empty must be
           DELETED or its old occupant lingers in two places. */
        ids.forEach(sid => {
          if (nextBySlot[sid]) newClaims[sid] = nextBySlot[sid];
          else delete newClaims[sid];
        });
        queryClient.setQueryData(['event', id], { ...currentData, claims: newClaims });
      }

      /**
       * ⭐⭐ THE SAME OPTIMISTIC PATCH, FOR A CALLER THAT KEEPS ITS OWN COPY.
       *
       * ⚠⚠ The block above only helps a consumer using the `['event', id]`
       * cache — the event page. The dashboard holds `claimsMap` in component
       * state, so it had NO optimistic update and sat on the old arrangement
       * until the round-trip finished. That wait IS the flicker: the card lands,
       * nothing changes, then the refetch snaps it into place.
       *
       * ⛔ Fires BEFORE the write, deliberately — it is optimistic. `onChanged`
       * still runs after, and the silent refetch is what CONFIRMS it.
       */
      onLocalMove?.({ slotIds: ids, nextBySlot });

      persistReorder(ids, nextBySlot, prevSlotOfClaim);
    }

    return (
      <div key={di} className={s.daySection}>
        {/* ⭐⭐ THE SECTION NAMES ITS DAY AND ITS STAGE. `groupSlotsIntoDays`
            emits one section per (day, stage) on a multi-stage event, so this
            renders "FRIDAY · LIVE STAGE" without the component needing any
            stage logic of its own. ⛔ The stage name is not optional chrome:
            without it two identical-looking lists of times sit under one
            heading and nothing on screen says which room is which.
            ⚠ A single-stage event has no `stageName` and is untouched. */}
        {/* ⭐ THE DAY NAMES ITSELF; the STAGES are pages beneath it. ⛔ The stage
            no longer belongs in this heading — it moved into the pager, which
            is what turns "two identical lists of times" into two rooms. */}
        {day.name && (
          <div className={s.dayDivider}>
            <span className={s.dayName}>{day.name}</span>
            <div className={s.dayLine} />
          </div>
        )}
        {effectiveIsHost && showEditor ? (
          <DndContext sensors={sensors}
            /* ⚠⚠ `pointerWithin` WAS TRIED AND REVERTED (2026-08-16), ⛔ do not
               try it again without reading this. It was NOT ruled out on merit:
               the test was invalid, because a synthetic `left_click_drag` emits
               no intermediate pointermove events, so `onDragOver` fired ONCE at
               the origin and pointer-based collision had nothing to read.
               ⭐ Meanwhile `closestCenter` DID resolve `over` to a different,
               EMPTY slot once empty slots were made droppable — see the log
               evidence in §8 item 25h. ⛔ Collision detection was never the
               fault; the droppable registration was. */
            collisionDetection={closestCenter}
            /* ⚠⚠ TEMPORARY — ⭐ THE MOST IMPORTANT LINE OF THE THREE. If NO
               "drag START" appears, the PointerSensor never armed and the
               problem is upstream of every guard in handleDragEnd. ⛔ Remove
               with the rest of the instrumentation. */
            onDragStart={({ active }) => setActiveSlotId(active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveSlotId(null)}
          >
            <>
              {single
                ? slots.map(slot => (
                  <SlotCard key={slot.id} {...hostSlotProps(slot)} {...sortableProps(slot)} />
                ))
                /* ⚠ THE PAGER SITS INSIDE THE SAME `DndContext`. Each cell's
                   SlotCard registers its own droppable, so an act can be
                   dragged onto any slot on any stage of this day — which is
                   what a host moving somebody between rooms actually needs. */
                : <StagePages
                    stages={stages}
                    dayKey={day.dayIndex ?? di}
                    sync={sync}
                    renderCell={slot => (
                      <SlotCard key={slot.id} {...hostSlotProps(slot)} {...sortableProps(slot)} />
                    )}
                  />}
            </>
            {/**
              * ⛔⛔ `dropAnimation={null}` — ⛔ do NOT restore the 180ms return.
              *
              * ⚠⚠ THE SLOT ORDER NEVER CHANGES. This is a CLAIM SWAP: the five
              * slots keep their positions and only their occupants change. So
              * dnd-kit's drop animation flew the overlay back to where the card
              * was PICKED UP — because as far as sortable is concerned nothing
              * moved — and only then did the new occupants render. ⭐ That was
              * the owner's "delay before it drops and then it flicks": a 180ms
              * animation to the wrong place, followed by a correction.
              *
              * ⭐ With no drop animation the overlay simply lifts away and the
              * already-updated rows are underneath. ⛔ The fix is NOT a shorter
              * duration — any return-to-origin is a lie about what happened.
              */}
            <DragOverlay dropAnimation={null}>
              {activeSlot ? (
                <SlotCard slot={activeSlot} claim={claims[activeSlot.id]}
                  isHost={effectiveIsHost} isDragOverlay />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : single ? (
          slots.map(slot => (
            <SlotCard key={slot.id} {...hostSlotProps(slot)} />
          ))
        ) : (
          /* ⚠ The same pager without the drag context. A viewer who cannot edit
             still needs to know which room a set is in. */
          <StagePages
            stages={stages}
            dayKey={day.dayIndex ?? di}
            sync={sync}
            renderCell={slot => <SlotCard key={slot.id} {...hostSlotProps(slot)} />}
          />
        )}
      </div>
    );
  });
}
