import { normaliseStatus } from './enquiryUtils';

/**
 * ⭐ THE APPLICANT-SIDE PIPELINE — one vocabulary, every asker.
 *
 * ⚠ THIS FILE IS AN EXTRACTION, NOT A NEW MODEL. Every value below was defined
 * inside ArtistDashboard.jsx and is unchanged; it moved here the moment a SECOND
 * screen needed it (HostDashboard's outgoing enquiries). Copying it would have
 * produced two status vocabularies that agree today and drift tomorrow — the
 * same third-copy mistake the Ask Category registry exists to prevent.
 *
 * ⛔ Nothing here knows WHO is asking. A host enquiring about a room and a DJ
 * applying to an event are the same question — "I asked for something; where is
 * it up to?" — and they must land in the same four buckets. A branch on profile
 * type in this file is a finding, not a feature.
 */

/**
 * The four buckets, in pipeline order. Asymmetric with the venue's own labels
 * on purpose: the person who asked wants to know where THEY stand, not what the
 * venue clicked.
 */
export const APP_TABS = ['SUBMITTED', 'BEING CONSIDERED', 'BOOKED', 'NOT SELECTED'];

export const APP_TAB_COLOR = {
  'SUBMITTED':        '#FFD700',
  'BEING CONSIDERED': '#BF5FFF',
  'BOOKED':           '#00E5A0',
  'NOT SELECTED':     '#888',
};

/**
 * Status → bucket. THE single source of truth: sub-tab counts, the list filter
 * and each row's badge all call this, so they cannot disagree with each other.
 *
 * 'offered'/'confirmed' come from the host slot-offer flow (EventScreen.jsx /
 * notifActions.js) — they used to fall through every bucket, counted in the
 * OUTGOING total but invisible in every sub-tab.
 */
/**
 * ⛔⛔ IT USED TO TEST THE RAW COLUMN AGAINST A LIST CONTAINING `interested`,
 * WHICH IS NOT A STORED STATUS.
 *
 * `interested` is the OUTGOING BUCKET — the ASKER's name for the state the
 * receiving side calls `shortlisted`. One row, read from two sides:
 *
 *     database        host sees        asker sees
 *     shortlisted  →  SHORTLISTED  ·  INTERESTED
 *
 * ⭐ That asymmetry is a deliberate product decision and it stays: an asker
 * should not be shown "shortlisted" just to make the vocabulary symmetrical.
 * ⛔ But a BUCKET name in a test against a raw column value is always a bug —
 * it can never match, and it disguises which side of the map you are on.
 *
 * ⭐ So the bucket is DERIVED and the label is a pure translation of it. Every
 * spelling behaves exactly as before except two, both of which were wrong:
 *
 *   `cancelled`   was SUBMITTED, is NOT SELECTED — a withdrawn ask fell to the
 *                 default and read as though it were still out there waiting.
 *   `interested`  was BEING CONSIDERED, is SUBMITTED — nothing writes it, so
 *                 this only answers a malformed question honestly.
 */
/* ⚠ The status model, not a second copy of it. `enquiryUtils` is already this
   file's neighbour — it re-exports the fade rule from there at the bottom. */
const BUCKET_LABEL = {
  awaiting:   'SUBMITTED',
  interested: 'BEING CONSIDERED',
  accepted:   'BOOKED',
  declined:   'NOT SELECTED',
};

export function applicantLabel(status) {
  return BUCKET_LABEL[normaliseStatus({ status, direction: 'outgoing' })] || 'SUBMITTED';
}

/* ⚠ DECLINE_FADE_DAYS / isFadedDecline MOVED to lib/enquiryUtils.js — the
   shared enquiry vocabulary — the moment EnquiryPanel needed the same rule
   for the venue and host surfaces. Re-exported so existing importers keep
   working. ⛔ Do not reimplement: the fade must be one clock. */
export { DECLINE_FADE_DAYS, isFadedDecline } from './enquiryUtils';

/**
 * Per-bucket empty states. Same calm voice as the incoming side: an empty
 * bucket is a feature, not a gap.
 *
 * ⚠ SUBMITTED's copy is deliberately about ASKING, not applying. This list holds
 * venue availability enquiries as well as event applications, and "you haven't
 * applied to anything yet" told someone who had just enquired with a venue that
 * they had done nothing.
 */
