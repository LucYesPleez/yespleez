-- ══════════════════════════════════════════════════════════════════════
-- fe3 · THREE FEATURED SLOTS, ON A STAGGERED CYCLE
-- ══════════════════════════════════════════════════════════════════════
--
-- The What's On hero becomes a rotation of THREE events rather than one, and
-- the three do not turn over together: each slot runs for a fixed lifespan and
-- the slots are offset from one another, so roughly every second day exactly
-- one card changes and the other two are where the reader left them.
--
-- ⭐⭐ THE SLOT IS THE NEW UNIQUENESS. fe1 said "one featured event per day"
-- with `unique (featured_date)`; fe2 corrected that to `unique (featured_date)
-- where status = 'active'` — one LIVE allocation per day, cancelled rows free
-- to coexist as history. Both encode a single hero. The rule now is one live
-- allocation per (day, SLOT), which is the same guarantee three times over.
--
-- ⚠⚠ WITHOUT THIS MIGRATION THE THREE-UP HERO CANNOT EXIST. The second
-- concurrent allocation on any day raises 23505 against the old index — the
-- database refuses it, correctly, because until now "two events featured at
-- once" WAS a bug. Studio's add will fail with a unique violation until this
-- runs; the Scene app degrades to whatever single allocation exists, which is
-- the pre-fe3 behaviour and not an outage.
--
-- ── THE CYCLE IS AN EQUATION: 3 SLOTS × 2 DAYS = A 6-DAY LIFESPAN ────
--
-- Hold `lifespan = slots × stagger` and exactly one card changes every second
-- day, forever, with no empty day and no day where two turn over together.
-- Break it and the rotation keeps running but drifts — at 5 days each slot
-- sits empty for a day per cycle and the replacements bunch up.
--
-- ⚠ The lifespan is NOT stored here. It is `p_days` per allocation, so the
-- database expresses any cycle and the choice stays the operator's; the app
-- and Studio hold the number. See SLOT_LIFESPAN_DAYS / SLOT_STAGGER_DAYS in
-- apps/scene/src/lib/featuredEvent.js and featured-rules.js in Studio.
--
-- ⛔ NOTHING HERE RECORDS AN IMPRESSION. The ledger still answers "how many
-- days has this event held a slot", never "who saw it" — see fe1's header.

-- ── 1 · THE SLOT COLUMN ──────────────────────────────────────────────
--
-- Defaulted to 1 so every existing row keeps meaning exactly what it meant:
-- the single hero was slot 1, and no historical allocation changes value.
alter table public.featured_allocation
  add column if not exists slot smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'featured_allocation_slot_range'
  ) then
    alter table public.featured_allocation
      add constraint featured_allocation_slot_range check (slot between 1 and 3);
  end if;
end $$;

comment on column public.featured_allocation.slot is
  'Which of the three hero positions this allocation holds (1..3). The rotation staggers the slots so only one changes at a time; slot 1 is where every pre-fe3 allocation sits.';

-- ── 2 · UNIQUENESS MOVES FROM THE DAY TO THE (DAY, SLOT) ─────────────
--
-- ⛔ Drop BOTH historical names. fe1's index may still exist in an environment
-- that never received fe2, and leaving it would silently keep the one-hero
-- rule in force while everything above claims three.
drop index if exists public.featured_allocation_date_key;
drop index if exists public.featured_allocation_active_date_key;

create unique index if not exists featured_allocation_active_slot_key
  on public.featured_allocation (featured_date, slot)
  where status = 'active';

-- ── 3 · CLAIMING A SLOT ──────────────────────────────────────────────

/**
 * The lowest slot with no live allocation on `p_date`, or null when all three
 * are taken. Split out so both the function below and Studio's "what is free"
 * question have ONE answer, rather than the UI guessing and the write
 * disagreeing.
 */
create or replace function public.free_featured_slot(p_date date)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select s::smallint
  from generate_series(1, 3) as s
  where not exists (
    select 1 from public.featured_allocation a
    where a.featured_date = p_date and a.slot = s and a.status = 'active'
  )
  order by s
  limit 1;
$$;

