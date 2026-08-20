-- FE2 · MANUAL ALLOCATIONS, IN THE SAME LEDGER THE ALGORITHM READS
-- Design: docs/featured-event-engine-2026-08-21.md
-- Requires: 20260821000000_fe1_featured_allocation
--
-- ⭐⭐ THE POINT OF THIS MIGRATION IS THAT THERE IS NO SECOND TABLE.
--
-- A Studio administrator featuring an event for 7 days must cost that event
-- seven days of exposure in the eyes of the ranking engine. The only way that
-- is true by construction is for a manual allocation to write the SAME rows
-- the automatic selector writes. A separate manual-feature table the engine
-- cannot see would let an admin hand out unlimited exposure that fairness
-- never accounts for, which is the one thing the featured slot exists to
-- prevent.
--
-- ── ⭐ THE UNIT IS THE DAY, SO N DAYS IS N ROWS ──────────────────────
--
-- fe1's ledger is one row per day. A 7-day manual allocation therefore inserts
-- SEVEN rows sharing an `allocation_id`, and `summariseExposure()` in
-- lib/featuredEvent.js counts seven days without a single line of engine
-- change. ⛔ Do NOT "simplify" this into one row with a date range: the engine
-- counts rows-per-day, and a range would read as ONE day of exposure however
-- long it actually ran.
--
-- ── ⭐⭐ THE UNIQUE INDEX BECOMES PARTIAL, AND THAT IS THE WHOLE TRICK ─
--
-- fe1 had `unique (featured_date)`. That says "one featured event per day",
-- which is right, but it also makes a superseded row and its replacement
-- unable to coexist — so honouring it would have meant DELETING history to
-- change the featured event, the exact thing this system must never do.
--
-- `unique (featured_date) where status = 'active'` says the true rule: one
-- ACTIVE featured event per day, with any number of removed rows kept beside
-- it as the record of what was scheduled before. Nothing is ever deleted.
--
-- ── ⚠ STATUS IS 'active' | 'removed', AND NOTHING ELSE ──────────────
--
-- There is no 'completed'. A day that has elapsed is completed BY THE CALENDAR,
-- and deriving that costs nothing while storing it would need a job to flip it
-- — and this project has no pg_cron, no worker and no scheduled Edge Function.
-- A stored status with nothing to maintain it is a state that can lie.
--
-- ⛔⛔ EARLY REMOVAL NEVER DELETES A ROW. Cancelling marks the not-yet-elapsed
-- days 'removed' and leaves every elapsed day exactly as it was, so the ledger
-- records ACTUAL exposure rather than the duration originally requested.
-- `requested_days` keeps the original intent beside it, because after a
-- cancellation that number is not recoverable from the surviving rows.

