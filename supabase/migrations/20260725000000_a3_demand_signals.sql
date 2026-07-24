-- ============================================================
-- A3 · DEMAND SIGNALS — what people ask the scene for
-- Requires: 20260724000005_a2_sessions_and_screens.sql
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
-- ============================================================
--
-- ── WHY THIS IS STILL PRE-DEPLOY WORK ───────────────────────────
--
-- A1 records what people DO. A2 records the SHAPE of a visit. This records
-- what they ASKED FOR and did not necessarily get — and it is the missing
-- half of the signature feature.
--
-- docs/analytics-vision-2026-07.md §12 names Scene Pulse + the Unclaimed
-- Value board as the loop the whole product steers by: demand tells you what
-- to import, importing creates unclaimed profiles, accrued value tells you
-- who to invite. The worked example in §9 is "Techno filter use is up 3x in
-- Coffs this month. Supply there: one event. Import target."
--
-- SUPPLY is already knowable — it is the events and profiles table, and it
-- can be counted retroactively at any time. DEMAND is not. Nobody can ever
-- reconstruct that eleven people filtered for techno in Coffs last March.
-- So this joins A2 on the unbackfillable list, and ships before the deploy
-- for exactly the same reason.
--
-- ── ONE EVENT, TWO SURFACES ─────────────────────────────────────
--
-- `filtered` covers both places demand is expressed, distinguished by
-- props.surface:
--
--   'whats_on'  the home tab's category chips — the highest-traffic surface
--   'discover'  the search box and the full filter panel
--
-- One name rather than two because every Scene Pulse query wants BOTH ("how
-- much techno demand, anywhere in the app"), and a UNION of two event names
-- is a query people forget to write. Splitting by surface stays available as
-- a WHERE clause; combining two names does not stay available at all once a
-- dashboard is written against only one of them.
--
-- ── PRIVACY: WHAT A SEARCH IS ALLOWED TO SAY ────────────────────
--
-- ⚠ THE TYPED QUERY TEXT IS NEVER RECORDED. Not truncated, not hashed —
-- never sent. §8 of the vision doc names "typed search text" in the Never
-- list alongside message contents and precise location, and a search box is
-- precisely where people type things they would not post. What is recorded
-- is `has_query: true` — that a search happened, never what it said.
--
-- The location field is free text too ("City, suburb or postcode"), so it
-- gets the same treatment as A2's paths: normalised in the CLIENT against a
-- CLOSED VOCABULARY before anything is sent. An input that resolves to a
-- known Australian postcode is recorded as that postcode; anything else is
-- recorded as `region_unresolved: true` and the text itself never leaves the
-- device. That flag is not consolation — a location real people type that
-- the app cannot resolve is a gap in SUBURB_MAP worth fixing.
--
-- Postcode-level region is the INTENDED granularity, not a compromise: §12's
-- whole example is town-level ("in Coffs"). It is a search facet the user
-- typed, not device geolocation, which remains forbidden.
--
-- ── ⚠ `_intent` PROPS: FILTERS THE UI COLLECTS BUT DOES NOT APPLY ──
--
-- Found while instrumenting, and it changes how this data must be read.
-- These controls are rendered, are settable, and DO NOT FILTER ANYTHING:
--
--   DiscoverScreen   dateFilter, nearMe, radius  (radius is display-only;
--                    dateFilter only flips `isFiltered` and the badge count)
--   WhatsOnScreen    postcode, radius            (only `category` filters)
--
-- Recording those as ordinary facets would make every row assert something
-- false — `{date: 'weekend', results: 12}` reads as "12 events matched the
-- weekend" when nothing filtered by date at all. But dropping them would
-- discard real, unbackfillable demand: someone asking for weekend events
-- wants weekend events whether or not the app honoured it.
--
-- So they are recorded under names that cannot be mistaken for applied
-- filters — `date_intent`, `near_me_intent`, `region_intent` — and the
-- contract is:
--
--   *_intent  = the user ASKED for this. It did NOT shape `results`.
--   everything else = actually applied to the query behind `results`.
--
-- WHEN THOSE FILTERS ARE FIXED, MOVE THE PROP RATHER THAN REDEFINING IT:
-- start writing `date` and stop writing `date_intent`, so the time series
-- stays honest on both sides of the fix instead of one key silently changing
-- meaning halfway through its history.
-- ============================================================


-- ── 1 · THE NAME ALLOW-LIST GAINS ONE ───────────────────────────
--
-- A2 left the constraint explicitly named, so unlike A2 this can drop by
-- name. It still verifies the constraint was there first: a silent no-op
-- here would mean the new event name is rejected forever, invisibly, which
-- is the exact failure this allow-list exists to prevent.
DO $dropcheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.usage_events'::regclass
       AND conname  = 'usage_events_name_check'
  ) THEN
    RAISE EXCEPTION 'A3 ABORTED: usage_events_name_check not found — apply A2 first';
  END IF;

  ALTER TABLE public.usage_events DROP CONSTRAINT usage_events_name_check;
  RAISE NOTICE 'A3: dropped usage_events_name_check, re-adding with filtered';
