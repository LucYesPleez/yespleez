-- ============================================================
-- M1 — SCHEMA EXPANSION (additive only)
-- ============================================================
--
-- Design: docs/m1-design-review-2026-07.md (committed alongside
-- this migration).
--
-- Revision from the initial draft: no new `owner_user_id` column.
-- `profiles.user_id` is already nullable and already means exactly
-- "which account owns this row" at the row level — unlike the
-- relationship-table FKs below, this meaning never competes with a
-- second resolution during the migration, so there is nothing for a
-- second column to reconcile. RLS already checks
-- `auth.uid() = user_id` and needs no changes. The existing
-- UNIQUE(user_id, type) constraint already tolerates any number of
-- user_id = NULL rows per type (NULLs are never equal to each other
-- under standard SQL uniqueness semantics).
--
-- Verified before writing this migration: zero `profiles` rows
-- currently have user_id IS NULL (2026-07-11) — claim_status
-- DEFAULT 'claimed' is safe for 100% of existing rows, not an
-- assumption.
-- ============================================================


-- ── profiles: claim-lifecycle columns ──────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS claim_status       TEXT NOT NULL DEFAULT 'claimed',
  ADD COLUMN IF NOT EXISTS claimed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_via        TEXT,
  ADD COLUMN IF NOT EXISTS created_via        TEXT,
  ADD COLUMN IF NOT EXISTS source             JSONB,
  ADD COLUMN IF NOT EXISTS onboarding_seen_at TIMESTAMPTZ;


-- ── follows: parallel profile reference ────────────────────
-- Only meaningful for entity_type <> 'event' rows; stays NULL for
-- event-follows by design.

ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS target_profile_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_follows_target_profile_id
  ON public.follows(target_profile_id);


-- ── lineup_members: parallel profile reference ─────────────

ALTER TABLE public.lineup_members
  ADD COLUMN IF NOT EXISTS artist_profile_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_lineup_members_artist_profile_id
  ON public.lineup_members(artist_profile_id);


-- ── venue_enquiries: parallel profile references (both sides) ─

ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS venue_profile_id     UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS applicant_profile_id  UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_venue_enquiries_venue_profile_id
  ON public.venue_enquiries(venue_profile_id);
CREATE INDEX IF NOT EXISTS idx_venue_enquiries_applicant_profile_id
  ON public.venue_enquiries(applicant_profile_id);


-- ── venue_availability: parallel profile reference ─────────

ALTER TABLE public.venue_availability
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_venue_availability_profile_id
  ON public.venue_availability(profile_id);


-- ── events: public attribution, separate from host auth ────
-- host_id remains untouched — stays the auth-only column
-- (events RLS/ownership checks keep using host_id = auth.uid()).
-- venue_profile_id is the new public-attribution column.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS venue_profile_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_events_venue_profile_id
  ON public.events(venue_profile_id);


-- ============================================================
-- VERIFICATION PERFORMED (2026-07-11)
-- ============================================================
--
-- 1. Pre-flight: confirmed none of the new column names existed
--    under any name/case before applying.
--
-- 2. Post-apply schema verification (information_schema.columns):
--    every column above confirmed present with the exact specified
--    type, nullability, and default — events.venue_profile_id,
--    follows.target_profile_id, lineup_members.artist_profile_id,
--    venue_availability.profile_id, venue_enquiries.venue_profile_id
--    + applicant_profile_id, and all six new profiles columns
--    (claim_status, claimed_at, claimed_via, created_via, source,
--    onboarding_seen_at).
--
-- 3. Live application smoke test: reloaded the app, checked Artist
--    Dashboard (identical stats/following list) and a real
--    ProfileScreen (full render, no missing data). Zero visible
--    behavior change, as expected for a purely additive migration
--    nothing in the codebase reads yet. Console showed only
--    pre-existing, already-tracked warnings predating this
--    migration — nothing new introduced.
--
-- 4. Confirmed before writing this migration: zero profiles rows
--    have user_id IS NULL, so claim_status DEFAULT 'claimed' is
--    safe for 100% of existing rows (not an assumption).
--
-- Design record: docs/m1-design-review-2026-07.md
