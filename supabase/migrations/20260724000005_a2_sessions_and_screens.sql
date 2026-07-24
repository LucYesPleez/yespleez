-- ============================================================
-- A2 · SESSIONS, SCREEN VIEWS, DURATION AND ERRORS
-- Requires: 20260724000001_a1_usage_events.sql
--
-- ✅ APPLIED 2026-07-24, verified: the name CHECK is now
--    `usage_events_name_check` and session_id exists as a nullable uuid.
-- ============================================================
--
-- ── WHY THIS SHIPS BEFORE THE DEPLOY, NOT AFTER ─────────────────
--
-- A1 records WHAT people do. This records the SHAPE of a visit — which
-- screens, in what order, for how long, and where it broke. Every metric in
-- docs/analytics-vision-2026-07.md that answers "why" rather than "how many"
-- rests on these four additions, and NONE of them can be backfilled: a
-- session nobody recorded is gone forever. Dashboards can wait for data;
-- data cannot wait for dashboards.
--
-- ── WHAT A1 SAID IT WOULD NOT DO, AND WHY THAT CHANGED ──────────
--
-- A1 §6 declared "NO SESSION DURATION, NO HEARTBEAT" and "NO PER-SCREEN VIEW
-- TRACKING", on the grounds that both were high volume for insight nobody
-- was acting on during a friends beta. That was right then and is wrong now:
-- the analytics vision was ratified 24 Jul and names the activation funnel,
-- empty-first-impressions and abandoned flows as Essential — every one of
-- which needs screens and sessions.
--
-- The volume objection stands and is answered rather than dismissed:
--   · NO HEARTBEAT still. Duration is measured at the moment of leaving, not
--     by a timer ticking rows while a tab sits open. One row per departure,
--     not one per minute.
--   · Screen views are the volume: expect ~10-40 rows per session where A1
--     produced 1-3. That is the deliberate cost. When it starts to hurt, the
--     fix is rollups or an RPC — not fewer screens.
--
-- ── PRIVACY: THE PATH IS NORMALISED BEFORE IT IS SENT ───────────
--
-- The client sends '/profile/:id', NEVER '/profile/9d4ad715-...'. Raw paths
-- carry the identity of the thing being looked at, and a table of "who
-- viewed which profile when" is exactly the named browsing history the
-- ratified privacy rule forbids. Normalising is therefore not tidiness, it
-- is the control — and it is applied in the client so an un-normalised path
-- never leaves the device.
--
-- Governing rule (docs/analytics-vision-2026-07.md §8): behaviour analytics
-- are anonymous by default; identifiable only for support, moderation, fraud,
-- or when the user initiated the interaction. `session_id` groups a visit
-- WITHOUT naming anyone — that is precisely its job.
-- ============================================================


-- ── 1 · THE SESSION COLUMN ──────────────────────────────────────
--
-- Nullable, deliberately: the 20 rows A1 already recorded predate sessions
-- and must not be invented. NULL means "recorded before sessions existed",
-- and any journey query should exclude it rather than treat it as one giant
-- session shared by every early row.
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS session_id uuid;

COMMENT ON COLUMN public.usage_events.session_id IS
  'A2 — groups events into one visit. Minted client-side per session and '
  'reset after the same 30-minute idle window that governs opened_app, so a '
  'session here means the same thing it means there. NULL on rows written '
  'before A2. Identifies a VISIT, never a person.';


-- ── 2 · THE NAME ALLOW-LIST GAINS THREE ─────────────────────────
--
-- The A1 constraint was declared inline, so Postgres named it. Rather than
-- guess that name (this project has already lost two migrations to guessed
-- schema facts), find it by its definition and drop it, then re-add with an
-- explicit name so the next migration can rely on one.
DO $dropcheck$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.usage_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%opened_app%';

  IF cname IS NULL THEN
    RAISE EXCEPTION 'A2 ABORTED: could not find the A1 name CHECK on usage_events — apply A1 first';
  END IF;

  EXECUTE format('ALTER TABLE public.usage_events DROP CONSTRAINT %I', cname);
  RAISE NOTICE 'A2: dropped the A1 name constraint (%)', cname;
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
    -- A2 · the shape of a visit
    'screen_view',    -- props.path, ALREADY NORMALISED: '/event/:id'
    'session_end',    -- props.duration_s — see the note in §4
    'error'           -- props.name / message / screen
  ));


-- ── 3 · INDEX FOR JOURNEY RECONSTRUCTION ────────────────────────
-- Every behaviour query is "give me this session's events in order".
-- Partial: rows predating A2 carry no session and would only bloat it.
CREATE INDEX IF NOT EXISTS usage_events_session_idx
  ON public.usage_events (session_id, created_at)
  WHERE session_id IS NOT NULL;


