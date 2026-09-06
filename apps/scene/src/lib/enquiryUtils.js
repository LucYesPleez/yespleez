import { today, isPastDate } from './dates';

export const STATUS_TAB_COLOR = {
  NEW:         '#FFD700',
  AWAITING:    '#FFD700',
  SEEN:        '#FF8C42',
  SHORTLISTED: '#00B4D8',
  INTERESTED:  '#00B4D8',
  CONSIDERING: '#00B4D8',
  ACCEPTED:    '#00E5A0',
  BOOKED:      '#00E5A0',
  DECLINED:    '#888',
  REJECTED:    '#888',
  HISTORY:     '#888',
};

// Single source of truth for raw application/offer status -> display tab.
// Every status that can ever be written (see EventScreen.jsx, HostDashboard.jsx,
// notifActions.js) must resolve to exactly one entry here per direction —
// anything missing silently counts toward the direction's total badge while
// never appearing under any status tab. 'offered'/'confirmed' (from the host
// slot-offer flow) and 'rejected' (the host's reject action) used to fall
// through both maps below.
const INCOMING_STATUS_MAP = {
  pending:     'new',
  new:         'new',
  viewed:      'seen',
  seen:        'seen',
  tentative:   'shortlisted',
  shortlisted: 'shortlisted',
  offered:     'shortlisted',
  accepted:    'accepted',
  confirmed:   'accepted',
  booked:      'accepted',
  declined:    'declined',
  rejected:    'declined',
  /**
   * ⚠ THE ASKER WALKED AWAY. Without this line a withdrawn enquiry falls to
   * the map's default and lands in the venue's NEW bucket — an ask nobody is
   * waiting on, sitting at the top of their inbox.
   *
   * ⛔ It files under DECLINED here because that is the venue's "off the
   * table" pile, not because anyone declined it. On the ASKER's side it is
   * never bucketed at all: cancelling also sets `applicant_cleared_at`, so
   * the row leaves their list entirely (owner, 2026-08-14 — "declined is only
   * to show me applications that have been declined by the places i applied
   * to").
   */
  cancelled:   'declined',
};
const OUTGOING_STATUS_MAP = {
  pending:     'awaiting',
  new:         'awaiting',
  tentative:   'interested',
  shortlisted: 'interested',
  offered:     'interested',
  accepted:    'accepted',
  confirmed:   'accepted',
  booked:      'accepted',
  declined:    'declined',
  rejected:    'declined',
  /**
   * ⛔⛔ WITHOUT THIS A CANCELLED ASK COMES BACK AS `awaiting`.
   *
   * ⚠⚠ The incoming map got this line on 2026-08-14; the outgoing one did not,
   * and the gap only surfaced when a VENUE cancelled an offer it had sent
   * (2026-09-01). The applicant side never showed it because cancelling also
   * sets `applicant_cleared_at`, which removes the row from the query — so the
   * fallback was never reached. The venue side set no cleared column, so its
   * withdrawn offer reappeared at the top of its own AWAITING tab as though
   * nothing had happened. That is precisely what "cancel does nothing" was.
   *
   * ⛔ `declined` because that is the "off the table" pile, ⛔ NOT because
   * anyone declined it — the same reading the incoming map takes. Belt and
   * braces: the canceller's own list clears the row anyway.
   */
  cancelled:   'declined',
};

// `direction` is viewer-relative and is deliberately NOT stored: the same row is
// incoming to the venue and outgoing to the artist, so there is no correct value
// to put in a column. The database stores `initiated_by` ('venue' | 'applicant'),
// which is absolute; each screen derives direction from it plus which side is
// looking. Rows written before initiated_by existed default to 'applicant', which
// is correct by construction — venue-initiated inserts have never been possible
// (see docs/known-issues/venue-enquiries-schema-drift.md, backlog S4).
export function deriveDirection(enq, viewerSide) {
  const startedBy = (enq?.initiated_by || 'applicant').toLowerCase();
  return startedBy === viewerSide ? 'outgoing' : 'incoming';
}

