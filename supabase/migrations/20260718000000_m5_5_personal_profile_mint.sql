-- ============================================================
-- M5.5 — PERSONAL PROFILE: BACKFILL + PERMANENT MINT INVARIANT
-- ============================================================
--
-- Identity v1.1 §A9 / §A10. Prerequisite for M6: `from_profile_id`
-- cannot become NOT NULL until every account owns exactly one
-- Personal (`type='punter'`) profile.
--
-- ── CENSUS (run 2026-07-18, read-only, before writing this) ──
--
--   SELECT count(*) AS total_accounts,
--          count(*) FILTER (WHERE p.n = 1)                 AS exactly_one,
--          count(*) FILTER (WHERE p.n = 0 OR p.n IS NULL)  AS zero,
--          count(*) FILTER (WHERE p.n > 1)                 AS multiple
--   FROM auth.users u
--   LEFT JOIN (SELECT user_id, count(*) n FROM public.profiles
--              WHERE type='punter' GROUP BY user_id) p ON p.user_id = u.id;
--
--   total_accounts │ exactly_one │ zero │ multiple
--   ───────────────┼─────────────┼──────┼──────────
--               18 │           7 │   11 │        0
--
-- All 11 accounts lacking a Personal profile are artist-only.
-- Zero duplicates. Zero accounts own no profile at all.
--
-- ── WHAT THE CENSUS CHANGED ──
--
-- v1.1 §A10 sized M5.5 as "likely a small backfill rather than a
-- mint". It is the mint. Verified 2026-07-18: **no code path
-- anywhere creates a Personal profile** — not in `v2/src`, not in
-- any prior migration, no trigger. The 7 that exist predate this
-- repository's app code.
--
-- A backfill alone would therefore fix today's 11 and reopen the
-- gap on the next signup, and M6's NOT NULL would break the first
-- account created after it. Hence the trigger below: the invariant
-- has to be enforced going forward, not just repaired once.
--
-- ── OWNER DECISIONS (18 Jul 2026) ──
--
--  1. Every new account automatically receives exactly one
--     immutable Personal profile at creation, enforced server-side
--     as a permanent database invariant.
--  2. Historical accounts are backfilled where one does not exist.
--  3. Display name: account display name if available, else a
--     sensible default (email username), else blank.
--  4. The Personal profile is the default participant for personal
--     conversations and direct messaging (consumed at M8).
--
-- Signup sets `options.data.name` (v2/src/screens/AuthScreen.jsx:32),
-- so the account display name is `raw_user_meta_data->>'name'`.
--
-- ── WHAT THIS MIGRATION DOES *NOT* DO ──
--
-- No UNIQUE index is added. `profiles` already carries
-- UNIQUE(user_id, type) — recorded in the M1 migration header
-- (20260711000003) — which already makes a second Personal profile
-- per account impossible. The census finding of zero duplicates is
-- that constraint working, not luck. **Verify before relying on it:**
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.profiles'::regclass AND contype = 'u';
--
-- If that returns no UNIQUE(user_id, type), STOP — the "exactly one"
-- half of this invariant is unenforced and needs its own migration.
--
-- No `can_act_as()`, no identity pair, no RLS changes. Those are M6.
-- ============================================================


-- ── 1 · Backfill ───────────────────────────────────────────
-- Idempotent: NOT EXISTS makes re-running a no-op. Only user_id,
-- type, name and email are set; every other column takes its
-- existing default, matching the 7 Personal rows already present
-- (is_live true, claim_status 'claimed', all flags false).

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


-- ── 2 · The mint ───────────────────────────────────────────
-- SECURITY DEFINER so the trigger can write `profiles` regardless
-- of the inserting role.
--
-- Deliberately NOT wrapped in an exception handler. A swallowed
-- error would let an account be created without a Personal profile,
-- which is the precise defect this migration exists to remove — and
-- it would fail silently, so nobody would find out until M6's NOT
-- NULL broke. Failing loudly at signup is the lesser harm.

CREATE OR REPLACE FUNCTION public.ensure_personal_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, type, name, email)
  VALUES (
    NEW.id,
    'punter',
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(split_part(NEW.email, '@', 1), ''),
      ''
    ),
    NEW.email
  )
  ON CONFLICT (user_id, type) DO NOTHING;  -- idempotent under retry

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_personal_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_personal_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_personal_profile();


-- ── 3 · Inalienability (v1.1 §A9) ──────────────────────────
-- "Personal is system-generated, inalienable — it can never be
-- claimed, transferred, or owned by anyone else."
--
-- Guards the two ways a Personal profile could stop being one:
-- deleting it, or mutating its type.
--
-- The DELETE guard deliberately allows the account-deletion path.
-- `profiles.user_id` cascades from `auth.users`, so an unconditional
-- guard would make account deletion fail outright — trading a data
-- integrity fix for a right-to-erasure defect. The guard therefore
-- fires only while the owning account still exists.

CREATE OR REPLACE FUNCTION public.protect_personal_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'punter'
       AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
      RAISE EXCEPTION
        'Personal profile is inalienable (identity v1.1 §A9) and cannot be deleted while its account exists (profile %)', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.type = 'punter' AND NEW.type IS DISTINCT FROM 'punter' THEN
    RAISE EXCEPTION
      'Personal profile type is immutable (identity v1.1 §A9): profile % cannot become %', OLD.id, NEW.type;
  END IF;

  IF NEW.type = 'punter' AND OLD.type IS DISTINCT FROM 'punter' THEN
    RAISE EXCEPTION
      'A profile cannot be converted into a Personal profile (identity v1.1 §A9): profile %', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_personal_profile_trg ON public.profiles;

CREATE TRIGGER protect_personal_profile_trg
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_personal_profile();


-- ============================================================
-- POST-RUN VERIFICATION — expected: 18 │ 18 │ 0 │ 0
-- ============================================================
--
--   SELECT count(*) AS total_accounts,
--          count(*) FILTER (WHERE p.n = 1)                 AS exactly_one,
--          count(*) FILTER (WHERE p.n = 0 OR p.n IS NULL)  AS zero,
--          count(*) FILTER (WHERE p.n > 1)                 AS multiple
--   FROM auth.users u
--   LEFT JOIN (SELECT user_id, count(*) n FROM public.profiles
--              WHERE type='punter' GROUP BY user_id) p ON p.user_id = u.id;
--
-- Blank display names are expected and permitted (one pre-existing
-- Personal row already has one). Count them — they are the prompt-
-- on-next-login backlog, not a failure:
--
--   SELECT count(*) FROM public.profiles
--   WHERE type = 'punter' AND btrim(coalesce(name,'')) = '';
-- ============================================================
