// The one way to ask whether a profile is unclaimed.
//
// v1.0 §09 (Ethics) requires unclaimed profiles to be "clearly labelled", and
// Phase 13 `P-C2` requires it *everywhere the profile appears publicly*. A test
// written per-page diverges — that is not a hypothetical here: `lib/eventBadges
// .js` exists because the same badge definitions lived in three places and
// disagreed on casing, and `profileIdentity()` exists because a dozen call
// sites each picked their own `|| PROFILE_TYPES.artist` fallback. One
// predicate, one badge component, no call-site logic.
//
// ── The column ───────────────────────────────────────────────────────────
// The live ownership column is `profiles.user_id`. v1.0 §03 and v1.1 R2/R3
// name `owner_user_id`, which does not exist on this table — it exists on
// `placeholder_profiles`. See `docs/live-schema-audit-2026-07.md` D2/D2b. That
// is a naming erratum in a frozen document, not a design fault; this helper
// follows the live schema, exactly as `ProfileScreen` already did.
//
// ── What this is not ─────────────────────────────────────────────────────
// This is presentation only. It answers "does this row have an owner", never
// "may this user act". Authorization is `can_act_as()` and nothing here
// participates in it. Attribution and authorization are never the same check.

/**
 * Is this profile unclaimed — i.e. does the row exist with no owner?
 *
 * Mirrors `profileIdentity()`: never throws, never guesses, returns a neutral
 * answer for input it cannot vouch for.
 *
 * **Pass a canonical `profiles` row.** Not a synthetic object that happens to
 * carry a `user_id` key. Two render paths build slot/artist objects whose
 * `user_id` is `lineup_members.artist_id` — a *different* column with a
 * different meaning (`EventScreen`'s `claim`, `MySceneScreen`'s `dayArtists`).
 * Handing one of those to this function compiles, runs, and returns a
 * confidently wrong answer. Those call sites attach the resolved profile row
 * instead; do the same for any new one.
 *
 * A profile with `claim_status = 'pending'` is still unclaimed — the row is
 * unowned until the claim is attached — so this returns `true` for it. The
 * pending *wording* is `ProfileScreen`'s "Claim under review" and stays there;
 * the badge does not model a second state.
 *
 * @param {object|null|undefined} profile a canonical `profiles` row
 * @returns {boolean} true only when the row is known to have no owner
 */
export function isProfileUnclaimed(profile) {
  if (!profile || typeof profile !== 'object') return false;

  // Absent is not null. `undefined == null` is true, so a row from a query
  // that never selected `user_id` would read as unclaimed — stamping UNCLAIMED
  // across profiles that are in fact owned. §09 forbids misrepresentation in
  // both directions, and a false "unclaimed" is the worse of the two: it tells
  // a real business the platform does not recognise them.
  //
  // So an unknown answer renders nothing, and says so loudly in development.
  // Fix the query — never infer ownership from a field that wasn't fetched.
  if (!('user_id' in profile)) {
    if (import.meta.env.DEV) {
      console.warn('[profileClaim] row has no `user_id`; cannot determine claim state — fix the query, do not guess', profile);
    }
    return false;
  }

  return profile.user_id == null;
}
