-- ══════════════════════════════════════════════════════════════════════
-- fe4 · THE OPERATOR WINS — force a slot, and change a run's length
-- ══════════════════════════════════════════════════════════════════════
--
-- fe3 made an add REFUSE when the slot it wanted was busy. That is right for a
-- queue and wrong for a person: an operator who has decided that this event
-- goes in the hero now should not have to work out which allocation is in the
-- way and cancel it first. The tool arguing back is the tool being wrong.
--
-- ⭐⭐ THE LINE, AND IT IS THE WHOLE POINT OF THIS FILE:
--
--   POLICY may always be overridden. Whether a slot is busy, how long a run
--   was meant to be, what the ranking would have chosen, the fairness penalty,
--   the cooldown, the horizon — every one of those is a judgement, and the
--   human making it has more context than the table does.
--
--   ⛔ VALIDITY may NEVER be overridden. A draft, a private event, or one that
--   has already finished stays out of the hero however forcefully it was
--   chosen. That is not the system arguing: it is the system refusing to
--   render a dead card, which is the exact defect this whole subsystem was
--   built to fix after the hero sat empty for six days in Aug 2026.
--
-- So `p_force` below skips the "slot is taken" refusal and nothing else. The
-- three validity checks stay exactly where they are.
--
-- ⚠ AN EVICTION IS RECORDED, NOT ERASED. Forcing a slot marks the outgoing
-- allocation's REMAINING days 'removed' with a reason naming what displaced
-- it. Days it already ran stay 'active' and keep costing it fairness — the
-- event really did receive that exposure. Nothing is ever deleted.

-- ── 1 · FORCE ────────────────────────────────────────────────────────

/**
 * Feature an event, optionally taking a slot that is already spoken for.
 *
 * `p_force = false` behaves exactly as fe3: a busy slot is refused.
 * `p_force = true` evicts whoever holds the chosen slot across the run.
 *
 * ⚠ With force AND no explicit slot, the LOWEST slot is taken rather than the
 * first free one. "Force" means the operator has stopped negotiating, and
 * hunting for a free slot first would make the outcome depend on state they
 * were explicitly overriding.
 */
