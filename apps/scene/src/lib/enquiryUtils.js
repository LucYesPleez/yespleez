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
 * ⛔ KNOWN AND ACCEPTED LIMIT: `normaliseStatus` sends an UNRECOGNISED status
 * to the first bucket ('new' / 'awaiting'), and no `.in()` list can express
 * "anything not listed". So a status nobody has ever written would appear in
 * the NEW tab (client-side) and be missing from the NEW header count
 * (server-side). The drift test below pins every known spelling; a genuinely
 * unknown one is a bug in whatever wrote it.
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
