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

begin;

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
      'pending', 'seen', 'shortlisted', 'accepted', 'declined', 'cancelled'
    )
  );

commit;
