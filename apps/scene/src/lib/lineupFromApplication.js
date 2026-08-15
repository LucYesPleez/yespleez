/**
 * AN APPLICATION BECOMES BILL MEMBERSHIP — the missing arrow.
 *
 * ⭐⭐ THE ARROW THAT DID NOT EXIST. `respondApp` only ever wrote
 * `applications.status`; nothing anywhere created a `lineup_member` from an
 * application. So a host could accept ten people and the bill stayed empty, and
 * the only routes onto a bill were the event page's ASSIGN SLOT or a direct
 * add. That absence is why the old code faked the connection by treating
 * "accepted application" AS the bill — the defect this whole sequence removed.
 *
 * ── THE RULES THIS OBEYS ────────────────────────────────────────────────────
 *
 * ⭐ Q3 (ratified 2026-08-15): adding an act to `lineup_members` is a PRIVATE
 *    host-side action and ⛔ notifies nobody. Offering a SLOT is the actionable
 *    offer. So joining the bill is silent; only the APPLICATION DECISION can
 *    speak, and only when it actually changes.
 *
 * ⭐ The invariant: an application may FEED membership, ⛔ never gate it.
 *    Nothing here reads the bill to decide what an event is; it only writes.
 *
 * ⭐ M6: the application already NAMES the profile that applied
 *    (`from_profile_id`). ⛔ Never re-derive it — `resolveProfileId` guesses
 *    from the account and can only return an 'artist', which is wrong for a
 *    band or a comedian.
 *
 * ⛔ NO `performances` ROW IS CREATED. Being on the bill is not being given a
 *    time. 123 of 152 members hold no performance; that is the normal state.
 */

/** Is this applicant already on this event's bill? */
export function findExistingMember(app, members = []) {
  if (!app) return null;
  return (members || []).find(m =>
    (app.from_profile_id && m.artist_profile_id === app.from_profile_id) ||
    (app.artist_id && m.artist_id === app.artist_id),
  ) || null;
}

/**
 * @returns {{ok:false, reason:string}}
 *        | {{ok:true, member:object, statusUpdate:?string, notify:?string}}
 */
export function planAddToBill(app, profile = null, members = []) {
  if (!app?.event_id) return { ok: false, reason: 'no application' };

  /**
   * ⛔ IDEMPOTENT. The button can be double-tapped, and the ACCEPTED tab and
   * the SHORT LIST can both offer it for the same person. A second press must
   * not put someone on the bill twice — `lineup_members` has no uniqueness
   * constraint to catch it, so this is the only guard.
   */
  const existing = findExistingMember(app, members);
  if (existing) return { ok: false, reason: 'already on the bill', existing };

  /**
   * ⛔ A DECLINED APPLICATION IS NOT A CANDIDATE. The host said no; putting
   * them on the bill would contradict a decision they made and left visible.
   * Undecline first, deliberately.
   */
  if (app.status === 'declined' || app.status === 'rejected') {
    return { ok: false, reason: 'this application was declined' };
  }

  const alreadyAccepted = app.status === 'accepted' || app.status === 'confirmed';

  return {
    ok: true,
    // ⚠ Carried on the plan so the executor never has to be handed the
    // application a second time and cannot be handed a DIFFERENT one.
    appId: app.id,
    member: {
      event_id:          app.event_id,
      artist_id:         app.artist_id || null,
      // ⚠ From the APPLICATION, never re-derived. See M6 above.
      artist_profile_id: app.from_profile_id || null,
      artist_name:       profile?.name || app.artist_name || null,
      sound:             profile?.sound || null,
      genre:             profile?.genre_string || null,
      status:            'on_bill',
    },
    /**
     * ⭐ PUTTING SOMEONE ON THE BILL IS SAYING YES. If the host had only
     * shortlisted them, the decision moves to `accepted` — that IS the host
     * decision this column records. If it was already accepted, ⛔ nothing is
     * rewritten: re-stamping a status it already holds would fire a second
     * notification for a decision made days ago.
     */
    statusUpdate: alreadyAccepted ? null : 'accepted',
    /**
     * ⛔ SILENT WHEN THE DECISION DID NOT CHANGE. Q3 says joining the bill
     * notifies nobody; the only thing worth telling someone is that their
     * APPLICATION was accepted, and only the first time.
     */
    notify: alreadyAccepted ? null : 'accepted',
  };
}

/**
 * @param db       supabase client
 * @param plan     from planAddToBill
 * @returns {Promise<{ok:boolean, error:?string, memberId:?string}>}
 */
export async function addToBill(db, plan) {
  if (!plan?.ok) return { ok: false, error: plan?.reason || 'nothing to do', memberId: null };

  const { data, error } = await db.from('lineup_members')
    .insert(plan.member).select('id').single();
  /**
   * ⚠ SURFACED, NEVER SWALLOWED. Until L1 the host could not write this table
   * on 22 events, and an INSERT there fails LOUDLY (42501) while an UPDATE
   * fails silently. Reporting it is what makes a policy regression visible
   * instead of looking like a button that does nothing.
   */
  if (error) return { ok: false, error: error.message, memberId: null };

  if (plan.statusUpdate) {
    const { error: sErr } = await db.from('applications')
      .update({ status: plan.statusUpdate }).eq('id', plan.appId);
    // ⚠ NOT FATAL. They ARE on the bill — that write succeeded and is the
    // thing that matters. A failed status update leaves the application
    // shortlisted, which is recoverable and visible, rather than rolling back
    // a membership the host can see on screen.
    if (sErr) return { ok: true, error: `On the bill, but the application status was not updated: ${sErr.message}`, memberId: data?.id ?? null };
  }

  return { ok: true, error: null, memberId: data?.id ?? null };
}
