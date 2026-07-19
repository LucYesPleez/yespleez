-- ============================================================
-- M14d — VENUE REPAIR, PART 1: clear untruthful links  (DATA ONLY)
-- ============================================================
--
-- Run ALONE, after M14c. One responsibility.
--
-- Invariant this migration moves toward:
--   **Every venue_profile_id either identifies the hosting venue,
--     or is NULL.**  (identity v1.3 O-R4 — location is optional)
--
-- Completed by M14e, which handles the one curated alias. This
-- migration deliberately does NOT touch those rows.
--
-- ── WHY THESE ROWS ARE WRONG ──
--
-- `CreateEventScreen` wrote venue_profile_id from
-- `resolveProfileId(session.user.id, 'venue')` — the CREATOR's own
-- venue profile — rather than the venue the event happens at. Every
-- event created by an account owning a venue inherited that venue
-- regardless of location. Fixed at source on 18 Jul 2026 (a3a1ea7);
-- this repairs the rows it produced. Recorded as erratum E3.
--
-- ── DRY RUN (read-only, 18 Jul 2026) ──
--
--   24 events, ALL pointing at venue profile "Elbows Rest"
--    1 already correct         — config.venue genuinely is Elbows Rest
--    8 "Bellingen Brewery"     — curated alias, handled by M14e
--   15 no venue profile exists — this migration
--
--   The 15, by venue named in config.venue:
--     10  Bellingen Memorial Hall
--      1  Tabbouleh RSL
--      1  The Old Supper Room
--      1  Vabooshna
--      1  Dorrigo Showgrounds
--      1  Multiple Venues
--
-- ── WHY NULL RATHER THAN A GUESS ──
--
-- No venue profile exists for any of these places. NULL is not a
-- degraded answer here — it is the correct one. `O-R4` makes the venue
-- link optional precisely because warehouses, parks, house shows and
-- multi-room festivals exist, and "Multiple Venues" above is a live
-- example: no single venue profile could ever be right for it.
--
-- A truthful NULL is strictly better than a plausible link the
-- platform would then treat as authoritative. These become correct
-- links when Studio creates the venue profiles, via ordinary editing
-- — not by inference now.
--
-- ── THE SET IS DERIVED, NOT LISTED ──
--
-- No event ids are hardcoded. The statement clears any link whose
-- target profile's name does not match the event's own stated venue,
-- excluding the alias M14e owns. If the dry run's arithmetic were
-- somehow wrong, this affects the rows that are actually inconsistent
-- rather than a list captured at a point in time.
-- ============================================================


UPDATE public.events e
SET venue_profile_id = NULL
WHERE e.venue_profile_id IS NOT NULL
  -- the linked profile does not match what the event says its venue is
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = e.venue_profile_id
      AND regexp_replace(lower(btrim(p.name)),            '\s+', ' ', 'g')
        = regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+', ' ', 'g')
  )
  -- leave the curated alias to M14e
  AND regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+', ' ', 'g')
      <> 'bellingen brewery';

-- Expect: UPDATE 15


-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1. Expect 24 | 9 | 15 — nine still linked (1 correct + 8 alias rows
--    awaiting M14e), fifteen now honestly NULL:
--
--      SELECT count(*)                                          AS total,
--             count(venue_profile_id)                           AS linked,
--             count(*) FILTER (WHERE venue_profile_id IS NULL)  AS unlinked
--      FROM public.events;
--
-- 2. Every REMAINING link is either truthful or the pending alias.
--    Expect 0:
--
--      SELECT count(*) AS untruthful_links
--      FROM public.events e
--      JOIN public.profiles p ON p.id = e.venue_profile_id
--      WHERE regexp_replace(lower(btrim(p.name)), '\s+',' ','g')
--         <> regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+',' ','g')
--        AND regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+',' ','g')
--            <> 'bellingen brewery';
--
-- 3. Ownership is untouched by this migration. Expect 24 | 24 | 0:
--
--      SELECT count(*) AS total, count(owner_profile_id) AS owned,
--             count(*) FILTER (WHERE owner_profile_id IS NULL) AS unowned
--      FROM public.events;
--
--    M14c's invariant must survive M14d. If it does not, something
--    touched a column this migration never names.
-- ============================================================
