-- ═══════════════════════════════════════════════════════════════════
-- PERFORMER AVAILABILITY BECOMES PROFILE-KEYED
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════
--
-- ── THE BUG ──
--
-- `artist_availability` is keyed on `user_id` and serves FOUR profile types:
-- artist, band and standup all share it (ProfileScreen:254 says so out loud),
-- and HostDashboard writes to it too. One human owns several of these, so
-- every one of their profiles displayed and edited THE SAME SET OF DATES. A
-- comedian's "available 3 Oct" was their DJ act's date; a host marking
-- themselves free silently moved their DJ profile's availability.
--
-- Venue availability already carries `profile_id` (VenueDashboard writes it).
-- This brings the performer side into line — the audit's §7 asymmetry.
--
-- ── ⚠ THE BACKFILL DUPLICATES ROWS, AND THAT IS THE CORRECT READING ──
--
-- Existing rows cannot be attributed to one profile: they were entered through
-- a UI that presented them as account-wide, and they were true of every act
-- the person had. Picking one owner would be a guess (U4: do not invent an
-- answer the data does not contain), and dropping them loses real dates a
-- promoter may already have seen.
--
-- So each existing date is copied to EVERY profile of that account that shows
-- availability. That preserves exactly what every profile displayed the day
-- before this migration ran, and from here the sets diverge as they are
-- edited. Nothing is lost and nothing is invented.
--
-- Expect the row count to multiply for multi-profile accounts. That is the
-- migration working, not a fault.

-- 1 · The column.
ALTER TABLE public.artist_availability
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2 · The old key has to go BEFORE the backfill, or every duplicate collides.
--     Named defensively: this table has no migration in the repo (it was made
--     in the dashboard), so the constraint name is Postgres's default and may
--     legitimately not exist.
ALTER TABLE public.artist_availability
  DROP CONSTRAINT IF EXISTS artist_availability_user_id_available_date_key;

-- 3 · Fan each unassigned date out to every availability-showing profile the
--     account owns. Reading and writing one table in a single statement is
--     safe: the SELECT sees the pre-statement snapshot.
INSERT INTO public.artist_availability (user_id, available_date, profile_id)
SELECT a.user_id, a.available_date, p.id
  FROM public.artist_availability a
  JOIN public.profiles p
    ON p.user_id = a.user_id
   AND p.type IN ('artist', 'band', 'standup', 'host')
 WHERE a.profile_id IS NULL
ON CONFLICT DO NOTHING;

-- 4 · Retire the originals — but ONLY where the fan-out actually had somewhere
--     to go. A row whose owner has no such profile is left exactly as it is;
--     deleting it would destroy a date to tidy up a column.
DELETE FROM public.artist_availability a
 WHERE a.profile_id IS NULL
   AND EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.user_id = a.user_id
        AND p.type IN ('artist', 'band', 'standup', 'host')
   );

-- 5 · The new key. A partial index so any surviving unattributed row from
--     step 4 does not fight it.
CREATE UNIQUE INDEX IF NOT EXISTS artist_availability_profile_date_key
  ON public.artist_availability (profile_id, available_date)
  WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN public.artist_availability.profile_id IS
  'The profile these dates belong to. Availability was account-keyed, so all of '
  'one person''s performer AND host profiles shared one set of dates; the '
  'backfill copied each existing date to every such profile because it was '
  'genuinely true of all of them, and they diverge from there. `user_id` is '
  'retained for RLS and audit. Writers MUST set profile_id.';

-- RLS unchanged: the existing policies key on user_id, every write still sends
-- it, and profile_id narrows within an account rather than across accounts.

-- ── VERIFY ──
-- (a) no attributable row left behind — expect 0:
--   SELECT count(*) FROM public.artist_availability a
--    WHERE a.profile_id IS NULL
--      AND EXISTS (SELECT 1 FROM public.profiles p
--                   WHERE p.user_id = a.user_id
--                     AND p.type IN ('artist','band','standup','host'));
--
-- (b) your own dates, now split by profile — expect one group per act, each
--     holding the full set you had before:
--   SELECT p.type, p.name, count(*) AS dates
--     FROM public.artist_availability a
--     JOIN public.profiles p ON p.id = a.profile_id
--    WHERE a.user_id = (SELECT id FROM auth.users WHERE email = 'musicalelbow@hotmail.com')
--    GROUP BY p.type, p.name ORDER BY p.type;
