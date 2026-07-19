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
  if (!isProfileUnclaimed(profile)) return null;
  return <span className={s.badge}>UNCLAIMED</span>;
}