/**
 * ⭐ WHICH SIDE'S "CLEARED" COLUMN BELONGS TO THIS VIEWER.
 *
 * One row, two lists, two markers: the venue tidies with `venue_cleared_at`,
 * the asker with `applicant_cleared_at`, and neither touches the other's.
 * Deriving it from the ROW plus the VIEWER — rather than letting each screen
 * decide — is what stops a surface hiding a row from the wrong person.
 *
 * ⚠ Falls back to the applicant column, matching `deriveDirection`'s own
 * default: a row whose venue side does not match the viewer is a row this
 * viewer is asking on.
 */
export function clearedColumnFor(enq, viewerProfileId) {
  return enq?.venue_profile_id && enq.venue_profile_id === viewerProfileId
    ? 'venue_cleared_at'
    : 'applicant_cleared_at';
}

// Attach the derived direction at the fetch site so every downstream consumer
// (EnquiryCard, EnquiryPanel, normaliseStatus) keeps reading `.direction`
// unchanged. viewerSide is 'venue' or 'applicant'.
export function withDirection(rows, viewerSide) {
  return (rows || []).map(e => ({ ...e, direction: deriveDirection(e, viewerSide) }));
}

// `e.direction` here is the derived value attached by withDirection(), not a column.
export function normaliseStatus(e) {
  const dir = (e.direction || 'incoming').toLowerCase();
  const st  = (e.status   || 'pending').toLowerCase();
  const map = dir === 'outgoing' ? OUTGOING_STATUS_MAP : INCOMING_STATUS_MAP;
  // An unrecognised status still needs a home rather than disappearing —
  // falls into the first ("just arrived") tab for its direction.
  return map[st] || (dir === 'outgoing' ? 'awaiting' : 'new');
}

/**
 * ⭐ A DECLINE FADES AFTER 30 DAYS (owner, 2026-08-14).
 *
 * A rejections list is useful for a while and then it is only a monument. This
 * hides settled-and-old rows from the asker's DECLINED tab without writing
 * anything: no cron, no job, no rows touched. A row that qualifies today
 * qualifies tomorrow, so the reading is stable, and nothing is destroyed —
 * clearing the browser does not resurrect it because the rule is time, not
 * state.
 *
 * ⚠ DERIVED, NOT STORED — and deliberately so, next to `applicant_cleared_at`
 * which IS stored. The manual clear is a DECISION the asker made and must
 * survive; "older than 30 days" is a FACT about the clock that needs no
 * record. Storing it would mean a job that has to run, and a row that lies
 * about being cleared if the job did not.
 *
 * ⚠ MEASURED FROM THE VENUE'S ANSWER where one is recorded, falling back to
 * when the ask was sent. `updated_at` does not exist on this table, so
 * `created_at` is the only honest clock — an old ask that was declined
 * yesterday will still fade on its send date. Revisit if the table ever grows
 * a decided_at.
 *
 * ⛔ NEVER APPLIED TO OPEN ROWS. Only a settled decline fades; an ask still
 * awaiting an answer stays visible no matter how long it has been waiting,
 * because waiting a long time is information, not clutter.
 */
/**
 * ⭐ THE INVERSE OF `normaliseStatus`, FOR QUERIES THAT CANNOT CALL IT.
 *
 * A client-side filter maps each row through `normaliseStatus`. A SERVER-side
 * count cannot: PostgREST needs the raw values up front. Hand-typing that list
 * beside the map is precisely how the two drift, so it is DERIVED from the same
 * object the renderer uses — add a spelling to the map and every query that
 * counts it follows automatically.
 *
 * ⚠⚠ WHY THIS EXISTS AT ALL. `HostDashboard` counted the PIPELINE with
 * `.eq('status','pending')` and `EventHostView` filtered SHORT LIST with
 * `status === 'tentative'`. Production holds ZERO rows of either spelling —
 * the host surfaces write `seen`/`shortlisted`/`accepted`/`declined` through
 * EnquiryCard, while those filters were written against the older vocabulary.
 * Both tabs were therefore permanently empty on every event.
 *
 * ⚠⚠ THIS RETURNS THE MAPPED SPELLINGS ONLY, WHICH IS NOT A WHOLE BUCKET.
 * `normaliseStatus` sends an UNRECOGNISED status — and a NULL one — to the
 * catch-all bucket ('new' / 'awaiting'), so `.in('status', rawStatusesFor(…))`
 * on THAT bucket is strictly narrower than the list it labels. This was
 * recorded here as a known and accepted limit, on the grounds that no `.in()`
 * list can express "anything not listed". That is true of `.in()` and false of
 * PostgREST.
 *
 * ⭐ Use `applyBucketFilter` for a server-side count: it picks the right form
 * per bucket. This stays for callers that genuinely want the spellings (unions
 * across several buckets, and the drift test below).
 */
