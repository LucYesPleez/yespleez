-- SEC-1 · ANONYMOUS CLIENTS COULD READ EVERY EVENT, INCLUDING UNPUBLISHED ONES.
--
-- Measured 2026-08-11 with the publishable key and no session: anon received
-- 78 of 78 event rows — byte-identical to what the service role returns. RLS
-- was filtering nothing. That included 4 drafts with `is_public = false`, with
-- their full `config` (unreleased event copy).
--
-- ⛔ THE CAUSE IS TWO PERMISSIVE POLICIES ON ONE TABLE. PostgreSQL ORs
-- permissive policies together, so the loosest one is the effective one:
--
--     "public read events"       USING (true)              <- wins, always
--     "public read live events"  USING (status = 'live')   <- never mattered
--
-- The narrow policy was not a gate; it was decoration sitting beside an open
-- door. ⚠ Whenever a table has more than one permissive SELECT policy, the
-- effective rule is the UNION, never the intersection.
--
-- ⭐ WHY THE REPLACEMENT NEEDS THE OWNER ARMS. 73 of 78 events have
-- `host_id = NULL` (Studio imports have no author) and 36 have no
-- `owner_profile_id`, so `status = 'live'` carries almost the whole catalogue.
-- The owner arms exist for the 5 authored events — without them the host
-- dashboard goes blank, which is the failure this migration must not cause.
--
-- ⛔ SELECT ONLY. No write policy is touched: `hosts manage own events`
-- (FOR ALL, `host_id = auth.uid()`) is deliberately left exactly as it was.

drop policy if exists "public read events"      on public.events;
drop policy if exists "public read live events" on public.events;

create policy "read live or own events" on public.events
  for select using (
    -- The public: published events only. `is_public` is NOT consulted here —
    -- it governs Discover listing, not row access, and a live event reached by
    -- direct link has always been readable.
    status = 'live'
    -- The author (pre-`owner_profile_id` events, and anything created in-app).
    or host_id = auth.uid()
    -- ⭐ The OWNER, which is where responsibility actually lives (identity
    -- v1.3 O-R4). A venue- or festival-owned event has no author.
    or owner_profile_id in (
      select id from public.profiles where user_id = auth.uid()
    )
  );
