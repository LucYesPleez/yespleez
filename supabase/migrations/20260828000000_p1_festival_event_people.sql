-- P1 · THE ROSTER — one row per PERSON, many roles.
--
-- ⭐⭐ PEOPLE IS THE FIRST SCREEN THAT WOULD BE WRONG WITHOUT PARTICIPATION.
-- `participation` already answers "who is part of this event", and the
-- organiser can read its own event's rows directly (participation_read_
-- counterparty). So why an RPC at all? Two reasons the client cannot solve:
--
-- ⭐⭐ 1. A VOLUNTEER'S ROW NAMES NOBODY. `profile_id` is NULL for a volunteer
-- BY DESIGN — they participate as the PERSON, not an identity (M2a). The row
-- carries `user_id`, and user_id is NOT an identity: on 2026-08-28 the owner's
-- account had SEVEN profiles behind one `user_id`. Resolving a name from it is
-- not a join a screen may invent — it is a platform rule, and the rule is: the
-- person is their `punter` profile. ⛔ Putting that in the organiser's tool
-- would be a second copy of knowledge M2a deliberately keeps in the database.
--
-- ⭐ 2. THE ORGANISER CANNOT SELECT PROFILES BY user_id. Nothing grants a
-- festival owner the right to enumerate somebody's other identities, and it
-- must stay that way — an organiser learning that their volunteer is also a
-- band and a venue is exactly the cross-identity leak the model forbids. This
-- function returns ONE resolved name per person and nothing else about them.
--
-- ⭐⭐ ONE ROW PER PERSON, MANY ROLES — the ratified law (FESTIVAL_UX_v1 §6).
-- ⛔ Never one row per role: two rows makes an organiser ask "have I already
-- dealt with this person?", and they get chased twice. So the roles aggregate
-- into an array and the person is the unit.
--
-- ⛔ NO READINESS HERE. Readiness is derived per participant type and is its
-- own surface; nobody ever marks a person Ready. This returns FACTS ONLY.
--
-- ⚠⚠ AN EARLIER REVISION OF THIS FILE FAILED TO CREATE, silently as far as the
-- app was concerned — the RPC probe answered PGRST202 and `pg_proc` had no row.
-- Two causes, both removed here and worth not reintroducing:
--   ⛔ a CTE named `rows` — ROWS is keyword-adjacent (window frames) and is not
--     safe as a bare relation alias;
--   ⛔ RETURNS TABLE output names reused as column references in the body —
--     plpgsql treats `person_key`, `location` and `roles` as variables in
--     scope, so every mention is ambiguous.
-- ⭐ The body now uses DISTINCT internal names and declares its conflict rule
-- explicitly, so no identifier means two things.

DROP FUNCTION IF EXISTS public.festival_event_people(uuid);

