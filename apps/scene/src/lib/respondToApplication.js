import { supabase } from './supabase';
import { writeNotification } from './writeNotification';
import { resolvePerformerProfileId } from './actingProfile';
import { normaliseStatus } from './enquiryUtils';

/**
 * ⭐ THE HOST DECIDES ON AN APPLICATION. Verified write, then the notice.
 *
 * ⛔⛔ THE SURFACE A CO-HOST IS MOST LIKELY TO BE FILTERED ON. RLS filters an
 * UPDATE rather than erroring it, so `error: null` proved nothing: a blocked
 * decision still told the applicant "your application was unsuccessful", still
 * fired APPLICATION_ACCEPTED, and still moved the row locally — while it stayed
 * in NEW for the actual owner. Two hosts, two truths, and an artist told the
 * losing one.
 *
 * ⭐ Extracted from `ApplicationsScreen` so the invariant can be tested at all:
 * WRITE SUCCEEDS → the applicant may be told. ZERO ROWS → nothing is told,
 * nothing is tracked, nothing moves on screen. The caller's early return on
 * `ok === false` is what makes the analytics and the local state structurally
 * unreachable on a refusal, rather than merely happening to be skipped.
 */
export async function respondToApplication(appId, status, {
  artistId,
  eventId,
  eventName,
  eventOwnerProfileId,
} = {}) {
  if (!appId || !status) return { ok: false, reason: 'missing-identity' };

  /* ⛔⛔ `.select()` IS THE VERIFICATION — a returned id, never `error: null`. */
  const { data: changed, error } = await supabase
    .from('applications')
    .update({ status })
    .eq('id', appId)
    .select('id');
  if (error || !(changed || []).length) return { ok: false, reason: 'refused', error: error ?? null };

  if (!artistId) return { ok: true, notified: false };

  const evLabel = eventName ? ` for ${eventName}` : '';
  /* ⚠ Keyed on the NORMALISED bucket. Keyed on the raw value this map missed
     every decline (`declined` is written, `rejected` was listened for), so the
     applicant was never told. */
  const NOTIF = {
    shortlisted: { type: 'shortlisted',          message: `You've been shortlisted${evLabel}.` },
    declined:    { type: 'application_declined', message: `Your application was unsuccessful${evLabel}.` },
    /* ⚠ Accepting the APPLICATION creates no lineup member and no performance,
       so it may claim neither. See HostDashboard's copy. */
    accepted:    { type: 'booking_confirmed',    message: `Your application was accepted${evLabel}.` },
  };
  const notif = NOTIF[normaliseStatus({ status, direction: 'incoming' })];
  if (!notif) return { ok: true, notified: false };

  // §A7: about = the event's owner (whose decision this is); to = the artist's
  // performer profile, U4-resolved, null if ambiguous.
  await writeNotification({
    toUserId:       artistId,
    toProfileId:    (await resolvePerformerProfileId(artistId)).profileId ?? null,
    aboutProfileId: eventOwnerProfileId ?? null,
    type:    notif.type,
    message: notif.message,
    data:    { event_name: eventName, event_id: eventId },
  });
  return { ok: true, notified: true };
}
