/**
 * ── ⭐⭐ PUTTING SOMEBODY ON THE BILL RESOLVES WHAT THEY ASKED ───────────────
 *
 * RATIFIED 2026-09-04, after Cosmatik appeared on the LINEUP of `YesPleez pres`
 * (17 Oct) and in its PIPELINE as awaiting decision at the same time. Both
 * readings were true, which is what made it a model bug and not a display one:
 * the bill and the request queue are different tables and only one arrow
 * between them had ever been built.
 *
 *     enquiry / application  ──→  LINEUP        wired (acceptedEnquiryEvent,
 *                                                      planAddToBill)
 *     LINEUP  ──→  enquiry / application        ⛔ DID NOT EXIST
 *
 * So every route onto a bill EXCEPT an applicant's own card left their open
 * request where it was: direct artist search, shortlist promotion,
 * `FillSlotModal`, `doAssign`. The host saw a contradiction; the ARTIST saw
 * "awaiting decision" while standing on a published lineup, which is the worse
 * half and the reason this is not cosmetic.
 *
 * ── ⭐⭐ THE STATE IT WRITES IS `accepted` (owner, 2026-09-05) ───────────────
 *
 * ⚠⚠ AN EARLIER CUT WROTE `booked`, AND THAT WAS WRONG. It read as a safer
 * choice — a distinct state, so "resolved because I was booked" could not be
 * confused with "the host said yes to my ask" — and the reconstruction of the
 * state machine from the repository showed it was not:
 *
 * ⛔⛔ 1 · `booked` IS A DERIVED QUESTION, AND STORING IT CREATES A SECOND,
 * WRONG ANSWER. `hostLineup.isBooked` already answers it, and its answer
 * depends on the event's contract (`lib/eventProvenance`): for legacy and
 * imported events `on_bill` IS booked, but for a MANAGED event booking is
 * MUTUAL — only `performances.status = 'accepted'`, the ARTIST's agreement,
 * counts. Every route here fires when the HOST acts, so on a managed event a
 * stored `booked` would assert a booking `isBooked` reports as false.
 *
 * ⛔ 2 · IT IS NOT THE APPLICATION VOCABULARY. L4 defines the six canonical
 * values and L5 exists to narrow to exactly them. `booked` was historically a
 * `venue_enquiries` value, written by a `respond('booked')` button removed long
 * ago; zero rows in that table have ever held it.
 *
 * ⛔ 3 · IT WAS NEVER NEEDED. `accepted` buckets out of PIPELINE exactly as
 * `booked` does (`normaliseStatus` maps both to the ACCEPTED bucket), so the
 * bug this module exists to close — somebody on the bill still showing as
 * awaiting a decision — is closed either way.
 *
 * ⭐ SO `accepted` IS CORRECT HERE, and it is not the "universal side effect"
 * that was refused. That objection was to writing it from paths where no host
 * decision had been made. Every route that calls this HAS put the person on the
 * bill, which IS the host saying yes — L4: "⭐ the HOST said yes. ⛔ NEVER 'the
 * artist agreed'." The artist's agreement stays where it has always lived, on
 * `performances`, and nothing here touches it.
 *
 * ⚠ FOUR PRODUCTION ROWS STILL HOLD `booked` from the 2026-09-04 backfill, and
 * L5 as applied still permits it. Nothing writes it any more. ⛔ Do not treat
 * those rows as precedent.
 */

/**
 * ⚠⚠ NOTHING HERE MAY IMPORT `./supabase`, DIRECTLY OR THROUGH A FRIEND.
 * `writeNotification` does, and importing it at module scope made every test in
 * this file die on `import.meta.env` before a single assertion ran. `db` and
 * `notify` are therefore both INJECTED, exactly as `addToBill(db, plan)` takes
 * its client — which is what keeps the rules above testable at all.
 */
import { rawStatusesFor } from './enquiryUtils';

/**
 * ⭐⭐ THE ONE RESOLUTION STATE, exported so every route onto a bill writes the
 * same thing and a literal can never drift from it.
 *
 * ⚠ THE NAME DESCRIBES THE OCCASION, ⛔ NOT THE VALUE: this is the state
 * written WHEN a request is resolved BY a booking, and that state is the host's
 * `accepted`. ⛔ Do not read the constant's name as an argument for putting
 * `booked` back — see the header for the three reasons it came out.
 */
export const RESOLVED_BY_BOOKING = 'accepted';

/**
 * ⭐ THE TABLES THIS MAY WRITE.
 *
 * Both admit `accepted`: `venue_enquiries.status` carries no CHECK at all (only
 * `initiated_by` is constrained), and `applications_status_check` has listed it
 * among the six canonical values since L4 — so this needs no migration and L5
 * does not threaten it.
 */
export const RESOLVABLE_TABLES = ['venue_enquiries', 'applications'];

