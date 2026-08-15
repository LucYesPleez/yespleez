-- L4 · A TRANSITIONAL CHECK ON `applications.status`.
--
-- ⚠ THIS FILE IS A RECORD OF WHAT WAS RUN, ⛔ not an instruction to run it.
--
-- ⭐⭐ THE RATIFIED SEPARATION (owner, 2026-08-15):
--
--     applications    the HOST's decision about a request to play
--     lineup_members  canonical bill membership
--     performances    slot, offer and acceptance lifecycle
--
-- Canonical vocabulary:
--     pending → seen → shortlisted → accepted → declined / cancelled
--
-- ── ⛔⛔ WHY THIS CONSTRAINT IS NOT THE STRICT ONE ──────────────────────────
--
-- Production still runs `ff21dab`, which writes `tentative`, `offered`,
-- `confirmed` and `rejected`. A constraint rejecting those would fail every
-- host action from the deployed app the moment it is applied.
--
-- ⭐ The standing rule, from the 2026-08-12 handover: "a constraint that
-- accepts a kind nothing sends is a NON-EVENT; code that sends a kind the
-- constraint rejects is an OUTAGE." So the legacy spellings are admitted here
-- and removed in L5, AFTER the converged code is deployed and verified.
--
-- What this DOES buy, today: a THIRD vocabulary can no longer appear. Every
-- value below is one somebody deliberately wrote; a typo or a new invented
-- state is now rejected at the door rather than discovered months later by an
-- audit, which is exactly how the current drift happened.
--
-- ── ⚠ NULL IS DELIBERATELY STILL ALLOWED ────────────────────────────────────
-- The column is nullable with `DEFAULT 'pending'`, and a CHECK passes on NULL
-- (it evaluates to NULL, not FALSE). Production holds no NULLs, and readers
-- already treat NULL as 'pending'. ⛔ Adding NOT NULL is a separate decision
-- and must not be smuggled in alongside a vocabulary constraint.
--
-- ── VERIFIED BEFORE WRITING THIS ────────────────────────────────────────────
-- All 13 production rows hold `accepted 9 · shortlisted 1 · confirmed 1 ·
-- declined 1 · seen 1`, every one of which is admitted below, so the constraint
-- validates against existing data without a backfill.

begin;

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check check (
    status is null or status in (
      -- ── canonical (ratified 2026-08-15) ──
      'pending',        -- submitted, no decision yet. The column default
      'seen',           -- host opened it. Metadata, ⛔ NOT progress
      'shortlisted',    -- host is interested
      'accepted',       -- ⭐ the HOST said yes. ⛔ NEVER "the artist agreed"
      'declined',       -- host said no
      'cancelled',      -- applicant withdrew (⚠ no code path yet: withdrawal
                        --   is currently a DELETE, under the "artists can
                        --   withdraw application" policy)

      -- ── ⛔ LEGACY, ADMITTED ONLY UNTIL THE CONVERGED CODE IS DEPLOYED ──
      -- Removed by L5. Each is written by `ff21dab` and by nothing in the
      -- converged tree.
      'tentative',      -- → shortlisted   (pure synonym)
      'rejected',       -- → declined      (pure synonym)
      'offered',        -- → performances.status + offered_at
      'confirmed'       -- → performances.status + accepted_at
    )
  );

commit;
