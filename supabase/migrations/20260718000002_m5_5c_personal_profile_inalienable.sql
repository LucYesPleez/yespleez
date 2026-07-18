-- ============================================================
-- M5.5c — PERSONAL PROFILE INALIENABILITY  (SCHEMA — guard trigger)
-- ============================================================
--
-- Run ALONE, after M5.5a and M5.5b.
--
-- Identity v1.1 §A9: Personal is "system-generated, inalienable — it
-- can never be claimed, transferred, or owned by anyone else."
-- Owner decision 18 Jul 2026: "exactly one immutable Personal
-- (punter) profile … enforced server-side as a permanent database
-- invariant."
--
-- M5.5a gives every account one; M5.5b keeps that true for new
-- accounts; this file stops an existing one being removed or
-- mutated out of existence. Guards the two ways that could happen:
-- deleting the row, or changing its type.
--
-- ── THE DELETE GUARD IS DELIBERATELY CONDITIONAL ──
-- `profiles.user_id` cascades from `auth.users`, so an unconditional
-- guard would make account deletion fail outright — trading a data
-- integrity fix for a right-to-erasure defect, which is a worse bug
-- than the one being fixed and would surface as an unrelated
-- production failure. The guard therefore fires only while the
-- owning account still exists.
--
-- ── OPTIONAL, AND SEPARABLE ──
-- M5.5a and M5.5b are prerequisites for M6. This file is not: it
-- enforces §A9 rather than the census invariant. If it causes any
-- friction with an existing admin or support flow, it can be dropped
-- without blocking M6:
--   DROP TRIGGER IF EXISTS protect_personal_profile_trg ON public.profiles;
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_personal_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'punter'
       AND OLD.user_id IS NOT NULL
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
-- VERIFY:
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--   WHERE tgname = 'protect_personal_profile_trg';
--
-- Ordinary profile edits are unaffected — the guard only fires on a
-- type change involving 'punter', or a delete of a Personal profile
-- whose account still exists.
-- ============================================================
