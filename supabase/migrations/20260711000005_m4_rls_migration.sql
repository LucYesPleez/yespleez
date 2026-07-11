-- ============================================================
-- M4 — RLS MIGRATION (additive-permissive)
-- ============================================================
--
-- Design: docs/m4-design-review-2026-07.md (approved 2026-07-11
-- with two decisions: (1) implement the INSERT consistency guard
-- as an identity-consistency invariant; (2) F1 resolved first,
-- as its own app-code change, before this migration).
--
-- Spec authority: Architecture Specification v1.0 §12 phase 4 —
-- "Additive-permissive: new owner-based policies land beside old
-- ones; old ones are removed only at contract." This migration
-- therefore ONLY executes CREATE POLICY (+ COMMENT). No policy
-- is altered or dropped; no schema or data is touched; no
-- application code ships with it (hard rule: RLS always isolated
-- from app code).
--
-- Cutover set (re-derived in the design review §1.1): exactly the
-- two tables whose existing policies authorise through legacy
-- identity columns that M8 retires —
--   venue_availability  (user_id            → profile_id)
--   venue_enquiries     (venue_user_id      → venue_profile_id,
--                        applicant_user_id  → applicant_profile_id)
-- Every other table's policies are correct account-based
-- authorisation and remain untouched, permanently or until M8.
--
-- The profile leg pattern (all four policies):
--   EXISTS (SELECT 1 FROM profiles p
--           WHERE p.id = <row>.<profile column>
--             AND p.user_id = auth.uid())
-- Notes that fall out of this shape, relied on by the design:
--   * <profile column> IS NULL      → leg is inert (legacy governs)
--   * unclaimed profile (user_id NULL) → leg grants NOBODY
--   * anon (auth.uid() NULL)        → leg grants nobody
--
-- THE CONSISTENCY GUARD (approval decision 1). Every WITH CHECK
-- below additionally enforces, per (legacy, profile) column pair:
-- if both are non-null, the referenced profile's user_id must
-- equal the legacy column — i.e. a single row may not name two
-- different identities for the same side. This is an
-- identity-consistency invariant, not a business rule: it is the
-- same "the identity you write must be coherent" property the
-- legacy policies already enforce, extended with "or absent" so
-- M6+ writes that stop populating legacy columns still pass.
--
-- Honest limitation, documented not hidden: permissive policies
-- OR together, so the guard constrains only what THESE new
-- policies admit. A write that passes an untouched legacy policy
-- still succeeds (that is the additive-permissive mandate). A
-- RESTRICTIVE policy could enforce the invariant absolutely but
-- could also reject writes that succeed today, which M4 is
-- forbidden to do.
--
-- The guard is deliberately NOT applied to the UPDATE policy's
-- row visibility or check: after a claim transfers a profile to a
-- new owner, rows legitimately diverge (legacy column = old
-- account, profile column = new owner) and the new owner must
-- still be able to manage them — that divergence is the intended
-- "commercial records belong to profiles" semantics, not a
-- forgery.
--
-- M8 OBLIGATION: the two guarded WITH CHECKs reference legacy
-- columns (venue_availability.user_id, venue_enquiries.
-- applicant_user_id / venue_user_id). The M8 contract migration
-- MUST drop-and-recreate these policies without the guard in the
-- same change that drops those columns, or the policies will
-- error. Recorded here and in the design review §5.
--
-- PRE-FLIGHT PERFORMED (2026-07-11, immediately before writing
-- this file — full record in docs/m4-design-review-2026-07.md):
--   * Fresh pg_policies dump (policyname, permissive, roles, cmd,
--     qual, with_check) across all 11 migration-relevant tables:
--     28 policies, ALL PERMISSIVE, exact match to the M0 §3.1
--     baseline + Fix 2/Fix 3. No dashboard drift. The additive-OR
--     strategy's PERMISSIVE assumption is confirmed, not assumed.
--   * Roles detail M0 didn't record: profiles "enable all for
--     authenticated users" is TO authenticated; "enable read for
--     everyone" is TO anon,authenticated; all 26 others {public}.
--   * F1 residual check: venue_enquiries has 2 rows, 0 with a
--     NULL venue_profile_id/applicant_profile_id — the pre-fix
--     sendEnquiry write path produced no legacy-only rows; no
--     backfill re-run required.
--
-- EXECUTED 2026-07-11 against production (project doqzxvppibuzieajqkxm,
-- main). Verified via the §4 matrix run PRE and POST (66 tests):
-- diff = 8 expected differences only — policy count 4→8, five
-- State-3 authorisation positives, A6 (new-leg INSERT capability),
-- A11 (consistency-guard 42501 rejection). A6/A11 reviewed after
-- execution and accepted (both designed in §1.4, neither changes
-- current app behaviour or creates exposure, A11 is stricter, both
-- only affect synthetic verification cases). 58/66 cells identical
-- including the entire C2 guarantee and all 9 untouched tables.
-- Full evidence: docs/m4-verification-evidence-2026-07.md.
-- ============================================================