alter table public.featured_allocation
  add column if not exists allocation_id  uuid,
  add column if not exists starts_at      timestamptz,
  add column if not exists requested_days smallint,
  add column if not exists status         text not null default 'active',
  add column if not exists created_by     uuid references auth.users(id) on delete set null,
  add column if not exists removed_at     timestamptz,
  add column if not exists removal_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'featured_allocation_status_check'
      and conrelid = 'public.featured_allocation'::regclass
  ) then
    alter table public.featured_allocation
      add constraint featured_allocation_status_check
      check (status in ('active', 'removed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'featured_allocation_requested_days_check'
      and conrelid = 'public.featured_allocation'::regclass
  ) then
    alter table public.featured_allocation
      add constraint featured_allocation_requested_days_check
      check (requested_days is null or requested_days between 1 and 7);
  end if;

  -- ⭐ EXTEND the vocabulary, do not replace it. 'manual' joins the three modes
  -- fe1 declared; organic/promoted/editorial keep working untouched.
  if exists (
    select 1 from pg_constraint
    where conname = 'featured_allocation_selection_type_check'
      and conrelid = 'public.featured_allocation'::regclass
  ) then
    alter table public.featured_allocation
      drop constraint featured_allocation_selection_type_check;
  end if;
  alter table public.featured_allocation
    add constraint featured_allocation_selection_type_check
    check (selection_type in ('organic', 'promoted', 'editorial', 'manual'));
end $$;

-- One ACTIVE featured event per day; removed rows stay beside it as history.
drop index if exists public.featured_allocation_date_key;
create unique index if not exists featured_allocation_active_date_key
  on public.featured_allocation (featured_date)
  where status = 'active';

create index if not exists featured_allocation_allocation_idx
  on public.featured_allocation (allocation_id);

comment on column public.featured_allocation.allocation_id is
  'Groups the day-rows of ONE allocation. A 7-day manual allocation is 7 rows sharing this id.';
comment on column public.featured_allocation.status is
  'active | removed. There is no ''completed'': an elapsed day is completed by the calendar, and a stored status with no job to maintain it would lie.';
comment on column public.featured_allocation.requested_days is
  'What the administrator originally asked for (1-7). Kept because after an early removal it cannot be recovered from the surviving rows.';
comment on column public.featured_allocation.removal_reason is
  'Why an allocation ended early. Rows are never deleted on removal.';

-- ── THE WRITE PATH ──────────────────────────────────────────────────
--
-- ⛔⛔ NO INSERT/UPDATE POLICY IS ADDED, AND NO TABLE GRANT WIDENS.
-- fe1 gave anon and authenticated SELECT only, and that stands. Featuring is
-- done through these two SECURITY DEFINER functions, EXECUTE revoked from
-- every role the app runs as. "An ordinary user cannot award themselves the
-- featured slot" stays enforced by the database rather than promised by a
-- client, the same shape c1_profile_claim_requests uses for approval.
--
-- ⚠ Atomic ON PURPOSE. Claiming days for one event releases them from another
-- in the same breath; as two round trips from Studio there would be a window
-- where the slot is held by nobody, or by two events at once.

create or replace function public.feature_event_manually(
  p_event_id   uuid,
  p_days       integer default 3,
  p_created_by uuid    default null,
  p_start_date date    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation_id uuid := gen_random_uuid();
  v_start  date;
  v_name   text;
  v_status text;
  v_public boolean;
  v_day    date;
  i        integer;
begin
  if p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'FEATURED_DAYS_OUT_OF_RANGE: days must be between 1 and 7, got %', p_days
      using errcode = '22023';
  end if;

  select name, status, is_public into v_name, v_status, v_public
  from public.events where id = p_event_id;

  if v_name is null then
    raise exception 'FEATURED_EVENT_NOT_FOUND: no event %', p_event_id using errcode = 'P0002';
  end if;

  -- ⚠ The same standard the engine applies. An administrator may override the
  -- RANKING; they may not push a draft or a private event into the most
  -- prominent slot in the app by featuring it.
  if v_status is distinct from 'live' or v_public is false then
    raise exception 'FEATURED_EVENT_NOT_PUBLIC: event % is not live and public', p_event_id
      using errcode = '22023';
  end if;

  v_start := coalesce(p_start_date, (now() at time zone 'Australia/Sydney')::date);

  for i in 0 .. (p_days - 1) loop
    v_day := v_start + i;

    -- ⭐ CONFLICT HANDLING. Whoever holds this day stands down. Only the day
    -- being claimed is released, so the outgoing allocation keeps every other
    -- day it legitimately ran, and its row survives as 'removed' rather than
    -- being deleted. The partial unique index lets both rows coexist.
    update public.featured_allocation
       set status         = 'removed',
           removed_at     = now(),
           removal_reason = 'superseded by a manual allocation'
     where featured_date = v_day
       and status = 'active';

    insert into public.featured_allocation (
      featured_date, event_id, event_name, selection_type,
      allocation_id, starts_at, requested_days, status, provenance, created_by
    ) values (
      v_day, p_event_id, v_name, 'manual',
      v_allocation_id, now(), p_days, 'active', 'studio', p_created_by
    );
  end loop;

  return v_allocation_id;
end $$;

create or replace function public.remove_featured_allocation(
  p_allocation_id uuid,
  p_reason        text default 'removed by administrator'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'Australia/Sydney')::date;
  v_affected integer;
begin
  -- ⭐⭐ ONLY THE DAYS THAT HAVE NOT HAPPENED. Today counts as not-yet-elapsed
  -- so removal takes effect immediately, but every PAST day of this allocation
  -- is left exactly as it was: the event really did receive that exposure, and
  -- fairness must go on charging it for them.
  update public.featured_allocation
     set status         = 'removed',
         removed_at     = now(),
         removal_reason = p_reason
   where allocation_id = p_allocation_id
     and status = 'active'
     and featured_date >= v_today;

  get diagnostics v_affected = row_count;
  return v_affected;
end $$;

revoke execute on function public.feature_event_manually(uuid, integer, uuid, date)
  from public, anon, authenticated;
revoke execute on function public.remove_featured_allocation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.feature_event_manually(uuid, integer, uuid, date)
  to service_role;
grant execute on function public.remove_featured_allocation(uuid, text)
  to service_role;

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- a 3-day allocation is three rows, one per day:
-- select public.feature_event_manually('<event-uuid>'::uuid, 3);
-- select featured_date, event_name, selection_type, status, requested_days
--   from public.featured_allocation order by featured_date;   -- expect 3 active
--
-- -- removal keeps elapsed days and cancels the rest, deleting nothing:
-- select public.remove_featured_allocation('<allocation-uuid>'::uuid, 'test');
-- select featured_date, status, removal_reason
--   from public.featured_allocation order by featured_date;
--
-- -- the range is enforced:
-- select public.feature_event_manually('<event-uuid>'::uuid, 8);   -- expect 22023
--
-- -- and the app's own roles cannot call it at all:
-- set role authenticated;
-- select public.feature_event_manually('<event-uuid>'::uuid, 3);   -- expect 42501
-- reset role;