/**
 * ⭐ DERIVED FROM THE ONE STATUS MAP, ⛔ never hand-typed beside it.
 *
 * `enquiryUtils` owns every spelling both vocabularies use and `rawStatusesFor`
 * exists so a server-side `.in()` cannot drift from what the renderer buckets.
 *
 * ⚠ SHORTLISTED COUNTS AS OPEN. Being considered is not being answered, and a
 * shortlisted applicant who is then booked has had their question resolved by
 * the booking exactly as an undecided one has.
 */
export const OPEN_REQUEST_STATUSES = [
  ...new Set([
    ...rawStatusesFor('new'),
    ...rawStatusesFor('seen'),
    ...rawStatusesFor('shortlisted'),
  ]),
];

/** Is this row still waiting on the host, in either vocabulary? */
export function isOpenRequest(row) {
  return OPEN_REQUEST_STATUSES.includes(String(row?.status || 'pending').toLowerCase());
}

/**
 * ⛔⛔ THE PROFILE IS THE ONLY KEY. ⛔ NEVER `artist_id`, ⛔ NEVER THE NAME.
 *
 * `lineup_members.artist_id` is an ACCOUNT (`FillSlotModal` writes
 * `prof.user_id` into it), and `profiles.user_id` is not an identity: it is
 * frequently NULL and it is SHARED by every profile on one account. Matching a
 * request on it would let a booking of somebody's DJ profile resolve an enquiry
 * their band sent. A name match is worse again, because two acts legitimately
 * share one.
 *
 * ⭐ The honest consequence: a hand-typed act with no profile resolves nothing.
 * They never asked, so there is nothing of theirs to resolve. Legacy rows whose
 * `from_profile_id` was never populated are skipped rather than guessed at.
 */
export function requestSubjectId(member) {
  return member?.artist_profile_id || null;
}

/**
 * Does this enquiry belong to the same conversation as this event?
 *
 * ⚠⚠ THE DATE ALONE IS NOT ENOUGH, and this is the trap worth naming. An artist
 * may have three enquiries out for one Saturday to three different places.
 * Resolving all of them because one promoter booked them would tell two other
 * venues' asks they were booked, by somebody who never saw them.
 *
 * ⭐ So an unlinked enquiry must match the NIGHT *and* the RECEIVING SIDE, and
 * the receiving side is checked against BOTH of the event's authority columns:
 * a venue-run night has the venue in `venue_profile_id`, while an artist asking
 * a promoter puts that promoter in the enquiry's `venue_profile_id` and the
 * event's `owner_profile_id`. ⛔ Neither column alone covers both shapes.
 */
export function enquiryBelongsToEvent(enq, event) {
  if (!enq || !event?.id) return false;
  // Already linked — `VenueDashboard` writes `event_id` when it attaches one.
  if (enq.event_id) return enq.event_id === event.id;

  const night = event?.config?.date || null;
  if (!night || enq.date_requested !== night) return false;

  const receiver = enq.venue_profile_id || null;
  if (!receiver) return false;
  return receiver === (event.owner_profile_id || null)
      || receiver === (event.venue_profile_id || null);
}

/**
 * Which open requests does this new bill member have, and what do we owe them?
 *
 * PURE. ⛔ Reads nothing and writes nothing, so every rule above is testable
 * without a database and without a browser.
 *
 * @param opts.skipApplicationId ⭐⭐ THE DOUBLE-NOTIFY GUARD. `planAddToBill`
 *   already answers and announces the application it was handed. Passing that
 *   id here is what stops the applicant's own ADD TO LINEUP button saying the
 *   same thing twice, in two rows, one second apart.
 * @returns {{enquiryIds:string[], applicationIds:string[], notify:object|null}}
 */
export function planAnswerRequests({
  member, event, applications = [], enquiries = [], skipApplicationId = null,
} = {}) {
  const none = { enquiryIds: [], applicationIds: [], notify: null };

  const subject = requestSubjectId(member);
  if (!subject || !event?.id) return none;

  const applicationIds = (applications || [])
    .filter(a => a?.event_id === event.id
      && a.from_profile_id === subject
      && a.id !== skipApplicationId
      && isOpenRequest(a))
    .map(a => a.id);

  const enquiryIds = (enquiries || [])
    .filter(e => e?.applicant_profile_id === subject
      && isOpenRequest(e)
      && enquiryBelongsToEvent(e, event))
    .map(e => e.id);

  if (!enquiryIds.length && !applicationIds.length) return none;

  return {
    enquiryIds,
    applicationIds,
    /**
     * ⭐⭐ ONE NOTIFICATION FOR THE PERSON, ⛔ NOT ONE PER ROW. Somebody who
     * asked twice about one night would otherwise hear back twice, which reads
     * as two separate bookings.
     *
     * ⛔⛔ ONLY WHEN SOMETHING ACTUALLY MOVED. A notification for a row still
     * sitting at `pending` is worse than silence: it tells somebody they are
     * resolved while every surface still shows them waiting. The executor
     * enforces the other half of this — a failed write sends nothing.
     *
     * ⚠ THE COPY NAMES NO NOUN, deliberately: one message may resolve an
     * enquiry, an application, or both. ⛔ It must not say "booked" in the slot
     * sense either — being on the bill is not being given a time, and a SET
     * TIME is a separate offer they have not had yet.
     */
    notify: {
      toUserId:       member.artist_id || null,
      toProfileId:    subject,
      aboutProfileId: event.owner_profile_id ?? null,
      type:           'booking_confirmed',
      message:        `You are on the lineup for ${event.name}.`,
      data: {
        event_id:         event.id,
        event_name:       event.name,
        lineup_member_id: member.id ?? null,
      },
    },
  };
}

