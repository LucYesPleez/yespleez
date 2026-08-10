-- ═══════════════════════════════════════════════════════════════════
-- P9 · ENQUIRY PROFILE IDS BECOME REQUIRED
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Prerequisite for P10. Apply P9 → P10 → (later, deliberately) P11.
-- ═══════════════════════════════════════════════════════════════════
--
-- ⭐ WHY THIS COMES FIRST, AND WHY IT IS NOT MERELY TIDINESS
--
-- P10 moves enquiry uniqueness onto the two profile columns. Postgres treats
-- NULLs as DISTINCT in a unique index, so a row with a NULL profile id would
-- sit OUTSIDE that key entirely — unconstrained, invisible to the very rule
-- being added. Fixing the cross-act bug while opening a duplicate hole in the
-- same breath is not a fix.
--
-- ── IT ALSO CLOSES A REAL GAP, NOT A HYPOTHETICAL ONE ──
--
-- RLS on this table is dual-legged (M4, additive-permissive). The profile leg
-- REQUIRES a profile id and checks both column pairs agree. But the legacy leg
-- survives beside it:
--
--     CREATE POLICY "Users can insert own enquiries" … WITH CHECK (auth.uid() = applicant_user_id);
--
-- so the database still ACCEPTS a profile-less insert today. A table-level NOT
-- NULL shuts that at a layer no policy can undo, and does not wait for M8.
--
-- ── SAFE ON THE DATA, AND THE LAST NULL PRODUCER IS ALREADY GONE ──
--
-- Full-table check 2026-08-10: 12 rows, 0 NULL applicant_profile_id, 0 NULL
-- venue_profile_id.
--
-- ⚠ The producer was `InviteSheet`, which derived both ids with
-- `resolveProfileId(user_id, type)` — and an UNCLAIMED artist has no user_id,
-- which is what unclaimed MEANS. Fixed in `0758227` (the callers pass the ids
-- they already hold, and the send REFUSES rather than writing an unattributed
-- row). ⛔ Do not apply P9 to an environment still running code older than
-- that commit: inviting an unclaimed act would turn from an incomplete row
-- into a hard 23502.
--
-- ⚠ Re-runnable ONLY in the sense that SET NOT NULL on an already-NOT NULL
-- column is a no-op. It is not `IF NOT EXISTS`-guarded because there is no
-- such form; running it twice is harmless.
--
-- ⚠ Takes a brief ACCESS EXCLUSIVE lock and scans the table to prove no NULLs.
-- Instant at this size; worth knowing if the table ever grows large.

-- Guard: refuse rather than fail halfway if the data is not what P10 assumes.
DO $$
DECLARE n_app int; n_ven int;
BEGIN
  SELECT count(*) FILTER (WHERE applicant_profile_id IS NULL),
         count(*) FILTER (WHERE venue_profile_id     IS NULL)
    INTO n_app, n_ven
    FROM public.venue_enquiries;
  IF n_app > 0 OR n_ven > 0 THEN
    RAISE EXCEPTION
      'P9 aborted: % rows have a NULL applicant_profile_id and % a NULL venue_profile_id. '
      'Backfill them first — see the m6c attribution work — or these rows would '
      'be silently exempt from P10''s uniqueness key.', n_app, n_ven;
  END IF;
END $$;

ALTER TABLE public.venue_enquiries
  ALTER COLUMN applicant_profile_id SET NOT NULL,
  ALTER COLUMN venue_profile_id     SET NOT NULL;

COMMENT ON COLUMN public.venue_enquiries.applicant_profile_id IS
  'P9 — REQUIRED. The ACT that enquired, not the account behind it. NOT NULL '
  'because P10 keys uniqueness on it and Postgres treats NULLs as distinct, so '
  'a null row would be exempt from the rule. Also closes the legacy RLS leg, '
  'which still permitted profile-less inserts.';

COMMENT ON COLUMN public.venue_enquiries.venue_profile_id IS
  'P9 — REQUIRED. The VENUE PROFILE enquired with, not the account that owns '
  'it: one person may own several venues. Same reasoning as '
  'applicant_profile_id.';

-- ── VERIFY ──
-- Expect both rows to read NO:
--
--   SELECT column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'venue_enquiries'
--      AND column_name IN ('applicant_profile_id', 'venue_profile_id');
--
-- ── ROLLBACK ──
--   ALTER TABLE public.venue_enquiries
--     ALTER COLUMN applicant_profile_id DROP NOT NULL,
--     ALTER COLUMN venue_profile_id     DROP NOT NULL;
