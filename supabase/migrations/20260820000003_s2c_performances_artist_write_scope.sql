-- S2c · AN ARTIST MAY ANSWER, NOT RESCHEDULE.
--
-- ⚠⚠ THE HOLE (baseline-era): "Artist can update own performance status" has
-- USING with no WITH CHECK, so an artist who can update their own row is
-- unrestricted in WHAT they write into it — including slot_uuid, which S2
-- makes the scheduling truth. An artist could move themselves to any slot,
-- or onto another event, with one PostgREST call.
--
-- TWO MECHANISMS, BECAUSE RLS CANNOT SEE OLD:
--   · The POLICY gains a WITH CHECK — row still theirs, status one of the two
--     answers. Declarative, visible in pg_policies.
--   · A TRIGGER enforces column immutability (a policy's WITH CHECK sees only
--     the NEW row, so "slot_uuid unchanged" is not expressible there).
--
-- ⭐ USING SEMANTICS ARE PRESERVED EXACTLY (lm.artist_id = auth.uid()).
-- ⚠ KNOWN GAP, DELIBERATELY NOT WIDENED HERE: members linked only by
-- artist_profile_id (the import path — most members) do not match this policy
-- and cannot accept/decline via RLS at all. That is a pre-existing condition;
-- widening access belongs to S5 scheduling-integrity as its own decision,
-- ⛔ not smuggled into a WITH CHECK fix.
--
-- ⚠ THE TRIGGER EXEMPTS THE EVENT OWNER AND THE SERVICE ROLE:
--   · Owner writes pass RLS via "owner can update performances" and must stay
--     free to reschedule — is_event_owner() answers from ONE table via the
--     proven SECURITY DEFINER + pinned search_path shape (42P17 is live in
--     this codebase; do not traverse).
--   · auth.uid() IS NULL = service role. RLS never applied to it, but
--     triggers DO — without this arm, every future owner-side backfill
--     script (one already touched performances.status) would start failing.

create or replace function public.is_event_owner(p_event_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from events e
    where e.id = p_event_id
      and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
  );
$$;

create or replace function public.performances_artist_update_guard()
returns trigger
language plpgsql
as $$
begin
  -- Service role (no JWT subject): triggers still fire for it; let it pass.
  if auth.uid() is null then
    return new;
  end if;

  -- The event owner reschedules freely — that is their verb.
  if public.is_event_owner(old.event_id) then
    return new;
  end if;

  -- Everyone else (the artist path): the row's identity and its schedule are
  -- immutable; only the answer may change.
  if new.id                is distinct from old.id
     or new.event_id          is distinct from old.event_id
     or new.lineup_member_id  is distinct from old.lineup_member_id
     or new.slot_uuid         is distinct from old.slot_uuid
     or new.slot_id           is distinct from old.slot_id
     or new.offered_at        is distinct from old.offered_at
     or new.created_at        is distinct from old.created_at
  then
    raise exception 'artists may change only their answer (status / accepted_at)';
  end if;

  if new.status not in ('accepted','declined') then
    raise exception 'an artist writes accepted or declined, nothing else';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_performances_artist_scope on public.performances;
create trigger trg_performances_artist_scope
  before update on public.performances
  for each row execute function public.performances_artist_update_guard();

-- The policy, replaced with the same USING plus a WITH CHECK.
drop policy if exists "Artist can update own performance status" on public.performances;
create policy "Artist can update own performance status" on public.performances
  for update
  using (
    exists (
      select 1 from public.lineup_members lm
      where lm.id = performances.lineup_member_id
        and lm.artist_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lineup_members lm
      where lm.id = performances.lineup_member_id
        and lm.artist_id = auth.uid()
    )
    and status in ('accepted','declined')
  );
