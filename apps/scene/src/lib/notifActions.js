import { supabase } from './supabase';
import { writeNotification, inferToProfileId } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';


/**
 * Remove a notification from the recipient's inbox WITHOUT destroying it.
 *
 * ⚠ DISMISSAL IS NOT DELETION, and the difference is the point. There is no
 * DELETE policy on `notifications` and there is not meant to be one — see
 * migration `20260804000000_sec6a_notification_dismissal.sql`. The row stays;
 * only its visibility changes, which is the same choice `N1` makes for held
 * rows and `NP1` makes for muted ones ("a held notification is an asset; a
 * suppressed one is a deleted fact").
 *
 * It matters more since SEC-1: any authenticated user can address a
 * notification to anyone, so a row may be FORGED, and a forged row is the only
 * evidence of the attempt. The instinct on seeing a suspicious notification is
 * to get rid of it, and deletion would spend that evidence to do it.
 *
 * Held rows cannot reach here: they carry `to_user_id IS NULL`, the UPDATE
 * policy keys on `auth.uid() = to_user_id`, and equality never matches NULL.
 *
 * @param {string} id
 * @returns {Promise<{error: Error|null}>}
 */
export async function dismissNotification(id) {
  if (!id) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error ?? null };
}

/**
 * Record that an actionable notification has been answered.
 *
 * ⚠ THIS USED TO LIVE ONLY IN REACT STATE, and that was a defect rather than a
 * shortcut. `responded_at` was read back on render (so the row knew how to look
 * answered) but every write went to `setNotifs` and stopped there. After a
 * reload the column was still NULL, ACCEPT and DECLINE returned, and tapping
 * again re-ran the whole action — re-updating `performances` and
 * `applications` with no record that a response had already happened.
 *
 * That made the SEC-1 forgery replayable, which is why this is part of the same
 * change rather than a later tidy-up.
 *
 * Deliberately fire-and-forget at the call site: the underlying accept/decline
 * has already committed by the time this runs, so failing to stamp the receipt
 * must not present as the action having failed. The row simply offers its
 * buttons again, which is exactly today's behaviour.
 *
 * @param {string} id
 * @returns {Promise<{error: Error|null}>}
 */
export async function markResponded(id) {
  if (!id) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ responded_at: new Date().toISOString() })
    .eq('id', id);
  return { error: error ?? null };
}

/**
 * §A7 identities for the four host-directed notices below. All four say
 * "an artist did something to your event", so they share one shape:
 *
 *   about = the acting ARTIST's profile   (the activity the notice concerns)
 *   to    = the recipient's HOST profile  (which of their profiles it is for)
 *   toUser= data.host_id                  (delivery)
 *
 * Both profile ids resolve under `U4` — exactly one owned profile of the
 * applicable type, or null. Null is a correct answer here, not a gap; see
 * the note in writeNotification.js.
 */
/**
 * ⛔ `offeredProfileId` AND THE `scopeToApplicant` IMPORT ARE GONE.
 *
 * Both existed solely to narrow the `applications` writes that accept/decline
 * used to make — scoping them to the right profile so that a person with a DJ
 * act and a band could not accept a slot offered to one and flip the other's
 * application row.
 *
 * ⭐ Those writes are removed (ratified 2026-08-15: the artist's answer lives on
 * `performances`, and `applications` records the host's decision). The bug the
 * scoping defended against cannot occur if nothing reaches across in the first
 * place — a whole class of ambiguity deleted rather than guarded.
 *
 * ⚠ `scopeToApplicant` itself still lives in lib/applicantProfiles.js and is
 * still used by three other call sites. Only this file's use of it is gone.
 */

async function hostNoticeIdentities(hostUserId, artistUserId) {
  const [toProfileId, performer] = await Promise.all([
    inferToProfileId(hostUserId, 'host'),
    resolvePerformerProfileId(artistUserId),
  ]);
  return { toProfileId, aboutProfileId: performer.profileId ?? null };
}

/**
 * ⭐⭐ THE ARTIST'S ANSWER LIVES ON `performances`, AND NOWHERE ELSE.
 *
 * ⛔ THE `applications` WRITE IS GONE (ratified 2026-08-15). This used to also
 * set `applications.status = 'confirmed'`, which is the exact conflation the
 * application state machine exists to end: `applications.status` records the
 * HOST's decision, and an artist accepting a slot is not a host decision. The
 * host already said yes — that is what produced the offer.
 *
 * ⚠ `confirmed` was the ONLY status this line ever wrote, and it is retired.
 * The forensic trace of the single production row carrying it (application
 * f8e03ca7) is why: its meaning could not be read off the row at all, only
 * recovered from git history.
 *
 * `performances.status = 'accepted'` + `accepted_at` is now the whole record of
 * the artist agreeing, which is what every surface should read.
 */
/**
 * ── ⛔⛔ AN OFFER WHOSE SET TIME IS GONE MUST SAY SO ─────────────────────────
 *
 * ⚠⚠ THE DEFECT THIS CLOSES, found in a real inbox. The update was issued and
 * its result DISCARDED, so when the performance no longer existed the artist
 * tapped ACCEPT, nothing was recorded, and three things then lied:
 *
 *   the artist    saw the offer marked responded, so they believed they were in
 *   the host      was notified "X accepted the slot" for a slot that does not
 *                 exist and an acceptance that was never written
 *   the record    stayed empty, so no surface could show the acceptance
 *
 * ⭐ A performance is deleted whenever its SLOT is deleted (ON DELETE CASCADE),
 * so an outstanding offer is orphaned by an ordinary edit to the running order.
 * ⛔ That is not an exotic case and it must not fail silently.
 *
 * ⚠ AN EMPTY RESULT IS NOT PROOF OF DELETION: RLS filters an UPDATE rather than
 * erroring it, so it may also mean "not yours to answer". ⛔ The message must not
 * assert which — it says the set time is no longer available and stops.
 *
 * @returns {Promise<{ok: boolean, code?: string, error?: string}>}
 */
