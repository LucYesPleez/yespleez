-- PE2 · THE PRIVATE TOGGLE BECOMES REAL, AND SHARES A DATE — NOT A DIARY
-- Requires: 20260821000002_pe1_personal_events_rls_recursion
--
-- ⚠⚠ BEFORE THIS, `is_private` DID NOTHING. It was written on save and read in
-- exactly two places, both of which chose a BADGE LABEL. No policy, no query
-- and no grant consulted it. A switch captioned "Only you can see this" that
-- changes a caption is the UI-privacy-switch failure the SEC-1 work named: a
-- control that looks like a boundary and is not one.
--
-- Owner's ruling, 2026-08-21: make it real. A non-private date becomes a
-- TENTATIVE DATE that other promoters can see, so the community can spot a
-- clash before two things land on the same night.
--
-- ── ⭐⭐ WHAT IS SHARED IS THE DATE, NOT THE ENTRY ────────────────────
--
-- ⛔ THE BASE TABLE STAYS SHUT. `personal_events` keeps the pe1 policy exactly
-- as it is — owner and invitees only — and anon is granted nothing on it. The
-- public surface is a VIEW that exposes THREE columns:
--
--     id            an opaque key, so a list can be rendered
--     event_date    the whole point
--     title         what may be happening
--
-- ⛔⛔ `notes` IS NEVER EXPOSED. The field is captioned "Any details, venue,
-- who's coming" — it is the one place a personal entry holds other people's
-- information, and no clash-detection need is served by publishing it.
-- ⛔ `user_id` is not exposed either: the date is the signal, and who is
-- holding it is theirs to say in the title if they want it said.
--
-- ⚠ THE VIEW IS THE BOUNDARY, so it is deliberately NOT security_invoker.
-- It runs with the definer's rights and applies `is_private = false` itself,
-- which is what lets anon read it while the base table stays closed. That
-- makes the WHERE clause load-bearing: ⛔ never widen it, and never add a
-- column here without asking what a stranger could do with it.

create or replace view public.tentative_dates
with (security_invoker = false)
as
  select id, event_date, title
  from public.personal_events
  where is_private = false
    and event_date >= (now() at time zone 'Australia/Sydney')::date;

comment on view public.tentative_dates is
  'Non-private personal dates, from today forward: id, date and title ONLY. The clash-detection surface for promoters. Deliberately excludes notes and user_id, and is the reason personal_events itself stays closed to anon.';

-- ⭐ Supabase auto-grants ALL to anon on new objects — the explicit reset is
-- the M1 lesson. Read-only, and only the view.
revoke all on public.tentative_dates from anon, authenticated;
grant select on public.tentative_dates to anon, authenticated;

-- ⚠ Only past dates ever leave the view, and only by the calendar moving on.
-- An entry is never rewritten or deleted by this migration.

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- anon sees ONLY non-private, future rows, and only three columns:
-- set role anon;
-- select * from public.tentative_dates;              -- expect the shared ones
-- select * from public.personal_events;              -- expect 42501, still shut
-- reset role;
--
-- -- and confirm nothing private leaked into the view:
-- select count(*) from public.tentative_dates t
--   join public.personal_events p on p.id = t.id
--  where p.is_private;                               -- expect 0
