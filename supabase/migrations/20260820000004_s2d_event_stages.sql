-- S2d · THE STAGE AXIS — the one structural addition of the S2 decision.
--
-- ⭐⭐ A STAGE IS AN ENTITY, NOT A STRING ON A SLOT. Views anchor on stage
-- identity (name, order, accent) and Festival needs stages that persist across
-- days. ratified 2026-08-20, scheduling-architecture-s2-decision-2026-08-20.md.
--
-- ⭐⭐ NULL stage_id = THE EVENT'S SINGLE IMPLICIT STAGE. An event with zero
-- event_stages rows is a single-stage event and its views render no stage
-- chrome at all. Every existing slot is single-stage by definition, so this
-- migration needs NO backfill. Mixed NULL/non-NULL within one event is an
-- invalid state prevented at the WRITE LAYER (creating an event's first stage
-- adopts all its existing slots, atomically, in the same writer) — it is a
-- cross-row property, so ⛔ no CHECK can express it.
--
-- ⛔⛔ ON DELETE RESTRICT, DELIBERATELY. A CASCADE chain stage → slot →
-- performance would silently unbook artists by deleting a stage. Emptying a
-- stage first is a decision the host must make explicitly. (Same caution
-- class as the flagged events.host_id CASCADE.)
--
-- ⛔ NO UNIQUE ON (event_id, position) — L2's reasoning holds here too:
-- reordering swaps positions and a non-deferrable index rejects the
-- intermediate state. Ordering is expressed, not enforced.
--
-- ⛔ NO capacity/location/genre metadata yet: stage stays minimal until
-- Festival's real requirements are known (S6). accent is a palette TOKEN,
-- nullable — the view decides rendering.
--
-- ⚠ updated_at is maintained BY HAND, like event_slots — no touch trigger
-- exists on any scheduling table and this one follows the local convention.

create table if not exists public.event_stages (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  position    int  not null default 0,
  accent      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists idx_event_stages_event_id on public.event_stages (event_id);

alter table public.event_slots
  add column if not exists stage_id uuid references public.event_stages(id) on delete restrict;

create index if not exists idx_event_slots_stage_id on public.event_slots (stage_id);

-- RLS mirrors event_slots (L2): the schedule's structure is as visible as the
-- schedule, and only the event's owner shapes it.
alter table public.event_stages enable row level security;

-- ⭐ Supabase auto-grants ALL to anon — the explicit reset below is the M1
-- lesson (a baseline is insecure without it). RLS is then the barrier.
revoke all on public.event_stages from anon, authenticated;
grant select on public.event_stages to anon, authenticated;
grant insert, update, delete on public.event_stages to authenticated;

drop policy if exists "read stages for live or own events" on public.event_stages;
create policy "read stages for live or own events" on public.event_stages
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_stages.event_id
        and (
          e.status = 'live'
          or e.host_id = auth.uid()
          or e.owner_profile_id in (select id from public.profiles where user_id = auth.uid())
        )
    )
  );

drop policy if exists "owner can insert stages" on public.event_stages;
create policy "owner can insert stages" on public.event_stages
  for insert with check (
    exists (select 1 from public.events e where e.id = event_stages.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

drop policy if exists "owner can update stages" on public.event_stages;
create policy "owner can update stages" on public.event_stages
  for update using (
    exists (select 1 from public.events e where e.id = event_stages.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  ) with check (
    exists (select 1 from public.events e where e.id = event_stages.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

drop policy if exists "owner can delete stages" on public.event_stages;
create policy "owner can delete stages" on public.event_stages
  for delete using (
    exists (select 1 from public.events e where e.id = event_stages.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

comment on table public.event_stages is
  'A stage/area of an event. Zero rows = single-stage event (event_slots.stage_id NULL). Ratified S2 2026-08-20.';
comment on column public.event_slots.stage_id is
  'NULL = the event''s single implicit stage. ON DELETE RESTRICT: emptying a stage is an explicit host decision, never a cascade into unbooking.';
