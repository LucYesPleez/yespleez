/**
 * STAGES — the write layer.
 *
 * ⭐⭐ A STAGE IS AN ENTITY, NOT A STRING ON A SLOT (S2, ratified 2026-08-20).
 * An event with ZERO `event_stages` rows is a single-stage event and renders no
 * stage chrome at all. That is the default and most events stay there forever.
 *
 * ⭐⭐ EVERYTHING ELSE FOR STAGES ALREADY EXISTED and was waiting for rows: the
 * table, its RLS, `event_slots.stage_id`, `resolveSchedule`'s grouping and the
 * swipeable stage pager. This module is the missing half: creating them.
 *
 * ⛔⛔ CREATING THE FIRST STAGE GOES THROUGH THE RPC, NEVER A PLAIN INSERT.
 * Mixed NULL/non-NULL `stage_id` inside one event is an invalid state, and a
 * browser client has no transaction to prevent it with. `create_event_stage`
 * inserts the stage AND adopts the event's existing slots in one statement pair
 * inside one transaction (migration 20260827000001). Insert-then-update from
 * here would leave a window, and a failure would leave it open permanently.
 *
 * ⛔ DELETING A STAGE IS `ON DELETE RESTRICT` BY DESIGN. A cascade stage → slot
 * → performance would silently unbook artists. A stage holding slots must be
 * emptied first, and that is the host's decision to make, not ours to automate.
 */
/* ⛔ NO `supabase` IMPORT. The client is INJECTED as `db`, exactly as
   `eventSlotWrites.saveEventSlots` does it. Importing it here would drag
   `import.meta.env` into every consumer and make the pure rules below
   untestable under the node runner — which is how they lost their tests once
   already. ⭐ The caller passes the client; this module owns the RULES. */

/** Palette tokens a stage may wear. The view decides how to render one. */
export const STAGE_ACCENTS = ['neon1', 'neon2', 'neon3', 'warm', 'cool'];

/**
 * The name a new stage should be offered.
 *
 * ⚠ `event_stages` is UNIQUE on (event_id, name), so a blind "Stage 2" collides
 * the moment somebody renames things. This counts up until the name is free
 * rather than letting the insert fail in front of the host.
 */
export function nextStageName(existing = [], base = 'Stage') {
  const taken = new Set((existing || []).map(s => String(s?.name || '').trim().toLowerCase()));
  for (let n = (existing?.length || 0) + 1; n < 200; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** The accent to offer next, cycling so two stages are not the same colour. */
export function nextStageAccent(existing = []) {
  return STAGE_ACCENTS[(existing?.length || 0) % STAGE_ACCENTS.length];
}

/**
 * ⚠⚠ CAN THIS STAGE BE DELETED? Pure, so the button can be disabled with a
 * REASON rather than the delete failing at the database with a foreign-key
 * error the host cannot read.
 */
export function stageDeletionBlockers(stageId, slotRows = []) {
  const held = (slotRows || []).filter(r => r?.stage_id === stageId);
  if (!held.length) return null;
  return {
    slots: held.length,
    message: `This stage still has ${held.length} slot${held.length === 1 ? '' : 's'}. Move or remove them first.`,
  };
}

/** Load an event's stages, in order. */
export async function loadEventStages(db, eventId) {
  if (!eventId) return [];
  const { data, error } = await db
    .from('event_stages')
    .select('id, event_id, name, position, accent')
    .eq('event_id', eventId)
    .order('position');
  if (error) throw error;
  return data || [];
}

/**
 * Create a stage. ⭐ The FIRST one adopts every existing slot on the event, in
 * the same transaction — see the module note and the RPC.
 */
export async function createEventStage(db, eventId, name, accent = null, position = null) {
  const { data, error } = await db.rpc('create_event_stage', {
    p_event_id: eventId,
    p_name: name,
    p_accent: accent,
    p_position: position,
  });
  if (error) throw error;
  // PostgREST returns a single composite as an object, or as a one-row array
  // depending on the client version. ⛔ Do not assume either shape.
  return Array.isArray(data) ? data[0] : data;
}

export async function renameEventStage(db, stageId, name) {
  const { error } = await db
    .from('event_stages')
    .update({ name: String(name || '').trim(), updated_at: new Date().toISOString() })
    .eq('id', stageId);
  if (error) throw error;
}

/**
 * ⚠ POSITIONS ARE REWRITTEN IN FULL, one update per stage. S2d deliberately put
 * ⛔ no unique index on (event_id, position) precisely so an intermediate state
 * during a reorder is legal; ordering is expressed, not enforced.
 */
export async function reorderEventStages(db, orderedIds = []) {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await db
      .from('event_stages')
      .update({ position: i, updated_at: now })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

/**
 * Delete a stage. ⛔ Refuses while it still holds slots — the database would
 * refuse too (ON DELETE RESTRICT), but a foreign-key violation is not something
 * a host can act on, and this way the caller has the count.
 */
export async function deleteEventStage(db, stageId, slotRows = []) {
  const blocked = stageDeletionBlockers(stageId, slotRows);
  if (blocked) throw new Error(blocked.message);
  const { error } = await db.from('event_stages').delete().eq('id', stageId);
  if (error) throw error;
}
