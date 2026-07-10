-- ============================================================
-- SECURITY FIX 2 of 4 — applications UPDATE hole
-- Applied: 2026-07-11 (via Supabase SQL editor)
-- Part of: 2026-07 security sprint (isolated from identity migration)
-- ============================================================
--
-- VULNERABILITY
-- "Hosts update apps" had USING (true) — unconditional. Any request,
-- regardless of ownership, could update any row in `applications`.
--
-- WHY THIS IS NOT A PURE DROP
-- Tracing every UPDATE call site on `applications` found one
-- legitimate path silently depending on the broad policy:
-- notifActions.js's acceptSlotOffer()/declineSlotOffer() (live,
-- called from NotificationsScreen.jsx and NotifPanel.jsx) update
-- applications.status as the ARTIST (auth.uid() = artist_id), not
-- the host. No other policy covered artist-initiated UPDATE — only
-- DELETE ("artists can withdraw application"). Dropping the broad
-- policy with nothing added back would have silently broken
-- Accept/Decline on slot-offer notifications.
--
-- Exhaustive trace of all 12 UPDATE call sites in the codebase
-- confirmed status is the ONLY column any artist-side call ever
-- modifies. A column-level GRANT restricting artists to
-- status-only was considered and rejected for this sprint: both
-- `anon` and `authenticated` already hold UPDATE grants on every
-- column of this table (verified via information_schema.column_privileges,
-- 2026-07-11), so a column-level restriction would have required
-- revoking those existing all-column grants — broader privilege
-- restructuring than a security patch should do.
--
-- INTERIM, NOT A DESIGN DECISION
-- The fact that an artist can write applications.status at all is
-- itself a design smell — `performances` already has a properly
-- scoped artist-status policy ("Artist can update own performance
-- status") and is arguably the real source of truth for booking
-- state. Whether applications.status should become derived/
-- read-only, and whether performances should be the sole writable
-- booking state, is deferred to the Booking architecture review.
-- ============================================================

-- Step 1: restore the artist's legitimate update path.
-- Mirrors the scoping already used by "artists can withdraw
-- application" (the existing DELETE policy on this same table) —
-- same shape, no new business rule, no status-transition validation
-- added or assumed.
CREATE POLICY "artists can update own application (interim)"
  ON public.applications
  FOR UPDATE
  USING (auth.uid() = artist_id)
  WITH CHECK (auth.uid() = artist_id);

COMMENT ON POLICY "artists can update own application (interim)" ON public.applications IS
  'INTERIM — added during the 2026-07 security sprint solely to preserve existing '
  'application behaviour (acceptSlotOffer/declineSlotOffer) after removing the '
  'unconditional "Hosts update apps" policy. Not a confirmation that direct artist '
  'writes to applications.status are the intended design. To be revisited during the '
  'Booking architecture review: determine whether performances should become the sole '
  'writable booking state and applications.status should become derived/read-only. '
  'KNOWN LIMITATION: this is a row-level policy only. anon/authenticated already hold '
  'UPDATE grants on every column of this table (verified 2026-07-11), so a column-level '
  'restriction to status-only was considered and rejected for this sprint — it would '
  'have required revoking those existing all-column grants, which is broader privilege '
  'restructuring than a security patch should do. In practice this policy permits an '
  'artist to rewrite any column on their own row (not just status) via a direct API '
  'call, even though no current application code does so. Revisit column-level '
  'restriction alongside the Booking architecture review.';

-- Step 2: remove the unconditional policy.
DROP POLICY "Hosts update apps" ON public.applications;


-- ============================================================
-- VERIFICATION PERFORMED (2026-07-11)
-- ============================================================
--
-- 1. Policy state confirmed post-change:
--      SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='applications' AND cmd='UPDATE';
--    Result: exactly two rows —
--      "artists can update own application (interim)" (auth.uid() = artist_id)
--      "hosts can update application status" (EXISTS ... host_id = auth.uid())
--    "Hosts update apps" no longer present.
--
-- 2. Host workflow — verified live through the actual running app
--    (not a raw API test): navigated to a real event's Applications
--    screen, clicked the real "SHORTLIST" button on a pending
--    application. Result: PENDING 1→0, TENTATIVE 0→1. Confirms
--    ApplicationsScreen.jsx's respond() -> update({status}) path
--    still works for the host under the new policy set. RLS does
--    not distinguish which status value is written, so this single
--    transition validates shortlist/accept/decline alike.
--
-- 3. Artist workflow — verified by replicating the exact query
--    acceptSlotOffer()/declineSlotOffer() perform, against two real
--    applications where the test account is the artist:
--      accept:  status -> 'confirmed'  — 1 row affected, confirmed
--      decline: status -> 'tentative'  — 1 row affected, confirmed
--
-- ============================================================
-- DEFERRED — cross-user security validation cases (not executed)
-- ============================================================
--
-- Per explicit direction, the following were NOT run against live
-- data (each would require writing to another real user's row or
-- acting anonymously against real data, which needs its own
-- explicit authorization separate from this fix's completion).
-- Documented here as the validation cases this fix is designed to
-- satisfy; run and record results before considering the sprint
-- fully closed out.
--
--   a) An artist attempts to UPDATE a DIFFERENT artist's application
--      row directly via the API. Expected: 0 rows affected.
--   b) An authenticated non-host, non-owner attempts to UPDATE an
--      application on an event they don't own. Expected: 0 rows
--      affected.
--   c) An anonymous (unauthenticated) request attempts any UPDATE
--      on this table. Expected: 0 rows affected — both surviving
--      policies require a non-null auth.uid() match, which anon
--      requests never satisfy.
