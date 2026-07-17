-- ============================================================
-- venue_enquiries — invite columns + schema reconciliation
-- Additive only. Part of: bring the enquiry/invite feature into
-- alignment with the live schema (2026-07-17).
-- ============================================================
--
-- WHY
-- InviteSheet.jsx has always written columns this table never had, so every
-- venue-initiated invite failed with PGRST204 before any SQL ran. See
-- docs/known-issues/venue-enquiries-schema-drift.md.
--
-- TWO KINDS OF CHANGE, both additive:
--
-- 1. NEW — event_id, proposed_time, proposed_fee, initiated_by.
--    The invite's terms. InviteSheet has collected these in its UI since it
--    shipped and had nowhere to put them.
--
-- 2. RETROSPECTIVE — headliner, slot_role, set_duration, extras, respond_by.
--    These ALREADY EXIST in production. They were added directly via the
--    dashboard with no migration (docs/live-schema-audit-2026-07.md, D5b),
--    which is why InviteSheet.jsx:83 still says they "require the
--    venue_enquiries columns — see migration". Declared here so the repo
--    stops lying about the schema. ADD COLUMN IF NOT EXISTS makes every one
--    a no-op against production; they matter only when the schema is rebuilt
--    from this directory (e.g. the Tier 2 baseline the CI spec needs).
--    Types confirmed against production 2026-07-17 by coercion probe, not
--    guessed: set_duration is integer, extras is an array, respond_by is a
--    date.
--
-- WHAT IS DELIBERATELY NOT HERE — the RLS policy is UNCHANGED.
--    Venue-initiated invites remain blocked by `Users can insert own
--    enquiries` (WITH CHECK auth.uid() = applicant_user_id) — backlog S4.
--    Fixing that needs `can_act_as()`, which lands at M6. Writing a new
--    inline `auth.uid()` policy here would add to the M4 debt that CLAUDE.md
--    explicitly forbids growing ("Do not add to that debt"), and R3 reserves
--    ownership testing to exactly one predicate.
--    This migration therefore turns a dishonest 400 (PGRST204 — "your
--    payload is nonsense") into an honest 42501 ("the policy says no").
--    That is the intended outcome, not an oversight.
--
-- WHY initiated_by AND NOT direction
--    `direction` ('incoming'/'outgoing') is viewer-relative: the same row is
--    incoming to the venue and outgoing to the artist. That is not a storable
--    fact, and the code already shows the strain — ArtistDashboard.jsx:183
--    has to comment that "direction 'outgoing' is from the SENDER's side".
--    initiated_by is absolute. The UI derives direction from it plus who is
--    looking.
--
-- BACKFILL CORRECTNESS
--    DEFAULT 'applicant' is provably right for existing rows, not a guess:
--    venue-initiated inserts have never been insertable (S4, verified live
--    2026-07-11 and again 2026-07-17), so every row that exists today was
--    applicant-initiated by construction.
--
-- NOT applied automatically. Review and run manually in the Supabase SQL
-- Editor when ready — production writes stay a deliberate, human-reviewed
-- action. The code changes in this task depend on this migration being
-- applied FIRST; shipping them against the current schema keeps the 400.
-- ============================================================

BEGIN;

-- ── NEW: the invite's terms ────────────────────────────────
ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS event_id      UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_time TIME,
  ADD COLUMN IF NOT EXISTS proposed_fee  TEXT;

-- ON DELETE SET NULL — deliberately not M1's bare `REFERENCES`. Events are
-- deleted (CreateEventScreen.jsx:388); a plain FK would make deleting an
-- event fail as soon as any enquiry referenced it. The enquiry outlives the
-- event it was about, with the link cleared.
CREATE INDEX IF NOT EXISTS idx_venue_enquiries_event_id
  ON public.venue_enquiries(event_id);

-- ── NEW: who started the conversation ──────────────────────
-- One conversation model, either side may initiate.
ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS initiated_by TEXT NOT NULL DEFAULT 'applicant';

-- ADD CONSTRAINT has no IF NOT EXISTS; this keeps the migration re-runnable.
DO $$ BEGIN
  ALTER TABLE public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_initiated_by_check
    CHECK (initiated_by IN ('venue', 'applicant'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Filtered on both dashboards (replacing the dead `.eq('direction', …)`).
CREATE INDEX IF NOT EXISTS idx_venue_enquiries_initiated_by
  ON public.venue_enquiries(initiated_by);

-- ── RETROSPECTIVE: already live, added via the dashboard ───
-- No-ops against production. Present so a rebuild matches reality.
ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS headliner    TEXT,
  ADD COLUMN IF NOT EXISTS slot_role    TEXT,
  ADD COLUMN IF NOT EXISTS set_duration INTEGER,
  ADD COLUMN IF NOT EXISTS extras       TEXT[],
  ADD COLUMN IF NOT EXISTS respond_by   DATE;

COMMIT;

-- ============================================================
-- VERIFICATION TO RUN AFTER APPLYING
-- ============================================================
--
-- 1. All nine columns present, with the expected types:
--
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'venue_enquiries'
--        AND column_name IN ('event_id','proposed_time','proposed_fee',
--                            'initiated_by','headliner','slot_role',
--                            'set_duration','extras','respond_by')
--      ORDER BY column_name;
--
--    Expect: event_id uuid | proposed_time time | proposed_fee text |
--            initiated_by text NOT NULL DEFAULT 'applicant' |
--            headliner text | slot_role text | set_duration integer |
--            extras ARRAY | respond_by date
--
-- 2. Every pre-existing row backfilled to 'applicant', none NULL:
--
--      SELECT initiated_by, count(*) FROM public.venue_enquiries
--      GROUP BY 1;
--
--    Expect: applicant = <all existing rows>, venue = 0.
--
-- 3. The constraint exists and is spelled as expected:
--
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.venue_enquiries'::regclass
--        AND conname = 'venue_enquiries_initiated_by_check';
--
-- 4. RLS is UNCHANGED — this migration must not have touched it:
--
--      SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'venue_enquiries'
--      ORDER BY policyname;
--
--    Expect the same set as before: the M0 three plus M4's four. If the
--    count changed, something else ran.
--
-- ROLLBACK (additive, so safe to leave in place instead):
--
--   ALTER TABLE public.venue_enquiries
--     DROP CONSTRAINT IF EXISTS venue_enquiries_initiated_by_check,
--     DROP COLUMN IF EXISTS event_id,
--     DROP COLUMN IF EXISTS proposed_time,
--     DROP COLUMN IF EXISTS proposed_fee,
--     DROP COLUMN IF EXISTS initiated_by;
--   -- NOTE: do NOT drop headliner/slot_role/set_duration/extras/respond_by.
--   -- They predate this migration and are live data.
-- ============================================================
