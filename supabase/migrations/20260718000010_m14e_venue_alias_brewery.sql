-- ============================================================
-- M14e — VENUE REPAIR, PART 2: one approved alias  (DATA ONLY)
-- ============================================================
--
-- Run ALONE, after M14d. One responsibility, and it rests on a
-- different kind of evidence from every other migration in this
-- series — which is why it is separate.
--
-- ── ⚠ THIS MIGRATION ENCODES A HUMAN DECISION, NOT A DERIVED FACT ──
--
-- Every other migration here asserts something the data proves. This
-- one asserts something a person decided:
--
--   **"Bellingen Brewery" is an accepted alias of
--     "The Bellingen Brewing Co".**
--
--   Approved by: the owner
--   Approved on: 18 Jul 2026
--   Basis:       the same physical venue. The events name it
--                colloquially; the profile carries the registered
--                trading name.
--
-- It is recorded here in full because in three years someone will read
-- these eight rows, see a link between two differently-named records,
-- and need to know whether it was a decision or a bug. **It was a
-- decision.** No fuzzy matching, no similarity threshold, no heuristic
-- ran — the alias is a single curated string approved by a human, and
-- nothing generalises from it. A second alias requires a second
-- approval and a second migration.
--
-- ── WHY IT IS NOT PART OF M14d ──
--
-- M14d clears links the data proves untruthful. This creates a link
-- the data alone does not support. Merging them would file an
-- inference under the same evidence standard as a fact, and neither
-- rollback nor the migration log would tell them apart afterwards.
--
-- ── DRY RUN (read-only, 18 Jul 2026) ──
--
--   8 events name their venue "Bellingen Brewery"
--   0 venue profiles carry that exact name
--   1 venue profile is "The Bellingen Brewing Co"
--     (4e77c0ae-9e05-4c79-853b-3edae1aab865)
--
-- Exact-name matching sends all 8 to NULL. That would be defensible
-- and, per the owner, wrong: these are the events of the first venue
-- client, and the link is real.
-- ============================================================


-- ── Pre-flight: the target must exist and be a venue ──
-- The FK catches a missing profile. It does not catch linking eight
-- events to an artist or host profile, which would look like a clean
-- run and misattribute a real client's venue.
DO $$
DECLARE
  t_type text;
  t_name text;
BEGIN
  SELECT type, name INTO t_type, t_name
  FROM public.profiles
  WHERE id = '4e77c0ae-9e05-4c79-853b-3edae1aab865';

  IF t_type IS NULL THEN
    RAISE EXCEPTION 'M14e: target venue profile 4e77c0ae-… does not exist. Re-run the dry run.';
  END IF;
  IF t_type <> 'venue' THEN
    RAISE EXCEPTION 'M14e: target profile is type %, expected venue. Aborting.', t_type;
  END IF;
  RAISE NOTICE 'M14e: linking "Bellingen Brewery" events to venue profile "%"', t_name;
END $$;


-- ── The approved alias ──
UPDATE public.events e
SET venue_profile_id = '4e77c0ae-9e05-4c79-853b-3edae1aab865'
WHERE regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+', ' ', 'g')
      = 'bellingen brewery';

-- Expect: UPDATE 8


-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1. Exactly the alias rows are linked to the Brewing Co. Expect 8:
--
--      SELECT count(*) AS linked_to_brewery
--      FROM public.events
--      WHERE venue_profile_id = '4e77c0ae-9e05-4c79-853b-3edae1aab865';
--
-- 2. The invariant is now complete — every remaining link is either
--    name-truthful or the approved alias. Expect 0:
--
--      SELECT count(*) AS unexplained_links
--      FROM public.events e
--      JOIN public.profiles p ON p.id = e.venue_profile_id
--      WHERE regexp_replace(lower(btrim(p.name)), '\s+',' ','g')
--         <> regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+',' ','g')
--        AND regexp_replace(lower(btrim(e.config ->> 'venue')), '\s+',' ','g')
--            <> 'bellingen brewery';
--
-- 3. Final state across both venue migrations. Expect 24 | 9 | 15:
--
--      SELECT count(*)                                         AS total,
--             count(venue_profile_id)                          AS linked,
--             count(*) FILTER (WHERE venue_profile_id IS NULL) AS unlinked
--      FROM public.events;
--
--    9 linked = 1 already-correct + 8 alias. 15 honestly NULL until
--    Studio creates those venue profiles.
--
-- 4. Ownership still untouched. Expect 24 | 24 | 0:
--
--      SELECT count(*) AS total, count(owner_profile_id) AS owned,
--             count(*) FILTER (WHERE owner_profile_id IS NULL) AS unowned
--      FROM public.events;
-- ============================================================
