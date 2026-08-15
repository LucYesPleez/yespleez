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
  isHost = false, editable = false, isLocked = false,
  onFill, onEdit, onRemove, onPin,
}) {
  const queryClient = useQueryClient();
  const [activeSlotId, setActiveSlotId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function persistClaimSwap(sourceSlotId, targetSlotId, sourceClaim, targetClaim) {
    // Swap slot_ids on the two performances — no unique constraint so both updates are safe
    await supabase.from('performances').update({ slot_id: targetSlotId }).eq('id', sourceClaim.id);
    await supabase.from('performances').update({ slot_id: sourceSlotId }).eq('id', targetClaim.id);
    queryClient.invalidateQueries({ queryKey: ['event', eventId] });
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
      if (!over || active.id === over.id) return;
      const sourceClaim = claims[active.id];
      if (!sourceClaim) return;
      if (slots.find(sl => sl.id === over.id)?.pinned) return;
      const targetClaim = claims[over.id];
      const isFilled = c => c && c.status !== 'declined';

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

      // Persist to DB
      if (!isFilled(targetClaim)) {
        supabase.from('performances')
          .update({ slot_id: over.id })
          .eq('id', sourceClaim.id)
          .then(() => queryClient.invalidateQueries({ queryKey: ['event', id] }));
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
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={({ active }) => setActiveSlotId(active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveSlotId(null)}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {slots.map(slot => (
                <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
                  isHost={effectiveIsHost}
                  locked={isLocked}
                  isSortable={!isLocked && !slot.pinned && !!claims[slot.id] && claims[slot.id].status !== 'declined'}
                  isActiveSort={slot.id === activeSlotId}
                  onFill={!isLocked ? () => onFill(slot) : null}
                  onEdit={!isLocked ? () => onEdit(slot) : null}
                  onRemove={!isLocked ? () => onRemove(slot) : null}
                  onPin={!isLocked ? () => onPin(slot) : null}
                  allMixSlots={allMixSlots}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
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
              locked={isLocked}
              onFill={effectiveIsHost && !isLocked ? () => onFill(slot) : null}
              onEdit={effectiveIsHost && !isLocked ? () => onEdit(slot) : null}
              onRemove={effectiveIsHost && !isLocked ? () => onRemove(slot) : null}
              onPin={effectiveIsHost && !isLocked ? () => onPin(slot) : null}
              allMixSlots={allMixSlots}
            />
          ))
        )}
      </div>
    );
  });
}
