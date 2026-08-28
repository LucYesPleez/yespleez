-- ============================================================
-- AV6 · V2 SNAPSHOTS — permanent reporting artefacts, new home
--
-- ⚠ NOT YET APPLIED. Run after AV5.
--
-- Same architecture the v1 table proved: raw usage_events stay the
-- source of truth; a snapshot is a permanent, reproducible reporting
-- artefact, regenerable from raw at any time, never a substitute for
-- it. What changes in v2:
--
--   · lives in the sealed analytics schema (service_role only)
--   · schema_version is part of identity — v1 rows in the legacy
--     public.weekly_analytics_snapshots are RETAINED, and nothing may
--     chart across the version boundary without saying so
--   · segments_used freezes the classification the week was computed
--     with; reclassifying tomorrow must not move last month's figures
--   · rebuild_reason: a finalised week is rebuilt only by an explicit
--     forced request that says why, and the row records it
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.snapshots (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schema_version int  NOT NULL,
  population     text NOT NULL CHECK (population IN ('public', 'internal', 'beta', 'test', 'all')),
  week_start     date NOT NULL,   -- Sydney-local Monday, as the humans name it
  week_end       date NOT NULL,
  metrics        jsonb NOT NULL,
  segments_used  jsonb NOT NULL,
  rows_considered  int NOT NULL,
  rows_in_population int NOT NULL,
  finalised      boolean NOT NULL DEFAULT false,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  rebuild_reason text,
  UNIQUE (schema_version, population, week_start)
);

ALTER TABLE analytics.snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics.snapshots FROM PUBLIC, anon, authenticated;
GRANT  ALL ON analytics.snapshots TO service_role;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- V1 · exists, sealed, service-readable.
DO $$
BEGIN
  IF to_regclass('analytics.snapshots') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: analytics.snapshots does not exist';
  END IF;
  IF has_table_privilege('anon', 'analytics.snapshots', 'SELECT')
     OR has_table_privilege('authenticated', 'analytics.snapshots', 'SELECT') THEN
    RAISE EXCEPTION 'V1 FAILED: snapshots readable with a public key';
  END IF;
  IF NOT has_table_privilege('service_role', 'analytics.snapshots', 'SELECT') THEN
    RAISE EXCEPTION 'V1 FAILED: service_role cannot read snapshots';
  END IF;
  RAISE NOTICE 'V1 PASSED: analytics.snapshots exists, service_role-only';
END $$;

-- V2 · version+population+week is an identity: a duplicate must be
-- refused, so two definitions of one week can never overwrite each
-- other silently (provoke-and-assert).
DO $$
BEGIN
  INSERT INTO analytics.snapshots (schema_version, population, week_start, week_end, metrics, segments_used, rows_considered, rows_in_population)
  VALUES (0, 'public', '2000-01-03', '2000-01-09', '{}', '{}', 0, 0);
  BEGIN
    INSERT INTO analytics.snapshots (schema_version, population, week_start, week_end, metrics, segments_used, rows_considered, rows_in_population)
    VALUES (0, 'public', '2000-01-03', '2000-01-09', '{}', '{}', 0, 0);
    RAISE EXCEPTION 'V2 FAILED: a duplicate (version, population, week) was ACCEPTED';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'V2 PASSED: duplicate week identity rejected, as intended';
  END;
  DELETE FROM analytics.snapshots WHERE schema_version = 0;
END $$;

-- V3 · v1 artefacts untouched and still present.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.weekly_analytics_snapshots') IS NULL THEN
    RAISE NOTICE 'V3 SKIPPED: no legacy snapshot table on this database';
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM public.weekly_analytics_snapshots;
  RAISE NOTICE 'V3 PASSED: % v1 snapshot(s) retained for auditability', n;
END $$;

NOTIFY pgrst, 'reload schema';
