import { supabase } from './supabase';

/**
 * ── ⛔⛔ AN OFFER WHOSE SET TIME NO LONGER EXISTS IS HISTORY, NOT WORK ────────
 *
 * ⚠⚠ FOUND IN A REAL INBOX, and OLDER THAN THE CODE THAT LOOKED FOR IT. Of six
 * readable slot_offer / event_invite rows, FOUR named a performance that no
 * longer exists — three of them from 10 and 16 July, a month before any of this
 * work. ⛔ This is not a regression: it is a live condition with ACCEPT buttons
 * that could never have worked.
 *
 * ⭐ THE STALE THING IS THE ACTION, NOT THE RECORD. The artist genuinely WAS
 * offered that set time, so the notification is honest history and stays exactly
 * as written. What this module removes is the offer of an answer.
 *
 * ⛔⛔ NOTHING HERE WRITES. ⛔ Not `responded_at` (they did not respond), ⛔ not
 * `expired_at` (no window closed), ⛔ not `dismissed_at` (that is the RECIPIENT
 * hiding a row, SEC-6a). Two constraints make a write the wrong instrument
 * anyway:
 *
 *   the POLICY  `USING (auth.uid() = to_user_id)` — only the recipient may
 *               write their own notification, so a host retiring an artist's
 *               row is impossible from the client.
 *   the CASCADE deleting a SLOT deletes its performances, so NO application
 *               code runs at all. That is how three of the four orphans were
 *               made, and any app-side retirement would miss the common cause.
 *
 * ⭐ So staleness is DERIVED at read time — asking the database what is true
 * rather than trusting a code path that never ran. Same reasoning as the
 * ratified derived-state philosophy: computing a state is the only way it
 * cannot lie.
 *
 * ⚠ AN ABSENT PERFORMANCE IS NOT PROOF OF DELETION. RLS filters a read rather
 * than erroring it, so "gone" and "not visible to you" look identical from the
 * artist's side — exactly as they do to `acceptSlotOffer`'s empty-result case.
 * ⛔ The copy therefore does not claim the host withdrew anything.
 *
 * ⛔ AND IT DOES NOT INFER ACROSS ROWS. Letting a later `slot_removed` notice
 * retire an earlier offer reads as tidy but mis-fires for an act holding two
 * slots, and for a removal that was never sent — which is precisely the
 * REMOVAL_TO_TELL case that exists because sends can be missed.
 */
export const ANSWERABLE_TYPES = ['slot_offer', 'event_invite'];

/**
 * ⭐ The handlers key on `data.performance_id`, so ITS existence is the correct
 * test for actionability. ⛔ Not "does this act still hold that slot" — that is
 * a different question, and it would mislabel a re-offer.
 *
 * An `event_invite` names no performance and is never gated here.
 */
export function referencedPerformanceIds(notifs = []) {
  const ids = new Set();
  for (const n of notifs) {
    if (!ANSWERABLE_TYPES.includes(n?.type)) continue;
    if (n?.responded_at) continue;            // already answered — leave it alone
    const id = n?.data?.performance_id;
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * @param {Array} notifs
 * @param {Iterable<string>} livePerformanceIds  the ids that came back
 * @returns {Set<string>} notification ids whose set time no longer exists
 */
export function orphanedNotifIds(notifs = [], livePerformanceIds = []) {
  const live = livePerformanceIds instanceof Set ? livePerformanceIds : new Set(livePerformanceIds);
  const out = new Set();
  for (const n of notifs) {
    if (!ANSWERABLE_TYPES.includes(n?.type)) continue;
    if (n?.responded_at) continue;
    const id = n?.data?.performance_id;
    if (id && !live.has(id)) out.add(n.id);
  }
  return out;
}

/**
 * ⭐ ONE BATCHED READ for the whole inbox, ⛔ never one query per row.
 *
 * ⚠ IT FAILS OPEN. On an error the set is empty, so every row keeps the
 * behaviour it has today and a live offer can still be answered. The floor
 * under that choice is `acceptSlotOffer`, which since `9d44851` refuses to
 * announce an answer that did not land — so the worst case of failing open is
 * an honest error on the row, not a lie.
 */
export async function findOrphanedOffers(notifs = [], client = supabase) {
  const ids = referencedPerformanceIds(notifs);
  if (!ids.length) return new Set();
  const { data, error } = await client.from('performances').select('id').in('id', ids);
  if (error) return new Set();
  return orphanedNotifIds(notifs, (data || []).map(r => r.id));
}
