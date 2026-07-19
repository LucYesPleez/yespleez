-- ============================================================
-- M14a — events.owner_profile_id  (SCHEMA — additive only)
-- ============================================================
--
-- Run ALONE. Phase 14.1 milestone 1 — the first commit turning
-- Identity v1.3 from specification into schema.
--
-- Identity v1.3 `O-R4`: an event's owner is a PROFILE, never an
-- account. `owner_profile_id` is the authority column and the sole
-- input to authorization. Three columns, three concepts:
--
--   owner_profile_id  AUTHORITY   who is accountable and may manage it
--   venue_profile_id  LOCATION    where it happens
--   host_id           AUTHORSHIP  which human created the row
--
-- `O-R6`: every event has exactly one accountable owner. This
-- migration does NOT enforce that — the column is nullable here
-- because existing rows have no owner until M14c backfills them.
-- Enforcement arrives with the backfill, not before it: a NOT NULL
-- on day one would reject every write against 24 unowned rows.
--
-- ── WHAT THIS DOES NOT DO ──
--
-- Nothing reads this column. No policy consults it, no application
-- code writes it, no behaviour changes. It is safe against the
-- running app in exactly the way M6b was.
--
--   * No policy change. Event authority still resolves
--     `host_id = auth.uid()`. Moving it to `can_act_as` is v1.3
--     migration phase 3, which rides with R3.2 and is deferred
--     pending an observed client write carrying `from_profile_id`.
--   * No backfill. That is M14c, and it runs its dry-run first.
--   * No NOT NULL. See above.
--   * `host_id` is untouched and stays nullable (v1.3 §O4).
--
-- ── FK BEHAVIOUR: NO ACTION, DELIBERATELY ──
--
-- A profile cannot be deleted while events attribute themselves to
-- it. The alternative, ON DELETE SET NULL, would let the profile go
-- and silently erase who owned the event — destroying attribution to
-- make a delete convenient, in the milestone whose entire purpose is
-- attribution. It would also produce an ownerless event, which
-- `O-R6` forbids outright.
--
-- Cost, accepted knowingly: deleting a profile that owns events now
-- fails with an FK error until those events are handled.
--
-- ── ⚠ PLATFORM-OWNED FIELD — READ THIS BEFORE WRITING AN IMPORTER ──
--
-- `owner_profile_id` and `is_public` are **platform-owned**. They are
-- set by the platform's own workflows — event creation, the M14c
-- backfill, and custodial publication (Phase 13 Q5 `P-C1`) — and they
-- are NEVER derived from an imported source.
--
-- Studio's SQL exporter upserts on `external_ref` and updates every
-- other column on conflict. **Both of these columns must be excluded
-- from that DO UPDATE set.** Otherwise re-running an import silently
-- reverts a custodially published event to unpublished, and reassigns
-- or clears an owner that a human decided — and nobody finds out
-- until a venue asks where their listing went.
--
-- The existing exporter already excludes `external_ref` from its
-- update set for the same class of reason. This extends that rule
-- rather than inventing one. Recorded as I6 in
-- docs/phase-14-studio-implementation-plan-2026-07.md and confirmed
-- by the owner as a blocker on the exporter milestone (M14f).
--
-- Import-owned fields describe the event as the source stated it.
-- Platform-owned fields describe decisions the platform made about
-- it. An importer may write the first and must never write the
-- second.
-- ============================================================


ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.events.owner_profile_id IS
  'Identity v1.3 O-R4 — the profile that owns this event and the sole input to authorization. Any profile type. PLATFORM-OWNED: never written by an importer (see I6). Nullable only until the M14c backfill; O-R6 requires exactly one owner per event.';

COMMENT ON COLUMN public.events.venue_profile_id IS
  'Identity v1.3 O-R4 — LOCATION, not ownership. Where the event happens. Nullable: warehouses, parks and house shows have no venue profile.';

COMMENT ON COLUMN public.events.host_id IS
  'Identity v1.3 O-R4 — AUTHORSHIP. The human who created this row. Never consulted for permission; authority is owner_profile_id via can_act_as(). Nullable — imported events have no human creator.';


-- Backs the policy predicate phase 3 will add, and the
-- "events owned by this profile" read that claiming makes meaningful.
CREATE INDEX IF NOT EXISTS idx_events_owner_profile
  ON public.events(owner_profile_id);


-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1. Column exists, nullable, correct type:
--
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'events'
--        AND column_name IN ('owner_profile_id','venue_profile_id','host_id')
--      ORDER BY column_name;
--
--    Expect owner_profile_id | uuid | YES | null
--
-- 2. FK points at profiles(id) with NO ACTION:
--
--      SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--      WHERE conrelid = 'public.events'::regclass AND contype = 'f';
--
--    The owner_profile_id row should read
--    FOREIGN KEY (owner_profile_id) REFERENCES profiles(id)
--    with no ON DELETE clause.
--
-- 3. Index exists:
--
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'events' AND indexname = 'idx_events_owner_profile';
--
-- 4. Nothing populated yet — every existing row is NULL. Expect 24 | 0:
--
--      SELECT count(*) AS total,
--             count(owner_profile_id) AS owned
--      FROM public.events;
--
--    A non-zero `owned` would mean something is already writing this
--    column, which nothing should be until M14b.
-- ============================================================
