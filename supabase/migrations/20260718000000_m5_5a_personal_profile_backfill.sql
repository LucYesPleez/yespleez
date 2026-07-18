-- ============================================================
-- M5.5a — PERSONAL PROFILE BACKFILL  (DATA ONLY — no schema)
-- ============================================================
--
-- Run this ALONE. Do not paste it together with M5.5b or M5.5c.
--
-- v1.1's migration hard rules require schema and backfill to be
-- separate. The first draft of M5.5 combined the backfill with two
-- schema changes in one file; run as a single transaction in the SQL
-- editor, a failure in the later schema section rolled the backfill
-- back with it, and the census came back unchanged (18/7/11/0) with
-- no partial progress. Hence the split: this file changes data and
-- nothing else, so it cannot be undone by a schema problem.
--
-- ── CENSUS (read-only, 2026-07-18, before any write) ──
--
--   total_accounts │ exactly_one │ zero │ multiple
--               18 │           7 │   11 │        0
--
-- All 11 accounts lacking a Personal profile are artist-only.
-- Zero duplicates — `profiles_user_type_unique UNIQUE (user_id, type)`
-- already makes a second Personal profile per account impossible
-- (verified 2026-07-18), so no unique index is added anywhere in M5.5.
--
-- ── OWNER DECISION (18 Jul 2026) ──
-- Display name: account display name if available, else email
-- username, else blank. Signup writes `options.data.name`
-- (v2/src/screens/AuthScreen.jsx:32) → `raw_user_meta_data->>'name'`.
-- Blank is permitted; one pre-existing Personal row already has one.
--
-- ── COLUMN CHOICE (verified against live schema, not assumed) ──
-- Only user_id, type, name, email are set. Every other column has a
-- default or is nullable — confirmed 2026-07-18: id DEFAULT
-- gen_random_uuid(), type DEFAULT 'artist', claim_status DEFAULT
-- 'claimed', is_live DEFAULT true, all flags DEFAULT false, and no
-- other NOT NULL column lacks a default. The resulting rows match
-- the 7 Personal profiles already present.
--
-- Idempotent: NOT EXISTS makes a re-run a no-op.
-- ============================================================

INSERT INTO public.profiles (user_id, type, name, email)
SELECT
  u.id,
  'punter',
  COALESCE(
    NULLIF(btrim(u.raw_user_meta_data ->> 'name'), ''),  -- account display name
    NULLIF(split_part(u.email, '@', 1), ''),             -- else email username
    ''                                                    -- else blank
  ),
  u.email
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.user_id = u.id AND p.type = 'punter'
);

-- ============================================================
-- VERIFY (expected after this file alone: 18 │ 18 │ 0 │ 0)
-- ============================================================
--   SELECT count(*) AS total_accounts,
--          count(*) FILTER (WHERE p.n = 1)                 AS exactly_one,
--          count(*) FILTER (WHERE p.n = 0 OR p.n IS NULL)  AS zero,
--          count(*) FILTER (WHERE p.n > 1)                 AS multiple
--   FROM auth.users u
--   LEFT JOIN (SELECT user_id, count(*) n FROM public.profiles
--              WHERE type='punter' GROUP BY user_id) p ON p.user_id = u.id;
--
-- This repairs the existing 11. It does NOT stop the gap reopening
-- on the next signup — that is M5.5b, and M6's NOT NULL depends on it.
-- ============================================================