/**
 * ⭐⭐ THE PIPELINE IS EVERYTHING UNDECIDED — `new` AND `seen`.
 *
 * ⚠⚠ `seen` IS WRITTEN BY LOOKING. `EnquiryCard` auto-marks an incoming row
 * `seen` the moment it is expanded. So a PIPELINE matching `new` alone means
 * OPENING an application removes it from the queue: on Bass Heavy the tab read
 * empty while an application sat there, because someone had once looked at it.
 *
 * ⛔ Reading is not deciding. The rule is already written down on the artist
 * side, in ArtistDashboard's own header: "NEW means UNDECIDED, not unread.
 * Reading is metadata... The pipeline advances only on intentional decisions."
 * This is that rule, applied to the surface that needed it.
 *
 * ⭐ Exported so the event page and the dashboard cannot disagree about what
 * is still waiting on the host.
 */
export const PIPELINE_BUCKETS = ['new', 'seen'];

/** Is this row still waiting on a decision? */
export function isUndecided(row) {
  return PIPELINE_BUCKETS.includes(normaliseStatus(row));
}

export function rawStatusesFor(bucket, direction = 'incoming') {
  const map = String(direction).toLowerCase() === 'outgoing' ? OUTGOING_STATUS_MAP : INCOMING_STATUS_MAP;
  return Object.entries(map).filter(([, v]) => v === bucket).map(([k]) => k);
}

/**
 * ⭐⭐ THE BUCKET EVERY UNRECOGNISED STATUS FALLS INTO, per direction.
 *
 * `normaliseStatus` ends `map[st] || (dir === 'outgoing' ? 'awaiting' : 'new')`.
 * That fallback is DELIBERATE and stated in three places — "an unrecognised
 * status still needs a home rather than disappearing". This names it once so a
 * query can ask which bucket is the catch-all instead of re-deriving it.
 */
export const FALLBACK_BUCKET = { incoming: 'new', outgoing: 'awaiting' };

/**
 * ⭐⭐ ONE DEFINITION OF A BUCKET, FOR THE RENDERER **AND** FOR THE SERVER.
 *
 * ⛔⛔ THE ASYMMETRY THIS CLOSES. `rawStatusesFor('new')` returns the MAPPED
 * spellings only, while `normaliseStatus` puts an unrecognised status — and a
 * NULL one, since it defaults to 'pending' — into that same bucket. So a
 * server-side `.in('status', rawStatusesFor('new'))` count and the client-side
 * list it labels could disagree about the very same rows. The old comment above
 * `rawStatusesFor` called this a "KNOWN AND ACCEPTED LIMIT" on the grounds that
 * "no `.in()` list can express 'anything not listed'". True of `.in()`; not
 * true of PostgREST, which can express exactly that.
 *
 * ⚠⚠ SO THE CATCH-ALL BUCKET IS DESCRIBED **NEGATIVELY**, AND THAT INVERSION
 * IS THE POINT. Everywhere else in this codebase a negative status filter is a
 * bug — it silently admits any status added later. Here the client rule IS
 * "anything I do not recognise is new", so the negative form is the FAITHFUL
 * translation and the positive form is the lossy one. ⛔ Do not "fix" this back
 * into an `.in()` list; that is the drift it exists to remove.
 *
 * Returns a description, never a query, so the same object can be applied to
 * PostgREST and evaluated in a test without either guessing what the other did:
 *   { kind: 'in',            statuses }  — row matches iff status ∈ statuses
 *   { kind: 'not-in-or-null', statuses } — row matches iff status is NULL or ∉
 */
