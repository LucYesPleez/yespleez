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
/* ⭐ THE CAP LIVES WITH THE BILL, ⛔ not here. `hostLineup` owns what the bill
   IS; this module owns one arrow into it and asks that module the question. */
import { billCapacity, billFullMessage } from './hostLineup';

export function findExistingMember(app, members = [], profile = null) {
  if (!app) return null;
  /**
   * ⚠ THE NAME IS THE THIRD KEY, and it is load bearing. A hand-typed act has
   * no profile and no account — 21 such members exist — so without this the
   * ONLY de-duplication available to them is nothing at all, and ADD TO BILL
   * becomes infinitely repeatable. That is exactly the incident of 2026-08-15.
   *
   * ⛔ Compared only when BOTH sides lack ids, and only for a NON-EMPTY name.
   * Two blank names must never match: that is how an all-NULL row would come
   * to "already be" every applicant.
   */
  const name = String(profile?.name || app.artist_name || '').trim().toLowerCase();
  return (members || []).find(m =>
    (app.from_profile_id && m.artist_profile_id === app.from_profile_id) ||
    (app.artist_id && m.artist_id === app.artist_id) ||
    (!!name && !app.from_profile_id && !app.artist_id
      && !m.artist_profile_id && !m.artist_id
      && String(m.artist_name || '').trim().toLowerCase() === name),
  ) || null;
}

/**
 * @returns {{ok:false, reason:string}}
 *        | {{ok:true, member:object, statusUpdate:?string, notify:?string}}
 */
/**
 * @param opts.totalSlots ⭐ THE CAP. Omitted or 0 means "this event has no
 *   running order", which is ⛔ NOT a cap of zero — see `billCapacity`.
 */
export function planAddToBill(app, profile = null, members = [], opts = {}) {
  if (!app?.event_id) return { ok: false, reason: 'no application' };

  /**
   * ⛔⛔ THE BILL CANNOT OUTGROW THE RUNNING ORDER (owner, 2026-08-16).
   *
   * ⚠ CHECKED HERE, in the planner, ⛔ not at the button. Three surfaces add to
   * a bill and a rule enforced at one of them is a rule that holds two thirds
   * of the time — which is worse than none, because it looks enforced.
   *
   * ⚠ Counts `on_bill` ONLY. A shortlisted member is somebody you are
   * considering and occupies no slot, so they must not consume the capacity.
   */
  const onBill = (members || []).filter(m => m?.status === 'on_bill').length;
  const cap = billCapacity(onBill, opts.totalSlots);
  if (cap.full) return { ok: false, reason: billFullMessage(cap.total), full: true };

  /**
   * ⛔ IDEMPOTENT. The button can be double-tapped, and the ACCEPTED tab and
   * the SHORT LIST can both offer it for the same person. A second press must
   * not put someone on the bill twice — `lineup_members` has no uniqueness
   * constraint to catch it, so this is the only guard.
   */
  const existing = findExistingMember(app, members, profile);
  if (existing) return { ok: false, reason: 'already on the bill', existing };

  /**
   * ⛔ A DECLINED APPLICATION IS NOT A CANDIDATE. The host said no; putting
   * them on the bill would contradict a decision they made and left visible.
   * Undecline first, deliberately.
   */
  if (app.status === 'declined' || app.status === 'rejected') {
    return { ok: false, reason: 'this application was declined' };
  }

  /**
   * ⛔⛔ AN APPLICATION WITH NO IDENTITY CANNOT JOIN A BILL.
   *
   * ⚠⚠ THIS CAUSED A REAL INCIDENT (2026-08-15). Application `73dee72b` on
   * `fds` carries `from_profile_id` NULL, `artist_id` NULL AND `artist_name`
   * NULL — nothing that names anybody. `findExistingMember` matches on those
   * two ids, so it could never match, so the idempotency guard could never
   * fire: every press of ADD TO BILL inserted ANOTHER anonymous member. The
   * owner pressed it repeatedly because nothing appeared to change, and fds
   * went from 7 members to 16. Eight all-NULL rows, deleted afterwards.
   *
   * ⭐ The guard is not "de-duplicate harder" — it is that this row is not a
   * candidate at all. A member with no name, no profile and no account is not
   * a person on a bill; it is a blank row. Refusing it is the honest answer,
   * and it makes the anonymous case impossible rather than merely rarer.
   *
   * ⚠ `artist_name` counts as identity: a hand-typed act legitimately has no
   * profile and no account, and those ARE valid bill members (21 exist). What
   * is refused is having none of the three.
   */
  const hasIdentity = !!(app.from_profile_id || app.artist_id
    || (profile?.name || app.artist_name || '').trim());
  if (!hasIdentity) {
    return { ok: false, reason: 'This application does not identify anybody — no profile, no account and no name — so it cannot be added to the bill.' };
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
