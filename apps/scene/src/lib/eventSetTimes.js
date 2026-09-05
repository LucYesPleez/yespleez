/**
 * DOES THIS EVENT USE A RUNNING ORDER?
 *
 * ⭐⭐ ONE READER of `events.config.set_times_enabled`. It decides whether the
 * scheduling workspace exists at all, and (from P5) which host tabs an event
 * shows — so ⛔ no screen may work it out for itself.
 *
 * ── ⛔⛔ WHY THIS COULD NOT STAY DERIVED ─────────────────────────────────────
 *
 * `setTimesNeeded` was computed from whether `event_slots` rows exist. That
 * made two genuinely different states indistinguishable:
 *
 *     "this event has no running order"      ← a deliberate answer
 *     "I have not added any slots yet"       ← an unfinished one
 *
 * ⚠ And it was circular the moment the SET TIMES tab itself became conditional:
 * you cannot add a slot without the tab, and the tab only appeared once a slot
 * existed. ⚠⚠ `CreateEventScreen` already records a near-miss from the same
 * root — an event whose slots lived only in rows loaded with the toggle OFF,
 * and the next save would have cleared the lot.
 *
 * ── ⭐⭐ ABSENT MEANS "BEHAVE EXACTLY AS TODAY" ──────────────────────────────
 *
 * ⛔ THERE IS NO BACKFILL, DELIBERATELY. An event that has never stated a
 * preference falls back to the OLD derivation — has slots, so it uses set
 * times. So every one of the 90 existing events keeps precisely the shape it
 * has now, and the flag only starts mattering once somebody sets it.
 *
 * ⚠ Same fail-safe direction as `lib/eventProvenance`: the unknown case is the
 * one that changes nothing.
 *
 * @param slotCount how many `event_slots` rows the event has. ⚠ Only consulted
 *                  when the flag is ABSENT. ⛔ Once set, the stored answer wins
 *                  even at zero slots — that is the whole point.
 */
export function setTimesEnabled(event, slotCount = 0) {
  const stored = event?.config?.set_times_enabled;
  if (stored === true || stored === false) return stored;
  return (Number(slotCount) || 0) > 0;
}

/** Has the host answered this question at all? ⚠ For the editor, which shows a
 *  real toggle rather than an inferred one. */
export function setTimesAnswered(event) {
  const stored = event?.config?.set_times_enabled;
  return stored === true || stored === false;
}

/**
 * ⭐ The config patch, so callers never hand-write the key.
 *
 * ⛔ MERGE, ⛔ never replace. `config` also carries days, poster, venue and
 * `set_times_locked`; a caller building a fresh object would drop the lot.
 */
export function withSetTimesEnabled(config, enabled) {
  return { ...(config || {}), set_times_enabled: !!enabled };
}

/**
 * ⭐⭐ HAS THE HOST ANNOUNCED THE RUNNING ORDER?
 *
 * ⛔⛔ THIS IS A DISPLAY DECISION, ⛔ NOT A BOOKING ONE, AND THAT SEPARATION IS
 * THE WHOLE POINT. `performances.status = 'accepted'` means THE ARTIST AGREED,
 * and `isBooked` reads it for a managed contract. Publishing a running order
 * before everyone has replied must NEVER write that value on their behalf, or
 * the bill starts claiming consent nobody gave.
 *
 * ⚠ So the override lives on the EVENT: the host says "these names are
 * announced", the artist's own row keeps saying `offered` / awaiting reply, and
 * the SET TIMES tab keeps showing AWAITING REPLY truthfully. One fact each.
 *
 * ── WHY IT WAS NEEDED ───────────────────────────────────────────────────────
 * `slotOccupant` named an act only once its performance was `confirmed`, so a
 * host ready to post the running order watched their public schedule read
 * PENDING down the page while the LINEUP directly beneath it named every one of
 * those same acts. The concealment protected nothing — the names were already
 * public a few hundred pixels lower — and it read as a broken page rather than
 * as "the time is not agreed yet" (owner, 2026-09-05).
 *
 * ⛔ A `draft` SLOT IS STILL HIDDEN. Announcing is about acts the host has
 * already offered a time to; a slot never sent is not part of the running
 * order, and `slotOccupant` keeps treating it as empty.
 *
 * ⚠ ABSENT MEANS "BEHAVE EXACTLY AS TODAY", the same fail-safe direction as
 * `setTimesEnabled` above. ⛔ No backfill.
 */
export function setTimesAnnounced(event) {
  return event?.config?.set_times_announced === true;
}

/**
 * ⭐ The config patch, so callers never hand-write the key.
 * ⛔ MERGE, ⛔ never replace — `config` also carries days, poster, venue,
 * `set_times_enabled` and `set_times_locked`.
 */
export function withSetTimesAnnounced(config, announced) {
  return { ...(config || {}), set_times_announced: !!announced };
}
