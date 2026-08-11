/**
 * ⭐ WHEN A DATE IS SPOKEN FOR — clearing the funnel without leaving anyone
 * hanging.
 *
 * Publishing an event is the public commitment to a date (owner, 2026-08-11).
 * Everyone still queued for that date is, by definition, no longer in the
 * running — and before this they simply stayed in the funnel forever, because
 * nothing connected "this night is booked" to "these people are waiting to hear
 * about this night".
 *
 * ⛔⛔ REMOVING THEM FROM THE FUNNEL IS NOT ENOUGH, AND ON ITS OWN IS THE WORSE
 * BUG. A row that quietly leaves the promoter's view still reads as "pending"
 * to the person who sent it: they wait on a reply nobody was ever prompted to
 * make. That is the same failure as the duplicate enquiry that faked success
 * (2026-08-10) — the screen looked resolved and the human was left stranded. So
 * the funnel is only ever cleared by actually ANSWERING people: a real decline,
 * with the notification that decline already sends.
 *
 * ⭐ THE HOST IS ASKED, NEVER ASSUMED. This is a bulk decline of real people;
 * it runs on an explicit confirmation, and it reports exactly who it will
 * touch before it touches them.
 */

/**
 * ⛔ ONLY THE UNANSWERED. `pending` is the PIPELINE — nobody has acted on it.
 * `tentative` is the SHORT LIST, someone the promoter deliberately kept alive
 * (see EventHostView: `shortList = tentative`, `pipeline = pending`), and
 * `offered`/`accepted` are commitments. A sweep that took those would delete
 * the promoter's own decisions, which is precisely the destructive misfire this
 * design has to avoid. Anyone moved forward is left for a human to answer.
 */
const SWEEPABLE = ['pending', 'new'];

export function isSweepable(status) {
  return SWEEPABLE.includes(String(status || 'pending').toLowerCase());
}

/**
 * Everything still queued for a date that has just been locked.
 *
 * Two funnels, and they are NOT interchangeable:
 *   · applications — to THIS event. Unambiguously the host's own funnel.
 *   · venue enquiries — for this DATE at this VENUE. Someone else's records
 *     unless the publisher also owns that venue.
 *
 * ⛔⛔ ONLY THE PARTY WHO RECEIVED AN ENQUIRY MAY DECLINE IT. A host publishing
 * an event at a venue they do not own must not touch that venue's enquiries —
 * it would be one account answering another account's mail. `venueProfileId` is
 * therefore only ever passed in when the viewer's OWN venue profile matches the
 * event's, and the caller proves that rather than this function assuming it.
 *
 * @returns {Promise<{applications: Array, enquiries: Array, date: string|null}>}
 */
export async function findOpenAsksForDate({ supabase, eventId, date, venueProfileId = null }) {
  if (!date) return { applications: [], enquiries: [], date: null };

  const appsQ = supabase.from('applications')
    .select('id, status, event_id, artist_id, from_profile_id, created_at')
    .eq('event_id', eventId)
    .in('status', SWEEPABLE);

  // ⛔ Applicant-initiated only. A venue-initiated row is an INVITATION the
  // venue itself sent; sweeping it would cancel the promoter's own outreach.
  const enqQ = venueProfileId
    ? supabase.from('venue_enquiries')
        .select('id, status, date_requested, applicant_user_id, applicant_profile_id, venue_profile_id')
        .eq('venue_profile_id', venueProfileId)
        .eq('date_requested', date)
        .eq('initiated_by', 'applicant')
        .in('status', SWEEPABLE)
    : Promise.resolve({ data: [] });

  const [appsRes, enqRes] = await Promise.all([appsQ, enqQ]);
  return {
    applications: appsRes?.data || [],
    enquiries:    enqRes?.data  || [],
    date,
  };
}

/**
 * Decline everything found, and tell each person.
 *
 * ⚠ THE NOTIFICATION IS THE POINT, not a courtesy on top. A status write with
 * no notice produces exactly the silent-vanish this whole mechanism exists to
 * prevent — the funnel would look clean and the people in it would still be
 * waiting.
 *
 * ⚠ Each notification is written individually and failures are counted rather
 * than thrown: one undeliverable notice must not abort the remaining declines
 * and leave the sweep half-applied.
 *
 * @returns {Promise<{declined: number, notified: number, failed: number}>}
 */
export async function declineOpenAsks({
  supabase, applications = [], enquiries = [], writeNotification,
  eventName = null, venueName = null, resolveToProfileId = null,
}) {
  let declined = 0, notified = 0, failed = 0;

  const appIds = applications.map(a => a.id);
  if (appIds.length) {
    // ⛔ Re-asserts the status filter in the WRITE, not only in the read. A row
    // shortlisted between the dialog opening and the confirmation must not be
    // swept by a decision made about a list that no longer describes it.
    const { error } = await supabase.from('applications')
      .update({ status: 'declined' }).in('id', appIds).in('status', SWEEPABLE);
    if (error) failed += appIds.length; else declined += appIds.length;
  }

  const enqIds = enquiries.map(e => e.id);
  if (enqIds.length) {
    const { error } = await supabase.from('venue_enquiries')
      .update({ status: 'declined' }).in('id', enqIds).in('status', SWEEPABLE);
    if (error) failed += enqIds.length; else declined += enqIds.length;
  }

  const recipients = [
    ...applications.map(a => ({
      userId: a.artist_id,
      profileId: a.from_profile_id,
      // ⛔ Names the EVENT, because that is what they applied to.
      message: `Your application${eventName ? ` for ${eventName}` : ''} was not successful this time.`,
      data: { event_id: a.event_id, event_name: eventName },
    })),
    ...enquiries.map(e => ({
      userId: e.applicant_user_id,
      // ⭐ The row already names the profile that asked — never re-derived.
      // Re-deriving is what addressed a host's reply to their DJ act.
      profileId: e.applicant_profile_id,
      message: `${venueName || 'The venue'} has confirmed another booking for ${e.date_requested}.`,
      data: { enquiry_id: e.id, date_requested: e.date_requested, venue_name: venueName },
    })),
  ];

  for (const r of recipients) {
    if (!r.userId) { failed += 1; continue; }
    try {
      await writeNotification({
        toUserId:       r.userId,
        toProfileId:    r.profileId ?? (resolveToProfileId ? await resolveToProfileId(r.userId) : null),
        aboutProfileId: null,
        type:    'application_declined',
        message: r.message,
        data:    r.data,
      });
      notified += 1;
    } catch {
      failed += 1;
    }
  }

  return { declined, notified, failed };
}
