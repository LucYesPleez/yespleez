-- L3 · `performances.slot_id` STOPS BEING A FOREIGN KEY INTO A JSON BLOB.
--
-- ⚠ THIS FILE IS A RECORD OF WHAT WAS RUN, ⛔ not an instruction to run it.
--
-- L2 verified 29 = 29 slots migrated and 0 unmappable performances, so every
-- one of the 63 rows can find its `event_slots` row by (event_id, legacy_key).
--
-- ── ⛔ WHY `ON DELETE CASCADE` AND NOT `SET NULL` ───────────────────────────
-- Deleting a slot must remove the PERFORMANCE and leave the `lineup_members`
-- row alone. That is the owner's ratified model stated as a constraint:
-- "removing from Set Times returns to Lineup, not off the event." A performance
-- with a NULL slot would be a booking for no time — the state the model says is
-- represented by having NO performance row at all.
--
-- ── ⛔ NO UNIQUE INDEX ON slot_uuid ALONE ───────────────────────────────────
-- B2B sets are real, and three slots genuinely hold competing members today.
-- The constraint is (slot_uuid, lineup_member_id): one act cannot hold the same
-- slot twice, but a slot may hold two acts. ⚠ `useEventData` currently builds
-- `map[p.slot_id] = …`, so it silently picks whichever row came back last on
-- those slots — that is a READER defect for the rebuild, ⛔ not something to
-- "fix" here by deleting somebody's booking.
--
-- ── THE DEDUPE, AND WHY IT IS SAFE ─────────────────────────────────────────
-- Measured immediately before running, with the service role:
--     12 duplicate groups (same event + slot + member)
--     30 rows shed
--      0 groups with MIXED statuses
--      0 groups containing an 'accepted'
-- So no acceptance can be lost. The status ordering below is belt-and-braces:
-- it is written to survive a mixed group even though none exists, because a
-- rule that is only correct against today's data is not a rule.
--
-- ⛔ WHAT THIS DOES NOT TOUCH. Two acts appear TWICE on one event as separate
-- members — once as a bare name and once as a linked profile (`Anti-Faffist`
-- on Solstice Soirée, `Daddy Longlegs` on fds). Merging them changes who is on
-- the bill, which is the organiser's decision. They are left visible.
--
-- ⚠⚠ `slot_uuid` IS DELIBERATELY NULLABLE, FOR NOW. The app still writes the
-- text `slot_id` and knows nothing about this column; a NOT NULL here would
-- reject every insert the live app makes. NOT NULL lands after the writers
-- migrate, and `slot_id` is dropped only when the last reader is gone.

begin;

alter table public.performances
  add column if not exists slot_uuid uuid references public.event_slots(id) on delete cascade;

-- Map by the key L2 preserved for exactly this purpose.
update public.performances p
   set slot_uuid = es.id
  from public.event_slots es
 where es.event_id = p.event_id
   and es.legacy_key = p.slot_id
   and p.slot_uuid is null;

-- Shed the provable duplicates, keeping the most committed row in each group.
delete from public.performances p
 using (
   select id,
          row_number() over (
            partition by slot_uuid, lineup_member_id
            order by case status
                       when 'accepted' then 0
                       when 'offered'  then 1
                       when 'draft'    then 2
                       else 3
                     end,
                     accepted_at desc nulls last,
                     id
          ) as rn
     from public.performances
    where slot_uuid is not null
 ) d
 where p.id = d.id
   and d.rn > 1;

create unique index if not exists uq_performances_slot_member
  on public.performances(slot_uuid, lineup_member_id) where slot_uuid is not null;

create index if not exists idx_performances_slot_uuid on public.performances(slot_uuid);

/**
 * ⚠ TRANSITIONAL — ⛔ DELETE THIS TRIGGER WITH THE LAST `slot_id` WRITER.
 *
 * Between L3 and the writer migration the app still inserts the text
 * `slot_id` and nothing else, so without this every NEW performance would land
 * outside the foreign key and outside the unique index — a table half under
 * constraint, which is worse than either state on its own.
 *
 * INVOKER, not SECURITY DEFINER: it reads `event_slots` as whoever is writing,
 * so it cannot resolve a slot the writer could not already see. If RLS hides
 * the slot the column simply stays NULL, which is exactly today's behaviour and
 * loses nothing.
 */
create or replace function public.performances_sync_slot_uuid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.slot_uuid is null and new.slot_id is not null then
    select es.id into new.slot_uuid
      from public.event_slots es
     where es.event_id = new.event_id
       and es.legacy_key = new.slot_id
     limit 1;
  end if;
  return new;
end;
$$;

-- ⛔ `create trigger` has no IF NOT EXISTS, and the SQL editor runs ONE
-- transaction — so drop first, or a re-run aborts the whole migration.
drop trigger if exists trg_performances_sync_slot_uuid on public.performances;
create trigger trg_performances_sync_slot_uuid
  before insert or update on public.performances
  for each row execute function public.performances_sync_slot_uuid();

commit;
