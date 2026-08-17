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
