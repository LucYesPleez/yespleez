/**
 * SLOTS ARE ROWS NOW — and this is the one place that knows it.
 *
 * ⭐⭐ THE SINGLE INTERPRETER. `eventEditorModel` is the one reader of
 * `events.config` for EDITING; this is the one reader of `event_slots` for
 * DISPLAY. A second interpreter is how two surfaces start disagreeing about
 * what an event says, which is the rule that produced both modules.
 *
 * ── WHAT CHANGED UNDERNEATH ──────────────────────────────────────────
 *
 * `events.config.days[].slots[]` was a JSON array, and `performances.slot_id`
 * was a foreign key into it with nothing behind it. L2/L3 (2026-08-15) moved
 * the slots to `event_slots` and gave `performances.slot_uuid` a real FK with
 * ON DELETE CASCADE — which is the owner's rule stated as a constraint:
 * removing a slot returns the act to the Lineup, ⛔ never off the event.
 *
 * ⚠ THE RENDERERS ARE NOT PORTED IN THIS FILE. `DaySlots` and `SlotCard` take
 * a `days` array of `{ name, slots }`, and they keep taking exactly that —
 * `groupSlotsIntoDays` rebuilds that shape from rows. The source of the data
 * changes; the shape the components consume does not. ⛔ Do not "simplify" that
 * away: a data migration and a UI rewrite landing in one step is how you lose
 * the ability to say which of them broke something.
 */

/**
 * ⚠ ONE SLOT CAN HOLD MORE THAN ONE ACT, AND ALWAYS COULD.
 *
 * `useEventData` built its claim map as `map[p.slot_id] = {…}`, so on a slot
 * with several performances the LAST ROW THE PLANNER HAPPENED TO RETURN won.
 * Three slots in production are in that state right now (`sat_1` holds four
 * members, `sat_2` two, `d0s3` two), so the set-times grid has been showing an
 * undefined winner on them — a different act between one page load and the next.
 *
 * ⛔ The fix is NOT a unique constraint on the slot. B2B sets are real, and
 * deleting somebody's booking to make a map convenient is not a migration, it
 * is data loss. L3 constrains (slot, member) instead: one act cannot hold the
 * same slot twice, but a slot may hold two acts.
 *
 * So the map becomes deterministic instead of arbitrary. The ranking is the
 * same one the tally already uses: what somebody has AGREED to outranks what
 * they were merely asked.
 */
export const STATUS_RANK = { confirmed: 0, accepted: 0, offered: 1, draft: 2, declined: 3 };

export function rankPerformance(p) {
  const r = STATUS_RANK[p?.status];
  return r === undefined ? 9 : r;
}

/**
 * Rows → the `{ name, slots }` day array the renderers already take.
 *
 * ⚠ ORDER COMES FROM THE COLUMNS, not from the array's accident. `day_index`
 * and `position` were backfilled from `with ordinality`, which is the only
 * record the JSON blob kept of the organiser's own ordering.
 *
 * ⛔ Days are NOT renumbered to close gaps. If day 1 is deleted, the remaining
 * days keep index 0 and 2 — the numbers are identity, not display, and a
 * renderer that needs "Day 2" counts what it was given.
 */
export function groupSlotsIntoDays(rows = []) {
  const byDay = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const idx = r.day_index ?? 0;
    if (!byDay.has(idx)) byDay.set(idx, { dayIndex: idx, name: r.day_name || '', slots: [] });
    // ⚠ The first row wins the day's name rather than the last: every row in a
    // day carries the same denormalised `day_name`, and if they ever disagree
    // (a partial write), taking the first makes the result stable instead of
    // dependent on row order.
    byDay.get(idx).slots.push(r);
  }
  return [...byDay.values()]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map(d => ({
      ...d,
      slots: d.slots
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(toRenderSlot),
    }));
}

/**
 * An `event_slots` row → the slot object the components read.
 *
 * ⚠ `id` IS THE UUID, deliberately. The claim map is keyed by
 * `performances.slot_uuid` from here on, and dnd-kit's sortable ids come from
 * this same field — so the text `legacy_key` must never be what identifies a
 * slot to the UI again. It is carried through for tracing a row back to the
 * blob it came from, and for nothing else.
 */
export function toRenderSlot(row) {
  return {
    id:         row.id,
    legacyKey:  row.legacy_key || null,
    time:       row.time || '',
    ampm:       row.ampm || '',
    dur:        row.dur_mins ?? 60,
    label:      row.label || '',
    labelColor: row.label_color || null,
    pinned:     !!row.pinned,
  };
}

