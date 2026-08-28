-- ============================================================
-- AV0 · THE ANALYTICS SCHEMA — foundation for Analytics v2
--
-- ⚠ NOT YET APPLIED. Run in the Supabase SQL editor, then run AV1.
--
-- Creates the `analytics` schema that owns every v2 table. Raw events
-- stay where they are: `public.usage_events` remains the immutable raw
-- store (A1/A2), and nothing here touches it.
--
-- ── THE PRIVILEGE MODEL, DECIDED ONCE FOR THE WHOLE SCHEMA ──────
--
-- ⚠ THIS PROJECT GRANTS `anon` AND `authenticated` FULL ACCESS TO EVERY
-- NEW TABLE IN `public`, AUTOMATICALLY, via ALTER DEFAULT PRIVILEGES.
-- A1 §5 documents the failure that follows from forgetting that. The
-- `analytics` schema takes the opposite stance at the SCHEMA level, so
-- no individual table can be born exposed:
--
--   · anon / authenticated hold NO privileges here, not even USAGE —
--     with no USAGE on the schema, a table privilege granted later by
--     accident is unreachable. Belt and braces, one level up.
--   · service_role owns full access. The Analytics service (Express,
--     local, service-role key server-side) is the only reader.
--   · default privileges are reset for this schema so FUTURE tables
--     are born closed too, not just the ones created today.
--
-- The one deliberate exception arrives in AV4: attribution touches are
-- client-written and will carry their own explicit INSERT grant and
-- policy, in that migration, where the reasoning can sit next to it.
--
-- ── POSTGREST EXPOSURE — A MANUAL STEP THIS FILE CANNOT DO ──────
--
-- ⚠⚠ PostgREST only serves schemas listed in the project's "Exposed
-- schemas" (Dashboard → Settings → API → API Settings → db_schema /
-- "Extra search path"). After applying this migration, add `analytics`
-- to Exposed schemas or the Analytics service's reads will 406 even
-- under the service-role key. The service reads this schema with an
-- `Accept-Profile: analytics` header; exposure is what makes that
-- header resolvable. This is config, not SQL — it cannot live in a
-- migration, so it lives in this comment and in the service's own
-- startup check, which reports the missing exposure by name.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS analytics;

-- Close the schema. PUBLIC is included for the same reason A1 §5
-- includes it: a privilege held there satisfies has_schema_privilege
-- just as an explicit grant would, and the point is that the
-- capability is gone however it arrived.
REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated;
GRANT  USAGE ON SCHEMA analytics TO service_role;

-- Future-proof the closure: objects created in this schema later must
-- be born closed, whatever role creates them ends up being. Without
-- this, the project's public-schema default-privilege habit could be
-- copied here by a future tool and quietly reopen the door.
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT ALL ON SEQUENCES TO service_role;

-- PostgREST discovers schema access through the authenticator role's
-- search; service_role USAGE above is the grant that matters. anon
-- deliberately receives nothing — there is no anonymous read of any
-- analytics interpretation, same stance as A1 §3 takes for raw events.


-- ============================================================
-- VERIFICATION — positive assertions, A1 house style. The SQL editor
-- has no JWT, so each block asserts a catalogue fact rather than
-- relying on an empty result meaning anything.
-- ============================================================

-- V1 · schema exists and anon/authenticated cannot even enter it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'analytics') THEN
    RAISE EXCEPTION 'V1 FAILED: analytics schema does not exist';
  END IF;
  IF has_schema_privilege('anon', 'analytics', 'USAGE') THEN
    RAISE EXCEPTION 'V1 FAILED: anon holds USAGE on analytics — tables here could become reachable';
  END IF;
  IF has_schema_privilege('authenticated', 'analytics', 'USAGE') THEN
    RAISE EXCEPTION 'V1 FAILED: authenticated holds USAGE on analytics';
  END IF;
  IF NOT has_schema_privilege('service_role', 'analytics', 'USAGE') THEN
    RAISE EXCEPTION 'V1 FAILED: service_role cannot enter the analytics schema — the service would read nothing';
  END IF;
  RAISE NOTICE 'V1 PASSED: analytics schema exists; service_role only';
END $$;

-- V2 · future tables are born closed: the default ACL for this schema
-- must not carry anon/authenticated. Checked by creating a probe table
-- under the current role, asserting its grants, and dropping it — a
-- default privilege only proves itself on a real object.
DO $$
BEGIN
  EXECUTE 'CREATE TABLE analytics._av0_probe (id int)';
  IF has_table_privilege('anon', 'analytics._av0_probe', 'SELECT')
     OR has_table_privilege('authenticated', 'analytics._av0_probe', 'SELECT') THEN
    EXECUTE 'DROP TABLE analytics._av0_probe';
    RAISE EXCEPTION 'V2 FAILED: a newly created analytics table is readable by anon/authenticated — default privileges are not reset';
  END IF;
  IF NOT has_table_privilege('service_role', 'analytics._av0_probe', 'SELECT') THEN
    EXECUTE 'DROP TABLE analytics._av0_probe';
    RAISE EXCEPTION 'V2 FAILED: service_role cannot read a new analytics table';
  END IF;
  EXECUTE 'DROP TABLE analytics._av0_probe';
  RAISE NOTICE 'V2 PASSED: new analytics tables are born service_role-only';
END $$;

-- V3 · nothing here touched the raw store. usage_events remains in
-- public, RLS on, with its single INSERT policy — restated here so a
-- future edit to this file that drifts into the raw table fails loudly.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.usage_events') IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: public.usage_events is missing — AV0 must not run before A1';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'usage_events';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V3 FAILED: usage_events no longer has exactly one policy (found %) — something altered the raw store', n;
  END IF;
  RAISE NOTICE 'V3 PASSED: raw event store untouched';
END $$;
