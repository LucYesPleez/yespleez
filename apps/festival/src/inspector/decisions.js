/**
 * ⭐ THE ONE MAP FROM A BUTTON TO A STATUS.
 *
 * It lives in its own module because both the decision row and the panel that
 * writes the decision need it, and two copies would let the button say
 * "Accepted" while the press wrote something else. ⛔ Not exported from a
 * component file — a constant beside a component breaks fast refresh.
 */
export const DECISIONS = { shortlist: 'shortlisted', accept: 'accepted', decline: 'declined' };

/** The past tense a held status is named in. ⛔ Never a verb: a state is not an offer. */
export const PAST_TENSE = { shortlist: 'Shortlisted', accept: 'Accepted', decline: 'Declined' };