export function bucketFilterFor(bucket, direction = 'incoming') {
  const dir = String(direction).toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming';
  if (bucket !== FALLBACK_BUCKET[dir]) {
    return { kind: 'in', statuses: rawStatusesFor(bucket, dir) };
  }
  /* Every spelling that belongs to some OTHER bucket. Anything else — an
     unknown spelling, or NULL — is this bucket, which is what the renderer
     does. ⭐ Derived from the same map, so a spelling added to the map leaves
     the catch-all automatically and the two cannot drift. */
  const others = bucketsFor(dir)
    .filter(b => b !== bucket)
    .flatMap(b => rawStatusesFor(b, dir));
  return { kind: 'not-in-or-null', statuses: [...new Set(others)] };
}

/**
 * Does a row fall in this bucket, per the description above? ⭐ The renderer's
 * own answer, `normaliseStatus(row) === bucket`, must agree with this for every
 * status — `enquiryBucketFilter.test.js` pins exactly that, in both directions.
 */
export function bucketFilterMatches(filter, status) {
  const st = status == null ? null : String(status).toLowerCase();
  if (filter.kind === 'in') return st !== null && filter.statuses.includes(st);
  return st === null || !filter.statuses.includes(st);
}

/**
 * Apply a bucket to a PostgREST query builder. ⚠ `.or()` is the only form that
 * can say "NULL or not one of these": `NOT IN (…)` alone evaluates to NULL for
 * a NULL status, and a NULL predicate excludes the row.
 *
 * ⚠ `venue_enquiries.status` is `NOT NULL DEFAULT 'pending'`, so the null leg
 * is unreachable on that table today. `applications.status` is nullable, and it
 * is the same question — the leg stays so the answer does not depend on which
 * table the caller happens to be asking about.
 */
export function applyBucketFilter(query, bucket, direction = 'incoming') {
  const f = bucketFilterFor(bucket, direction);
  if (f.kind === 'in') return query.in('status', f.statuses);
  return query.or(`status.is.null,status.not.in.(${f.statuses.join(',')})`);
}

/** Every bucket a row can normalise into, for building tab lists. */
export function bucketsFor(direction = 'incoming') {
  const map = String(direction).toLowerCase() === 'outgoing' ? OUTGOING_STATUS_MAP : INCOMING_STATUS_MAP;
  return [...new Set(Object.values(map))];
}

export const DECLINE_FADE_DAYS = 30;

export function isFadedDecline(row, now = Date.now()) {
  const st = (row?.status || '').toLowerCase();
  if (!['declined', 'rejected'].includes(st)) return false;
  const at = row?.created_at ? new Date(row.created_at).getTime() : NaN;
  if (Number.isNaN(at)) return false;
  return (now - at) > DECLINE_FADE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * ⭐⭐ BOOKED AND HISTORY ARE ONE SET SPLIT BY TODAY (owner, 2026-08-31).
 *
 * Every profile type has a HISTORY tab: BOOKED is what is coming up, HISTORY
 * what already happened. Both read the SAME rows — a booked row is booked
 * whichever direction it was asked in, which is why this asks about status and
 * never about direction — so no row can be in both and none can fall between.
 *
 * ⛔⛔ ABSENT IS NOT PAST. An enquiry with no date has not been shown to have
 * happened, so it stays in BOOKED rather than quietly ageing out of the list
 * its owner is still acting on. `isPastDate` rules the same way, and today is
 * never past: a gig tonight is a booking, not a memory.
 *
 * ⛔ The date comes from `isPastDate`, never a 10-char slice of a timestamp —
 * that is UTC and reads as yesterday every Australian morning.
 */
export function isBookedRow(row) {
  return ['booked', 'accepted'].includes((row?.status || '').toLowerCase());
}

/** The date an enquiry is ABOUT — the night, not the day it was sent. */
export function enquiryEventDate(row) {
  return row?.date_requested || row?.preferred_date || null;
}

export function isPastBooking(row, todayStr = today()) {
  return isBookedRow(row) && isPastDate(enquiryEventDate(row), todayStr);
}

export function isUpcomingBooking(row, todayStr = today()) {
  return isBookedRow(row) && !isPastDate(enquiryEventDate(row), todayStr);
}
