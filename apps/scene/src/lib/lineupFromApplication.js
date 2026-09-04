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
import { normaliseStatus, PIPELINE_BUCKETS } from './enquiryUtils';
/* ⭐ ONE SPELLING OF THE RESOLUTION STATE, imported rather than repeated, so a
   literal here can never drift from what `answerOpenRequests` writes on the
   other three routes onto a bill. */
import { RESOLVED_BY_BOOKING } from './answerOpenRequests';

/**
 * ── ⭐⭐ THE PIPELINE IS WHAT IS STILL WAITING, AND SOMEBODY ON THE BILL IS NOT ─
 *
 * ⛔⛔ A DEFENSIVE INVARIANT, ⛔ NOT THE FIX (owner, 2026-09-04). The real
 * repair is that booking somebody resolves what they asked; this guard exists
 * so that when a row slips through anyway — a route nobody remembered, a write
 * that RLS filtered silently, a legacy row from before the arrow existed — the
 * host is not shown a person as awaiting their decision while that same person
 * stands on the bill two tabs away. ⭐ It must therefore stay even once every
 * write path is centralised: an invariant that is only true while the code is
 * correct is not an invariant.
 *
 * ⚠ Cosmatik on `YesPleez pres` (17 Oct) was in LINEUP and in PIPELINE at once,
 * and both readings were honest — `lineup_members` and `applications` are
 * different tables and nothing compared them.
 *
 * ⛔ ON-BILL ONLY. A SHORTLISTED member is somebody the host is considering and
 * has decided nothing about, so their application genuinely is still waiting;
 * hiding it would be the same class of lie in the other direction. Pass the
 * bill, ⛔ never the mixed array.
 *
 * ⚠⚠ SCOPED BY EVENT, so a MIXED list is safe. `HostDashboard` holds every
 * application and every bill member across all of a host's events at once, and
 * `findExistingMember` asks only "is this the same person" — it has no idea
 * which night it is being asked about. Without this scoping a resident booked
 * on next Friday would silently answer for their application to a different
 * night, which is a far worse lie than the one being fixed.
 *
 * @param apps       applications, for one event or many
 * @param onBill     `lineup_members` with status 'on_bill', for one event or many
 * @param profileFor (app) => the applicant's profile row, for the name key
 */
export function pipelineApplications(apps = [], onBill = [], profileFor = () => null) {
  return (apps || []).filter(a => {
    if (!PIPELINE_BUCKETS.includes(normaliseStatus({ status: a?.status, direction: 'incoming' }))) {
      return false;
    }
    /**
     * ⛔ Only members of THIS application's event may answer for it.
     *
     * ⚠⚠ A MEMBER WITH NO `event_id` IS ALREADY SCOPED BY ITS CALLER, ⛔ not
     * unknown. `useEventData` selects the bill with `.eq('event_id', id)` and
     * therefore never selects the column — so requiring it here would filter
     * every member away and quietly disable the guard on the event page, which
     * is the surface it was written for. `HostDashboard` fetches across events
     * and does select it, so the mixed list is scoped properly there.
     */
    const sameNight = (onBill || []).filter(m =>
      /**
       * ⛔⛔ ONLY A ROW EXPLICITLY `on_bill` MAY HIDE AN APPLICANT, and this is
       * checked here rather than trusted from the caller. `findExistingMember`
       * answers "is this the same person" and knows nothing about status, so
       * handing it a mixed array would let a SHORTLISTED member — somebody the
       * host has decided nothing about — hide that same person's undecided
       * application. ⚠ That is the same lie in the other direction: it would
       * remove a real question from the queue.
       *
       * ⚠ Strict on purpose. Both callers select `status`, so a row without one
       * is not a shape either of them produces, and refusing to hide on it errs
       * towards showing a contradiction rather than concealing a decision.
       */
      m?.status === 'on_bill'
      && (m?.event_id == null || !a?.event_id || m.event_id === a.event_id));
    return !findExistingMember(a, sameNight, profileFor(a) || null);
  });
}

/**
 * ── ⭐⭐ SOMEBODY ON THE BILL IS NOT SOMEBODY YOU DECLINE ────────────────────
 *
 * ⛔⛔ MADDS ENDED UP `declined` WHILE ON THE BASS HEAVY BILL. `HostDashboard`'s
 * AppCard gated DECLINE on `bucket !== 'declined'` alone, so an ACCEPTED row
 * still offered it — under a label that said ACCEPTED · ON THE BILL, in green,
 * two lines above the button.
 *
 * ⭐ THE RULE THE OTHER THREE SURFACES ALREADY IMPLEMENT, three different ways:
 * `EventHostView`'s SHORTLIST branches on `isMember` and substitutes REMOVE
 * FROM EVENT; its PIPELINE and ACCEPTED tabs exclude members by list
 * construction. This is that rule, written once so a fourth surface cannot
 * disagree with the first three.
 *
 * ⛔⛔ `accepted` IS NOT GLOBALLY TERMINAL, and this must not make it so.
 * ACCEPTED-but-NOT-on-the-bill is the orphan cleanup — "You told these artists
 * yes and they were never added to the lineup" — and declining there is the
 * whole point of that tab. ⚠ Suppressing DECLINE on every accepted row would
 * silently disable it.
 *
 * ⭐ ON THE BILL, ANY BUCKET. Not just `accepted`: a `seen` or `shortlisted`
 * application belonging to somebody already booked is the same situation, and
 * SHORTLIST's `isMember` branch already suppresses it for every status. Bill
 * management is a lineup action; ⛔ this module does not perform one.
 */