create or replace function public.feature_event_manually(
  p_event_id   uuid,
  p_days       integer default 6,
  p_created_by uuid    default null,
  p_start_date date    default null,
  p_slot       smallint default null,
  p_force      boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation_id uuid := gen_random_uuid();
  v_start  date;
  v_end    date;
  v_name   text;
  v_status text;
  v_public boolean;
  v_slot   smallint;
  v_day    date;
  i        integer;
begin
  if p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'FEATURED_DAYS_OUT_OF_RANGE: days must be between 1 and 7, got %', p_days
      using errcode = '22023';
  end if;

  if p_slot is not null and (p_slot < 1 or p_slot > 3) then
    raise exception 'FEATURED_SLOT_OUT_OF_RANGE: slot must be 1, 2 or 3, got %', p_slot
      using errcode = '22023';
  end if;

  select name, status, is_public into v_name, v_status, v_public
  from public.events where id = p_event_id;

  -- ⛔ THE THREE VALIDITY CHECKS. `p_force` does not reach them, deliberately.
  if v_name is null then
    raise exception 'FEATURED_EVENT_NOT_FOUND: no event %', p_event_id using errcode = 'P0002';
  end if;

  if v_status is distinct from 'live' or v_public is false then
    raise exception 'FEATURED_EVENT_NOT_PUBLIC: event % is not live and public', p_event_id
      using errcode = '22023';
  end if;

  v_start := coalesce(p_start_date, (now() at time zone 'Australia/Sydney')::date);
  v_end   := v_start + (p_days - 1);

  if p_slot is not null then
    v_slot := p_slot;
  elsif p_force then
    v_slot := 1;
  else
    select s::smallint into v_slot
    from generate_series(1, 3) as s
    where not exists (
      select 1 from public.featured_allocation a
      where a.slot = s
        and a.status = 'active'
        and a.featured_date between v_start and v_end
    )
    order by s
    limit 1;
  end if;

  if v_slot is null then
    raise exception
      'FEATURED_NO_SLOT_FREE: all three slots are occupied for % to %', v_start, v_end
      using errcode = '22023';
  end if;

  if p_force then
    -- ⭐ EVICT ONLY THE OVERLAP. An allocation displaced from Thursday onward
    -- keeps Monday to Wednesday: it ran those days and must go on being
    -- charged for them. Whole-allocation cancellation here would quietly
    -- refund exposure that was really delivered.
    update public.featured_allocation
       set status         = 'removed',
           removed_at     = now(),
           removal_reason = 'displaced by ' || coalesce(v_name, 'a manual allocation')
     where slot = v_slot
       and status = 'active'
       and featured_date between v_start and v_end;
  elsif exists (
    select 1 from public.featured_allocation a
    where a.slot = v_slot
      and a.status = 'active'
      and a.featured_date between v_start and v_end
  ) then
    raise exception
      'FEATURED_SLOT_TAKEN: slot % is already allocated between % and %', v_slot, v_start, v_end
      using errcode = '22023';
  end if;

  for i in 0 .. (p_days - 1) loop
    v_day := v_start + i;
    insert into public.featured_allocation (
      featured_date, slot, event_id, event_name, selection_type,
      allocation_id, starts_at, requested_days, status, provenance, created_by
    ) values (
      v_day, v_slot, p_event_id, v_name, 'manual',
      v_allocation_id, now(), p_days, 'active', 'studio', p_created_by
    );
  end loop;

  return v_allocation_id;
end $$;

-- ── 2 · CHANGE HOW LONG A RUN SHOWS FOR ──────────────────────────────

/**
 * Set an existing allocation's length to `p_days`, counted from its own start.
 *
 * ⭐⭐ EXTENDING AND SHORTENING ARE NOT SYMMETRICAL, and pretending otherwise
 * is how exposure gets quietly refunded:
 *
 *   SHORTENING cancels only days that have NOT happened. Today counts as
 *   not-yet-elapsed so the change takes effect immediately, but a day already
 *   run stays 'active' and stays charged. Shortening a 6-day run to 2 on its
 *   fifth day therefore ends it today and leaves five days on the record — it
 *   cannot rewrite the past, and the returned length says so.
 *
 *   EXTENDING adds days at the end, taking them from whoever holds that slot,
 *   because the operator lengthening a run has decided it outranks what was
 *   queued behind it. Same eviction rule as force: only the overlap.
 *
 * Returns the number of days the allocation now actually runs.
 */
create or replace function public.set_featured_duration(
  p_allocation_id uuid,
  p_days          integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Australia/Sydney')::date;
  v_start   date;
  v_slot    smallint;
  v_event   uuid;
  v_name    text;
  v_new_end date;
  v_day     date;
  i         integer;
  v_actual  integer;
begin
  if p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'FEATURED_DAYS_OUT_OF_RANGE: days must be between 1 and 7, got %', p_days
      using errcode = '22023';
  end if;

  select min(featured_date), min(slot), min(event_id), min(event_name)
    into v_start, v_slot, v_event, v_name
  from public.featured_allocation
  where allocation_id = p_allocation_id and status = 'active';

  if v_start is null then
    raise exception 'FEATURED_ALLOCATION_NOT_FOUND: no active allocation %', p_allocation_id
      using errcode = 'P0002';
  end if;

  v_new_end := v_start + (p_days - 1);

  -- Shorten: cancel the tail, but never a day that has already been served.
  update public.featured_allocation
     set status         = 'removed',
         removed_at     = now(),
         removal_reason = 'shortened to ' || p_days || ' days by administrator'
   where allocation_id = p_allocation_id
     and status = 'active'
     and featured_date > v_new_end
     and featured_date >= v_today;

  -- Extend: add the missing days, displacing whatever holds them.
  for i in 0 .. (p_days - 1) loop
    v_day := v_start + i;
    continue when v_day < v_today;          -- the past is not re-created
    if not exists (
      select 1 from public.featured_allocation
      where allocation_id = p_allocation_id
        and featured_date = v_day and status = 'active'
    ) then
      update public.featured_allocation
         set status         = 'removed',
             removed_at     = now(),
             removal_reason = 'displaced by ' || coalesce(v_name, 'an extended allocation')
       where slot = v_slot and status = 'active' and featured_date = v_day;

      insert into public.featured_allocation (
        featured_date, slot, event_id, event_name, selection_type,
        allocation_id, starts_at, requested_days, status, provenance
      ) values (
        v_day, v_slot, v_event, v_name, 'manual',
        p_allocation_id, now(), p_days, 'active', 'studio'
      );
    end if;
  end loop;

  -- `requested_days` is what was ASKED FOR and every row of the run must agree,
  -- or the screen shows "day 3 of 6" beside "day 3 of 2".
  update public.featured_allocation
     set requested_days = p_days
   where allocation_id = p_allocation_id and status = 'active';

  select count(*) into v_actual
  from public.featured_allocation
  where allocation_id = p_allocation_id and status = 'active';

  return v_actual;
end $$;

-- ── 3 · GRANTS ───────────────────────────────────────────────────────
--
-- ⛔ Drop the 5-arg version: `create or replace` cannot change a signature, so
-- it survives alongside the 6-arg one and a 5-arg call would still reach the
-- version that refuses instead of forcing. Dropping takes its grants with it.
drop function if exists public.feature_event_manually(uuid, integer, uuid, date, smallint);

revoke execute on function public.feature_event_manually(uuid, integer, uuid, date, smallint, boolean)
  from public, anon, authenticated;
revoke execute on function public.set_featured_duration(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.feature_event_manually(uuid, integer, uuid, date, smallint, boolean)
  to service_role;
grant execute on function public.set_featured_duration(uuid, integer)
  to service_role;

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- force takes a busy slot instead of refusing, and says what displaced what:
-- select public.feature_event_manually('<a>'::uuid, 6, null, null, 1, false);
-- select public.feature_event_manually('<b>'::uuid, 6, null, null, 1, false);  -- expect 22023
-- select public.feature_event_manually('<b>'::uuid, 6, null, null, 1, true);   -- succeeds
-- select featured_date, event_name, status, removal_reason
--   from public.featured_allocation where slot = 1 order by featured_date, status;
--
-- -- ⛔ but validity is NOT negotiable, however hard it is forced:
-- select public.feature_event_manually('<a-draft>'::uuid, 6, null, null, 1, true);  -- expect 22023
--
-- -- shortening cannot rewrite days already served:
-- select public.set_featured_duration('<alloc>'::uuid, 1);   -- returns days STILL active
