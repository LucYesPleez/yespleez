-- S2e · CREATING A STAGE — the write layer S2d specified and did not build.
--
-- ⭐⭐ S2d's own note: "Mixed NULL/non-NULL within one event is an invalid state
-- prevented at the WRITE LAYER (creating an event's first stage adopts all its
-- existing slots, atomically, in the same writer) — it is a cross-row property,
-- so ⛔ no CHECK can express it."
--
-- ⛔⛔ THAT IS WHY THIS IS AN RPC AND NOT TWO CLIENT CALLS. A PostgREST client
-- has no transaction. Insert-then-update from the browser leaves a window in
-- which the event has a stage and slots that belong to no stage, and a failed
-- second call leaves it that way permanently. `resolveSchedule` renders those
-- orphans under the first stage and COUNTS them (`unstagedOnStagedEvent`)
-- rather than dropping a real booking, so the damage would be quiet: a
-- schedule that looks right and a set of slots on the wrong stage.
--
-- ⭐ ADOPTION HAPPENS ONCE, on the FIRST stage only. Every stage after that is a
-- plain insert: once an event has a stage, new slots are created against one.
--
-- ⛔ SECURITY DEFINER with an explicit owner check. The function must be able to
-- update `event_slots` in the same transaction, and it verifies the caller owns
-- the event itself rather than trusting RLS to have done it for both tables.
-- ⛔ search_path is pinned — a SECURITY DEFINER function without it is a
-- privilege-escalation hole.

create or replace function public.create_event_stage(
  p_event_id uuid,
  p_name     text,
  p_accent   text default null,
  p_position int  default null
)
returns public.event_stages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage      public.event_stages;
  v_is_first   boolean;
  v_position   int;
begin
  if p_event_id is null or coalesce(btrim(p_name), '') = '' then
    raise exception 'create_event_stage needs an event and a name';
  end if;

  -- ⛔ THE OWNER CHECK IS THE WHOLE SECURITY OF THIS FUNCTION, because SECURITY
  -- DEFINER means RLS is not doing it for us.
  --
  -- ⚠⚠ THE PREDICATE IS COPIED VERBATIM from S2d's own "owner can insert
  -- stages" policy, deliberately. `host_id` is NULL on most events, so an
  -- ownership rule that checks only one of the two columns locks real owners
  -- out of their own events — that defect has already been shipped twice, in
  -- RLS and in the client gate. ⛔ Both halves, or neither.
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
  ) then
    raise exception 'not your event' using errcode = '42501';
  end if;

  select not exists (
    select 1 from public.event_stages s where s.event_id = p_event_id
  ) into v_is_first;

  -- Ordering is EXPRESSED, not enforced (S2d: no unique on position), so the
  -- default simply lands the new stage after the current last one.
  if p_position is null then
    select coalesce(max(position), -1) + 1 into v_position
      from public.event_stages where event_id = p_event_id;
  else
    v_position := p_position;
  end if;

  insert into public.event_stages (event_id, name, position, accent)
  values (p_event_id, btrim(p_name), v_position, p_accent)
  returning * into v_stage;

  -- ⭐⭐ THE ADOPTION. Same transaction as the insert above, which is the entire
  -- reason this function exists.
  if v_is_first then
    update public.event_slots
       set stage_id = v_stage.id, updated_at = now()
     where event_id = p_event_id
       and stage_id is null;
  end if;

  return v_stage;
end;
$$;

revoke all on function public.create_event_stage(uuid, text, text, int) from public, anon;
grant execute on function public.create_event_stage(uuid, text, text, int) to authenticated;
