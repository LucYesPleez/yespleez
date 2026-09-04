-- PP1b · FESTIVAL_ROLE_PROFILES — the reusable Festival-native role layer.
--
-- ⚠⚠ THIS TABLE ALREADY EXISTED IN PRODUCTION. Applied by the owner on
-- 2026-09-03 without a migration file; this file was written afterwards to
-- close the Git-reproducibility gap (M1), and APPLIED on 2026-09-04.
--
-- ✅ VERIFIED AGAINST THE LIVE CATALOGUE, 2026-09-04, and corrected where the
-- first draft was wrong. Three corrections worth naming, because each was an
-- assertion standing in for an observation:
--
--   · `data` carries DEFAULT '{}'::jsonb. The draft omitted it. Production was
--     unharmed (CREATE TABLE IF NOT EXISTS was a no-op) but a fresh database
--     built from the draft would have differed from production on day one.
--   · uniqueness is the CONSTRAINT `festival_role_profiles_one_per_role`, not
--     the index name the draft invented. Running the draft left production with
--     two identical unique indexes; the cleanup migration drops the spare.
--   · there IS an organiser read policy, and the draft asserted in a comment
--     that its absence was deliberate. See it below.
--
-- ⛔⛔ ONE THING THIS DOES NOT REPRODUCE, ON PURPOSE. Production also carries
-- `festival_role_profiles_own` — FOR ALL, with `EXISTS (SELECT 1 FROM profiles
-- p WHERE p.id = profile_id AND p.user_id = auth.uid())` inline. That predicate
-- is equivalent to `can_act_as(profile_id)`, so it grants nothing extra, but it
-- is an inline ownership test, which the architecture forbids outright:
-- ownership goes through the seam and only the seam, so that the day the body
-- of `can_act_as` changes, every table changes with it. The per-command
-- policies below replace it and the cleanup migration drops it.
--
-- ── ⭐⭐ WHAT THIS TABLE IS, AND THE THREE THINGS IT IS NOT ─────────────
--
-- It answers "WHAT KIND OF <role> AM I", once, reusably. A volunteer's
-- experience, skills and qualifications are as true at next year's festival as
-- at this one, so they are answered once and carried.
--
-- ⛔ NOT A SCENE PROFILE TYPE. `volunteer` must never appear in
-- `SCENE_ROLE_TYPES`, `PROFILE_TYPES`, `SCENE_ROLE_ORDER` or the portal's
-- `profileTypes.js`. Every account already holds a punter identity; a person
-- does not create a new identity in order to volunteer. This table hangs a
-- ROLE off the identity they already have.
--
-- ⛔ NOT THE APPLICATION. Availability, departments, and a festival's own
-- questions live in `festival_applications.answers`. They change per festival,
-- and freezing one festival's answers into a permanent record is the failure
-- the whole split exists to prevent.
--
-- ⛔ NOT EVIDENCE. `data` holds CLAIMS — "I have a Blue Card" — and a claim is
-- never proof. The document is a CLEARANCE profile asset. A festival that
-- requires the document asks for the asset; ticking a box must never satisfy
-- it. There is deliberately no `verified` column here and there must never be
-- one, because a self-declared boolean beside a claim reads as a checked fact.

CREATE TABLE IF NOT EXISTS public.festival_role_profiles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ⭐ THE CANONICAL PROFILE, which for a volunteer is their `punter` row. An
  -- account holds several profiles and `profiles.user_id` is null on most rows
  -- across the table, so the profile is the stable subject and the account is
  -- not. ⚠ CASCADE: if the profile goes, its role answers have no subject left.
  profile_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- ⭐⭐ A FOREIGN KEY, NOT A LABEL. The role vocabulary is the database's own
  -- list, so a typo is rejected at write time rather than becoming a role
  -- nothing can ever read. ⛔ Adding a role is a ROW in the ceiling table, not
  -- a migration and not an enum.
  role_key   text        NOT NULL
               REFERENCES public.participation_type_ceiling(participant_type),

  -- ⛔⛔ THE APP OWNS THE SHAPE, AND ITS KEYS ARE NOT COLUMNS. Never derive a
  -- schema from what happens to be in here: a JSONB value's keys masquerade as
  -- columns and the two drift the moment a client is upgraded. The volunteer
  -- shape is defined in apps/festival/src/config/volunteerProfile.js and is the
  -- only thing that may declare it.
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.festival_role_profiles IS
  'Reusable Festival role capability profile. One row per (canonical profile, role). role_key is the participation_type_ceiling registry; Volunteer is the first. NOT a Scene profile type.';

COMMENT ON COLUMN public.festival_role_profiles.data IS
  'Role-scoped reusable fields. Shape varies by role_key and is owned by the app. Never treat its keys as columns.';

