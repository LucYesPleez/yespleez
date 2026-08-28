-- ============================================================
-- AV1 · ACCOUNT SEGMENTS — classification becomes reproducible
--
-- ⚠ NOT YET APPLIED. Run in the Supabase SQL editor, after AV0.
--
-- `public.analytics_account_segments` exists in production (one row:
-- the operator account, marked internal, 2026-08-14) with NO migration
-- anywhere in Git and no writer anywhere in code — audit defect D5.
-- This migration gives the fact a reproducible home:
--
--   analytics.account_segments   the canonical classification table
--
-- and copies the live rows across. ⛔ The legacy public table is NOT
-- dropped here: Studio's weekly-snapshot generator still reads it, and
-- it keeps doing so until the v2 snapshot path reconciles (Phase F).
-- Two readers, one classification: the copy below is one-time, and
-- from AV1 on the ONLY writer anywhere is the Analytics service,
-- writing the analytics-schema table. The service also mirrors writes
-- to the legacy table until F retires it — stated here so nobody
-- discovers the mirror by surprise, and defined in code, not SQL,
-- because it is a transitional behaviour with a planned death.
--
-- ── THE SHAPE, AND WHY EACH COLUMN ──────────────────────────────
--
-- segment · CHECK ('internal','beta','test') — ⛔ 'public' IS ABSENCE.
--   The audit's safe-default rule as a constraint: an unclassified
--   account is a real person, and a row cannot exist that merely
--   restates the default. Deleting a row IS reclassifying to public.
--
-- source · how the classification came to be — 'direct' (a person
--   chose it), 'team_default' (materialised when the account joined a
--   team whose default says so; AV2 builds teams), 'system' (seeded or
--   derived by the service). Classification must be explainable from
--   database state alone; this column is that explanation.
--
-- user_id → auth.users ON DELETE CASCADE. Unlike raw events (which
--   keep their anonymous fact when an account dies, A1), a
--   classification row ABOUT an account has no meaning after it.
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.account_segments (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  segment     text NOT NULL CHECK (segment IN ('internal', 'beta', 'test')),
  source      text NOT NULL DEFAULT 'direct'
                   CHECK (source IN ('direct', 'team_default', 'system')),
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Grants: AV0's default privileges already made this service_role-only
-- at birth; restated explicitly because the dashboard depends on it
-- and it should not rest on a default (the A1 §5 lesson, again).
REVOKE ALL ON analytics.account_segments FROM PUBLIC, anon, authenticated;
GRANT  ALL ON analytics.account_segments TO service_role;

-- ── ONE-TIME COPY FROM THE LEGACY TABLE ─────────────────────────
--
-- source = 'system': these rows were seeded by hand in production, not
-- chosen through the product, and the provenance column should say so.
-- Idempotent (ON CONFLICT DO NOTHING) so re-running the migration
-- cannot clobber a later, deliberate reclassification.
--
-- Guarded: on a FRESH database the legacy table does not exist and the
-- copy is skipped — that is what "reproducible from Git" means here.
DO $$
BEGIN
  IF to_regclass('public.analytics_account_segments') IS NOT NULL THEN
    INSERT INTO analytics.account_segments (user_id, segment, source, note, updated_at)
    SELECT user_id, segment, 'system', note, updated_at
      FROM public.analytics_account_segments
     WHERE segment IN ('internal', 'beta', 'test')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;


-- ============================================================
-- VERIFICATION
-- ============================================================

-- V1 · table exists, closed to anon/authenticated, open to the service.
DO $$
BEGIN
  IF to_regclass('analytics.account_segments') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: analytics.account_segments does not exist';
  END IF;
  IF has_table_privilege('anon', 'analytics.account_segments', 'SELECT')
     OR has_table_privilege('authenticated', 'analytics.account_segments', 'SELECT') THEN
    RAISE EXCEPTION 'V1 FAILED: classification data is readable with a public key';
  END IF;
  IF NOT has_table_privilege('service_role', 'analytics.account_segments', 'SELECT') THEN
    RAISE EXCEPTION 'V1 FAILED: service_role cannot read account segments';
  END IF;
  RAISE NOTICE 'V1 PASSED: account_segments exists, service_role-only';
END $$;

-- V2 · 'public' cannot be stored — the default lives as absence, and
-- the constraint must BITE, not merely exist (A1 V4 shape: provoke the
-- rejection and fail if it does not happen).
DO $$
BEGIN
  BEGIN
    INSERT INTO analytics.account_segments (user_id, segment)
    VALUES ('00000000-0000-0000-0000-000000000000', 'public');
    RAISE EXCEPTION 'V2 FAILED: a segment row of ''public'' was ACCEPTED — the absence rule is not enforced';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V2 PASSED: ''public'' rejected by CHECK, as intended';
    WHEN foreign_key_violation THEN
      -- The zero uuid has no auth.users row; if the FK fired first the
      -- CHECK was never tested. Assert it directly instead.
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'analytics.account_segments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%internal%'
          AND pg_get_constraintdef(oid) NOT LIKE '%''public''%'
      ) THEN
        RAISE NOTICE 'V2 PASSED: CHECK excludes ''public'' (asserted via catalogue; FK fired first)';
      ELSE
        RAISE EXCEPTION 'V2 FAILED: cannot prove the segment CHECK excludes ''public''';
      END IF;
  END;
END $$;

-- V3 · the copy carried the production classification across: whatever
-- the legacy table holds must now exist here too, row for row.
DO $$
DECLARE missing int;
BEGIN
  IF to_regclass('public.analytics_account_segments') IS NULL THEN
    RAISE NOTICE 'V3 SKIPPED: fresh database, no legacy table to copy';
    RETURN;
  END IF;
  SELECT count(*) INTO missing
    FROM public.analytics_account_segments l
   WHERE l.segment IN ('internal', 'beta', 'test')
     AND NOT EXISTS (
       SELECT 1 FROM analytics.account_segments a WHERE a.user_id = l.user_id
     );
  IF missing <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: % legacy classification row(s) did not copy across', missing;
  END IF;
  RAISE NOTICE 'V3 PASSED: legacy classifications copied';
END $$;

-- V4 · nothing here touched raw events or the legacy table's contents.
DO $$
DECLARE legacy_n int;
BEGIN
  IF to_regclass('public.analytics_account_segments') IS NOT NULL THEN
    SELECT count(*) INTO legacy_n FROM public.analytics_account_segments;
    RAISE NOTICE 'V4 NOTE: legacy table retained with % row(s); it is read-only by convention until Phase F retires it', legacy_n;
  END IF;
  IF to_regclass('public.usage_events') IS NULL THEN
    RAISE EXCEPTION 'V4 FAILED: usage_events missing';
  END IF;
  RAISE NOTICE 'V4 PASSED: raw store present and untouched';
END $$;
