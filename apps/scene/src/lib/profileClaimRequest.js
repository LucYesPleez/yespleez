import { supabase } from './supabase';
import { getOwnedProfileOfType } from './actingProfile';

/**
 * PROFILE CLAIM REQUESTS — the one place a claim is submitted (§07 stage C).
 *
 * Same one-write-path discipline as writeNotification.js and sendMessage:
 * ClaimDialog calls these; nothing else touches profile_claim_requests.
 *
 * ── WHAT SUBMITTING DOES, AND POINTEDLY DOES NOT DO ──────────────────
 *
 * Submitting INSERTs a request row. A database trigger then sets the
 * profile's public claim_status to 'pending' — the Q7 5.2 transparency
 * signal ("a claim on this profile is under review", the fact, never the
 * claimant) that ProfileScreen already renders.
 *
 * It does NOT complete a claim. Completion is the NULL → NOT NULL
 * transition of profiles.user_id, performed only by approve_profile_claim()
 * — a function the app's database roles cannot execute (EXECUTE revoked).
 * That is where the N3 trigger delivers every held notification, and it is
 * the invariant claimDelivery.test.js pins: no app code writes
 * profiles.user_id. This module keeps that true by construction.
 *
 * ── THE INSERT USES .select(), DELIBERATELY ──────────────────────────
 *
 * The OPPOSITE of analytics.js's rule, because the policies are opposite:
 * usage_events has no SELECT policy so `.select()` there would fail every
 * write; profile_claim_requests HAS a select-own policy precisely so the
 * submitter gets their request id back (INSERT ... RETURNING is governed by
 * the SELECT policy — the beta_feedback lesson). If this insert starts
 * failing with an RLS error, check that policy before touching this code.
 */

/**
 * §07 stage C "asserted relationship".
 *
 * ⚠ MUST match the CHECK in 20260724000003_c1_profile_claim_requests.sql —
 * profileClaimRequest.test.js pins the two together. A value here that the
 * CHECK refuses is a submission that fails only at the moment a real owner
 * tries to claim their page.
 */
export const CLAIM_RELATIONSHIPS = [
  { value: 'owner',          label: 'I am the owner' },
  { value: 'manager',        label: 'I manage this act / venue' },
  { value: 'member',         label: 'I am a member (band / group)' },
  { value: 'representative', label: 'I officially represent them' },
];

const RELATIONSHIP_VALUES = CLAIM_RELATIONSHIPS.map(r => r.value);

/**
 * Why a claim is unavailable. One constant per reason so the UI switches on a
 * value rather than string-matching a sentence.
 */
export const CLAIM_BLOCKED = Object.freeze({
  /** The account already holds a profile of this type — this one is a duplicate. */
  OWNS_TYPE: 'owns_type',
});

/**
 * ★ THE EXTENSION POINT FOR PROFILE MERGE ★
 *
 * The single place that decides whether an account may claim a profile.
 * Both the dialog (on open, to choose what to show) and submitClaimRequest
 * (as the gate before any write) call this, so there is exactly one
 * definition of "claimable" and they cannot drift.
 *
 * ── HOW MERGE REPLACES THIS WITHOUT A REFACTOR ───────────────────────
 *
 * When Profile Merge ships, this function keeps its signature and its return
 * shape and simply gains a field — `{ eligible: false, reason: OWNS_TYPE,
 * ownedProfile, mergeAvailable: true }`. ClaimDialog already branches on
 * `reason` and already has `ownedProfile` in hand, so it swaps its
 * explanation panel for a "Merge into <name>" action. submitClaimRequest
 * needs no change at all: a merge is not a claim and will not travel through
 * it. Nothing else in the app asks this question, by design.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.profileType] target's type; omitted ⇒ cannot judge, allow
 * @returns {Promise<{eligible: boolean, reason?: string, ownedProfile?: object}>}
 */
