-- SEC-2 · ANONYMOUS CLIENTS COULD READ UNANNOUNCED LINEUPS AND PENDING OFFERS.
--
-- ⚠ APPLY SEC-1 FIRST. This migration gates lineup and set-time rows on the
-- readability of their EVENT, so it assumes the event rule already exists.
--
-- Measured 2026-08-11 with the publishable key and no session: anon received
-- 149 of 149 `lineup_members` and 64 of 64 `performances` — again the whole
-- table. Both carried `USING (true)`. Concretely exposed:
--   · 13 artist names on the bills of unpublished events
--   · 12 set-time rows on unpublished events — 7 `offered`, 1 `declined`
--   · `offered` rows on LIVE events: artists invited who have not answered
--
-- ⭐⭐ AN OFFER IS NOT AN ANNOUNCEMENT (owner, 2026-08-11). "We have asked this
-- artist" is not public information until they say yes, and a `declined` row
-- is a private no. Only `accepted` slots on a live event are public.
--
-- ⛔ THE APP'S PRIVACY SWITCHES WERE NEVER A BOUNDARY. `showTimesPublicly` and
-- `privateSetTimes` live in `config` and are read by the UI alone; a direct API
-- call ignored them completely. A UI control is a presentation choice — RLS is
-- the boundary. This migration does NOT read those flags: they decide what the
-- page draws, not who may fetch the row.
--
-- ⚠⚠ THE ARTIST MUST STILL SEE THEIR OWN OFFER. `acceptSlotOffer`
-- (lib/notifActions.js) SELECTS the performance before updating it, so an act
-- that cannot read its own `offered` row cannot accept it. That arm is load
-- bearing — ⛔ removing it silently breaks accepting a slot.
--
-- ⛔ SELECT ONLY. Every host insert/update/delete policy is left untouched.

-- ── lineup_members ──────────────────────────────────────────────────────────
drop policy if exists "Anyone can read lineup_members" on public.lineup_members;

create policy "read lineup for live or own events" on public.lineup_members
  for select using (
    exists (
      select 1 from public.events e
      where e.id = lineup_members.event_id
        and (
          e.status = 'live'
          or e.host_id = auth.uid()
          or e.owner_profile_id in (
            select id from public.profiles where user_id = auth.uid()
          )
        )
    )
    -- The act's own row, so a booking stays visible to the person booked even
    -- while the event is still a draft.
    or lineup_members.artist_id = auth.uid()
    or lineup_members.artist_profile_id in (
      select id from public.profiles where user_id = auth.uid()
    )
  );

-- ── performances (set times) ────────────────────────────────────────────────
drop policy if exists "Anyone can read performances" on public.performances;

create policy "read confirmed set times, own offers, or own events" on public.performances
  for select using (
    -- ⭐ THE ACT'S OWN SLOT, WHATEVER ITS STATUS. Required to accept or decline
    -- an offer — see the note above.
    exists (
      select 1 from public.lineup_members m
      where m.id = performances.lineup_member_id
        and (
          m.artist_id = auth.uid()
          or m.artist_profile_id in (
            select id from public.profiles where user_id = auth.uid()
          )
        )
    )
    -- The event's owner, at any status — this is their running order.
    or exists (
      select 1 from public.events e
      where e.id = performances.event_id
        and (
          e.host_id = auth.uid()
          or e.owner_profile_id in (
            select id from public.profiles where user_id = auth.uid()
          )
        )
    )
    -- ⭐ THE PUBLIC: confirmed slots on published events, and nothing else.
    -- ⛔ `offered`, `draft` and `declined` never reach this arm.
    or (
      performances.status = 'accepted'
      and exists (
        select 1 from public.events e
        where e.id = performances.event_id and e.status = 'live'
      )
    )
  );
