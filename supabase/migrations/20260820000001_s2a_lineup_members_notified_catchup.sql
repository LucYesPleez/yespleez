-- S2a · CATCH-UP: the P6 notified_* columns, into the migration record.
--
-- ⚠⚠ THESE THREE COLUMNS ALREADY EXIST IN PRODUCTION and are load-bearing for
-- every scheduling notification (notifyPlan / notifySender / lineupActions read
-- and write all three). They were added outside the migration record, so a
-- rebuild from Git fails on every slot-removal notification — a direct
-- violation of the M1 "production reproducible from Git" invariant.
-- This migration records them; on production it must be a no-op for the
-- columns and add only the CHECK.
--
-- ⭐ THE CHECK MIRRORS notifyPlan's CLOSED VOCABULARY. notifiedPatch() already
-- throws client-side on any kind outside the three; the constraint makes the
-- database agree so a raw write cannot invent a fourth spelling.
--
-- ⛔⛔ DELIBERATELY NO FOREIGN KEY ON notified_slot_uuid. The removal case
-- records the slot the artist was told about AFTER that slot may have been
-- deleted (slot deletion cascades performances, and the removal notice is
-- what tells the artist). A dangling reference here is the design, not a
-- defect. Do not "fix" this with a FK.

alter table public.lineup_members
  add column if not exists notified_at        timestamptz,
  add column if not exists notified_slot_uuid uuid,
  add column if not exists notified_kind      text;

-- The constraint is added separately and guarded: on production the columns
-- already exist, so ADD COLUMN IF NOT EXISTS skips them and would skip an
-- inline CHECK with them.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname  = 'lineup_members_notified_kind_check'
      and conrelid = 'public.lineup_members'::regclass
  ) then
    alter table public.lineup_members
      add constraint lineup_members_notified_kind_check
      check (notified_kind is null
             or notified_kind in ('slot_offer','slot_changed','slot_removed'));
  end if;
end $$;

comment on column public.lineup_members.notified_slot_uuid is
  'The slot the artist was last told about. Deliberately NO foreign key: a removal notice records a slot that may already be deleted.';
comment on column public.lineup_members.notified_kind is
  'One of slot_offer / slot_changed / slot_removed — the closed vocabulary in lib/notifyPlan.js. CHECK-enforced.';
