-- L2 · SLOTS BECOME ROWS. (Q1, ratified by the owner 2026-08-15.)
--
-- ⚠ THIS FILE IS A RECORD OF WHAT WAS RUN, ⛔ not an instruction to run it.
--
-- ⭐⭐ WHY NOW AND NOT LATER. `performances.slot_id` is a foreign key into a
-- JSON blob with nothing behind it: `events.config.days[].slots[]` is rewritten
-- wholesale by `eventEditorModel.toConfig()` on every save, and nothing stops a
-- performance pointing at a slot that no longer exists. Measured 2026-08-15:
--
--   29 slots, across 3 events (fds 5 · Bass Heavy 5 · Solstice Soirée 19)
--   0 orphaned performances — the hazard has not fired YET
--
-- The migration-risk argument for leaving slots in JSON was the only real one,
-- and 29 rows across 3 events is as cheap as it will ever be.
--
-- ── ⚠ THE ID SCHEME HAS THREE GENERATIONS ───────────────────────────────────
-- Stored slot ids are 4–6 character strings from three different eras:
-- `sat_1`/`sun_10` (day-prefixed), `d0s3` (day+index), `ehkh62` (makeId()'s
-- 6-char random). ⛔ None is a uuid, so `performances.slot_id` cannot simply be
-- re-typed — it needs a VALUE rewrite, which is L3's job. `legacy_key` below is
-- what makes that mapping possible, and it is kept afterwards so a row can
-- always be traced back to the blob it came from.
--
-- ⛔ NO UNIQUE INDEX ON (event_id, day_index, position). Reordering swaps two
-- positions, and a non-deferrable unique index rejects the intermediate state
-- of a multi-row update. Ordering is expressed, not enforced.
--
-- ── ⚠⚠ `dur` IS NOT ALWAYS A NUMBER ─────────────────────────────────────────
-- The first attempt at this backfill died on `22P02: invalid input syntax for
-- type integer: "1.5 hrs"`. ⭐ THAT FAILURE WAS THE GATE WORKING: the whole
-- transaction rolled back and nothing was created.
--
-- All 29 slots were then enumerated. `dur` holds exactly four values:
--
--     "1.5 hrs"  string   5   (every slot on `fds`)   → 90
--     60         number  11                           → 60
--     90         number  12                           → 90
--     45         number   1                           → 45
--
-- The CASE below is written against that complete enumeration, ⛔ not against a
-- guess — every one of the 29 rows is accounted for, so no slot silently takes
-- the 60-minute default. The default arm survives only for data added between
-- this being written and being run.
--
-- ⚠ THE STRING IS A LIVE DEFECT, NOT JUST A MIGRATION NUISANCE. `SlotRow`
-- computes `Number("1.5 hrs")` → NaN, so the editor renders `fds`'s duration as
-- an EMPTY number input; and `EventHostView`'s ASSIGN SLOT sheet computes
-- `"1.5 hrs" >= 60` → false and renders the duration as `1.5 hrsm`. Normalising
-- to an int column is what stops that class of thing recurring.
--
-- ⚠ `pinned` and `labelColor` are ABSENT on all 29 slots. `carryUnedited()` in
-- eventEditorModel exists to preserve exactly those two fields, and no slot in
-- production has either — Solstice's organiser typed 🔒 into the LABEL instead
-- ("SUNSET SET 🔒", "MIDNIGHT CLOSER 🔒"). ⛔ Do not read that as permission to
-- delete `carryUnedited`; it means the pin feature was never reachable, which
-- is a finding for the rebuild, not a cleanup.
--
-- ── VISIBILITY IS DELIBERATELY UNCHANGED ────────────────────────────────────
-- Today the slot grid lives in `events.config`, so it is readable exactly when
-- the event is (SEC-1: live, or your own). The SELECT policy below reproduces
-- that rule EXACTLY so this migration is behaviour-preserving.
--
-- ⚠ NOTE, AND ⛔ DO NOT FIX IT HERE: `showTimesPublicly` does not gate this and
-- never did. The times on a live event are already public through `config` no
-- matter what that toggle says; SEC-2 hides WHO IS PLAYING, not WHEN. Making
-- the toggle a real boundary is a product decision, ⛔ not something to smuggle
-- into a data migration.