export async function acceptSlotOffer(data, userId) {
  if (!data.performance_id) {
    return { ok: false, code: 'no_performance', error: 'This offer does not name a set time, so it cannot be accepted.' };
  }
  const { data: rows, error } = await supabase.from('performances')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', data.performance_id)
    .select('id');
  if (error)        return { ok: false, code: 'write_failed', error: error.message };
  /* ⛔⛔ AND THE HOST IS NOT TOLD. Announcing an acceptance that was never
     recorded is worse than the silence it replaces. */
  if (!rows?.length) {
    return { ok: false, code: 'gone', error: 'That set time is no longer available. The host may have changed the running order.' };
  }
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'slot_accepted',
      message: `${data.artist_name || 'An artist'} accepted the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
  return { ok: true };
}

/**
 * ⛔ THE `applications` WRITE IS GONE HERE TOO. Declining a slot used to reset
 * the application to `tentative`, i.e. to walk the HOST's decision backwards
 * because the ARTIST said no. The host still wants them; they simply cannot
 * play that slot.
 *
 * ⚠ NOTHING IS LOST. `performances.status = 'declined'` is the signal, and the
 * Lineup surface renders it as DECLINED against that act — which is more
 * precise than the old behaviour, because it says WHICH slot was turned down
 * rather than quietly demoting the whole application.
 */
/* ⛔ SAME RULE ON THE WAY OUT — see `acceptSlotOffer`. A decline that recorded
   nothing must not tell the host the artist declined. */
export async function declineSlotOffer(data, userId) {
  if (!data.performance_id) {
    return { ok: false, code: 'no_performance', error: 'This offer does not name a set time, so it cannot be declined.' };
  }
  const { data: rows, error } = await supabase.from('performances')
    .update({ status: 'declined' })
    .eq('id', data.performance_id)
    .select('id');
  if (error)        return { ok: false, code: 'write_failed', error: error.message };
  if (!rows?.length) {
    return { ok: false, code: 'gone', error: 'That set time is no longer available, so there is nothing to decline.' };
  }
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'slot_declined',
      message: `${data.artist_name || 'An artist'} declined the slot at ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
    });
  }
  return { ok: true };
}

/**
 * Accept an invitation to perform, which creates the application.
 *
 * ⭐⭐ THE INVITED PROFILE IS KNOWN — USE IT, DO NOT RE-DERIVE IT.
 *
 * The invitation names exactly one act: `InviteSheet` writes it as the
 * notification's `to_profile_id`, and `venue_enquiries.applicant_profile_id`
 * carries the same value. This function's own comment predicted the fix — "if
 * the invite ever starts carrying the invited profile id … prefer that and this
 * branch stops mattering" — and since `0758227` it always does.
 *
 * ⚠ WHAT THE OLD BEHAVIOUR COST. `resolvePerformerProfileId` looks the account
 * up and refuses to guess when it owns several performer profiles, correctly
 * under U4 — leaving `from_profile_id` NULL. So a person with a DJ act and a
 * band who accepted an invite got an application attributed to NOBODY: absent
 * from their dashboard, which reads by profile, and unattributable for the
 * host. It picked the ambiguity up from the ACCOUNT when the invitation had
 * already resolved it.
 *
 * ⚠ P11 made multi-act accounts a first-class case, so this was getting more
 * likely, not less.
 *
 * @param {object} data          the notification's `data` payload
 * @param {string} userId        the accepting account
 * @param {string|null} [invitedProfileId]
 *   the notification's `to_profile_id` — the act that was invited. Omitted
 *   only by a caller that has not been updated, or by a LEGACY invite written
 *   before the id was guaranteed; both fall back to the old resolution.
 */
export async function acceptInvite(data, userId, invitedProfileId = null) {
  let profileId = invitedProfileId ?? null;

  if (!profileId) {
    // Legacy path. Same U4 rule as before: refuse to guess, leave it NULL,
    // and say so — an unattributed application is a known state, not a
    // silent one.
    const resolved = await resolvePerformerProfileId(userId);
    profileId = resolved.profileId;
    if (resolved.ambiguous) {
      console.warn('[acceptInvite] no invited profile on the notification and several performer profiles; sender left unattributed', { userId });
    }
  }
  await supabase.from('applications').insert({
    event_id:        data.event_id,
    artist_id:       userId,
    from_profile_id: profileId ?? null,
    /* ⚠ RENAME ONLY, semantics unchanged: `tentative` and `shortlisted` were
       always the same bucket. An accepted invite lands on the short list, where
       it landed before — ⛔ NOT on `accepted`, which would silently promote an
       invite into a booking decision the host has not made. */
    status:          'shortlisted',
  });
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      toProfileId: await inferToProfileId(data.host_id, 'host'),
      // The performer profile was already resolved above under the same U4
      // rule — reuse it rather than resolving twice and risking divergence.
      aboutProfileId: profileId ?? null,
      type:    'invite_accepted',
      message: `${data.artist_name || 'An artist'} accepted your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}

export async function declineInvite(data, userId) {
  if (data.host_id) {
    await writeNotification({
      toUserId: data.host_id,
      ...(await hostNoticeIdentities(data.host_id, userId)),
      type:    'invite_declined',
      message: `${data.artist_name || 'An artist'} declined your invite to ${data.event_name || 'your event'}.`,
      data:    { event_id: data.event_id, artist_user_id: userId },
    });
  }
}
