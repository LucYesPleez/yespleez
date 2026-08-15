-- L1 · THE HOST COULD NOT EDIT THEIR OWN BILL, AND WAS TOLD IT WORKED.
--
-- ⚠ THIS FILE IS A RECORD OF WHAT WAS RUN, ⛔ not an instruction to run it.
--
-- Every write policy on `lineup_members` and `performances` gated on
-- `events.host_id = auth.uid()`. Measured 2026-08-15 with the service role
-- (both headers; a junk-column control returned 400 and an anon control
-- returned 0 draft events, so the read was genuinely privileged):
--
--   92 events            82 with NULL host_id
--   39 events with a bill    36 with NULL host_id
--   35 of those have an owner_profile_id and no host_id
--   22 of those 35 are owned by CLAIMED profiles, across 3 real accounts
--
-- `NULL = auth.uid()` is never true, so on those 22 events:
--   INSERT  → 42501, loud
--   UPDATE  → filtered to zero rows, reported as SUCCESS
--   DELETE  → filtered to zero rows, reported as SUCCESS
--
-- ⚠⚠ RLS FILTERS A WRITE, IT DOES NOT ERROR IT. UNASSIGN and DISCARD on those
-- events have been doing nothing and saying they worked. This is the same shape
-- as S2 on `venue_enquiries`, where both INSERT policies were applicant-side
-- only and every offer-downward flow had 42501'd since it was built.
--
-- ⭐ `can_act_as(uuid) RETURNS boolean` is the ratified ownership seam (M6a,
-- signature frozen by identity v1.1 §A4). It returns FALSE for NULL, for an
-- unclaimed profile and for a signed-out caller, so no null-guard is needed and
-- widening to it grants nothing to an unclaimed catalogue profile.
--
-- ⛔ SELECT IS NOT TOUCHED. SEC-2 already governs who may READ a bill or a set
-- time, including the artist's own-offer arm that `acceptSlotOffer` depends on.
--
-- ⭐ The host_id arm is KEPT, not replaced: 10 events legitimately carry one,
-- and 34 events still have NULL owner_profile_id (they predate M14a).
--
-- ⚠ THE UPDATE POLICIES GAIN A `WITH CHECK` THEY NEVER HAD. With USING alone a
-- host could re-point a row's `event_id` at an event they do not control — the
-- row would pass the read test on the way in and land somewhere else.

begin;

-- ── lineup_members ──────────────────────────────────────────────────────────
drop policy if exists "Host can insert lineup_members" on public.lineup_members;
drop policy if exists "Host can update lineup_members" on public.lineup_members;
drop policy if exists "Host can delete lineup_members" on public.lineup_members;

create policy "owner can insert lineup_members" on public.lineup_members
  for insert with check (
    exists (
      select 1 from public.events e
      where e.id = lineup_members.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

create policy "owner can update lineup_members" on public.lineup_members
  for update using (
    exists (
      select 1 from public.events e
      where e.id = lineup_members.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  ) with check (
    exists (
      select 1 from public.events e
      where e.id = lineup_members.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

create policy "owner can delete lineup_members" on public.lineup_members
  for delete using (
    exists (
      select 1 from public.events e
      where e.id = lineup_members.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

-- ── performances ────────────────────────────────────────────────────────────
-- ⛔ "Artist can update own performance status" is deliberately LEFT IN PLACE.
-- It is how an act accepts or declines an offer. Two permissive policies on one
-- command OR together, which is the intended reading here: the host may edit
-- the running order, and the act may answer its own slot.
drop policy if exists "Host can insert performances" on public.performances;
drop policy if exists "Host can update performances" on public.performances;
drop policy if exists "Host can delete performances" on public.performances;

create policy "owner can insert performances" on public.performances
  for insert with check (
    exists (
      select 1 from public.events e
      where e.id = performances.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

create policy "owner can update performances" on public.performances
  for update using (
    exists (
      select 1 from public.events e
      where e.id = performances.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  ) with check (
    exists (
      select 1 from public.events e
      where e.id = performances.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

create policy "owner can delete performances" on public.performances
  for delete using (
    exists (
      select 1 from public.events e
      where e.id = performances.event_id
        and (e.host_id = auth.uid() or public.can_act_as(e.owner_profile_id))
    )
  );

commit;
