-- ═══════════════════════════════════════════════════════════════════
-- P5 · APPLICATION REQUIREMENTS SNAPSHOT
-- Design: docs/professional-profile-requirements-engine-design-2026-08.md §12 P5
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires P4 (20260803000000) — events.required_items.
-- ═══════════════════════════════════════════════════════════════════
--
-- ── WHAT THIS STORES, AND WHAT IT DELIBERATELY DOES NOT ──
--
-- A VERDICT, not a copy of a profile.
--
-- Everywhere else in this system the profile is referenced and never copied —
-- enquiries, applications, messaging, events, lineups and follows all hold
-- `*_profile_id` and nothing else, and the two places that did copy
-- (`lineup_members.artist_name`, the enquiry note) are logged as defects. This
-- column is not a third one.
--
-- Profile completion stays LIVE, recomputed on every read, because "how
-- complete is this act" is a question about now. "Did they meet what I asked,
-- when they asked" is a question about a moment, and only a stored answer can
-- report it. Without this column a host opening an application six months on
-- would see 6/8 because the artist deleted a press kit last week — silently
-- rewriting what was submitted.
--
-- Shape (see snapshotEvaluation in v2/src/lib/requirements.js — the ONE place
-- this is built):
--
--   {
--     "v": 1,
--     "evaluated_at": "2026-08-03T04:12:55.019Z",
--     "required_items": ["BIO", "DEMO_MIX", "PRESS_KIT"],
--     "items": [{"key": "BIO", "state": "satisfied"}, ...],
--     "satisfied": 2,
--     "total": 3
--   }
--
-- `required_items` is copied in ON PURPOSE, even though the event has it: the
-- host may edit their checklist after an application arrives, and the verdict
-- must keep naming what was actually asked at the time.
--
-- NOT stored: labels (derivable from the registry, and a stored one would go
-- stale against it), profile field values, asset contents or paths. Live
-- values remain one join away, so "8/8 at submission · 7/8 now" is a
-- comparison of two verdicts, never a diff of two profile copies.
--
-- ── NULL IS THE NORMAL CASE ──
--
-- NULL means no snapshot: either the opportunity declared no requirements, or
-- the row predates P5. Both are ordinary and neither is a defect. Readers must
-- render nothing rather than "0/0" (Rendering Contract R3).
--
-- jsonb, not a table: it is written once, read whole, and never queried by
-- part. A `application_requirement_results` table would be three joins to
-- reconstruct one immutable object.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS requirements_snapshot jsonb;

COMMENT ON COLUMN public.applications.requirements_snapshot IS
  'P5 (Requirements Engine, 2026-08) — the evaluation VERDICT at submission: '
  '{v, evaluated_at, required_items[], items[{key,state}], satisfied, total}. '
  'Built only by snapshotEvaluation() in v2/src/lib/requirements.js. Stores the '
  'decision, never profile values — the profile stays referenced, not copied. '
  '`required_items` is duplicated here on purpose so a host editing their '
  'checklist later cannot rewrite what an applicant was asked. NULL = no '
  'requirements were declared, or the row predates P5; render nothing, not 0/0.';

-- No RLS change. `applications` policies already govern the row; the snapshot
-- is an ordinary field of it and is visible to exactly whoever the row is.

-- ── VERIFY ──
-- Expect one row: requirements_snapshot | jsonb | YES
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'applications'
--      AND column_name  = 'requirements_snapshot';
