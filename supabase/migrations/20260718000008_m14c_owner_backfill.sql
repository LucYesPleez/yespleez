-- ============================================================
-- M14c — OWNER BACKFILL  (DATA ONLY — no schema)
-- ============================================================
--
-- Run ALONE. One responsibility: populate events.owner_profile_id
-- for the 24 events that predate M14b.
--
-- Invariant established by this migration:
--   **Every event has an owner_profile_id.**  (identity v1.3 O-R6)
--
-- The venue-relationship repair is M14d and is deliberately NOT here.
-- It establishes a different invariant (every venue_profile_id either
-- identifies the hosting venue or is NULL), and combining them would
-- cost independent rollback, independent verification and a readable
-- migration log for no benefit.
--
-- ── WHY THIS IS DETERMINISTIC, NOT AN INFERENCE ──
--
-- The M14c dry run (docs/m14c-owner-backfill-dryrun-2026-07.md) and
-- its post-fix re-run established, against live data on 18 Jul 2026:
--
--   * 24 events, all sharing ONE host_id
--   * that account owns 5 owner-eligible profiles (venue, artist,
--     band, standup, host) — so U4 resolves NOTHING, by design
--   * 0 events already carry owner_profile_id
--   * the target host profile exists: "YesPleez"
--     4bdb2004-0e79-4f27-a569-3071bfc58fe5
--   * 0 events created since the venue fix
--
-- U4's rule produced 0 of 24. The owner therefore made a single
-- product decision covering the whole table rather than a per-row
-- inference: these events were created and are managed by that
-- account, so its Host profile is the accountable owner today. That is
-- true under O-R4 — the owner is whoever is accountable — and it
-- asserts nothing false about any venue.
--
-- Rows remain correctable by pre-claim Ops reattribution (Phase 13 Q6
-- `T2`) as Studio creates real venue profiles. That is the normal
-- operation of the model, not a repair of a mistake.
--
-- ── THE ACCOUNT IS DERIVED, NOT HARDCODED ──
--
-- The UPDATE scopes to events whose host_id is the account that owns
-- the target profile, read from the profile itself. A hardcoded user
-- id would be a second fact to keep true; deriving it means the
-- migration cannot assign events belonging to a different account even
-- if one appears between writing this and running it.
--
-- Combined with `owner_profile_id IS NULL`, the statement is
-- idempotent and cannot touch a row M14b has already stamped.
-- ============================================================


-- ── Pre-flight: fail loudly rather than silently mis-assign ──
-- The FK would catch a missing profile. It would NOT catch a profile
-- of the wrong type, or one belonging to another account — both of
-- which would assign 24 events to the wrong owner and look like a
-- clean run.
DO $$
DECLARE
  t_type    text;
  t_user_id uuid;
BEGIN
  SELECT type, user_id INTO t_type, t_user_id
  FROM public.profiles
  WHERE id = '4bdb2004-0e79-4f27-a569-3071bfc58fe5';

  IF t_type IS NULL THEN
    RAISE EXCEPTION 'M14c: target profile 4bdb2004-… does not exist. Re-run the dry run before proceeding.';
  END IF;
  IF t_type <> 'host' THEN
    RAISE EXCEPTION 'M14c: target profile is type %, expected host. Aborting rather than assigning 24 events to the wrong owner.', t_type;
  END IF;
  IF t_user_id IS NULL THEN
    RAISE EXCEPTION 'M14c: target profile is unclaimed (user_id IS NULL). The dry run recorded it as owned; state has changed.';
  END IF;
END $$;


-- ── The backfill ──
UPDATE public.events e
SET owner_profile_id = '4bdb2004-0e79-4f27-a569-3071bfc58fe5'
WHERE e.owner_profile_id IS NULL
  AND e.host_id = (
    SELECT p.user_id FROM public.profiles p
    WHERE p.id = '4bdb2004-0e79-4f27-a569-3071bfc58fe5'
  );

-- Expect: UPDATE 24


-- ============================================================
-- VERIFY — all three must hold
-- ============================================================
--
-- 1. The invariant. Expect 24 | 24 | 0:
--
--      SELECT count(*)                                          AS total,
--             count(owner_profile_id)                           AS owned,
--             count(*) FILTER (WHERE owner_profile_id IS NULL)  AS unowned
--      FROM public.events;
--
-- 2. No unexpected row was affected — every owner is the intended
--    profile. Expect 0:
--
--      SELECT count(*) AS wrong_owner
--      FROM public.events
--      WHERE owner_profile_id IS DISTINCT FROM '4bdb2004-0e79-4f27-a569-3071bfc58fe5';
--
--    (This will legitimately become non-zero once new events are
--    created by other accounts under M14b. It is an assertion about
--    THIS migration's effect, run immediately after it.)
--
-- 3. Every owner resolves to a real, owner-eligible profile. Expect 0:
--
--      SELECT count(*) AS bad_owner_ref
--      FROM public.events e
--      LEFT JOIN public.profiles p ON p.id = e.owner_profile_id
--      WHERE e.owner_profile_id IS NOT NULL
--        AND (p.id IS NULL OR p.type = 'punter');
--
-- ── NOT established by this migration ──
-- owner_profile_id is still nullable. O-R6 is now true of the data but
-- is not yet enforced by the schema; a NOT NULL belongs with the
-- policy cutover (v1.3 phase 3), which rides with R3.2 and remains
-- deferred pending an observed client write carrying from_profile_id.
--
-- venue_profile_id is untouched. 23 of 24 rows still point at the
-- wrong venue — see erratum E3 and M14d.
-- ============================================================
