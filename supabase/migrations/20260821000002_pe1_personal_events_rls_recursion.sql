-- PE1 · PERSONAL EVENTS WERE UNREADABLE BY EVERYONE, SILENTLY
--
-- ⚠⚠ LIVE DEFECT, found 2026-08-21. Every SELECT on `personal_events` failed
-- with `42P17 infinite recursion detected in policy for relation
-- "personal_events"` — HTTP 500, for every user, on every read, since the
-- baseline. Eleven rows have been saved since 2 July and not one of them has
-- ever been displayable.
--
-- ── THE CYCLE ────────────────────────────────────────────────────────
--
--   pe_select      on personal_events        reads personal_event_invites
--   pei_owner_all  on personal_event_invites reads personal_events
--
-- Each policy needs the other table, so evaluating either one re-enters the
-- other for ever. Postgres detects it and aborts the statement.
--
-- ⭐ WHY NOBODY NOTICED. The INSERT policy has no subquery, so writing worked
-- perfectly. The row saved, the sheet closed, and `peRes.data || []` in
-- MySceneScreen turned the 500 into an empty list — so the calendar said
-- "NOTHING ANNOUNCED YET" about an event that was sitting in the table. A
-- write path that works and a read path that fails silently is the worst
-- possible combination: it looks like the save is broken, so the fix gets
-- hunted in entirely the wrong place.
--
-- ── THE FIX: EACH POLICY ANSWERS FROM ONE TABLE ─────────────────────
--
-- Both cross-table lookups move into SECURITY DEFINER helpers that read a
-- SINGLE table with a pinned search_path. A definer function does not run the
-- other table's policies, so the loop cannot form. This is the same shape
-- `can_act_as` and `is_event_owner` use, and s2c states the rule outright: a
-- helper must answer from ONE table and ⛔ must not traverse.
--
-- ⚠ The VISIBILITY RULE IS UNCHANGED. An owner sees their own rows; an invitee
-- sees rows they were invited to; nobody else sees anything. This migration
-- changes only how that question is asked, never its answer.

-- Is the caller invited to this personal event? Reads personal_event_invites
-- ONLY. Returns false — never null — for an unauthenticated caller, so the
-- policy needs no null guard.
create or replace function public.is_personal_event_invitee(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.personal_event_invites
    where personal_event_id = p_event_id
      and invitee_id = auth.uid()
  );
$$;

-- Does the caller own this personal event? Reads personal_events ONLY.
create or replace function public.owns_personal_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.personal_events
    where id = p_event_id
      and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_personal_event_invitee(uuid) from public, anon;
revoke execute on function public.owns_personal_event(uuid)       from public, anon;
grant execute on function public.is_personal_event_invitee(uuid) to authenticated;
grant execute on function public.owns_personal_event(uuid)       to authenticated;

-- ⛔⛔ ONE SELECT POLICY PER TABLE. PostgreSQL ORs permissive policies, so a
-- leftover alongside these would widen access rather than narrow it — the sec1
-- lesson, where a narrow policy sat beside `USING (true)` and anon received
-- every draft.
drop policy if exists pe_select on public.personal_events;
create policy pe_select on public.personal_events
  for select using (
    auth.uid() = user_id
    or public.is_personal_event_invitee(id)
  );

drop policy if exists pei_owner_all on public.personal_event_invites;
create policy pei_owner_all on public.personal_event_invites
  using      (public.owns_personal_event(personal_event_id))
  with check (public.owns_personal_event(personal_event_id));

-- ── ⚠ THE GRANTS ARE FAR WIDER THAN THIS FEATURE NEEDS ──────────────
--
-- The baseline handed anon and authenticated TRIGGER, REFERENCES and MAINTAIN
-- on both tables — the Supabase auto-grant the M1 audit flagged, where a
-- rebuild gave anon TRUNCATE on 46 tables. RLS is still the barrier, so this
-- is not the defect above, but a diary of someone's nights out has no business
-- being alterable by an anonymous visitor. Reset to what the app actually uses.
revoke all on public.personal_events        from anon, authenticated;
revoke all on public.personal_event_invites from anon, authenticated;
grant select, insert, update, delete on public.personal_events        to authenticated;
grant select, insert, update, delete on public.personal_event_invites to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- Before this migration the next line returned 42P17 / HTTP 500.
-- -- As anon it must now return ZERO ROWS, not an error:
-- set role anon;
-- select count(*) from public.personal_events;      -- expect 0, no error
-- reset role;
--
-- -- and exactly one SELECT policy survives on each table:
-- select tablename, policyname, cmd from pg_policies
--  where tablename in ('personal_events','personal_event_invites')
--  order by tablename, policyname;