-- ⭐ ONE ROW PER (PROFILE, ROLE) — which the table comment already claims, so
-- the constraint is what makes the claim true rather than aspirational. It is
-- also the conflict target the client upserts on.
--
-- ⚠ A CONSTRAINT, NOT A BARE INDEX. Both enforce the same thing, but a
-- constraint is declared: it appears in `pg_constraint`, it can be named in an
-- `on conflict`, and it says the uniqueness is intended rather than incidental.
-- ⛔ The first draft of this file created an index called
-- `festival_role_profiles_profile_role` instead, which ran against production
-- on 2026-09-04 and left TWO identical unique indexes on this pair. The cleanup
-- drops the index and keeps the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.festival_role_profiles'::regclass
      AND conname  = 'festival_role_profiles_one_per_role'
  ) THEN
    ALTER TABLE public.festival_role_profiles
      ADD CONSTRAINT festival_role_profiles_one_per_role UNIQUE (profile_id, role_key);
  END IF;
END $$;

-- ⚠ Live alongside the unique constraint above, whose leading column is the
-- same. Kept because it IS what production has; ⛔ do not "optimise" it away
-- from a file whose job is to reproduce production.
CREATE INDEX IF NOT EXISTS festival_role_profiles_profile_idx
  ON public.festival_role_profiles (profile_id);

ALTER TABLE public.festival_role_profiles ENABLE ROW LEVEL SECURITY;

-- ⭐ The explicit reset again (M1). ⛔ anon gets nothing: a volunteer's
-- experience and qualifications are not public, and role_discovery_scope puts
-- vollys in the "never public" tier outright.
REVOKE ALL ON public.festival_role_profiles FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.festival_role_profiles TO authenticated;
-- ⚠ Restated rather than relied upon — see PP1a. If service_role's access came
-- through PUBLIC, the REVOKE above would remove it silently.
GRANT ALL ON public.festival_role_profiles TO service_role;

-- ── AUTHORITY GOES THROUGH THE SEAM, AND ONLY THE SEAM ─────────────────
--
-- ⛔ `can_act_as(profile_id)`, never an inline `auth.uid()` comparison. It is
-- the frozen sole ownership predicate (Identity v1.1 §A4), and it returns false
-- for null, for unclaimed profiles and for unauthenticated callers.
--
-- ⚠ It resolves correctly for the profile this table is actually keyed on: a
-- `punter` row is system-generated at registration with `user_id` set, so it is
-- never one of the unclaimed profiles that can_act_as cannot answer for.
--
-- ⛔ ATTRIBUTION MUST ITSELF BE AUTHORIZED. The same predicate guards the
-- INSERT's `with check`, so nobody can write a role profile in another person's
-- name. Forgeable attribution is worse than none.
DROP POLICY IF EXISTS festival_role_profiles_select_own ON public.festival_role_profiles;
CREATE POLICY festival_role_profiles_select_own ON public.festival_role_profiles
  FOR SELECT TO authenticated USING (public.can_act_as(profile_id));

DROP POLICY IF EXISTS festival_role_profiles_insert_own ON public.festival_role_profiles;
CREATE POLICY festival_role_profiles_insert_own ON public.festival_role_profiles
  FOR INSERT TO authenticated WITH CHECK (public.can_act_as(profile_id));

-- ⛔ BOTH HALVES: `using` says which rows may be touched, `with check` says what
-- may be left behind. Without the second, a person could re-point their own row
-- at somebody else's profile.
DROP POLICY IF EXISTS festival_role_profiles_update_own ON public.festival_role_profiles;
CREATE POLICY festival_role_profiles_update_own ON public.festival_role_profiles
  FOR UPDATE TO authenticated
  USING (public.can_act_as(profile_id))
  WITH CHECK (public.can_act_as(profile_id));

-- ── ⭐⭐ THE ORGANISER READ, SCOPED BY AN APPLICATION THAT EXISTS ───────
--
-- ⚠ This policy is the OWNER'S, recovered from the live database on
-- 2026-09-04. An earlier draft of this file asserted there was no organiser
-- read policy and called the absence deliberate. That was wrong, and it is
-- worth recording why the real one is better than the absence: an organiser can
-- read a role profile ONLY where that person has applied to an event the
-- organiser owns, in the matching category. Not everyone who ever filled one
-- in, and not to festivals they never approached.
--
-- ⛔⛔ IT ASSUMES `category_key = role_key`, and that assumption is now
-- LOAD-BEARING IN RLS. It holds today because volunteer is called `volunteer`
-- on both sides. The category-to-role mapping is a deferred decision, and this
-- is the first place that will break when a category stops sharing its name
-- with a participation type — an organiser would silently see nothing, which
-- reads as "the applicant filled in nothing" rather than as a mapping fault.
DROP POLICY IF EXISTS festival_role_profiles_read_applied ON public.festival_role_profiles;
CREATE POLICY festival_role_profiles_read_applied ON public.festival_role_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.festival_applications a
      WHERE a.from_profile_id = festival_role_profiles.profile_id
        AND a.category_key    = festival_role_profiles.role_key
        AND public.owns_festival_event(a.event_id)
    )
  );

DROP TRIGGER IF EXISTS festival_role_profiles_updated_at ON public.festival_role_profiles;
CREATE TRIGGER festival_role_profiles_updated_at
  BEFORE UPDATE ON public.festival_role_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
