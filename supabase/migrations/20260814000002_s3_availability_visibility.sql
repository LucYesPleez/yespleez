-- S3 · AVAILABILITY GETS A VISIBILITY STATE, ENFORCED WHERE IT COUNTS.
--
-- ⭐ Ratified 2026-08-14: availability is optional public information, never
-- the gate for contact. A profile may keep a complete calendar while choosing
-- not to publish it. That choice needs a real field — an opt-out cannot be
-- derived from an empty table, because empty already means "not configured".
--
-- ONE boolean gives all three public states:
--   private = false, dates exist  → PUBLISHED  (calendar shows)
--   private = true                → PRIVATE    ("doesn't publish dates — enquire")
--   private = false, no dates     → NOT SET    (never rendered as booked out)
--
-- ⚠ ENFORCED IN RLS, NOT IN THE UI. A UI privacy switch is not a boundary
-- (SEC-1/SEC-2): if withheld dates still travel to the client, the switch is
-- decoration. The SELECT policies below are the boundary — a withheld
-- calendar's rows do not leave the database for anyone but their owner.
--
-- ⚠ artist_availability's public-read policy is DROPPED AND REPLACED, not
-- added beside. Permissive policies OR together and the loosest wins — leaving
-- "Public read availability (true)" in place would make the new policy
-- decorative, the exact SEC-1 shape.
--
-- ⚠ venue_availability GAINS its first public SELECT policy. Probed live
-- 2026-08-14: anon reads return 0 rows — the table has only owner-manage
-- policies, so every venue's published calendar has been invisible to every
-- visitor. CHECK AVAILABILITY on a venue profile has been showing an empty
-- calendar to everyone but the owner. This fixes that defect and lands the
-- visibility rule in the same policy.
--
-- ⚠ NOT NULL DEFAULT false: every existing profile keeps today's visibility
-- (artist calendars public, and venue calendars BECOME public, which is what
-- ProfileScreen always believed they were).
--
-- ⛔ CREATE POLICY has no IF NOT EXISTS; DROP IF EXISTS first, re-runnable.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS availability_private boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.availability_private IS
  'S3 2026-08-14: true = the profile keeps its availability calendar but does '
  'not publish it. Enforced by the availability SELECT policies, not by the '
  'UI. false + rows = published; false + no rows = not configured. Neither '
  'may ever render as "booked out".';

-- ── artist_availability: replace the unconditional public read ──────────

DROP POLICY IF EXISTS "Public read availability" ON public.artist_availability;
DROP POLICY IF EXISTS "Availability readable unless withheld" ON public.artist_availability;

CREATE POLICY "Availability readable unless withheld"
  ON public.artist_availability FOR SELECT
  USING (
    auth.uid() = user_id
    OR (profile_id IS NOT NULL AND public.can_act_as(profile_id))
    -- Legacy rows with no profile_id predate profile-keying and belong to no
    -- profile that could have opted out; they stay readable, as they were.
    OR profile_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = artist_availability.profile_id
        AND p.availability_private = false)
  );

COMMENT ON POLICY "Availability readable unless withheld"
  ON public.artist_availability IS
  'S3 2026-08-14: replaces the unconditional public read. Owner always; '
  'everyone else only while the profile has not set availability_private.';

-- ── venue_availability: its first public SELECT policy ──────────────────

DROP POLICY IF EXISTS "Venue availability readable unless withheld" ON public.venue_availability;

CREATE POLICY "Venue availability readable unless withheld"
  ON public.venue_availability FOR SELECT
  USING (
    auth.uid() = user_id
    OR (profile_id IS NOT NULL AND public.can_act_as(profile_id))
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_availability.profile_id
        AND p.availability_private = false)
  );

COMMENT ON POLICY "Venue availability readable unless withheld"
  ON public.venue_availability IS
  'S3 2026-08-14: the table''s first public SELECT leg — before this, venue '
  'calendars were readable by nobody but their owner (probed live, anon = 0 '
  'rows). Public while the profile has not set availability_private.';
