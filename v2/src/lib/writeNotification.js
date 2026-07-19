import { supabase } from './supabase';
import { getOwnerProfiles } from './actingProfile';

/**
 * The one place notifications are created.
 *
 * Identity v1.1 §A7 and the communication architecture's C18 both say
 * notifications originate from shared services and are never generated
 * inside UI components. Before this consolidation there were fifteen
 * write paths — six through this helper and nine inserting directly —
 * so any change to the notification row shape meant fifteen edits, and
 * the sixteenth call site would have missed it.
 *
 * ── §A7 · THREE IDENTITIES ───────────────────────────────────────────
 *
 *   about_profile_id  SUBJECT   — what the notification concerns. MAY BE
 *                                 UNCLAIMED (§05 C1): the profile a notice
 *                                 is about can have no owner at all.
 *                                 Nullable for account-level notices.
 *   to_profile_id     RECIPIENT — which of the reader's profiles this is
 *                                 for. Scopes the feed. See the NULL note.
 *   to_user_id        DELIVERY  — the human with the device. Dedup and
 *                                 delivery both key on it. NULL means HELD;
 *                                 see the N1 note below.
 *
 * "Addressed to a profile, delivered to an account" is only two-thirds of
 * the model; the subject is a third, independent identity.
 *
 * ── N1 · A NULL to_user_id MEANS HELD, NOT BROKEN ────────────────────
 *
 * Phase 13.2 `N1`: a notification to an UNCLAIMED profile is CREATED AND
 * HELD, never suppressed. A held row carries its recipient (to_profile_id)
 * and NO delivery identity — that absence IS the held state, which is why
 * there is no separate flag to disagree with it.
 *
 * This helper used to do the opposite. It returned early whenever toUserId
 * was missing, under the comment "no delivery identity, no notification" —
 * stating the rule exactly backwards from the spec. Callers compounded it:
 * ProfileScreen guarded its follow write behind `if (profile.user_id)`.
 * Between them, every follow of an unclaimed profile was discarded.
 *
 *     "A held notification is an asset; a suppressed one is a deleted fact."
 *
 * That was not a missing feature. `N3` makes the held pile the payoff of
 * the entire model — a venue claims and finds followers and enquiries
 * waiting — and `N4` names follows as the kind that NEVER expires. The
 * rows being thrown away were the most valuable ones.
 *
 * THE INVARIANT IS ADDRESSABILITY, NOT DELIVERY. A row must carry at least
 * one identity that can reach someone, now or later:
 *
 *     delivered   to_user_id set,  to_profile_id may be null (U4)
 *     held        to_user_id null, to_profile_id set          (N1)
 *     rejected    both null — addressed to nobody
 *
 * Enforced in the database by CHECK notifications_addressable, and here by
 * isAddressable(). Do NOT tighten this to "to_profile_id is required" —
 * that breaks U4 below, whose NULLs are correct answers.
 *
 * ── ⚠ A NULL to_profile_id IS A CORRECT ANSWER, NOT MISSING DATA ─────
 *
 * This column is deliberately NOT uniformly populated, and a future reader
 * finding NULLs here has not found a bug or an unfinished migration.
 *
 * Identity v1.2 `U4` (decided 18 Jul 2026) is the governing rule:
 *
 *     "infer the sender profile only where the user owns exactly one
 *      profile of the applicable type; leave every other row NULL."
 *
 * A NULL to_profile_id states a fact: THE SYSTEM CANNOT UNIQUELY INFER
 * THE DESTINATION PROFILE. If a recipient owns three host profiles, no
 * amount of inspection tells us which one an incoming notice is for —
 * only the recipient knows, and inventing an answer would attribute their
 * mail to the wrong identity while looking perfectly populated.
 *
 * Do NOT add heuristics to reduce the NULL count: not most-recently-used,
 * not first-created, not "the one that matches the event". Each is a guess
 * that types correctly and is silently wrong, which is worse than an
 * honest blank. Correctness over complete population. Future UI or an
 * explicit workflow may resolve these; a backfill script must not.
 *
 * ── R5 · SCOPE THE FEED, NEVER THE BADGE ─────────────────────────────
 *
 * The unread badge aggregates across EVERY profile the account owns, so
 * an artist browsing as Personal still sees an urgent venue enquiry.
 * That half is live (App.jsx counts by to_user_id alone).
 *
 * R5's other two clauses — the feed scoping to the active profile, and
 * opening another profile's notification switching to it — are DEFERRED,
 * not implemented and not approximated. They require a persisted
 * "active profile" concept, and this app has none: actingProfile.js is
 * resolvers only, with no acting-as state to read or switch. Faking one
 * to satisfy the letter of R5 would be worse than recording the gap.
 * Revisit when an active-profile concept exists.
 */