END $dropcheck$;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_name_check CHECK (name IN (
    -- lifecycle (A1)
    'opened_app',
    'signed_up',
    -- install funnel (A1)
    'install_prompt_shown',
    'install_prompt_accepted',
    'install_prompt_dismissed',
    'installed_pwa',
    -- what people do (A1)
    'created_event',
    'published_event',
    'applied',
    'sent_message',
    'sent_voicey',
    'followed',
    'shared',
    -- the shape of a visit (A2)
    'screen_view',
    'session_end',
    'error',
    -- A3 · what people ASK for
    'filtered'        -- props.surface + the facets; NEVER the query text
  ));


-- ── 2 · INDEX FOR THE SCENE PULSE QUERY ─────────────────────────
--
-- Scene Pulse is always "demand for X in region Y over window Z", i.e. a
-- scan of `filtered` rows reaching into props. The existing
-- usage_events_name_created_idx already narrows by name and time; this adds
-- the jsonb containment path so genre/region predicates are indexed rather
-- than filtered row by row after the fact.
--
-- Partial on the one event name because props is jsonb on EVERY row — an
-- unqualified GIN index would cover thirteen event types that never carry a
-- genre, for no query anyone runs.
CREATE INDEX IF NOT EXISTS usage_events_filtered_props_idx
  ON public.usage_events USING gin (props)
  WHERE name = 'filtered';


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · every name the client can now send is accepted, `filtered` included,
--      and nothing A1/A2 relied on was dropped in the swap.
DO $v1$
DECLARE
  expected text[] := ARRAY[
    'opened_app','signed_up',
    'install_prompt_shown','install_prompt_accepted','install_prompt_dismissed','installed_pwa',
    'created_event','published_event','applied','sent_message','sent_voicey','followed','shared',
    'screen_view','session_end','error',
    'filtered'
  ];
  nm text; def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.usage_events'::regclass
     AND conname  = 'usage_events_name_check';

  IF def IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: usage_events_name_check is missing after the swap';
  END IF;

  FOREACH nm IN ARRAY expected LOOP
    IF position('''' || nm || '''' in def) = 0 THEN
      RAISE EXCEPTION 'V1 FAILED: % is missing from the CHECK — every row carrying it would be rejected', nm;
    END IF;
  END LOOP;

  RAISE NOTICE 'V1 PASSED: all % event names accepted, including filtered', array_length(expected, 1);
END $v1$;

-- V2 · a realistic demand row inserts, and an unknown name is still refused.
--      Provoke-and-assert; cleans up after itself.
DO $v2$
DECLARE sid uuid := gen_random_uuid(); n bigint;
BEGIN
  INSERT INTO public.usage_events (device_id, session_id, name, display_mode, platform, props)
  VALUES ('00000000-0000-0000-0000-000000000000', sid, 'filtered', 'browser', 'desktop',
          '{"surface":"discover","genre":"Techno","region":"2450","has_query":false,"results":1}');

  SELECT count(*) INTO n FROM public.usage_events WHERE session_id = sid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V2 FAILED: expected the filtered row to insert, got %', n;
  END IF;

  BEGIN
    INSERT INTO public.usage_events (device_id, name, display_mode, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', 'not_a_real_event', 'browser', 'desktop');
    RAISE EXCEPTION 'V2 FAILED: an unknown event name was ACCEPTED — the allow-list stopped enforcing';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- intended
  END;

  DELETE FROM public.usage_events WHERE session_id = sid;
  IF EXISTS (SELECT 1 FROM public.usage_events WHERE session_id = sid) THEN
    RAISE EXCEPTION 'V2 FAILED: cleanup left rows behind';
  END IF;

  RAISE NOTICE 'V2 PASSED: filtered inserts; unknown names still refused; no debris';
END $v2$;

-- V3 · the Scene Pulse index exists and is scoped to the one event name.
DO $v3$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'usage_events_filtered_props_idx';

  IF def IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: usage_events_filtered_props_idx does not exist';
  END IF;
  IF position('filtered' in def) = 0 THEN
    RAISE EXCEPTION 'V3 FAILED: the props index is not partial on name = filtered — it would cover 16 event types that carry no facets';
  END IF;

  RAISE NOTICE 'V3 PASSED: partial gin index on filtered props exists';
END $v3$;

-- V4 · A1's guarantees still hold. A DROP CONSTRAINT is exactly the kind of
--      edit that quietly loosens something adjacent, so this is re-asserted
--      on every migration that touches the table.
DO $v4$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'usage_events'
     AND cmd IN ('SELECT', 'UPDATE', 'DELETE');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V4 FAILED: % read/update/delete polic(ies) appeared on usage_events', n;
  END IF;

  IF has_table_privilege('anon', 'public.usage_events', 'SELECT') THEN
    RAISE EXCEPTION 'V4 FAILED: anon can SELECT usage_events — demand data readable with the public key';
  END IF;
  IF NOT has_table_privilege('anon', 'public.usage_events', 'INSERT') THEN
    RAISE EXCEPTION 'V4 FAILED: anon lost INSERT — signed-out visitors would record nothing, and guests browse the most';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.usage_events', 'SELECT') THEN
    RAISE EXCEPTION 'V4 FAILED: service_role cannot SELECT — Studio would have nothing to read';
  END IF;

  RAISE NOTICE 'V4 PASSED: still append-only, still unreadable with the anon key';
END $v4$;
