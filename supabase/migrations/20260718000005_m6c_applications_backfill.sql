-- ============================================================
-- M6c — APPLICATIONS SENDER BACKFILL  (DATA ONLY — no schema)
-- ============================================================
--
-- Run ALONE, after M6b. Changes data and nothing else.
--
-- Implements U4, decided by the owner 18 Jul 2026 and recorded in
-- CLAUDE.md: infer the sender profile only where the user owns
-- exactly one profile of the applicable type; leave every other row
-- NULL. v1.1 §A10: "Do not let a backfill silently guess."
--
-- ── DRY RUN (2026-07-18, before this file was written) ──
--
--   total_applications        12
--   guest_no_account           1   → stays NULL (no account at all)
--   inferable                  9   → set by this migration
--   ambiguous_stays_null       2   → owner has 2+ performer profiles
--   no_candidate_stays_null    0
--
-- 9 of 12 recovered. 3 remain NULL, honestly.
--
-- ── WHY THE CANDIDATE SET EXCLUDES 'punter' ──
--
-- Candidates are artist / band / standup — performer types only.
-- This is load-bearing rather than cosmetic: M5.5 gave every account
-- a Personal profile, so including 'punter' would give every user
-- two-or-more candidates and NOTHING would be inferable. A Personal
-- profile does not apply for gigs. venue and host are excluded for
-- the same reason.
--
-- ── WHY THE 2 AMBIGUOUS ROWS ARE NOT RESOLVED ──
--
-- A user owning several performer profiles applied as one of them
-- and the row does not record which. v1.1 §A10 is explicit that this
-- history is unrecoverable — it is B2 having already caused
-- permanent data loss. No heuristic is applied: not most-recent, not
-- most-active, not best-match. A plausible reconstruction is worse
-- than an honest NULL, because it cannot later be told apart from a
-- fact.
--
-- A narrowing by `profiles.created_at < applications.created_at`
-- (candidates that existed when the application was sent) was
-- considered and NOT used. It would be sound only if created_at
-- reliably reflects true creation, which cannot be assumed for rows
-- that passed through earlier migrations. Trading a verified NULL
-- for an unverified value is the wrong direction.
--
-- ── IDEMPOTENT ──
-- `AND a.from_profile_id IS NULL` means a re-run touches nothing,
-- and it can never overwrite a value written by the application
-- after cutover.
-- ============================================================

UPDATE public.applications a
SET from_profile_id = c.only_profile
FROM (
  SELECT a2.id                 AS app_id,
         count(p.id)           AS n,
         (array_agg(p.id))[1]  AS only_profile
  FROM public.applications a2
  JOIN public.profiles p
    ON p.user_id = a2.artist_id
   AND p.type IN ('artist', 'band', 'standup')
  WHERE a2.artist_id IS NOT NULL
  GROUP BY a2.id
) c
WHERE a.id = c.app_id
  AND c.n = 1
  AND a.from_profile_id IS NULL;

-- ============================================================
-- VERIFY — expect  12 │ 9 │ 3
-- ============================================================
--   SELECT count(*)                                        AS total,
--          count(*) FILTER (WHERE from_profile_id IS NOT NULL) AS attributed,
--          count(*) FILTER (WHERE from_profile_id IS NULL)     AS honestly_null
--   FROM public.applications;
--
-- Every attributed row must point at a profile owned by the same
-- account the application already named. This must return 0:
--
--   SELECT count(*) AS mismatched
--   FROM public.applications a
--   JOIN public.profiles p ON p.id = a.from_profile_id
--   WHERE p.user_id IS DISTINCT FROM a.artist_id;
--
-- That second query is the one that matters. A non-zero result means
-- the backfill attributed an application to a profile belonging to a
-- different human, which would be worse than leaving it NULL.
-- ============================================================