/**
 * ⛔⛔ KEYED BY THE SUB-TAB NAMES, AND THEY ARE `normaliseStatus`'s.
 *
 * ⚠⚠ THIS WAS DEAD AND NOTHING SAID SO. The keys were `applicantLabel`'s old
 * vocabulary (SUBMITTED / BEING CONSIDERED / BOOKED / NOT SELECTED) while the
 * lookup is `OUT_EMPTY[outStatusTab]`, and `outStatusTab` holds AWAITING /
 * INTERESTED / ACCEPTED / DECLINED. Every key missed, so every empty tab fell
 * through to the generic fallback and none of this copy had been seen since the
 * sub-tabs were unified on 2026-08-14. A stale key does not throw; it just
 * quietly stops being the answer.
 */
export const OUT_EMPTY = {
  'AWAITING':   "You haven't applied or enquired anywhere yet.",
  'INTERESTED': 'Nothing being considered right now.',
  'ACCEPTED':   'Nothing accepted yet.',
  'DECLINED':   'Nothing here yet.',
};

/**
 * The columns an outgoing enquiry row needs. Declared beside the fetch that
 * uses them so a field added to the row cannot be left unselected.
 */
/* ⚠ `venue_user_id` IS FOR DELIVERY, not display. Cancelling an ACCEPTED ask
   notifies the venue, and the row is the only honest source of who they are —
   `profiles.user_id` is NULL for most profiles and shared across one account's
   profiles, so it can never address anyone.
   ⛔ KEEP THIS COMMENT ABOVE THE EXPORT. `outgoingAsksContract` asserts the
   string literal sits directly after the `=`. */
export const OUTGOING_ENQUIRY_COLUMNS =
  'id, status, created_at, date_requested, note, venue_profile_id, venue_user_id, event_id, ask_category';

const VENUE_COLUMNS = 'id, name, type, avatar, avatar_thumb, location, state, suburb';

/**
 * ⭐ THE ENQUIRIES THIS PROFILE SENT, with the venues they went to.
 *
 * ⛔ KEYED ON THE PROFILE, NEVER THE ACCOUNT. One human owns a host profile, a
 * DJ act and a comedy act; keying on `applicant_user_id` puts all three
 * profiles' enquiries on each of their dashboards, which is the exact
 * cross-over the 2026-08 profile-keying sweep removed everywhere else.
 *
 * ⛔ `initiated_by: 'applicant'` is not optional. A venue-initiated row is an
 * OFFER you received, not an enquiry you sent, and the two must never merge.
 *
 * ⛔ A venue that did not come back is ABSENT, not an empty-named row — the
 * enquiry still happened and must still be listed (Rendering Contract R4:
 * broken ≠ sparse). The row renders what it has.
 *
 * @param {object} supabase   the client
 * @param {string|null} profileId  the ASKING profile — host, artist, band, standup
 * @returns {Promise<Array>} rows, each with a `venue` (or null), newest first
 */
export async function fetchOutgoingEnquiries(supabase, profileId) {
  if (!profileId) return [];
  const { data: rows } = await supabase.from('venue_enquiries')
    .select(OUTGOING_ENQUIRY_COLUMNS)
    .eq('applicant_profile_id', profileId)
    .eq('initiated_by', 'applicant')
    /* ⚠ S5 · CLEARED ROWS NEVER ARRIVE. Filtered in the QUERY, not in the
       render: a row the asker has tidied away should not be counted by a tab,
       matched by a search or included in a limit. Cancelling sets this too, so
       a withdrawn ask leaves this list by the same door. */
    .is('applicant_cleared_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  const enquiries = rows || [];
  const venueIds = [...new Set(enquiries.map(e => e.venue_profile_id).filter(Boolean))];
  if (!venueIds.length) return enquiries.map(e => ({ ...e, venue: null }));
  const { data: venues } = await supabase.from('profiles')
    .select(VENUE_COLUMNS).in('id', venueIds);
  const venuesById = {};
  (venues || []).forEach(v => { venuesById[v.id] = v; });
  return enquiries.map(e => ({ ...e, venue: venuesById[e.venue_profile_id] || null }));
}
