-- L5 · TIGHTEN `applications.status` TO THE CANONICAL VOCABULARY.
--
-- ⚠ THIS FILE IS A RECORD OF WHAT WAS RUN, ⛔ not an instruction to run it.
--
-- ⛔⛔ DO NOT RUN THIS UNTIL ALL THREE ARE TRUE:
--
--   1. The converged code is DEPLOYED to production. Until then `ff21dab`
--      writes `tentative`/`offered`/`confirmed`/`rejected` and this constraint
--      turns every host action into a 23514.
--
--   2. The verification query below returns ZERO legacy rows. Deploying is not
--      the same as proving: run it after a real host action.
--
--   3. The single `confirmed` row has been RESOLVED BY A HUMAN.
--      ⛔ NOT by this migration. See below.
--
-- ── ⛔⛔ THE ONE `confirmed` ROW IS NOT BACKFILLED HERE ──────────────────────
--
-- Application `f8e03ca7` (Solstice Soirée). Traced 2026-08-15:
--
--   · `status: 'confirmed'` has exactly ONE writer in the whole git history —
--     `acceptSlotOffer`, added 2026-07-10. The June-era code live when this row
--     was created could only write `pending` / `accepted` / `rejected`. So it
--     means THE ARTIST ACCEPTED A SLOT, ⛔ not a host decision.
--   · Its only performance is `draft` with `accepted_at` NULL. ZERO accepted
--     performances exist on that event — the corroborating record was destroyed
--     by the July migrations.
--   · ⚠⚠ The applicant account IS THE HOST'S OWN ACCOUNT (it owns the
--     `YesPleez` host profile). No acceptance notice was ever addressed to them.
--     It is a self-test artefact of the one-login problem.
--
-- ⛔ `update ... set status='accepted' where status='confirmed'` would assert a
-- host decision that provably never happened. Whoever runs L5 must first decide
-- what that ONE row should say, by hand.
--
-- The other three legacy spellings hold ZERO rows today, so their backfill arms
-- are no-ops here — kept only because another environment may differ.

-- ── ⛔ NO `begin;` / `commit;` WRAPPER (2026-09-04) ─────────────────────────
--
-- ⚠⚠ NOT because the wrapper was PROVEN to have broken L4. The record shows a
-- sequence, ⛔ not a mechanism: L4 "was reported applied and was NOT —
-- `pg_constraint` held nothing and an illegal status inserted fine", and
-- re-running it unwrapped worked. No error text from the failed run was ever
-- captured, and no l4/l5 verification-evidence document exists.
--
-- It is removed for three reasons that do not depend on that diagnosis:
--
--   1. ⭐ THE SQL EDITOR ALREADY RUNS THE FILE AS ONE TRANSACTION (the same
--      handover says so, in the note explaining why M2 must never be re-run).
--      An explicit wrapper adds no atomicity that is not already there.
--   2. ⛔⛔ IT IS THE ONE FAILURE MODE THAT MATCHES WHAT HAPPENED. The editor
--      runs the SELECTED text when there is a selection, so a run that stops
--      before `commit;` lands nothing and shows no error — exactly L4's
--      signature. Unwrapped, a partial run leaves the statements it did reach.
--   3. ⭐ THERE IS NOTHING PARTIAL TO PROTECT. All three UPDATEs below match
--      ZERO rows (verified 2026-09-04), so the only statement that changes
--      anything is the constraint itself.
--
-- ⚠ THE TRADE, stated: run through a client that does NOT wrap (`psql` without
-- `-1`, a migration runner) and the UPDATEs could land while `add constraint`
-- fails. Harmless while they match no rows; ⛔ reconsider if that stops being
-- true in another environment.
--
-- ⭐⭐ EITHER WAY THE BINDING STEP IS THE CATALOG CHECK AT THE BOTTOM OF THIS
-- FILE. That is what caught L4, and "I ran it" is not evidence that it landed.

-- Synonyms: safe and lossless, both directions are the same concept.
update public.applications set status = 'shortlisted' where status = 'tentative';
update public.applications set status = 'declined'    where status = 'rejected';

-- ⚠ `offered` is a SLOT fact that was written onto the wrong table. The host
-- had already said yes (that is what produced the offer), so the host-decision
-- state it should have been carrying is `accepted`. The offer itself already
-- lives on `performances`.
update public.applications set status = 'accepted' where status = 'offered';

-- ⛔ NO ARM FOR 'confirmed'. See the header. If any row still holds it, this
-- migration fails at the constraint below — deliberately, and loudly.

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check check (
    status is null or status in (
      'pending', 'seen', 'shortlisted', 'accepted', 'declined', 'cancelled',
      -- ⭐⭐ `booked` IS CANONICAL, ⛔ not a legacy spelling to be tightened out
      -- (owner, 2026-09-04). A request stops being a question once the person
      -- is put on the bill, and that resolution is ITS OWN state: `accepted`
      -- means the HOST SAID YES TO AN ASK, and making it the automatic side
      -- effect of every route onto a lineup would retire the distinction this
      -- constraint exists to protect.
      --
      -- ⛔⛔ WITHOUT THIS LINE L5 REJECTS FOUR LIVE ROWS. The constraint was
      -- widened to admit `booked` on 2026-09-04 and four applications were
      -- backfilled to it (Pokki and Anti-Faffist on Solstice Soirée, Madds on
      -- Bass Heavy, Cosmatik on YesPleez pres.) — each one already on the bill
      -- while still showing as awaiting a decision. Running L5 as originally
      -- written would fail at this constraint on all four.
      'booked'
    )
  );

-- ── ⭐⭐ VERIFICATION — RUN THIS AFTER, AND READ IT ─────────────────────────
--
-- ⚠⚠ THE HEADER HAS ALWAYS SAID "the verification query below" AND THERE WAS
-- NEVER ONE IN THIS FILE. That gap is how L4 came to be reported as applied
-- while `pg_constraint` held nothing at all.
--
-- ⛔ `pg_catalog` IS NOT REACHABLE THROUGH POSTGREST — this only runs in the
-- SQL editor, so it has to be run and READ by a human. ⛔ Do not treat the
-- absence of an error as proof: check the returned definition.
--
-- Expect ONE row: `applications_status_check`, `convalidated` = true, and a
-- definition listing exactly the seven values above — `booked` INCLUDED.
-- ⛔ If `booked` is missing, this file was not the version that ran.
--
--   select conname, convalidated, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.applications'::regclass
--     and contype = 'c';
--
-- ⭐ And the data check, which DOES run through PostgREST: every row must hold
-- one of the seven. Four hold `booked` as of 2026-09-04.
--
--   select status, count(*) from public.applications group by status order by 2 desc;
