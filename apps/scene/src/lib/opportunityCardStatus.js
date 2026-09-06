import { normaliseStatus } from './enquiryUtils';

/**
 * ⭐ IS THIS OFFER ONE THE ARTIST HAS KEPT ALIVE BUT NOT ANSWERED?
 *
 * ⛔⛔ `offered` WAS MISSING, AND THE CARD LOST ITS ACTIONS ENTIRELY.
 * `OpportunityCard` gated its whole action row on
 * `isUndecided || CONSIDERED.includes(status)`, where CONSIDERED was the raw
 * list `['shortlisted','interested','tentative']`. `normaliseStatus` maps
 * `offered` — the spelling the host's slot-offer flow writes — into the
 * `shortlisted` bucket, so an offered row was in NEITHER set: no DECLINE, no
 * VIEW OFFER, a real offer the artist could look at and not answer.
 *
 * ⭐ THE BUCKET, ⛔ never a longer local list. Adding `offered` to the array
 * would fix this row and leave the next spelling to find the same hole.
 *
 * ⚠⚠ `'interested'` WAS IN THAT LIST AND IS NOT A STORED STATUS. It is the
 * OUTGOING BUCKET — the ASKER's name for the state the receiving side calls
 * `shortlisted`, one row read from two sides:
 *
 *     database        host sees        artist sees
 *     shortlisted  →  SHORTLISTED  ·  INTERESTED
 *
 * That asymmetry is a deliberate product decision, not a naming accident: an
 * artist should not be shown "shortlisted" just to make the vocabulary
 * symmetrical. ⛔ But a bucket name has no business in a test against a raw
 * column value, and there is no alias for it here — `normaliseStatus` already
 * answers the question, and a row holding the literal `interested` would be an
 * unknown status the model files under the catch-all.
 *
 * ⚠ DIRECTION IS `incoming` BECAUSE THIS CARD IS AN INCOMING SURFACE: it shows
 * venue-initiated invitations, which the artist RECEIVES. Their own asks live
 * on the outgoing pipeline, where the same three raw spellings bucket as
 * `interested` instead. Both readings select the identical set
 * (`tentative`, `shortlisted`, `offered`) — this one is simply the true
 * description of what the card renders.
 *
 * ⚠⚠ IT LIVES IN A `.js` FILE, AND THAT IS THE ONLY REASON IT IS NOT INLINE.
 * The Node test runner cannot load `.jsx`, so a predicate exported from the
 * component is unreachable from a test, and a test that re-implemented it
 * beside the component would keep passing while the card regressed — which is
 * precisely how this defect survived. ⛔ Not a general helper: `enquiryUtils`
 * owns the status model; this is only the card's reading of it.
 */
export function isConsideredStatus(status) {
  return normaliseStatus({ status, direction: 'incoming' }) === 'shortlisted';
}
