/**
 * ── ⭐⭐ P6.3 · THE SENDER · ONE ARTIST, ONE PLACEMENT, ONE MESSAGE ───────────
 *
 * ⛔⛔ A NEW TRANSACTIONAL BOUNDARY, ⛔ NOT AN EXTENSION OF `publishSetTimes`.
 * That function does five things behind one press — flips every draft
 * event-wide, writes notifications, rewrites `applications.status`, locks the
 * event — and inspects none of its four writes. ⛔ Nothing here may grow into it.
 *
 * ⭐⭐ THE ORDER IS THE INVARIANT:
 *
 *     resolve recipient + placement
 *              ↓
 *          SEND  ⛔ if this fails, STOP
 *              ↓
 *     write notified_at + notified_slot_uuid + notified_kind
 *
 * ⛔ THE RECORD IS NEVER WRITTEN FIRST. `notified_at` means "we told them", and a
 * row claiming that before the message left is a lie the host cannot see. The
 * whole point of P6.2's derivation is that this column is EVIDENCE.
 *
 * ⭐ PER ARTIST, ⛔ NEVER PER EVENT. One failure must not block the others, and
 * one success must not mark anybody else as notified. That is what made the old
 * model unusable: reaching one newly scheduled artist meant unlocking, which
 * reverted EVERY outstanding offer, then republishing to everybody.
 *
 * ⛔ WHAT THIS MODULE MUST NEVER TOUCH:
 *   ⛔ `events.config.set_times_locked` — an editing lock, ⛔ not a send condition
 *   ⛔ `applications` — a host decision in another domain
 *   ⛔ any performance but the one being communicated
 *   ⛔ any `lineup_members` row but the recipient's
 *   ⛔ acknowledgement (P6.4) — it does not exist yet and nothing here may assume it
 */
import { isBooked, canPlaceMember } from './hostLineup';
import { isReachable } from './lineupActions';
import { NOTIFY_KINDS, SLOT_OFFER, SLOT_CHANGED, SLOT_REMOVED, notifiedPatch } from './notifyPlan';

/**
 * ⚠ THE COPY, kept beside the rule so one phrasing serves every caller. ⛔ NO EM
 * DASHES: this reaches an artist.
 *
 * ⚠ The slot label is OPTIONAL and the sentence still reads without it. A caller
 * that cannot resolve the time must not produce "your set time is undefined".
 */
export function messageForKind(kind, eventName, slotLabel = null) {
  const ev   = eventName ? ` at ${eventName}` : '';
  const when = slotLabel ? ` ${slotLabel}` : '';
  if (kind === SLOT_OFFER)   return `You've been offered a slot${ev}.${when ? ` Your set time is${when}.` : ''}`;
  if (kind === SLOT_CHANGED) return `Your set time${ev} has changed.${when ? ` It is now${when}.` : ''}`;
  if (kind === SLOT_REMOVED) return `Your set time${ev} has been removed.`;
  return `There is an update about your set time${ev}.`;
}

/**
 * ⭐ THE ONE SEND.
 *
 * @param db            supabase client
 * @param member        the recipient's `lineup_members` row
 * @param event         the event row — ⭐ decides what "booked" means
 * @param perfs         EVERY performance this member holds
 * @param slotUuid      the placement being communicated. ⚠ For `slot_removed`
 *                      this is the slot they are being told they have LOST, which
 *                      they no longer hold — recording it is more informative
 *                      than a null, and the derivation reads the KIND either way.
 * @param kind          one of NOTIFY_KINDS
 * @param slotLabel     optional, for the copy only
 * @param notify        ⭐ INJECTED, like `executeLineupPlan`. Returns an error or
 *                      falsy. ⛔ Not imported, so a test can prove the ORDER
 *                      without mocking a module.
 * @param resolveProfileId  optional, resolves the recipient's performer profile
 *
 * @returns {Promise<{ok, sent, recorded, code, error, memberId, kind, slotUuid}>}
 *          ⛔ NEVER THROWS on a write failure: the caller is sending to several
 *          artists and one broken row must not abort the rest.
 */
