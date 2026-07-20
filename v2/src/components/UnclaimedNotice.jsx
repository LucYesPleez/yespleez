import s from './UnclaimedNotice.module.css';
import { isProfileUnclaimed } from '../lib/profileClaim';

// The canonical ACTION-TIME disclosure. Phase 13.2 `N2`:
//
//   "Anyone acting toward an unclaimed profile sees that it is unclaimed and
//    that their action will be held rather than delivered, at the point of
//    acting — not afterwards, and not in help text."
//
// UnclaimedBadge is the display-time half (`P-C2`): it labels a profile
// wherever it appears. This is the action-time half: it says what will happen
// if you go ahead. Both exist to prevent the same misrepresentation — that a
// business is participating when it has never heard of the platform.
//
// ── The copy is centralised, and that is the point ───────────────────────
//
// Callers choose a `context`, never a string. Disclosure that each screen
// phrases for itself drifts, and drifted disclosure is worse than none: it
// teaches users the notice is decorative. This repo has the precedent twice
// over — eventBadges.js exists because three copies of the same definitions
// disagreed on casing, and UnclaimedBadge exists because the UNCLAIMED pill
// had been re-implemented per page. Same failure, higher stakes.
//
// ── What the wording deliberately does NOT say ───────────────────────────
//
// No "held", no "queue", no "pending", no "unclaimed", no mention of
// notifications, delivery or claiming as a system event. Those are internal
// concepts; a user does not have them and should not need them. The copy
// states a fact about the PERSON ("they haven't joined yet") and a promise
// about the OUTCOME ("we'll let them know when they do"), which is all the
// informed choice in §2 actually requires:
//
//   "The artist then makes an informed choice. Some will apply anyway — a
//    held application costs them little and may pay off. Others will not.
//    Either is fine; being surprised is not."
//
// It is also phrased positively. The spec wants an informed choice, not a
// discouraged one, so the line says what WILL happen rather than what will
// not — "we'll let them know when they do", not "they will not be notified".
// The one exception is `slot`, which is host-facing and operational: a host
// adding a performer to a lineup needs to know no invitation goes out, or
// they will sit waiting for a reply that was never requested.

const COPY = {
  /** Following a profile that has no owner yet. The follow is recorded now. */
  follow: "They haven't joined YesPleez yet — we'll let them know you're following when they do.",

  /** Applying to an event whose organiser has no account yet. */
  apply: "This event's organiser hasn't joined YesPleez yet. Your application will be waiting for them when they do.",

  /** Host-facing: adding a performer who has no account yet. */
  slot: "This performer hasn't joined YesPleez yet, so they won't get an invite. You can still add them to the lineup.",
};

/**
 * @param {object} props
 * @param {object|null|undefined} props.profile a canonical `profiles` row.
 *   ⚠ NOT a synthetic object that merely carries a `user_id` key. Several
 *   render paths build slot/artist objects whose `user_id` is
 *   `lineup_members.artist_id` — a different column with a different meaning —
 *   and handing one of those to isProfileUnclaimed() compiles, runs, and
 *   returns a confidently wrong answer. Attach the resolved profile row
 *   instead. See lib/profileClaim.js.
 * @param {'follow'|'apply'|'slot'} props.context which action is being taken.
 * @returns the disclosure line when the target is unclaimed, otherwise null —
 *   so it disappears on claim with no call-site condition, and claimed flows
 *   are untouched by construction.
 */
export default function UnclaimedNotice({ profile, context }) {
  if (!isProfileUnclaimed(profile)) return null;

  const copy = COPY[context];
  if (!copy) {
    // An unknown context must not render an empty line under a button. Loud in
    // development, silent and absent in production.
    if (import.meta.env.DEV) {
      console.warn(`[UnclaimedNotice] unknown context "${context}" — add it to COPY`);
    }
    return null;
  }

  return (
    <p className={`${s.notice}${context === 'slot' ? ` ${s.alignStart}` : ''}`}>
      {copy}
    </p>
  );
}
