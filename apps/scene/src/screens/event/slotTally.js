// Set Times · the slot tally — how full is this running order, honestly.
//
// ── ⚠ WHY THIS IS NOT "ANYTHING THAT IS NOT DECLINED" ────────────────
//
// The shipped count was `claims[id] && status !== 'declined'`, which counts an
// UNANSWERED OFFER as a filled slot. On Bass Heavy that read "4 of 5 slots
// filled" when exactly one artist had accepted: two acts had been offered and
// had not replied in five weeks, and a third had never been sent at all. The
// organiser's own dashboard was telling them the night was booked.
//
// ⭐ A SLOT IS FILLED WHEN SOMEONE HAS AGREED TO PLAY IT. An offer is a
// question, not an answer — the same rule the RLS already enforces for the
// public (SEC-2: only `accepted` slots on a live event are visible). This makes
// the organiser's view agree with the punter's instead of flattering it.
//
// ⚠ THE OTHER STATES ARE NOT NOISE, so they are returned rather than discarded.
// "1 of 5" alone would hide that two acts are mid-conversation and one has never
// been asked, which is exactly the difference between a night that needs
// chasing and one that needs booking. The renderer decides how much to say; it
// cannot invent what it was never given.
//
// Kept pure and separate from `useEventData` for the reason `lineupDisplay.js`
// is: a count nobody can test is a count nobody should trust.

/**
 * @param {Array<{slots?: Array<{id: string}>}>} days   events.config.days
 * @param {Record<string, {status?: string}>} claims    slot_id → claim
 * @returns {{total, confirmed, awaiting, unsent, declined, empty, filled}}
 */
export function tallySlots(days = [], claims = {}) {
  let total = 0, confirmed = 0, awaiting = 0, unsent = 0, declined = 0, empty = 0;

  for (const day of days || []) {
    for (const slot of day?.slots || []) {
      total++;
      const status = claims?.[slot?.id]?.status;
      if      (status === 'confirmed') confirmed++;
      else if (status === 'offered')   awaiting++;
      else if (status === 'draft')     unsent++;
      // ⚠ A DECLINED SLOT IS AN EMPTY SLOT WITH A HISTORY. It needs refilling
      // exactly as an untouched one does, so it counts as empty too — but it is
      // reported separately, because "nobody has been asked" and "someone said
      // no" are different problems for the organiser.
      else if (status === 'declined') { declined++; empty++; }
      else                             empty++;
    }
  }

  return { total, confirmed, awaiting, unsent, declined, empty, filled: confirmed };
}

/**
 * The one-line summary, or null when there is nothing worth saying.
 *
 * ⚠ Null rather than "0 of 0" — an event with no running order has not failed
 * to fill one, and the section hides instead (the rendering contract's rule
 * that absent is not the same as empty).
 */
export function tallySummary(tally) {
  if (!tally || tally.total === 0) return null;
  return { confirmed: tally.confirmed, total: tally.total };
}
