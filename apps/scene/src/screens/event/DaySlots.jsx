// EP-00d · the day + slot list, shared by the public view and the host editor.
//
// Extracted verbatim. The difference between "punter reading the set times" and
// "host dragging them around" is entirely in the props: without `editable`
// there is no DndContext at all, and without `isHost` every action handler is
// null. Nothing here reads session or host state directly.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { supabase } from '../../lib/supabase';
import SlotCard from './SlotCard';
import s from '../EventScreen.module.css';

export default function DaySlots({
  eventId, days, claims, allMixSlots,
  isHost = false, editable = false, isLocked = false, viewerProfileId = null,
  onFill, onEdit, onRemove, onPin, onChanged, onLocalMove,
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
  async function persistClaimSwap(sourceSlotId, targetSlotId, sourceClaim, targetClaim) {
    // Swap the two performances — no unique constraint, so both updates are safe
    const a = await supabase.from('performances').update({ slot_uuid: targetSlotId }).eq('id', sourceClaim.id);
    const b = await supabase.from('performances').update({ slot_uuid: sourceSlotId }).eq('id', targetClaim.id);
    /* ⚠⚠ TEMPORARY — same reason as the move-to-empty write. ⚠ An RLS-filtered
       UPDATE reports NO error and changes NOTHING, so ⛔ a null error here is
       not proof the swap landed; check the rows. */
    console.log('[YesPleez] drag WRITE swap', { aErr: a.error?.message ?? null, bErr: b.error?.message ?? null });
    queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    onChanged?.();
  }

  const id = eventId;
  const effectiveIsHost = isHost;
  const showEditor = editable;

  return days.map((day, di) => {
    const slots = day.slots || [];
    const sortableIds = slots.map(sl => sl.id);
    const activeSlot = activeSlotId ? slots.find(sl => sl.id === activeSlotId) : null;

    function handleDragEnd({ active, over }) {
      setActiveSlotId(null);
      /**
       * ⚠⚠ TEMPORARY INSTRUMENTATION (2026-08-16) — the dashboard's drag does
       * nothing and THREE ROUNDS OF THEORISING failed to find it. Every guard
       * below returns SILENTLY, so from the outside "the sensor never armed",
       * "the claim did not resolve" and "the target was pinned" are the same
       * observation: nothing happened.
       *
       * ⛔ REMOVE THIS once the cause is named. ⭐ Until then it is the only
       * thing that distinguishes the four exits.
       */
      const log = (stage, extra = {}) => console.log('[YesPleez] drag', stage, {
        active: active?.id, over: over?.id,
        claimKeys: Object.keys(claims || {}).length,
        slotIds: slots.map(sl => sl.id),
        ...extra,
      });
      log('END');

      if (!over || active.id === over.id) return log('BAIL · no target, or dropped on itself');
      const sourceClaim = claims[active.id];
      /* ⚠ If this fires, `claims` is keyed differently from `slot.id` — the
         single most likely dashboard-vs-event-page divergence. */
      if (!sourceClaim) return log('BAIL · no sourceClaim for active.id', { claimKeys: Object.keys(claims || {}) });
      if (slots.find(sl => sl.id === over.id)?.pinned) return log('BAIL · target slot is pinned');
      const targetClaim = claims[over.id];
      const isFilled = c => c && c.status !== 'declined';
      log('PROCEEDING', {
        sourceClaimId: sourceClaim.id,
        targetClaimId: targetClaim?.id ?? null,
        path: isFilled(targetClaim) ? 'swap two claims' : 'move to empty slot',
      });

      // Optimistic update — swap claims in the React Query cache immediately
      const currentData = queryClient.getQueryData(['event', id]);
      if (currentData) {
        const newClaims = { ...currentData.claims };
        if (isFilled(targetClaim)) {
          newClaims[over.id]    = sourceClaim;
          newClaims[active.id]  = targetClaim;
        } else {
          newClaims[over.id] = sourceClaim;
          delete newClaims[active.id];
        }
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
      onLocalMove?.({
        from: active.id,
        to: over.id,
        sourceClaim,
        targetClaim,
        filled: isFilled(targetClaim),
      });

      // Persist to DB. ⛔ `slot_uuid` — see persistClaimSwap for why.
      if (!isFilled(targetClaim)) {
        supabase.from('performances')
          .update({ slot_uuid: over.id })
          .eq('id', sourceClaim.id)
          .then(({ error }) => {
            /* ⚠⚠ TEMPORARY, and it should probably STAY. This write's error was
               never read — and RLS FILTERS an UPDATE rather than erroring it, so
               a blocked write returns no error AND changes nothing. ⛔ Silent
               either way, which is half of why this took all afternoon. */
            console.log('[YesPleez] drag WRITE move-to-empty', { error: error?.message ?? null });
            queryClient.invalidateQueries({ queryKey: ['event', id] });
            /* ⭐ THE MOVE-TO-AN-EMPTY-SLOT PATH NEEDS THIS TOO. It is the one
               the owner hit first (fewrf → the 7:00 open slot), and it is the
               half a "swap two claims" mental model forgets. */
            onChanged?.();
          });
      } else {
        persistClaimSwap(active.id, over.id, sourceClaim, targetClaim);
      }
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
            onDragOver={({ active, over }) => console.log('[YesPleez] drag OVER', { active: active?.id, over: over?.id ?? null })}
            /* ⚠⚠ TEMPORARY — ⭐ THE MOST IMPORTANT LINE OF THE THREE. If NO
               "drag START" appears, the PointerSensor never armed and the
               problem is upstream of every guard in handleDragEnd. ⛔ Remove
               with the rest of the instrumentation. */
            onDragStart={({ active }) => { console.log('[YesPleez] drag START', active?.id); setActiveSlotId(active.id); }}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveSlotId(null)}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {slots.map(slot => (
                <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
isHost={effectiveIsHost}
                  viewerProfileId={viewerProfileId}
                  locked={isLocked}
                  isSortable={!isLocked && !slot.pinned && !!claims[slot.id] && claims[slot.id].status !== 'declined'}
                  isActiveSort={slot.id === activeSlotId}
                  /* ⛔⛔ `&& onX` — ⛔ NOT just `!isLocked`. Wrapping a handler
                     that was never passed hands SlotCard a truthy function, so
                     the button renders and pressing it calls `undefined(slot)`
                     and THROWS. ⭐ Composes with SlotCard's rule that a control
                     exists only where its verb does, which is what lets the
                     dashboard ask for EDIT SLOT and nothing else. */
                  onFill={!isLocked && onFill ? () => onFill(slot) : null}
                  onEdit={!isLocked && onEdit ? () => onEdit(slot) : null}
                  onRemove={!isLocked && onRemove ? () => onRemove(slot) : null}
                  onPin={!isLocked && onPin ? () => onPin(slot) : null}
                  allMixSlots={allMixSlots}
                />
              ))}
            </SortableContext>
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
              onFill={effectiveIsHost && !isLocked && onFill ? () => onFill(slot) : null}
              onEdit={effectiveIsHost && !isLocked && onEdit ? () => onEdit(slot) : null}
              onRemove={effectiveIsHost && !isLocked && onRemove ? () => onRemove(slot) : null}
              onPin={effectiveIsHost && !isLocked && onPin ? () => onPin(slot) : null}
              allMixSlots={allMixSlots}
            />
          ))
        )}
      </div>
    );
  });
}