/**
 * Feature an event for `p_days` days from `p_start_date`, in one slot.
 *
 * ⭐⭐ THE CHANGE FROM fe2: an allocation no longer evicts whoever held the
 * day. It takes a slot the whole run can occupy, and a run that cannot hold
 * ONE slot for ALL of its days is REFUSED rather than half-written. Partial
 * runs were harmless when there was one hero — the next add simply replaced
 * it — but with three slots a partial run means a card that vanishes mid-week
 * for no reason the operator can see.
 *
 * ⚠ `p_slot` is optional. Passing null asks for the lowest slot free on EVERY
 * day of the run, which is what the staggered cycle wants; passing a slot is
 * for an operator deliberately replacing one position.
 */
create or replace function public.feature_event_manually(
  p_event_id   uuid,
  p_days       integer default 6,
  p_created_by uuid    default null,
  p_start_date date    default null,
  p_slot       smallint default null
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
  v_slot   smallint;
  v_day    date;
  i        integer;
begin
  -- 1..7 still, so the old 3-day habit and the 6-day cycle are both
  -- expressible. The app-side constant decides the DEFAULT; this decides the
  -- limit, and a limit is not a policy.
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

  -- ⭐ ONE SLOT FOR THE WHOLE RUN. Chosen before anything is written, so the
  -- refusal below happens instead of a half-written allocation.
  if p_slot is not null then
    v_slot := p_slot;
  else
    select s::smallint into v_slot
    from generate_series(1, 3) as s
    where not exists (
      select 1 from public.featured_allocation a
      where a.slot = s
        and a.status = 'active'
        and a.featured_date between v_start and (v_start + (p_days - 1))
    )
    order by s
    limit 1;
  end if;

  if v_slot is null then
    raise exception
      'FEATURED_NO_SLOT_FREE: all three slots are occupied for % to %',
      v_start, v_start + (p_days - 1)
      using errcode = '22023';
  end if;

  -- An explicitly named slot must still be free for the whole run — otherwise
  -- the insert below fails partway and leaves days already written.
  if exists (
    select 1 from public.featured_allocation a
    where a.slot = v_slot
      and a.status = 'active'
      and a.featured_date between v_start and (v_start + (p_days - 1))
  ) then
    raise exception
      'FEATURED_SLOT_TAKEN: slot % is already allocated between % and %',
      v_slot, v_start, v_start + (p_days - 1)
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

-- ── 4 · GRANTS ───────────────────────────────────────────────────────
--
-- ⚠⚠ THE SIGNATURE CHANGED, so fe2's grants do not cover the new function and
-- the OLD one is still there: `create or replace` cannot alter a signature, so
-- the 4-arg version survives alongside the 5-arg one, keeping its grant and
-- its one-hero behaviour. Studio would still resolve to it on a 4-arg call.
--
-- ⛔ DROP IT, do not revoke it. A `revoke` naming a function that does not
-- exist raises 42883 and aborts the whole migration — which is exactly what
-- would happen in any environment that never received fe2. Dropping removes
-- the grants with the function, and `if exists` makes it a no-op instead.
drop function if exists public.feature_event_manually(uuid, integer, uuid, date);

revoke execute on function public.feature_event_manually(uuid, integer, uuid, date, smallint)
  from public, anon, authenticated;
revoke execute on function public.free_featured_slot(date)
  from public, anon, authenticated;

grant execute on function public.feature_event_manually(uuid, integer, uuid, date, smallint)
  to service_role;
grant execute on function public.free_featured_slot(date)
  to service_role;

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- three events can now hold the same day, and a fourth cannot:
-- select public.feature_event_manually('<a>'::uuid, 6);            -- slot 1
-- select public.feature_event_manually('<b>'::uuid, 6);            -- slot 2
-- select public.feature_event_manually('<c>'::uuid, 6);            -- slot 3
-- select public.feature_event_manually('<d>'::uuid, 6);            -- expect 22023
--
-- select featured_date, slot, event_name from public.featured_allocation
--  where status = 'active' order by featured_date, slot;           -- 3 rows per day
--
-- -- the staggered start: slot 2 begins two days after slot 1
-- select public.feature_event_manually('<b>'::uuid, 5, null, current_date + 2);
--
-- -- one live allocation per (day, slot) is enforced, not merely intended:
-- insert into public.featured_allocation (featured_date, slot, selection_type)
--   values (current_date, 1, 'organic');                           -- expect 23505
--
-- -- and the app's own roles still cannot call it at all:
-- set role authenticated;
-- select public.feature_event_manually('<a>'::uuid, 6);            -- expect 42501
-- reset role;
