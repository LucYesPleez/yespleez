import { supabase } from './supabase';
import { PROFILE_TYPE_ORDER } from './profileTypes';

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

/**
 * Types that can OWN an event (identity v1.3 `O-R4`).
 *
 * v1.3 is explicit that an event's owner may be **any profile type** —
 * a venue running its own night, a promoter presenting one, a festival
 * programming its own bill. The only exclusion is Personal: §A9 makes
 * it inalienable and non-commercial, and it does not run events.
 *
 * Derived from the profile registry rather than hand-listed, so a new
 * profile type becomes owner-eligible without editing this file —
 * which is precisely the extensibility `O-R4` was chosen for.
 */
export const OWNER_ELIGIBLE_TYPES = PROFILE_TYPE_ORDER.filter(t => t !== 'punter');

/**
 * Profiles the user could own an event as, deterministically ordered.
 *
 * @param {string} userId
 * @param {string} [type] optional narrowing — the context the user is
 *   creating from (a host dashboard means a host profile). Narrowing is
 *   a convenience, never a permission: `can_act_as` re-checks whatever
 *   is written, so a wrong hint produces a rejected write, not an
 *   escalation (R2).
 */
export async function getOwnerProfiles(userId, type) {
  if (!userId) return [];

  const wanted = type && OWNER_ELIGIBLE_TYPES.includes(type)
    ? [type]
    : OWNER_ELIGIBLE_TYPES;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, type, name')
    .eq('user_id', userId)
    .in('type', wanted)
    .order('type', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('[actingProfile] owner profile lookup failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * Deterministic owner resolution for events (`O-R4`, `O-R6`).
 *
 * Exactly one eligible profile → { profileId }        decided
 * Several                      → { ambiguous: [...] } caller must ask
 * None                         → { profileId: null }  cannot own an event
 *
 * `O-R6` requires every event to have exactly one owner, so a caller
 * receiving `{ profileId: null }` must refuse to create the event
 * rather than writing one without an owner.
 *
 * Same contract as `resolvePerformerProfileId` on purpose: one seam,
 * one shape, and R6 later replaces both bodies without touching a
 * single write site.
 */
export async function resolveOwnerProfileId(userId, type) {
  const profiles = await getOwnerProfiles(userId, type);
  if (profiles.length === 1) return { profileId: profiles[0].id };
  if (profiles.length === 0) return { profileId: null };
  return { ambiguous: profiles };
}

/**
 * The profile this account already owns of exactly `type`, or null.
 *
 * The claim pre-check (§07 C). A single account owns at most one profile of
 * each type, so a claim against a type they already hold can never complete —
 * the imported profile is a DUPLICATE of one they own, and resolving it means
 * merging, which is not built. Answering this before submission turns a dead
 * end into a clear message instead of a claim that sits publicly "under
 * review" until a reviewer rejects it.
 *
 * Returns the ROW, not a boolean, deliberately: the message can then name the
 * profile the user already has ("a duplicate of Lucious"), and a future merge
 * feature needs exactly this row as its merge target. Callers wanting a
 * yes/no just check for null.
 *
 * ── EXACT MATCH, NOT getOwnerProfiles ────────────────────────────────
 *
 * getOwnerProfiles falls back to ALL owner-eligible types when handed a type
 * it does not recognise — right for "what could this user act as", wrong
 * here, where the question is about ONE specific type and a fallback would
 * silently answer a different question.
 *
 * ── FAILS OPEN ───────────────────────────────────────────────────────
 *
 * A lookup blip returns null (nothing owned), so a transient error never
 * blocks a legitimate claim. The backstops downstream cannot be raced:
 * approve_profile_claim() refuses the attach, and the database's own
 * uniqueness rule refuses it under that. The worst case of a false negative
 * is a doomed claim a reviewer rejects — exactly the pre-check-less
 * behaviour, no worse.
 *
 * @param {string} userId
 * @param {string} type  a profile type — 'artist' | 'venue' | 'host' | …
 * @returns {Promise<{id: string, type: string, name: string}|null>}
 */
export async function getOwnedProfileOfType(userId, type) {
  if (!userId || !type) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, type, name')
    .eq('user_id', userId)
    .eq('type', type)
    .limit(1);
  if (error) {
    console.error('[actingProfile] getOwnedProfileOfType lookup failed', error);
    return null;   // fail open — see header
  }
  return data?.[0] ?? null;
}

/** Call on sign-out — a cached id must not leak across sessions. */
export function clearActingProfileCache() {
  personalCache.clear();
}