export function canDeclineApplication(bucket, onBill = false) {
  if (bucket === 'declined') return false;   // already the answer
  if (onBill) return false;                  // Remove from lineup, not decline
  return true;
}

/**
 * Is this application's applicant on the bill of its own event?
 *
 * ⭐ THE SAME QUESTION `HostDashboard` ALREADY ASKS to render ACCEPTED · ON THE
 * BILL, extracted so the action boundary can ask it too. ⛔ It opens no query:
 * `lineups` is the shape `buildHostLineup` already returns, and that builder is
 * handed `on_bill` members only — the mixed array is refused upstream.
 *
 * ⚠ SCOPED TO THE APPLICATION'S OWN EVENT. `lineups` spans every event the host
 * runs, and `findExistingMember` asks only "is this the same person", so
 * without the group lookup a resident booked on another night would answer for
 * this one.
 */
export function onBillForApplication(app, lineups = [], profile = null) {
  if (!app?.event_id) return false;
  const group = (lineups || []).find(g => g?.event?.id === app.event_id);
  const members = (group?.members || []).map(r => r?.member).filter(Boolean);
  return !!findExistingMember(app, members, profile);
}

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

  /**
   * ⭐⭐ SETTLED, ⛔ NOT "ACCEPTED" — the two are different questions and the
   * old name answered only one of them. A settled application is never
   * re-stamped, so it is never downgraded and never re-notified.
   *
   * ⚠ `booked` IS LISTED DEFENSIVELY, and no longer describes any live row.
   * Four applications briefly held it (backfilled 2026-09-04, reverted
   * 2026-09-05) and `applications_status_check` no longer admits it, so nothing
   * can write it and nothing holds it. ⛔ Kept anyway: a settled-state test that
   * silently stops recognising a value is how a row comes to be treated as
   * undecided, and the cost of the extra string is nothing. `confirmed` is here
   * on the same basis — L5 removed it from the constraint too.
   */
  const alreadySettled = ['accepted', 'confirmed', 'booked'].includes(app.status);

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
     * ⭐⭐ ON THE BILL IS `booked`, ⛔ NOT `accepted` (owner, 2026-09-04).
     *
     * ⛔⛔ THIS ROUTE ACTUALLY PUTS THEM ON THE BILL, so the terminal truth is
     * `booked`. Writing `accepted` here left the SAME REAL FACT spelled two
     * ways in one column: `booked` when the person arrived via the shortlist,
     * a profile fill or the backfill, `accepted` when they arrived through
     * their own application. That is the two-vocabularies-in-one-column shape
     * the application state machine exists to prevent.
     *
     * ⭐ `accepted` KEEPS ITS MEANING EVERYWHERE ELSE: the host said yes to an
     * ask. It is still what `ApplicationsScreen` and `HostDashboard` write when
     * a host accepts WITHOUT booking. ⛔ This is not a rename.
     *
     * ⚠ Already settled (`accepted`, `confirmed`, `booked`) rewrites nothing —
     * see `alreadySettled`. So a second press is silent and a `booked` row is
     * never downgraded.
     */
    statusUpdate: alreadySettled ? null : RESOLVED_BY_BOOKING,
    /**
     * ⛔ SILENT WHEN THE DECISION DID NOT CHANGE. Q3 says joining the bill
     * notifies nobody; the only thing worth telling someone is that their
     * APPLICATION was accepted, and only the first time.
     */
    notify: alreadySettled ? null : 'accepted',
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

  /**
   * `accepted` says whether this add-to-bill WAS an accept decision, so the
   * CALLER can observe it (AV5's application_accepted) — this module stays
   * free of the analytics/supabase imports, per its injected-db contract.
   *
   * ⚠⚠ IT ASKS WHETHER A DECISION HAPPENED, ⛔ NOT WHAT STRING WAS WRITTEN.
   * It used to read `plan.statusUpdate === 'accepted'`, which silently became
   * false the moment this route started persisting `booked` — and
   * `application_accepted` would have stopped firing for `via: 'add_to_bill'`
   * while the host kept making exactly the same decision. The event measures
   * THE HOST ACCEPTING (its two call sites are told apart by `via`), so it must
   * not be keyed on the persisted vocabulary.
   */
  return { ok: true, error: null, memberId: data?.id ?? null, accepted: !!plan.statusUpdate };
}
