-- ============================================================
-- M5.5b — PERSONAL PROFILE MINT  (SCHEMA — trigger on auth.users)
-- ============================================================
--
-- Run ALONE, after M5.5a has been verified at 18 │ 18 │ 0 │ 0.
--
-- WHY THIS EXISTS: verified 2026-07-18, **no code path anywhere
-- creates a Personal profile** — not in v2/src, not in any prior
-- migration, no trigger. The 7 that existed before M5.5a predate
-- this repository's app code. A backfill alone therefore repairs the
-- 11 and reopens the gap on the very next signup, and M6's
-- `from_profile_id NOT NULL` would break the first account created
-- after it. v1.1 §A10 sized M5.5 as "likely a small backfill rather
-- than a mint"; the census showed it is the mint.
--
-- ⚠ THIS FILE IS THE PRIVILEGE-SENSITIVE ONE.
-- `CREATE TRIGGER ... ON auth.users` requires ownership of that
-- table. It is the standard Supabase `handle_new_user` pattern and
-- normally succeeds in the SQL editor, but if this project refuses
-- it, **stop and report the error rather than working around it.**
-- The fallback is to mint from the app's signup path instead — a
-- real architectural trade-off (any future signup path that forgets
-- reopens the gap), and one the owner should choose deliberately,
-- having already chosen server-side enforcement.
--
-- NO EXCEPTION HANDLER, deliberately. A swallowed error would create
-- an account with no Personal profile — the exact defect this
-- removes — and do it silently, so nobody would learn of it until
-- M6's NOT NULL failed. Failing loudly at signup is the lesser harm.
--
-- ON CONFLICT relies on `profiles_user_type_unique UNIQUE (user_id,
-- type)`, verified present 2026-07-18. It is load-bearing: without
-- that constraint this statement errors rather than being idempotent.
-- ============================================================

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
  ON CONFLICT (user_id, type) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_personal_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_personal_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_personal_profile();

-- ============================================================
-- VERIFY the trigger exists:
--
--   SELECT tgname, tgrelid::regclass, tgenabled
--   FROM pg_trigger
--   WHERE tgname = 'on_auth_user_created_personal_profile';
--
-- Behavioural check (optional, and it creates a real account —
-- do it only if you have a disposable address): sign up, then
-- confirm the census still reads N │ N │ 0 │ 0 with N incremented.
-- ============================================================
