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
/**
 * @param rows   `event_slots` rows
 * @param dates  the event's own dates in order, from `eventDays.eventDates()`.
 *
 * ⭐⭐ A DAY CARRIES ITS DATE. `dates[dayIndex]` is attached to each day as
 * `date`, so the schedule, the day chips and the set-times grid can say
 * "SAT 29 AUG" instead of "DAY 2". A day used to be a bare ORDINAL, which meant
 * an artist reading a festival's running order had to COUNT to work out which
 * calendar day their set was on.
 *
 * ⚠ DERIVED, ⛔ never stored. `event_slots` has no date column and does not need
 * one: the day's date is the event's start date plus `day_index`. Storing it
 * would give the schedule a second opinion the moment an organiser moves the
 * event, and the stored copy would be the one that lied.
 *
 * ⚠ `dates` is OPTIONAL and defaults to empty, so a caller that has not been
 * given the event row yet still gets the shape it always got. `date` is then
 * '' and every label falls back to the ordinal, exactly as before.
 */
export function groupSlotsIntoDays(rows = [], dates = [], stages = []) {
  const byDay = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const idx = r.day_index ?? 0;
    if (!byDay.has(idx)) byDay.set(idx, { dayIndex: idx, name: r.day_name || '', date: dates?.[idx] || '', slots: [] });
    // ⚠ The first row wins the day's name rather than the last: every row in a
    // day carries the same denormalised `day_name`, and if they ever disagree
    // (a partial write), taking the first makes the result stable instead of
    // dependent on row order.
    byDay.get(idx).slots.push(r);
  }

  const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0);
  const days = [...byDay.values()].sort((a, b) => a.dayIndex - b.dayIndex);

  /* ⚠⚠ A SINGLE-STAGE EVENT IS UNCHANGED, and that matters more than the new
     behaviour: almost every event has no stages at all, and this function feeds
     the host's set-times grid, the dashboard and the public day list. */
  const ordered = (stages || []).slice().sort(byPosition);
  if (ordered.length < 2) {
    return days.map(d => ({ ...d, slots: d.slots.sort(byPosition).map(r => toRenderSlot(r)) }));
  }

  /**
   * ⭐⭐ ONE SECTION PER (DAY, STAGE). The consumer keeps rendering a flat list
   * of sections and needs no stage logic of its own, which is what lets the
   * host's drag-and-drop stay exactly as it was — a reorder is now within one
   * stage, which is the only reorder that ever made sense.
   *
   * ⚠⚠ IT ALSO FIXES AN ORDERING BUG, and that is the visible half. `position`
   * is per (day, stage), so a two-stage day holds two slots at position 0, two
   * at position 1, and so on. Sorting a day's slots by position alone therefore
   * INTERLEAVED the stages: Friday read 4:30 Welcome, 5:00 Rieperluv (DJ),
   * 6:00 Qi Fields (DJ), 5:00 Afi James (Live) — times jumping backwards down
   * the page with nothing on screen to explain why.
   *
   * ⛔ A STAGE WITH NO SLOTS ON A DAY IS OMITTED, never rendered empty. That is
   * how a festival whose workshops run only on Sunday reads correctly, rather
   * than showing two blank rooms every other day.
   */
  return days.map(d => {
    const rest = d.slots.slice();
    const dayStages = [];
    /**
     * ⭐⭐ EVERY DAY CARRIES EVERY STAGE, INCLUDING THE ONES IT DOES NOT RUN.
     *
     * ⚠⚠ THIS IS WHAT MAKES THE PAGER LINE UP. The stage pages must be the SAME
     * SET in the SAME ORDER on every day, or page 2 is the DJ stage on Friday
     * and the workshops on Sunday, and one swipe desynchronises the festival.
     * Omitting the empty ones was tried first and did exactly that: swiping
     * Saturday moved Saturday while Sunday sat still.
     *
     * ⛔ An empty stage is NOT a missing stage. It renders as that day's column
     * of "nothing on" against the shared time axis, which is the honest answer
     * to "what is happening in the gallery on Friday" and keeps the rooms
     * stacked under one another where the eye expects them.
     */
    for (const st of ordered) {
      const mine = rest.filter(r => r.stage_id === st.id).sort(byPosition);
      dayStages.push({ id: st.id, name: st.name || '', accent: st.accent || null, slots: mine.map(r => toRenderSlot(r, st.name)) });
    }
    /* ⚠ Slots belonging to NO stage on an event that HAS stages are an invalid
       state (S2d prevents it at the write layer). They are carried anyway, as a
       trailing unnamed page: a reader that silently drops rows it disapproves
       of makes a real booking vanish with no trace. */
    const unstaged = rest.filter(r => !r.stage_id).sort(byPosition);
    if (unstaged.length) {
      dayStages.push({ id: null, name: '', accent: null, slots: unstaged.map(r => toRenderSlot(r, null)) });
    }
    /* ⚠⚠ `slots` STAYS, as every one of the day's slots in stage order. It is
       what `hostLineup` and the other consumers already read, and a nested-only
       shape would have broken them silently — they would simply have found
       nothing rather than erroring. ⛔ Do not remove it to tidy the object. */
    return { ...d, stages: dayStages, slots: dayStages.flatMap(st => st.slots) };
  });
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
/**
 * ⭐⭐ ADD A SLOT AT THE TOP OF A STAGE'S DAY. One INSERT, and ⛔ nothing else is
 * touched.
 *
 * ⭐ IT IS AN EMPTY SLOT, ⛔ not a marker. The sheet that opens next decides
 * what goes in it — an artist whose set starts earlier than anything booked, a
 * welcome to country, doors, a smoking ceremony. ⛔ Do not bake a label choice
 * in here: this function's job is that a row exists at the right position, and
 * the moment it also decides MEANING there are two places that answer "what is
 * this slot".
 *
 * ⚠⚠ IT GOES BEFORE THE FIRST SLOT, AND ONLY THERE, ON PURPOSE. `position` is a
 * dense integer per (day, stage) — 0, 1, 2 with no gaps — so inserting BETWEEN
 * two slots means renumbering every row after it. That is a multi-row write
 * with no transaction from the client: interrupted, it leaves two slots sharing
 * a position, and equal positions sort arbitrarily, which silently scrambles a
 * running order. ⛔ Do not add a mid-list insert here; it needs an RPC that can
 * renumber atomically.
 *
 * ⭐ `min(position) - 1` needs no renumbering at all. Positions are only ever
 * READ in sort order, never as an index, so a negative one is ordinary.
 *
 * ⚠ THE TIME IS COPIED FROM THE SLOT IT PRECEDES, not invented. A marker with
 * no time renders a blank where every neighbour states one; the host can edit
 * it afterwards, and a sensible starting value beats an empty box.
 *
 * @returns {Promise<{ok: boolean, slot?: object, error?: string}>}
 */
