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
