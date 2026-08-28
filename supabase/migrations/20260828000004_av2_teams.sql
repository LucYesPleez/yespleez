-- ============================================================
-- AV2 · TEAMS — membership, orthogonal to classification
--
-- ⚠ NOT YET APPLIED. Run after AV0/AV1.
--
-- Team membership and analytics classification are DIFFERENT AXES.
-- A team never classifies anyone by existing: `default_segment` is a
-- convenience the SERVICE materialises into an explicit
-- analytics.account_segments row (source = 'team_default') at
-- member-add time — in code, never at read time, and never over a
-- 'direct' row. Classification stays explainable from database state
-- alone: every classified account has its own row saying why.
--
-- default_segment NULL means public — the same absence rule as
-- account_segments, for the same reason: a team of ordinary users
-- (Echo Valley's organisers) is the default case, and it must not be
-- possible to store a row that merely restates it.
--
-- removed_at is SOFT removal. Membership history is evidence — "who
-- was on the YesPleez team in August" must stay answerable after
-- someone leaves. Removal does NOT retract a materialised segment row:
-- classification changes are deliberate acts, not side effects of
-- roster edits, and the segment row's source still explains itself.
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  description     text,
  default_segment text CHECK (default_segment IN ('internal', 'beta', 'test')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics.team_members (
  team_id    uuid NOT NULL REFERENCES analytics.teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text,
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE analytics.teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.team_members ENABLE ROW LEVEL SECURITY;

-- AV0's default privileges already close these; restated because the
-- service depends on it and it should not rest on a default.
REVOKE ALL ON analytics.teams, analytics.team_members FROM PUBLIC, anon, authenticated;
GRANT  ALL ON analytics.teams, analytics.team_members TO service_role;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- V1 · both tables exist, closed to public keys, open to the service.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['analytics.teams', 'analytics.team_members'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'V1 FAILED: % does not exist', t;
    END IF;
    IF has_table_privilege('anon', t, 'SELECT')
       OR has_table_privilege('authenticated', t, 'SELECT') THEN
      RAISE EXCEPTION 'V1 FAILED: % readable with a public key', t;
    END IF;
    IF NOT has_table_privilege('service_role', t, 'SELECT') THEN
      RAISE EXCEPTION 'V1 FAILED: service_role cannot read %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'V1 PASSED: teams and team_members exist, service_role-only';
END $$;

-- V2 · a team cannot claim 'public' as a default — absence is public.
DO $$
BEGIN
  BEGIN
    INSERT INTO analytics.teams (name, default_segment) VALUES ('_av2_probe', 'public');
    DELETE FROM analytics.teams WHERE name = '_av2_probe';
    RAISE EXCEPTION 'V2 FAILED: default_segment ''public'' was ACCEPTED';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V2 PASSED: ''public'' default rejected by CHECK, as intended';
  END;
END $$;

-- V3 · nothing above left a row behind.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM analytics.teams WHERE name = '_av2_probe';
  IF n <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: probe team row survived';
  END IF;
  RAISE NOTICE 'V3 PASSED: no verification residue';
END $$;
