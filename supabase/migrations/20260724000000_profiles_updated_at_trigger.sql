-- ============================================================
-- PROFILES.UPDATED_AT — auto-set on every UPDATE, at the database layer
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- No client write path has ever set `updated_at` on save — ProfileEditScreen
-- and ArtistProfileScreen (and every sibling profile-type screen: venue,
-- host, band, standup) each upsert a payload built purely from form fields.
-- Discover's "Recently Added / Active" section sorts by `updated_at DESC`,
-- so a profile that was genuinely just edited doesn't move to the front
-- unless something bumps that column.
--
-- A trigger, not a field added to each screen's payload — there are already
-- multiple call sites making this same omission, and any future profile-type
-- screen would repeat it. One trigger fixes all of them, present and future,
-- and works whether the write is a plain UPDATE or an upsert's
-- ON CONFLICT DO UPDATE branch (Supabase's .upsert() is exactly that).
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ "The trigger exists" is not the guarantee — "the trigger fires and
-- actually advances the timestamp" is. V2 mutates a real row and checks the
-- column moved, rather than trusting that a CREATE TRIGGER succeeding means
-- it does what it says.
-- ============================================================

-- V1 · the trigger exists on public.profiles.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass
    AND tgname = 'trg_profiles_updated_at'
    AND NOT tgisinternal;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: trg_profiles_updated_at not found on public.profiles';
  END IF;
  RAISE NOTICE 'V1 PASSED: trigger exists on public.profiles';
END $$;

-- V2 · it actually fires and advances updated_at on a real row.
DO $$
DECLARE
  test_id  uuid;
  before_ts timestamptz;
  after_ts  timestamptz;
BEGIN
  SELECT id, updated_at INTO test_id, before_ts FROM public.profiles LIMIT 1;
  IF test_id IS NULL THEN
    RAISE NOTICE 'V2 SKIPPED: no rows in public.profiles to test against';
    RETURN;
  END IF;

  PERFORM pg_sleep(1); -- guarantee now() differs from the stored value
  UPDATE public.profiles SET name = name WHERE id = test_id; -- no-op value, real UPDATE
  SELECT updated_at INTO after_ts FROM public.profiles WHERE id = test_id;

  IF after_ts <= before_ts THEN
    RAISE EXCEPTION 'V2 FAILED: updated_at did not advance (before=%, after=%)', before_ts, after_ts;
  END IF;
  RAISE NOTICE 'V2 PASSED: updated_at advanced from % to %', before_ts, after_ts;
END $$;