/** Types whose ownership is resolvable per-profile-type via getOwnerProfiles. */
const RESOLVABLE_TYPES = ['venue', 'host', 'artist', 'band', 'standup'];

/**
 * §A7 recipient identity, under `U4`.
 *
 * Returns the recipient's profile id ONLY when it is unambiguous — the
 * user owns exactly one profile of `profileType`. Returns null in every
 * other case, including "owns none" and "owns several". Null is a result,
 * not a failure; see the U4 note above.
 *
 * @param {string} userId       recipient's auth user id
 * @param {string} [profileType] the applicable profile type, if the caller knows it
 * @returns {Promise<string|null>}
 */
export async function inferToProfileId(userId, profileType) {
  if (!userId || !profileType || !RESOLVABLE_TYPES.includes(profileType)) return null;
  try {
    const profiles = await getOwnerProfiles(userId, profileType);
    // Exactly one, or nothing. No tie-breaking, by rule.
    return profiles && profiles.length === 1 ? profiles[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Build a notification row. The single definition of a notification's
 * shape — extend here, never at a call site.
 */
function buildRow({ toUserId = null, toProfileId = null, aboutProfileId = null, type, message, data = {} }) {
  return {
    to_user_id:       toUserId ?? null,   // null = HELD (N1)
    to_profile_id:    toProfileId,        // may be null — see U4 note
    about_profile_id: aboutProfileId,     // may be null for account-level notices
    type,
    message,
    data,
    read: false,
  };
}

/**
 * The addressability invariant (N1). Mirrors the database's
 * CHECK notifications_addressable — a row must be reachable by someone,
 * now (to_user_id) or after a claim (to_profile_id).
 *
 * This is the ONLY reason to refuse to write. Absence of a delivery
 * identity is not a reason; that is a held notification.
 */
function isAddressable(row) {
  return Boolean(row.to_user_id || row.to_profile_id);
}

/**
 * True when a row is held rather than delivered (N1).
 * Exported so readers and future claim-delivery share one definition of
 * "held" instead of each re-deriving `to_user_id == null`.
 */
export function isHeld(row) {
  return Boolean(row) && !row.to_user_id && Boolean(row.to_profile_id);
}

/**
 * Write one notification.
 *
 * Options object rather than positional arguments deliberately: the row now
 * carries three id-shaped values, and positional UUIDs across eleven call
 * sites is an argument-swap bug waiting to be written.
 *
 * Writes a HELD row when toUserId is absent but toProfileId is present
 * (N1) — the unclaimed-profile case. Refuses only when neither is given,
 * which would be a row addressed to nobody.
 *
 * @param {object}  opts
 * @param {string} [opts.toUserId]         recipient's auth user id — DELIVERY (§A7); omit for a held row (N1)
 * @param {string} [opts.toProfileId]      recipient profile — RECIPIENT (§A7); null when not uniquely inferable (U4); REQUIRED when toUserId is absent
 * @param {string} [opts.aboutProfileId]   subject profile — SUBJECT (§A7); may be an unclaimed profile
 * @param {string}  opts.type              e.g. 'slot_offer', 'invite_accepted'
 * @param {string}  opts.message           readable message
 * @param {object} [opts.data]             JSONB payload (event_id, host_id, …)
 * @returns {Promise<object|null>} the Postgres error, or null on success
 */
export async function writeNotification(opts) {
  const row = buildRow(opts || {});
  // N1: a missing delivery identity is a HELD notification, not a reason
  // to discard. Only an unaddressable row — neither identity — is refused.
  if (!isAddressable(row)) return null;
  const { error } = await supabase
    .from('notifications')
    .insert(row);
  return error;
}

/**
 * Write several notifications in a single insert.
 *
 * Exists so the batch slot-offer path stays ONE round trip. Mapping it
 * to N writeNotification() calls would have been a behaviour change
 * dressed as a refactor — N requests instead of one, and partial
 * failure where previously there was none.
 *
 * @param {Array<{toUserId: string, toProfileId?: string, aboutProfileId?: string, type: string, message: string, data?: object}>} rows
 * @returns {Promise<object|null>} the Postgres error, or null on success
 */
export async function writeNotifications(rows) {
  // N1: same rule as the single write — held rows are kept, only
  // unaddressable ones are dropped. The old filter was `r.toUserId`,
  // which silently discarded every held row in a batch.
  const list = (rows || [])
    .filter(Boolean)
    .map(buildRow)
    .filter(isAddressable);
  if (!list.length) return null;
  const { error } = await supabase
    .from('notifications')
    .insert(list);
  return error;
}