begin;

create table if not exists public.event_slots (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  day_index   int  not null default 0,
  day_name    text,
  position    int  not null default 0,
  -- The id this slot carried inside config.days, so L3 can map performances
  -- onto it and so the blob remains traceable afterwards.
  legacy_key  text,
  time        text,
  ampm        text,
  dur_mins    int  not null default 60,
  label       text,
  label_color text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_event_slots_event_id on public.event_slots(event_id);
create index if not exists idx_event_slots_order    on public.event_slots(event_id, day_index, position);
-- Partial: only rows that actually came from the blob need to be unique on it.
create unique index if not exists uq_event_slots_legacy
  on public.event_slots(event_id, legacy_key) where legacy_key is not null;

-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- `with ordinality` is what preserves the organiser's order; the array index is
-- the only record of it, and it is 1-based, hence the -1.
insert into public.event_slots
  (event_id, day_index, day_name, position, legacy_key, time, ampm, dur_mins, label, label_color, pinned)
select
  e.id,
  (d.ord - 1)::int,
  nullif(d.day->>'name', ''),
  (s.ord - 1)::int,
  nullif(s.slot->>'id', ''),
  nullif(s.slot->>'time', ''),
  nullif(s.slot->>'ampm', ''),
  case
    when jsonb_typeof(s.slot->'dur') = 'number'          then (s.slot->>'dur')::int
    when s.slot->>'dur' ~ '^\s*[0-9]+(\.[0-9]+)?\s*h'    then round(regexp_replace(s.slot->>'dur', '[^0-9.]', '', 'g')::numeric * 60)::int
    when s.slot->>'dur' ~ '^\s*[0-9]+\s*m'               then regexp_replace(s.slot->>'dur', '[^0-9]', '', 'g')::int
    when s.slot->>'dur' ~ '^\s*[0-9]+\s*$'               then (s.slot->>'dur')::int
    else 60
  end,
  nullif(s.slot->>'label', ''),
  nullif(s.slot->>'labelColor', ''),
  coalesce(nullif(s.slot->>'pinned', '')::boolean, false)
from public.events e
cross join lateral jsonb_array_elements(coalesce(e.config->'days', '[]'::jsonb)) with ordinality as d(day, ord)
cross join lateral jsonb_array_elements(coalesce(d.day->'slots', '[]'::jsonb)) with ordinality as s(slot, ord)
on conflict do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.event_slots enable row level security;

-- Mirrors SEC-1's event rule exactly: a slot is as readable as its event.
create policy "read slots for live or own events" on public.event_slots
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_slots.event_id
        and (
          e.status = 'live'
          or e.host_id = auth.uid()
          or e.owner_profile_id in (select id from public.profiles where user_id = auth.uid())
        )
    )
  );

-- The same ownership seam L1 established, for the same reason.
create policy "owner can insert slots" on public.event_slots
  for insert with check (
    exists (select 1 from public.events e where e.id = event_slots.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

create policy "owner can update slots" on public.event_slots
  for update using (
    exists (select 1 from public.events e where e.id = event_slots.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  ) with check (
    exists (select 1 from public.events e where e.id = event_slots.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

create policy "owner can delete slots" on public.event_slots
  for delete using (
    exists (select 1 from public.events e where e.id = event_slots.event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id)))
  );

-- ⚠ Supabase auto-grants ALL to anon and authenticated on new tables in the
-- public schema; RLS above is the only barrier, which is the standing rule.
-- Stated explicitly so the grant is a decision rather than a default.
grant select, insert, update, delete on public.event_slots to authenticated;
grant select on public.event_slots to anon;

commit;