/**
 * Fetch this member's open requests, resolve the ones the schema allows, and
 * tell them once.
 *
 * ⭐ CALLED AFTER THE MEMBER IS ON THE BILL, never before. If the write failed
 * there is nothing to report, and resolving first would leave a resolved
 * request with nobody on the bill — the orphan state the ACCEPTED tab exists to
 * clean up.
 *
 * ⚠ NEVER FATAL. Its caller has already done what the host asked. A failure
 * here is reported for the caller to surface if it wishes; ⛔ it must not turn
 * a successful booking into an error message.
 *
 * @param opts.notify the notification writer, injected. ⛔ Not imported — see
 *   the note at the top of the imports.
 * @returns {{resolved:number, notified:boolean, error:string|null}}
 */
export async function answerOpenRequests(db, {
  event, member, skipApplicationId = null, notify = null,
} = {}) {
  const quiet = { resolved: 0, notified: false, error: null };

  const subject = requestSubjectId(member);
  if (!subject || !event?.id) return quiet;

  /* ⚠ FETCHED BY THE OPEN STATUSES, not filtered afterwards. A settled row is
     never read, so a second run finds nothing to do and notifies nobody — the
     idempotency is a property of the query rather than a flag somebody has to
     remember to check. */
  const night = event?.config?.date || null;
  const enquiryCols = 'id, event_id, applicant_profile_id, venue_profile_id, date_requested, status';
  const enquiryQuery = db.from('venue_enquiries')
    .select(enquiryCols)
    .eq('applicant_profile_id', subject)
    .in('status', OPEN_REQUEST_STATUSES);

  const [appsRes, enqRes] = await Promise.all([
    db.from('applications')
      .select('id, event_id, from_profile_id, status')
      .eq('event_id', event.id)
      .eq('from_profile_id', subject)
      .in('status', OPEN_REQUEST_STATUSES),
    /* ⚠ The event link and the night are fetched together because an enquiry
       may reach this event either way; `enquiryBelongsToEvent` decides which of
       them counts and does the receiving-side check the query cannot express.
       ⛔ Do not narrow this to `event_id`: the enquiry that produced this bug
       names no event at all. */
    night
      ? enquiryQuery.or(`event_id.eq.${event.id},date_requested.eq.${night}`)
      : enquiryQuery.eq('event_id', event.id),
  ]);

  const plan = planAnswerRequests({
    member,
    event,
    applications: appsRes?.data || [],
    enquiries:    enqRes?.data || [],
    skipApplicationId,
  });

  const resolving = plan.enquiryIds.length + plan.applicationIds.length;
  if (!resolving) return quiet;

  /* ⚠ BOTH TABLES TAKE THE SAME STATE, and both may be empty. `applications`
     joined this list on 2026-09-04 when its CHECK was widened; before that it
     could only be counted, never written. */
  const writes = [];
  if (plan.enquiryIds.length) {
    writes.push(db.from('venue_enquiries')
      .update({ status: RESOLVED_BY_BOOKING }).in('id', plan.enquiryIds));
  }
  if (plan.applicationIds.length) {
    writes.push(db.from('applications')
      .update({ status: RESOLVED_BY_BOOKING }).in('id', plan.applicationIds));
  }
  const error = (await Promise.all(writes)).find(r => r?.error)?.error || null;

  /**
   * ⛔⛔ NO RESOLUTION, NO ANNOUNCEMENT. ⚠ RLS FILTERS AN UPDATE, IT DOES NOT
   * ERROR IT — a blocked write reports success and changes nothing, which is
   * how 22 events came to be silently uneditable. So a failure here suppresses
   * the notification rather than sending one for a status that did not move.
   */
  if (error) return { resolved: 0, notified: false, error: error.message };

  const notifyError = plan.notify && notify ? await notify(plan.notify) : null;
  return {
    resolved: resolving,
    notified: !!plan.notify && !!notify && !notifyError,
    error: notifyError ? notifyError.message || String(notifyError) : null,
  };
}
