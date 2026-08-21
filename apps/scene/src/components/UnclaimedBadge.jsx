import s from './UnclaimedBadge.module.css';
import { isProfileUnclaimed } from '../lib/profileClaim';

// The canonical UNCLAIMED marker. v1.0 §09 requires unclaimed profiles to be
// clearly labelled; Phase 13 `P-C2` requires it everywhere the profile appears
// publicly, and consistently. A badge implemented per-page diverges — that is
// this repo's own history, not a hypothesis (see the header of lib/eventBadges
// .js, where three copies of the same definitions disagreed on casing).
//
// The pill is lifted verbatim from ProfileScreen's inline span; this component
// is the extraction of an existing implementation, not a new design.
//
// Purely presentational. It owns no claim logic: the "Is this you? Claim this
// profile" entry point and the ClaimDialog stay on ProfileScreen, and cards
// keep their existing navigation. This renders a label and nothing else.
//
// There is deliberately no `className` or style prop. A per-call-site styling
// hook is exactly how "visually consistent everywhere" erodes, and §09's
// requirement is consistency. Spacing belongs to the parent's flex gap.
//
// No pending state. A profile with claim_status = 'pending' is still unowned,
// so the predicate returns true and this renders UNCLAIMED. The pending
// wording is ProfileScreen's "Claim under review" and stays there.

/**
 * @param {{ profile: object|null|undefined }} props `profile` must be a
 *   canonical `profiles` row — see the note in lib/profileClaim.js about
 *   synthetic objects whose `user_id` is a different column entirely.
 * @returns the UNCLAIMED pill when the row is unclaimed, otherwise null —
 *   so it disappears on claim with no call-site condition.
 */
export default function UnclaimedBadge({ profile }) {
  /**
   * ⛔⛔ HIDDEN EVERYWHERE (owner, 2026-08-21: "hide the unclaimed chip from
   * everywhere that has one"). This OVERRIDES v1.0 §09's labelling
   * requirement as a product decision — the pill read as a mark against the
   * act on every card, and most of the catalogue is imported and unclaimed,
   * so whole rails wore it.
   *
   * ⚠ HIDDEN, ⛔ NOT DELETED. The eight call sites stay wired and the
   * predicate still runs, so restoring the label is deleting ONE line here —
   * and the claim FLOW is untouched: UnclaimedNotice ("Is this you?") and the
   * ClaimDialog still do their jobs on the profile page. Only the public
   * label is gone.
   */
  void profile; void isProfileUnclaimed; void s; // imports stay live for the restore
  return null;
}

/* The original body, verbatim, for the restore:
     if (!isProfileUnclaimed(profile)) return null;
     return <span className={s.badge}>UNCLAIMED</span>;
*/