CREATE OR REPLACE FUNCTION public.festival_event_people(p_event_id uuid)
RETURNS TABLE (
  person_key   text,
  display_name text,
  location     text,
  -- ⭐ One entry per participation row this person holds on this event:
  --   { participationId, participantType, status, profileId, since }
  -- ⚠ An ARRAY, not a joined string. The caller renders a chip per role and
  -- must never parse a delimiter back apart.
  roles        jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  -- ⛔ THE GATE IS FIRST AND IT IS THE SAME ONE THE RLS POLICY USES. A
  -- SECURITY DEFINER function bypasses RLS entirely, so this check IS the
  -- access control, not a convenience.
  IF NOT public.owns_festival_event(p_event_id) THEN
    RAISE EXCEPTION 'festival_event_people: not the owner of event %', p_event_id;
  END IF;

  RETURN QUERY
  WITH participant AS (
    SELECT
      pt.id                AS pid,
      pt.user_id           AS uid,
      pt.profile_id        AS prof_id,
      pt.participant_type  AS ptype,
      pt.status            AS pstatus,
      pt.created_at        AS since,
      pt.visibility_rank   AS vrank,
      -- ⭐ THE PERSON, not the row. An account is one person however many
      -- profiles it holds. ⚠ `user_id` is NULLABLE — erasure severs the person
      -- from the record without deleting it (M2's SET NULL), and two severed
      -- rows are NOT the same person. So a severed row keys on its own id and
      -- stays a row of its own rather than merging with every other orphan.
      COALESCE('u:' || pt.user_id::text, 'p:' || pt.id::text) AS pkey
      FROM public.participation pt
     WHERE pt.event_id = p_event_id
       -- ⛔ PARTICIPATION BEGINS AT ACCEPTED. Everything before it is still an
       -- application and belongs to the Applications room; `invited` is a real
       -- participation status but the person has not agreed to anything yet.
       -- ⚠ Withdrawn and cancelled STAY: a roster that silently drops someone
       -- who pulled out tells the organiser nothing happened.
       AND pt.status <> 'invited'
  ),
  named AS (
    SELECT
      c.*,
      -- ⭐⭐ THE NAME RESOLUTION, in priority order:
      --   1. the identity they participated under, when there is one
      --   2. otherwise the person's `punter` profile — the account itself
      -- ⚠ ORDER BY + LIMIT 1, not a bare pick: an account could hold more than
      -- one punter row through some past defect, and an unordered choice would
      -- make the roster's names change between refreshes.
      COALESCE(
        (SELECT pr.name FROM public.profiles pr WHERE pr.id = c.prof_id),
        (SELECT pr.name FROM public.profiles pr
          WHERE pr.user_id = c.uid AND pr.type = 'punter'
          ORDER BY pr.created_at ASC NULLS LAST, pr.id ASC
          LIMIT 1)
      ) AS rname,
      COALESCE(
        (SELECT pr.location FROM public.profiles pr WHERE pr.id = c.prof_id),
        (SELECT pr.location FROM public.profiles pr
          WHERE pr.user_id = c.uid AND pr.type = 'punter'
          ORDER BY pr.created_at ASC NULLS LAST, pr.id ASC
          LIMIT 1)
      ) AS rloc
      FROM participant c
  ),
  person AS (
    SELECT
      n.pkey,
      -- ⭐⭐ THE MOST VISIBLE IDENTITY SUPPLIES THE NAME. A person holding two
      -- roles has two candidate names — the artist profile they performed
      -- under and the punter profile they volunteered as — and the roster shows
      -- one. The rule is visibility_rank DESC: an artist credit (40) outranks a
      -- volunteer row (10), which is also how the ratified spec's own example
      -- renders ("Lucious · Performer · Volunteer").
      --
      -- ⛔⛔ IT WAS `MAX(n.rname)` AND THAT WAS AN ACCIDENT, NOT A RULE. MAX over
      -- text picks the lexicographically largest string: 'Lucious' beat 'Luc'
      -- and looked perfect on the real data, but an artist profile named
      -- 'Aardvark' would have made the same roster read 'Luc'. ⚠ The output was
      -- IDENTICAL before and after this fix, so the screen could not prove it —
      -- `prosrc LIKE '%array_agg%'` was the discriminator.
      --
      -- ⭐ FILTER skips NULLs rather than letting them win, and [1] takes the
      -- first survivor. ⛔ NEVER A FABRICATED NAME: an unclaimed or erased
      -- person resolves to NULL all the way through and the caller renders that
      -- absence honestly.
      (array_agg(n.rname ORDER BY n.vrank DESC, n.since ASC)
         FILTER (WHERE n.rname IS NOT NULL))[1] AS pname,
      (array_agg(n.rloc  ORDER BY n.vrank DESC, n.since ASC)
         FILTER (WHERE n.rloc  IS NOT NULL))[1] AS ploc,
      jsonb_agg(
        jsonb_build_object(
          'participationId', n.pid,
          'participantType', n.ptype,
          'status',          n.pstatus,
          'profileId',       n.prof_id,
          'since',           n.since
        )
        -- ⭐ A STABLE ORDER inside the array too, so a person's chips do not
        -- reshuffle between loads — most visible role first, matching the name.
        ORDER BY n.vrank DESC, n.ptype, n.since
      ) AS role_list
      FROM named n
     GROUP BY n.pkey
  )
  SELECT p.pkey, p.pname, p.ploc, p.role_list
    FROM person p
   -- ⭐ Nameless last, then alphabetical. ⛔ Not by created_at: a roster is
   -- read by looking somebody up, not by when they were added.
   ORDER BY (p.pname IS NULL), p.pname ASC;
END; $$;

REVOKE ALL ON FUNCTION public.festival_event_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.festival_event_people(uuid) TO authenticated;

COMMENT ON FUNCTION public.festival_event_people(uuid) IS
  'The People roster for one event: one row per PERSON with their roles aggregated. Owner-gated.';

-- ⭐ PostgREST resolves RPCs from a cached schema. A function that exists but
-- answers PGRST202 is a stale cache, not a missing function — reload it here so
-- the app can call this the moment the migration finishes.
NOTIFY pgrst, 'reload schema';
