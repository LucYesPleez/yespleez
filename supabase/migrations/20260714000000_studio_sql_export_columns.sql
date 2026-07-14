-- ============================================================
-- STUDIO SQL EXPORT — supporting columns (additive only)
-- ============================================================
--
-- Adds the columns YesPleez Studio's new SQL exporter needs so it can
-- stop guessing at field names Studio's own field-capture code was
-- (incorrectly) using — phone/accessibility/country/links were never
-- real columns; this migration gives them one. external_ref on both
-- profiles and events is a stable idempotency key: Studio stamps it
-- with its own local id at export time, so re-running the same
-- generated SQL is a no-op (ON CONFLICT (external_ref) DO NOTHING/
-- UPDATE) instead of creating duplicate rows.
--
-- NOT applied automatically. Review and run manually in the Supabase
-- SQL Editor when ready — per the new export workflow, production
-- writes stay a deliberate, human-reviewed action.
-- ============================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone         TEXT,
  ADD COLUMN IF NOT EXISTS accessibility TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS links         JSONB,
  ADD COLUMN IF NOT EXISTS external_ref  TEXT;

-- Partial unique index — external_ref is only ever set on rows Studio
-- created, so this never constrains the app's own (NULL external_ref)
-- profiles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_external_ref
  ON public.profiles(external_ref) WHERE external_ref IS NOT NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_external_ref
  ON public.events(external_ref) WHERE external_ref IS NOT NULL;

COMMIT;

-- ============================================================
-- VERIFICATION TO RUN AFTER APPLYING (information_schema.columns):
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--     AND column_name IN ('phone','accessibility','country','links','external_ref');
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'events'
--     AND column_name = 'external_ref';
--
-- Both should return the columns above with no errors.
-- ============================================================
