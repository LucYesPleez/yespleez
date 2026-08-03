-- ═══════════════════════════════════════════════════════════════════
-- P4 · OPPORTUNITY REQUIREMENTS
-- Design: docs/professional-profile-requirements-engine-design-2026-08.md §5.1
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════
--
-- ── WHY A COLUMN ON `events` AND NOT A REQUIREMENTS TABLE ──
--
-- Requirements belong to an OPPORTUNITY. Today an opportunity is an event
-- application, so v1 stores them on events — §5.1 calls this an implementation
-- detail, not part of the domain model. Every interface says "opportunity";
-- only this storage location says "event". A second opportunity type brings
-- its own storage and the engine is untouched.
--
-- No `requirement_sets` table, no join table, no per-key rows. Templates are
-- client-side presets. `text[]` is queryable with GIN if "which opportunities
-- am I ready for?" is ever asked, and it costs one column instead of three
-- tables plus their RLS.
--
-- ── NO CHECK CONSTRAINT ON THE VALUES, DELIBERATELY ──
--
-- The obvious move is CHECK (required_items <@ ARRAY['BIO', ...]). We have
-- already paid for that pattern twice: `follows_entity_type_check` omitted
-- 'event' and every event heart failed with 23514 from launch until
-- 2026-07-31, misattributed to a Supabase outage for weeks; PA1 declined the
-- same constraint on `asset_type` for the same reason.
--
-- The engine is the validator and it already handles the case: an unrecognised
-- key evaluates to `state: 'unknown', blocking: false` — surfaced to both
-- sides, and unable to trap an applicant behind something they cannot fix. A
-- database constraint would instead reject the host's SAVE, losing the whole
-- edit over one stale key. Deleting a key from the registry must degrade a
-- requirement, never break an event.
--
-- ── NULL vs '{}' ──
--
-- Both mean "no declared requirements". The column is nullable with no
-- default so every event that exists today is backward compatible by
-- construction — no backfill, no rewrite of 24 rows. Readers must treat NULL
-- and empty identically; `evaluate()` does (`(keys || [])`).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS required_items text[];

COMMENT ON COLUMN public.events.required_items IS
  'P4 (Requirements Engine, 2026-08) — requirement keys the host ticked, from '
  'REQUESTABLE_KEYS in v2/src/lib/requirements.js. NULL and ''{}'' both mean no '
  'declared requirements. Deliberately unconstrained: the engine treats an '
  'unrecognised key as non-blocking and surfaces it, whereas a CHECK would '
  'reject the host''s entire save. UI word is "Requirements"; this column name '
  'is internal (design §5.3).';

-- No RLS change. `events` policies already govern who may read and update a
-- row, and requirements are an ordinary field of the event — a host who can
-- edit the event can edit its requirements, which is exactly the intent.

-- ── VERIFY ──
-- Expect one row: required_items | ARRAY | YES
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'events'
--      AND column_name  = 'required_items';