-- ── 4 · HOW TO READ session_end — TAKE THE MAX, NOT THE SUM ─────
--
-- ⚠ A SESSION CAN EMIT MORE THAN ONE session_end ROW, AND THAT IS CORRECT.
--
-- Duration is recorded when the app is BACKGROUNDED (visibilitychange /
-- pagehide), because on mobile there is frequently no later opportunity —
-- iOS in particular may never fire another event once a tab is discarded.
-- Someone who switches away three times during one visit therefore produces
-- three rows, each carrying the elapsed time SINCE THE SESSION STARTED, not
-- since the last one.
--
-- So the length of a session is:
--
--     SELECT session_id, max((props->>'duration_s')::int) AS seconds
--       FROM public.usage_events
--      WHERE name = 'session_end' AND session_id IS NOT NULL
--      GROUP BY session_id;
--
-- SUM would multiply every session by how often the user changed apps —
-- a number that looks plausible and is wildly wrong. Cumulative-from-start
-- was chosen precisely so that a lost final row costs accuracy rather than
-- the whole measurement.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · the column exists, is nullable, and no existing row was invented a
--      session it never had.
DO $v1$
DECLARE c record; n bigint;
BEGIN
  SELECT is_nullable, data_type INTO c
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'usage_events'
     AND column_name = 'session_id';

  IF c IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: usage_events.session_id does not exist';
  END IF;
  IF c.is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'V1 FAILED: session_id is NOT NULL — pre-A2 rows would need a fabricated session';
  END IF;
  IF c.data_type <> 'uuid' THEN
    RAISE EXCEPTION 'V1 FAILED: session_id is %, expected uuid', c.data_type;
  END IF;

  SELECT count(*) INTO n FROM public.usage_events WHERE session_id IS NOT NULL;
  RAISE NOTICE 'V1 PASSED: session_id exists (uuid, nullable); % row(s) already carry one', n;
END $v1$;

-- V2 · every name the client can now send is accepted, and the three new
--      ones specifically. Asserts the contract, not merely "a CHECK exists".
DO $v2$
DECLARE
  expected text[] := ARRAY[
    'opened_app','signed_up',
    'install_prompt_shown','install_prompt_accepted','install_prompt_dismissed','installed_pwa',
    'created_event','published_event','applied','sent_message','sent_voicey','followed','shared',
    'screen_view','session_end','error'
  ];
  nm text; def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.usage_events'::regclass
     AND conname = 'usage_events_name_check';

  IF def IS NULL THEN
    RAISE EXCEPTION 'V2 FAILED: usage_events_name_check does not exist — the rename did not happen';
  END IF;

  FOREACH nm IN ARRAY expected LOOP
    IF position('''' || nm || '''' in def) = 0 THEN
      RAISE EXCEPTION 'V2 FAILED: % is missing from the CHECK — every row carrying it would be rejected', nm;
    END IF;
  END LOOP;

  RAISE NOTICE 'V2 PASSED: all % event names accepted, including screen_view/session_end/error',
    array_length(expected, 1);
END $v2$;

-- V3 · THE NEW NAMES ACTUALLY INSERT, and an unknown one is still refused.
--      Provoke-and-assert: passing means the rejection happened, not that
--      nothing was tried. Cleans up after itself.
DO $v3$
DECLARE sid uuid := gen_random_uuid(); n bigint;
BEGIN
  INSERT INTO public.usage_events (device_id, session_id, name, display_mode, platform, props)
  VALUES
    ('00000000-0000-0000-0000-000000000000', sid, 'screen_view', 'browser', 'desktop', '{"path":"/event/:id"}'),
    ('00000000-0000-0000-0000-000000000000', sid, 'session_end', 'browser', 'desktop', '{"duration_s":42}'),
    ('00000000-0000-0000-0000-000000000000', sid, 'error',       'browser', 'desktop', '{"name":"TypeError"}');

  SELECT count(*) INTO n FROM public.usage_events WHERE session_id = sid;
  IF n <> 3 THEN
    RAISE EXCEPTION 'V3 FAILED: expected 3 A2 rows to insert, got %', n;
  END IF;

  BEGIN
    INSERT INTO public.usage_events (device_id, name, display_mode, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', 'not_a_real_event', 'browser', 'desktop');
    RAISE EXCEPTION 'V3 FAILED: an unknown event name was ACCEPTED — the allow-list stopped enforcing';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- intended
  END;

  DELETE FROM public.usage_events WHERE session_id = sid;
  IF EXISTS (SELECT 1 FROM public.usage_events WHERE session_id = sid) THEN
    RAISE EXCEPTION 'V3 FAILED: cleanup left rows behind';
  END IF;

  RAISE NOTICE 'V3 PASSED: screen_view/session_end/error insert; unknown names still refused; no debris';
END $v3$;

-- V4 · A1's guarantees survive the constraint swap. The table must still be
--      append-only and unreadable with the public key — a DROP CONSTRAINT is
--      exactly the kind of edit that quietly loosens something else.
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
    RAISE EXCEPTION 'V4 FAILED: anon can SELECT usage_events — behaviour data readable with the public key';
  END IF;
  IF NOT has_table_privilege('anon', 'public.usage_events', 'INSERT') THEN
    RAISE EXCEPTION 'V4 FAILED: anon lost INSERT — signed-out visitors would record nothing';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.usage_events', 'SELECT') THEN
    RAISE EXCEPTION 'V4 FAILED: service_role cannot SELECT — Studio would have nothing to read';
  END IF;

  RAISE NOTICE 'V4 PASSED: still append-only, still unreadable with the anon key';
END $v4$;
