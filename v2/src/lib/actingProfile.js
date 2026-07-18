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

/**
 * Types that can apply for a gig. Personal is excluded because a
 * Personal profile does not perform (§A9), and venue/host are not
 * performers. Same set the U4 backfill used — they must not drift, or
 * historical and new attribution stop meaning the same thing.
 */
export const PERFORMER_TYPES = ['artist', 'band', 'standup'];

/**
 * Every profile the user could apply as, deterministically ordered.
 *
 * Ordering is explicit and stable (type, then created_at, then id).
 * The pre-M6 code read `.neq('type','punter').limit(1)` with no ORDER
 * BY, so which profile the UI claimed to be "applying as" was
 * undefined row order — the same class of fault M5.1 fixed for
 * profile routes. A picker over an unstable list would be no better.
 */
export async function getPerformerProfiles(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, type, name, sound, genre_string')
    .eq('user_id', userId)
    .in('type', PERFORMER_TYPES)
    .order('type', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('[actingProfile] performer profile lookup failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * Deterministic acting-profile resolution for applications.
 *
 * Exactly one eligible profile  → { profileId }        decided
 * Several eligible profiles     → { ambiguous: [...] } caller must ask
 * None                          → { profileId: null }  nothing to apply as
 *
 * ── THIS IS THE SEAM (M6, deliberately not R6) ──
 *
 * v1.1 R6 specifies an active-profile context with a "Sending as ▾"
 * control — a P-class product decision (§A11) that is NOT built during
 * M6. When it is, it replaces the BODY of this function and nothing
 * else: write sites ask "which profile is acting", and continue to ask
 * exactly that. The ambiguous branch simply stops occurring, because
 * R6 will already know the answer.
 *
 * So do not inline this logic at a call site, and do not let a caller
 * choose a profile by any other route. The whole point is that R6 can
 * land later without touching a single application write.
 */
export async function resolvePerformerProfileId(userId) {
  const profiles = await getPerformerProfiles(userId);
  if (profiles.length === 1) return { profileId: profiles[0].id };
  if (profiles.length === 0) return { profileId: null };
  return { ambiguous: profiles };
}

/** Call on sign-out — a cached id must not leak across sessions. */
export function clearActingProfileCache() {
  personalCache.clear();
}