/**
 * ⚠⚠ THIS EXISTS BECAUSE `dur` USED TO BE A STRING SOMETIMES.
 *
 * Five slots stored `"1.5 hrs"` rather than `90`. `EventHostView` computed
 * `"1.5 hrs" >= 60` → false and rendered the duration as `1.5 hrsm`; `SlotRow`
 * computed `Number("1.5 hrs")` → NaN and rendered an EMPTY number input, so
 * editing one silently rewrote it. L2 normalised the column to an int, and
 * this is the one formatter — ⛔ do not inline the ternary again at a call
 * site, which is where both defects lived.
 */
export function durationLabel(durMins) {
  const n = Number(durMins);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${n}m`;
  const hrs = n / 60;
  // 90 → "1.5hr", 120 → "2hr". Trailing ".0" is noise on a card this small.
  return `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)}hr`;
}

/**
 * Performances → what is on each slot.
 *
 * @returns {{ bySlot: Record<string, Array>, primary: Record<string, object> }}
 *   `bySlot`  every act on that slot, best-ranked first — the honest answer.
 *   `primary` one act per slot, DETERMINISTICALLY chosen, for the surfaces that
 *             still show a single name. ⛔ `primary` is a display convenience;
 *             a surface that decides anything (a count, a removal, a publish)
 *             must read `bySlot`, or it will act on one of two acts at random.
 */
export function indexPerformances(perfs = [], membersById = {}) {
  const bySlot = {};
  for (const p of perfs || []) {
    if (!p?.slot_uuid) continue;             // on the bill, no time yet
    const member = membersById[p.lineup_member_id];
    if (!member) continue;                   // member removed or unreadable
    (bySlot[p.slot_uuid] ||= []).push(toClaim(p, member));
  }
  const primary = {};
  for (const [slotId, list] of Object.entries(bySlot)) {
    // Stable tiebreak on id so two equally-ranked acts do not swap places
    // between renders — the exact instability this replaces.
    list.sort((a, b) => rankPerformance(a) - rankPerformance(b) || String(a.id).localeCompare(String(b.id)));
    primary[slotId] = list[0];
  }
  return { bySlot, primary };
}

/**
 * One performance + its member → the claim shape the components already read.
 *
 * ⚠ THE STATUS TRANSLATION IS LOAD BEARING and moved here verbatim from
 * `useEventData`. A member with no `artist_id` is somebody the organiser typed
 * in: there is no account to send an offer to and no one to accept it, so the
 * booking is CONFIRMED by the act of writing it down. ⛔ Do not "tidy" that
 * into a plain status passthrough — it would render every hand-entered act as
 * permanently awaiting a reply from nobody.
 *
 * ⭐⭐ AND THAT IS EXACTLY WHY THE RAW ROWS ARE CARRIED THROUGH. `status` is a
 * DISPLAY translation, and it lies on purpose: `!artist_id → 'confirmed'` is a
 * fiction for hand-entered acts, and `accepted → 'confirmed'` renames a real
 * value. This function used to discard `p` and `member` after translating, so
 * no surface downstream could recover what the database actually said — which
 * is why `HostDashboard` could not decide safely whether a removal needed
 * notifying, and why `EventHostView` had to keep a parallel `perfsByMember` map
 * to do its own.
 *
 * ⛔ A DECISION READS `claim.performance.status`. `claim.status` is for pixels.
 * Never send a notification off the translated value: it would tell somebody an
 * offer was withdrawn when no offer was ever made.
 */
export function toClaim(p, member) {
  const status = p.status === 'accepted' ? 'confirmed'
    : p.status === 'declined' ? 'declined'
    : p.status === 'draft'    ? 'draft'
    : !member.artist_id       ? 'confirmed'
    : 'offered';
  return {
    id:         p.id,
    member_id:  member.id,
    slot_id:    p.slot_uuid,
    user_id:    member.artist_id || null,
    profile_id: member.artist_profile_id || null,
    name:       member.artist_name || null,
    genre:      member.genre || null,
    sound:      member.sound || null,
    card_pills: member.card_pills || null,
    status,
    // ⛔ Truth, not display. Keep these last so the shape above still reads as
    // the claim the components consume.
    performance: p,
    member,
  };
}