export async function sendSlotNotice(db, {
  member, event, perfs = [], slotUuid = null, kind = SLOT_OFFER,
  slotLabel = null, notify, resolveProfileId = null,
} = {}) {
  const fail = (code, error) => ({
    ok: false, sent: false, recorded: false, code, error: error || code,
    memberId: member?.id ?? null, kind, slotUuid,
  });

  if (!NOTIFY_KINDS.includes(kind)) return fail('unknown_kind', `Unknown kind "${kind}".`);
  if (!member?.id || !event?.id)    return fail('missing_input', 'A recipient and an event are required.');
  if (typeof notify !== 'function') return fail('no_transport', 'No notification transport was provided.');

  /**
   * ⛔ NOBODY TO TELL IS NOT A FAILURE, IT IS A NON-EVENT. A hand-typed act has no
   * account, so there is no recipient and ⛔ nothing may be recorded either: a
   * `notified_at` on an unreachable member would claim a message that could not
   * exist. Same rule `lineupActions` already applies before writing to a null
   * recipient.
   */
  if (!isReachable(member)) return fail('unreachable', 'This artist has no account to notify.');

  /**
   * ⛔⛔ NEVER ANNOUNCE A BOOKING THAT DOES NOT EXIST. `canPlaceMember` is the
   * ratified gate and carries the contract (`on_bill` for legacy and imported, an
   * accepted performance for managed), so ⛔ no second opinion is formed here.
   * ⚠ A shortlisted artist holding a stray slot from before that gate must not be
   * told they are playing.
   */
  if (!isBooked(member, perfs, event)) {
    const gate = canPlaceMember(member, perfs, event);
    return fail('not_booked', gate.ok ? 'This artist is not booked for this event.' : gate.reason);
  }

  /**
   * ⚠ THE PLACEMENT MUST BE REAL for an offer or a change: telling somebody about
   * a set time they do not hold is how a host promises a slot that was already
   * given away. ⛔ For a REMOVAL the opposite is required — they must NOT hold it,
   * or the message contradicts the schedule.
   */
  const held = (perfs || []).find(p => p?.slot_uuid && p.slot_uuid === slotUuid) || null;
  if (kind === SLOT_REMOVED) {
    if (held) return fail('still_placed', 'This artist still holds that set time, so it has not been removed.');
  } else if (!held) {
    return fail('not_placed', 'This artist does not hold that set time.');
  }

  /* ── THE SEND. ⛔ Everything above this line is a refusal; everything below
        assumes a message has actually gone. ───────────────────────────────── */
  const { profileId } = resolveProfileId ? await resolveProfileId(member.artist_id) : { profileId: null };

  const sendError = await notify({
    toUserId:       member.artist_id,
    toProfileId:    profileId ?? member.artist_profile_id ?? null,
    aboutProfileId: event.owner_profile_id ?? null,
    /* ⭐ THE TYPE IS THE KIND. One vocabulary, so `notified_kind` can be checked
       against the notification that was sent. */
    type:    kind,
    message: messageForKind(kind, event.name, slotLabel),
    /* ⚠ `performance_id` is what the accept and decline handlers key on, and
       P6.2.1 is what keeps that row alive through a reschedule. */
    data: {
      performance_id: held?.id ?? null,
      event_id:       event.id,
      event_name:     event.name ?? null,
      slot_id:        slotUuid ?? null,
    },
  });

  /* ⛔⛔ THE RECORD IS NOT WRITTEN. This is the whole ordering invariant: an
     artist who was not told must not look like one who was. */
  if (sendError) {
    return { ...fail('send_failed', sendError.message || String(sendError)), sent: false };
  }

  const outcome = {
    ok: true, sent: true, recorded: false, code: 'sent', error: null,
    memberId: member.id, kind, slotUuid,
  };

  /**
   * ⭐ AN OFFER MAKES THE PLACEMENT OFFERED, and only for the row just
   * communicated. ⚠ This is the ONE named status transition P6.2.1 permits: a
   * placement may never rewrite `status`, but an explicit send is not a placement.
   * ⛔ `draft` only. An `accepted` row must never be downgraded, and a re-sent
   * `offered` row is already where it belongs.
   */
  if (kind === SLOT_OFFER && held?.status === 'draft') {
    const { error } = await db.from('performances')
      .update({ status: 'offered', updated_at: new Date().toISOString() })
      .eq('id', held.id);
    /* ⚠⚠ SURFACED, ⛔ NOT FATAL. The artist HAS been told, so the communication
       record below must still be written or the next pass would tell them twice.
       A stale status is visible and fixable; a duplicate notice is not. */
    if (error) outcome.statusError = error.message;
  }

  const { data, error } = await db.from('lineup_members')
    .update(notifiedPatch(slotUuid, undefined, kind))
    .eq('id', member.id)
    .select('id, notified_at, notified_slot_uuid, notified_kind');

  /**
   * ⚠⚠ SENT BUT NOT RECORDED IS THE WORST OUTCOME, AND IT MUST BE LOUD. The
   * artist has the message and the system does not know, so the next pass will
   * tell them again. ⛔ Reported as `ok: false` with `sent: true` rather than
   * hidden behind a boolean: an RLS-filtered UPDATE returns no error and no row,
   * which is exactly the silence that let 22 events look editable.
   */
  if (error || !data?.length) {
    return { ...outcome, ok: false, recorded: false, code: 'sent_not_recorded',
      error: error?.message || 'The notification was sent but could not be recorded.' };
  }

  return { ...outcome, recorded: true, member: data[0] };
}

/**
 * ⭐⭐ SEVERAL ARTISTS, INDEPENDENTLY.
 *
 * ⛔ NOT A BULK OPERATION. It is a loop with no shared state, so one refusal or
 * one failed send cannot stop or contaminate another artist's result. ⚠ That is
 * the difference from `publishSetTimes`, whose single batched insert meant one
 * bad row left EVERY status flipped and NOBODY told.
 *
 * ⚠ SEQUENTIAL on purpose: each send is a write, and a parallel burst against
 * one event is how two notifications for the same slot end up interleaved.
 */
export async function sendSlotNotices(db, items = [], shared = {}) {
  const results = [];
  for (const item of items || []) {
    results.push(await sendSlotNotice(db, { ...shared, ...item }));
  }
  return results;
}

/** ⭐ For the caller's report: what actually happened, in one line each. */
export function summariseOutcomes(results = []) {
  const list = results || [];
  return {
    sent:      list.filter(r => r?.sent).length,
    recorded:  list.filter(r => r?.recorded).length,
    refused:   list.filter(r => r && !r.sent).length,
    /* ⚠ Called out separately because it is the one state that needs a human. */
    sentNotRecorded: list.filter(r => r?.sent && !r?.recorded).length,
  };
}
