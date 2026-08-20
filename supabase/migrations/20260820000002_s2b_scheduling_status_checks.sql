-- S2b · STATUS VOCABULARIES BECOME CONSTRAINTS.
--
-- ⚠⚠ THE APPLICATION-STATE-MACHINE INCIDENT, APPLIED PREVENTIVELY. Two
-- vocabularies in one unconstrained text column is exactly what left
-- PIPELINE/SHORT LIST empty on every event and made shortlist/decline silent
-- on applications.status. Both scheduling status columns are free text today;
-- these CHECKs close them before S3 adds new writers.
--
-- ⭐ THE LISTS COME FROM THE CODE'S VOCABULARY, verified against a full
-- production census on 2026-08-20:
--   lineup_members.status — 143× 'on_bill' in production; code also writes
--     'shortlisted' and 'removed' (removal is a status, never a delete).
--   performances.status — 1× 'accepted' in production; code writes 'draft',
--     'offered', 'accepted', 'declined' (display-side 'confirmed' is a
--     TRANSLATED status in eventSlots.js and never stored — ⛔ do not add it).
--
-- ⚠ A plain ADD CONSTRAINT validates existing rows on apply — that scan IS the
-- final census. If it fails, a value exists that the 2026-08-20 census missed:
-- STOP and investigate; ⛔ do not widen the list to make the error go away.
--
-- Both columns are NOT NULL since the baseline, so no NULL arm is needed.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname  = 'lineup_members_status_check'
      and conrelid = 'public.lineup_members'::regclass
  ) then
    alter table public.lineup_members
      add constraint lineup_members_status_check
      check (status in ('on_bill','shortlisted','removed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname  = 'performances_status_check'
      and conrelid = 'public.performances'::regclass
  ) then
    alter table public.performances
      add constraint performances_status_check
      check (status in ('draft','offered','accepted','declined'));
  end if;
end $$;
