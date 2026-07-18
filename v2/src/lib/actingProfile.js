import { supabase } from './supabase';

/**
 * M6 write cutover — who is acting?
 *
 * Identity v1.1 R6.1: attribution is stamped at write time. Every
 * profile-actionable insert must name the profile it comes from, and
 * `from_profile_id` is that name.
 *
 * This module is the ONE place that answers "which profile is doing
 * this". Resolving it inline at each write site is how the pre-M6
 * codebase ended up with `.neq('type','punter')` copy-pasted a dozen
 * times, drifting apart, and needing M5.1 to consolidate it. Do not
 * add a second resolver — extend this one.
 *
 * R2: this sets ATTRIBUTION, never permission. Nothing here decides
 * what a user may do; `can_act_as()` in the database is the only
 * authority on that (v1.1 §A4), and it re-checks whatever this
 * returns. A wrong answer here produces a rejected write, not an
 * escalation.
 */

// Personal profile ids are stable for the life of a session and are
// read on every follow. Cached per user id; cleared on sign-out.
const personalCache = new Map();

/**
 * The acting user's Personal profile id.
 *
 * Follows are personal acts (v1.1 §A6, §A9) — a follow is made by the
 * human browsing, not by a business they own. M6d normalised every
 * historical follow this way; new follows must match, or rosters end
 * up split between two conventions.
 *
 * M5.5 guarantees this exists: every account owns exactly one
 * Personal profile, enforced by a trigger on signup and by
 * `profiles_user_type_unique`. A null return therefore means
 * something is wrong upstream, not that the user is unusual.
 *
 * @returns {Promise<string|null>} profile id, or null if unresolvable
 */
export async function getPersonalProfileId(userId) {
  if (!userId) return null;
  if (personalCache.has(userId)) return personalCache.get(userId);

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'punter')
    .maybeSingle();

  if (error) {
    // Surfaced rather than swallowed: after M5.5 this should not
    // happen, and a silent null would write an unattributed row.
    console.error('[actingProfile] Personal profile lookup failed', error);
    return null;
  }
  if (!data) {
    console.error('[actingProfile] no Personal profile for account', userId);
    return null;
  }

  personalCache.set(userId, data.id);
  return data.id;
}

/** Call on sign-out — a cached id must not leak across sessions. */
export function clearActingProfileCache() {
  personalCache.clear();
}