export async function checkClaimEligibility({ userId, profileType } = {}) {
  if (!userId || !profileType) return { eligible: true };

  const owned = await getOwnedProfileOfType(userId, profileType);
  if (owned) {
    return { eligible: false, reason: CLAIM_BLOCKED.OWNS_TYPE, ownedProfile: owned };
  }
  return { eligible: true };
}

/**
 * Submit a claim for an unclaimed profile.
 *
 * Mirrors the database's own refusals client-side so each reads as a
 * sentence instead of a constraint name — the database remains the
 * authority (RLS insists user_id = auth.uid() and the target is unowned;
 * the CHECK insists on a known relationship and non-blank evidence; the
 * partial unique index refuses a second live claim).
 *
 * @param {object} opts
 * @param {string} opts.profileId     the unclaimed profile being claimed
 * @param {string} [opts.profileType] the target's type — enables the one-per-type
 *                                    pre-check; omit only if unknown (DB still backstops)
 * @param {string} opts.relationship  one of CLAIM_RELATIONSHIPS values
 * @param {string} opts.evidence      links / handles proving ownership
 * @returns {Promise<{request: object|null, error: {message: string}|null}>}
 */
export async function submitClaimRequest({ profileId, profileType, relationship, evidence } = {}) {
  if (!profileId) {
    return { request: null, error: { message: 'submitClaimRequest: profileId is required' } };
  }
  if (!RELATIONSHIP_VALUES.includes(relationship)) {
    return { request: null, error: { message: 'Choose how you are connected to this profile.' } };
  }
  if (!evidence || !evidence.trim()) {
    return { request: null, error: { message: 'Add some evidence — a website, social handle, or anything that shows this is you.' } };
  }

  // §A3 discipline: the claimant is the SESSION, never a parameter. RLS
  // enforces it regardless; resolving it here means a mismatch is impossible
  // rather than merely rejected.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user?.id) {
    return { request: null, error: { message: 'You need a YesPleez account to claim a profile.' } };
  }

  // ⚠ THE GATE — no impossible claim may become a row.
  //
  // The dialog already checks this on open and never shows the form when a
  // claim is unavailable; this is the backstop for a race (they created a
  // profile of this type between opening the dialog and submitting) and for
  // any future caller. Same decision function, so the two cannot disagree.
  const eligibility = await checkClaimEligibility({ userId: auth.user.id, profileType });
  if (!eligibility.eligible) {
    return {
      request: null,
      error: {
        message: 'This profile can’t be claimed — it looks like a duplicate of one you already have.',
        reason: eligibility.reason,
        ownedProfile: eligibility.ownedProfile,
      },
    };
  }

  const { data, error } = await supabase
    .from('profile_claim_requests')
    .insert({
      profile_id:   profileId,
      user_id:      auth.user.id,
      relationship,
      evidence:     evidence.trim(),
    })
    .select('id, status, created_at')
    .single();

  if (error) {
    // The partial unique index — you already have a live claim here.
    if (error.code === '23505') {
      return { request: null, error: { message: 'You already have a claim under review for this profile.' } };
    }
    // The RLS with_check — profile got claimed between page load and submit.
    if (error.code === '42501') {
      return { request: null, error: { message: 'This profile can no longer be claimed — it may have just been claimed by someone else.' } };
    }
    return { request: null, error: { message: error.message } };
  }
  return { request: data, error: null };
}

/**
 * The caller's most recent claim request for a profile, or null.
 *
 * Readable because of the select-own policy: a claimant sees only their own
 * requests, never anyone else's — the public signal stays "a claim exists",
 * on the profile row (Q7-R4).
 */
export async function fetchMyClaimRequest(profileId) {
  if (!profileId) return { request: null, error: null };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return { request: null, error: null };

  const { data, error } = await supabase
    .from('profile_claim_requests')
    .select('id, status, created_at, decided_at, decision_note')
    .eq('profile_id', profileId)
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return { request: null, error };
  return { request: (data && data[0]) || null, error: null };
}