export async function addSlotBefore(db, { eventId, stageSlots = [], dayIndex, dayName, stageId = null, label = '' }) {
  if (!eventId) return { ok: false, error: 'No event.' };
  if (!stageSlots.length) return { ok: false, error: 'Nothing to put it before yet.' };

  const positions = stageSlots.map(r => r.position ?? 0);
  const first = stageSlots.reduce((a, b) => ((a.position ?? 0) <= (b.position ?? 0) ? a : b));

  const { data, error } = await db.from('event_slots').insert({
    event_id:  eventId,
    day_index: dayIndex ?? 0,
    day_name:  dayName || '',
    stage_id:  stageId,
    position:  Math.min(...positions) - 1,
    time:      first.time || '',
    ampm:      first.ampm || '',
    /* ⚠ Short by default. A marker is a moment, not a set, and a 60-minute
       welcome to country would draw a card the size of a headline slot. */
    dur_mins:  15,
    label:     String(label || '').trim(),
  }).select().maybeSingle();

  if (error) return { ok: false, error: error.message || 'That could not be added.' };
  return { ok: true, slot: data };
}

export function toRenderSlot(row, stageName = null) {
  return {
    id:         row.id,
    legacyKey:  row.legacy_key || null,
    time:       row.time || '',
    ampm:       row.ampm || '',
    dur:        row.dur_mins ?? 60,
    label:      row.label || '',
    labelColor: row.label_color || null,
    pinned:     !!row.pinned,
    /* ⭐ The slot's stage, so a consumer can group or label without going back
       to the raw rows. Null on a single-stage event: that IS the implicit stage. */
    stageId:    row.stage_id || null,
    /* ⭐ The stage's NAME, carried beside its id so a card can ask what kind of
       room it is in without being handed the stage list. ⚠ Only the grouping
       functions know it — a bare `toRenderSlot(row)` legitimately has no stage
       in scope and passes null, which reads as "no stage opinion". */
    stageName:  stageName || null,
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
