-- FE1 · THE FEATURED EXPOSURE LEDGER
-- Design: docs/featured-event-engine-2026-08-21.md
-- Engine:  apps/scene/src/lib/featuredEvent.js
--
-- ⭐⭐ THIS TABLE RECORDS WHAT THE PLATFORM ALLOCATED, NEVER WHAT ANYONE SAW.
--
-- One row per day per event that held the What's On hero. That is the whole
-- fairness question: "has this event had a turn lately?" It needs no viewer,
-- no device and no session to answer.
--
-- ⛔⛔ DELIBERATELY NO `impressions`, `device_id`, `user_id` OR `session_id`.
-- The original design sketch carried an exposure_impressions column. A count
-- of who-saw-what is browsing history under a different name, and the ratified
-- privacy rule forbids exactly that (docs/analytics-vision-2026-07.md §8) —
-- which is also why `normaliseScreenPath()` in lib/analytics.js rewrites
-- /event/<uuid> to /event/:id ON THE CLIENT before anything is sent. Adding an
-- impression counter here would reintroduce, in a readable table, the thing
-- that control exists to prevent. Days-featured answers fairness just as well.
--
-- ── ⚠ WHO WRITES THIS, AND WHY NOT THE APP ──────────────────────────
--
-- Writes are service_role only. An anon/authenticated INSERT grant would let
-- any caller claim a day for any event, and since the ledger FEEDS the ranking
-- that is a lever on the result, not just bad data.
--
-- Until Studio records allocations, the client derives the same sequence by
-- replay — selection is a pure function of (candidates, day, prior
-- allocations), so the history is recomputable rather than remembered
-- (`replayHistory()` in the engine). This follows the house answer to "there
-- is no worker": 20260724000004_n4b_expiry_on_delivery does its scheduled work
-- lazily on read instead of on a timer, because there is no pg_cron, no Edge
-- Function and no cron in this project.
--
-- ⚠⚠ REPLAY IS ONLY SOUND IF IT CAN SEE THE PAST. Measured on the live
-- catalogue: replaying 30 days over a today-onwards event list handed a
-- month of allocations to gigs that had not happened yet, pushing the hero
-- from an event 3 days out to one 14 days out. What's On therefore fetches a
-- SECOND, WIDER window for the replay (see the comment at its
-- `featuredPool`). Get that wrong and the engine still looks like it works.
--
-- Rows in THIS table always win over replay: replay is a bootstrap so the
-- fairness rules mean something on day one instead of after a month, and it
-- cannot see an event deleted since. That is the reason to start recording.
--
-- ── ⚠ WHY event_id IS NULLABLE ──────────────────────────────────────
--
-- `events.host_id` cascades from auth.users, so deleting an account deletes
-- its events. ON DELETE CASCADE here would then erase the record that those
-- events were ever featured. m2_participation_spine settled this: severing the
-- link is right, destroying the record is not. `event_name` keeps the row
-- legible afterwards, the same snapshot trick `follows.entity_name` uses.

create table if not exists public.featured_allocation (
  id             uuid primary key default gen_random_uuid(),
  featured_date  date not null,
  event_id       uuid references public.events(id) on delete set null,
  event_name     text,
  selection_type text not null,
  score          numeric,
  provenance     text not null default 'service_role',
  created_at     timestamptz not null default now()
);

-- ⭐ ONE ALLOCATION PER DAY. This is what makes a write idempotent and a race
-- harmless: whoever records the day first wins, and nobody can record it
-- twice. It is also the constraint that makes "3 consecutive allocations"
-- countable at all.
create unique index if not exists featured_allocation_date_key
  on public.featured_allocation (featured_date);

-- The fairness lookup is always "this event, recently", so lead on event_id.
create index if not exists featured_allocation_event_idx
  on public.featured_allocation (event_id, featured_date desc);

-- Closed vocabularies, added separately and guarded: on a re-run the CREATE
-- TABLE is skipped and an inline CHECK would be skipped with it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname  = 'featured_allocation_selection_type_check'
      and conrelid = 'public.featured_allocation'::regclass
  ) then
    alter table public.featured_allocation
      add constraint featured_allocation_selection_type_check
      check (selection_type in ('organic', 'promoted', 'editorial'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname  = 'featured_allocation_provenance_check'
      and conrelid = 'public.featured_allocation'::regclass
  ) then
    alter table public.featured_allocation
      add constraint featured_allocation_provenance_check
      check (provenance in ('app', 'studio', 'service_role'));
  end if;
end $$;

comment on table public.featured_allocation is
  'One row per day per event that held the What''s On featured slot. Records the ALLOCATION, never impressions: no viewer, device or session is recorded here, deliberately.';
comment on column public.featured_allocation.featured_date is
  'The local AU day this allocation covers. UNIQUE — one featured event per day.';
comment on column public.featured_allocation.event_id is
  'Nullable ON DELETE SET NULL: deleting an event must not erase the record that it was featured. event_name keeps the row legible.';
comment on column public.featured_allocation.provenance is
  'HOW the row was written, since this schema has no admin identity and service_role has no auth.uid(). One of app / studio / service_role.';
comment on column public.featured_allocation.score is
  'The winning final score, kept for debugging "why did this win?". Not read by the engine.';

-- ── GRANTS ──────────────────────────────────────────────────────────
--
-- ⭐ Supabase auto-grants ALL to anon — the explicit reset is the M1 lesson
-- (a baseline is insecure without it). RLS is then the barrier.
--
-- SELECT is public because the ledger is an input to a public ranking: an
-- anonymous What's On visitor must be able to compute the same fairness state
-- as everyone else. There is nothing personal in the row to protect.

revoke all on public.featured_allocation from anon, authenticated;
grant select on public.featured_allocation to anon, authenticated;
grant all on public.featured_allocation to service_role;

alter table public.featured_allocation enable row level security;

-- ⛔⛔ EXACTLY ONE SELECT POLICY. PostgreSQL ORs permissive policies, so a
-- second one would widen this, not narrow it — the sec1 lesson, where a
-- narrow policy sat beside `USING (true)` and anon received every draft.
drop policy if exists "read featured allocations" on public.featured_allocation;
create policy "read featured allocations" on public.featured_allocation
  for select using (true);

-- ⛔ NO INSERT / UPDATE / DELETE POLICY, DELIBERATELY. service_role bypasses
-- RLS; every other role is denied by the absence. "The app cannot award itself
-- the featured slot" is enforced by the database, not promised by the client —
-- the same shape c1_profile_claim_requests uses for approval.

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- select count(*) from pg_policies
--  where tablename = 'featured_allocation';                     -- expect 1
--
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'featured_allocation' and grantee in ('anon','authenticated')
--  order by grantee, privilege_type;                            -- expect SELECT only, twice
--
-- -- one allocation per day is enforced, not merely intended:
-- insert into public.featured_allocation (featured_date, selection_type)
--   values ('2026-01-01', 'organic'), ('2026-01-01', 'organic');   -- expect 23505
--
-- -- and the vocabulary is closed:
-- insert into public.featured_allocation (featured_date, selection_type)
--   values ('2026-01-02', 'sponsored');                            -- expect 23514
