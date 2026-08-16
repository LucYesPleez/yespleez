// EP-00d · the day + slot list, shared by the public view and the host editor.
//
// Extracted verbatim. The difference between "punter reading the set times" and
// "host dragging them around" is entirely in the props: without `editable`
// there is no DndContext at all, and without `isHost` every action handler is
// null. Nothing here reads session or host state directly.
import { useState, useRef, useLayoutEffect } from 'react';
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

export default function DaySlots({
  eventId, days, claims, allMixSlots,
  isHost = false, editable = false, isLocked = false, viewerProfileId = null,
  onFill, onEdit, onRemove, onDemote, onPin, onChanged, onLocalMove,
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

  return days.map((day, di) => {
    const slots = day.slots || [];
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
              {slots.map(slot => (
                <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
isHost={effectiveIsHost}
                  viewerProfileId={viewerProfileId}
                  locked={isLocked}
                  isSortable={!isLocked && !slot.pinned && !!claims[slot.id] && claims[slot.id].status !== 'declined'}
                  isActiveSort={slot.id === activeSlotId}
                  /* ⭐ Hands the row element up so FLIP can measure it. */
                  registerNode={el => { nodeRefs.current[slot.id] = el; }}
                  /* ⛔⛔ `&& onX` — ⛔ NOT just `!isLocked`. Wrapping a handler
                     that was never passed hands SlotCard a truthy function, so
                     the button renders and pressing it calls `undefined(slot)`
                     and THROWS. ⭐ Composes with SlotCard's rule that a control
                     exists only where its verb does, which is what lets the
                     dashboard ask for EDIT SLOT and nothing else. */
                  /**
                   * ⛔⛔ `isLocked` NO LONGER NULLS THESE (owner, 2026-08-16).
                   *
                   * ⚠⚠ THIS WAS THE REASON THE MUTED CONTROLS NEVER APPEARED.
                   * `SlotCard` renders a control only where its handler exists,
                   * so nulling them here deleted the buttons before that rule
                   * could grey them — no amount of styling inside `SlotCard`
                   * could bring back a control it was never given.
                   *
                   * ⭐ `locked={isLocked}` is passed too, and THAT is what mutes
                   * them. The handler says the verb exists; the flag says it is
                   * not available right now. ⛔ Two different questions.
                   */
                  onFill={onFill ? () => onFill(slot) : null}
                  onEdit={onEdit ? () => onEdit(slot) : null}
                  onRemove={onRemove ? () => onRemove(slot) : null}
                  /* ⭐ CLEAR SET TIME vs MOVE TO SHORTLIST — two outcomes, two
                     handlers. ⛔ Never one prop with a flag. */
                  onDemote={onDemote ? () => onDemote(slot) : null}
                  onPin={onPin ? () => onPin(slot) : null}
                  allMixSlots={allMixSlots}
                />
              ))}
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
        ) : (
          slots.map(slot => (
            <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
isHost={effectiveIsHost}
              viewerProfileId={viewerProfileId}
              locked={isLocked}
              /* ⛔ `&& onX` here too — same reason as the sortable branch. */
              /* ⛔ `isLocked` dropped here too — see the sortable branch above.
                 ⚠ `effectiveIsHost` STAYS: a non-host has no such verb at all,
                 which is a different thing from a host who cannot use it yet. */
              onFill={effectiveIsHost && onFill ? () => onFill(slot) : null}
              onEdit={effectiveIsHost && onEdit ? () => onEdit(slot) : null}
              onRemove={effectiveIsHost && onRemove ? () => onRemove(slot) : null}
              onDemote={effectiveIsHost && onDemote ? () => onDemote(slot) : null}
              onPin={effectiveIsHost && onPin ? () => onPin(slot) : null}
              allMixSlots={allMixSlots}
            />
          ))
        )}
      </div>
    );
  });
}