-- ── venue_availability: profile-based ownership (parallel) ──
-- Legacy policy "Users manage own venue availability"
-- (ALL, auth.uid() = user_id) remains in force, untouched.

CREATE POLICY "Profile owner manages venue availability"
  ON public.venue_availability
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_availability.profile_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_availability.profile_id
        AND p.user_id = auth.uid()
    )
    -- consistency guard: user_id and profile_id must not name
    -- two different identities on the same row
    AND (
      venue_availability.user_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = venue_availability.profile_id
          AND p.user_id = venue_availability.user_id
      )
    )
  );

COMMENT ON POLICY "Profile owner manages venue availability" ON public.venue_availability IS
  'M4 (identity migration, 2026-07): profile-based ownership leg, additive-permissive '
  'beside the legacy user_id policy. WITH CHECK carries the approved identity-consistency '
  'guard (legacy user_id, when present, must belong to the same profile named by '
  'profile_id). M8 contract MUST recreate this policy without the guard when '
  'venue_availability.user_id is dropped. Design: docs/m4-design-review-2026-07.md.';


-- ── venue_enquiries: profile-based ownership (parallel ×3) ──
-- Legacy policies remain in force, untouched:
--   "Users can insert own enquiries"        INSERT  auth.uid() = applicant_user_id
--   "Venue owner can read their enquiries"  SELECT  auth.uid() = venue_user_id OR applicant_user_id
--   "Venue owner can update status"         UPDATE  auth.uid() = venue_user_id
-- No DELETE policy exists on either identity system and none is
-- added (no code path deletes enquiries; adding one would be a
-- new business rule).

CREATE POLICY "Applicant profile owner can insert own enquiries"
  ON public.venue_enquiries
  FOR INSERT
  WITH CHECK (
    -- authorisation: the inserting account owns the applicant profile
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.applicant_profile_id
        AND p.user_id = auth.uid()
    )
    -- consistency guard, applicant pair
    AND (
      venue_enquiries.applicant_user_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = venue_enquiries.applicant_profile_id
          AND p.user_id = venue_enquiries.applicant_user_id
      )
    )
    -- consistency guard, venue pair (applies only when both named)
    AND (
      venue_enquiries.venue_profile_id IS NULL
      OR venue_enquiries.venue_user_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = venue_enquiries.venue_profile_id
          AND p.user_id = venue_enquiries.venue_user_id
      )
    )
  );

COMMENT ON POLICY "Applicant profile owner can insert own enquiries" ON public.venue_enquiries IS
  'M4 (identity migration, 2026-07): profile-based applicant INSERT leg, additive-permissive '
  'beside "Users can insert own enquiries". Applicant-side only, mirroring legacy semantics — '
  'venue-initiated invites (InviteSheet) remain blocked by design on both identity systems '
  '(known issue, deferred to the enquiries/Booking rework). WITH CHECK carries the approved '
  'identity-consistency guard on both (legacy, profile) column pairs. M8 contract MUST '
  'recreate this policy without the guard when the legacy columns are dropped. '
  'Design: docs/m4-design-review-2026-07.md.';


CREATE POLICY "Profile owner can read their enquiries"
  ON public.venue_enquiries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.venue_profile_id
        AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.applicant_profile_id
        AND p.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Profile owner can read their enquiries" ON public.venue_enquiries IS
  'M4 (identity migration, 2026-07): profile-based SELECT leg (either side), '
  'additive-permissive beside "Venue owner can read their enquiries". '
  'Design: docs/m4-design-review-2026-07.md.';


CREATE POLICY "Venue profile owner can update status"
  ON public.venue_enquiries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.venue_profile_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.venue_profile_id
        AND p.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Venue profile owner can update status" ON public.venue_enquiries IS
  'M4 (identity migration, 2026-07): profile-based venue UPDATE leg, additive-permissive '
  'beside "Venue owner can update status". Deliberately venue-side only, mirroring legacy '
  'semantics — applicant-side status updates stay denied (known issue F3, a business-rule '
  'decision deferred to the enquiries/Booking rework). No consistency guard here by design: '
  'post-claim-transfer rows legitimately diverge and the new owner must retain management '
  'access. Design: docs/m4-design-review-2026-07.md.';


-- ============================================================
-- ROLLBACK (verbatim from the design review §5)
-- ============================================================
--   DROP POLICY "Profile owner manages venue availability"      ON public.venue_availability;
--   DROP POLICY "Applicant profile owner can insert own enquiries" ON public.venue_enquiries;
--   DROP POLICY "Profile owner can read their enquiries"        ON public.venue_enquiries;
--   DROP POLICY "Venue profile owner can update status"         ON public.venue_enquiries;
-- SQL-only, no data to revert. Behaviour-neutral until the first
-- real ownership divergence (claim transfer); hard floor at M8.
-- ============================================================
