-- ============================================================
-- AV7 · DROP THE LEGACY CLASSIFICATION TABLE — D3's funeral
--
-- ⚠ NOT YET APPLIED. Run LAST, after the Analytics v2 UI is in use.
--
-- public.analytics_account_segments was the hand-made production table
-- the audit found with no migration and no writer (D5). AV1 copied its
-- rows into analytics.account_segments (the canonical store), the
-- service mirrored every write back during the transition, and now:
--
--   · Studio's v1 snapshot scheduler is retired (nothing generates)
--   · Studio's analytics page is a pointer to Analytics v2 (nothing reads)
--   · the service's mirror is removed (nothing writes)
--
-- so the table has no readers and no writers, and keeping it is how a
-- future tool finds "the other" classification store and resurrects
-- D3. The 42 v1 SNAPSHOT artefacts are NOT touched — they froze their
-- segment maps at generation time and never consult this table.
-- ============================================================

-- Safety gate: refuse to drop if the canonical table is missing any
-- classification the legacy one holds — the copy must be provably
-- complete at the moment of the drop, not merely believed complete
-- from a migration run weeks earlier.
DO $g$
DECLARE missing int;
BEGIN
  IF to_regclass('public.analytics_account_segments') IS NULL THEN
    RAISE NOTICE 'GATE: legacy table already gone — nothing to do';
    RETURN;
  END IF;
  SELECT count(*) INTO missing
    FROM public.analytics_account_segments l
   WHERE l.segment IN ('internal', 'beta', 'test')
     AND NOT EXISTS (
       SELECT 1 FROM analytics.account_segments a WHERE a.user_id = l.user_id
     );
  IF missing <> 0 THEN
    RAISE EXCEPTION 'GATE FAILED: % legacy classification(s) absent from analytics.account_segments — copy them before dropping', missing;
  END IF;
  RAISE NOTICE 'GATE PASSED: every legacy classification exists canonically';
END
$g$;

DROP TABLE IF EXISTS public.analytics_account_segments;

-- V1 · gone, and the canonical store still answers.
DO $v1$
DECLARE n int;
BEGIN
  IF to_regclass('public.analytics_account_segments') IS NOT NULL THEN
    RAISE EXCEPTION 'V1 FAILED: legacy table still exists';
  END IF;
  SELECT count(*) INTO n FROM analytics.account_segments;
  IF n < 1 THEN
    RAISE EXCEPTION 'V1 FAILED: canonical store is empty — classification would be lost';
  END IF;
  RAISE NOTICE 'V1 PASSED: legacy table dropped; % canonical classification(s) remain', n;
END
$v1$;

-- V2 · the v1 snapshots survive the drop untouched.
DO $v2$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.weekly_analytics_snapshots;
  RAISE NOTICE 'V2 PASSED: % v1 snapshot artefact(s) retained', n;
END
$v2$;

NOTIFY pgrst, 'reload schema';
