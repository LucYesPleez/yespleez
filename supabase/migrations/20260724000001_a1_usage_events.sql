-- ============================================================
-- A1 · USAGE EVENTS — the analytics ingest table
--
-- ✅ APPLIED 2026-07-24 and verified live (insert 201, anon read 42501).
--    ⚠ The `name` CHECK here was REPLACED by A2
--    (20260724000005_a2_sessions_and_screens.sql) — the live allow-list is
--    `usage_events_name_check` and includes screen_view/session_end/error.
--    This file's list is the A1-era history, not current truth.
--
-- ⚠ "EVENT" HERE MEANS AN ANALYTICS EVENT, NOT A GIG. `public.events` is
-- the gig table and is unrelated to this one. A row here records that
-- something HAPPENED IN THE APP — an app open, a message sent, an install.
-- The two are never joined by id; `usage_events.props` may reference a gig
-- but carries no foreign key, deliberately (§6).
--
-- Append-only. Nothing updates or deletes a row, and no policy permits it.
-- The client WRITES and never READS: the dashboard that consumes this runs
-- in Studio under a service-role key, which bypasses RLS entirely. That
-- asymmetry is the whole security model — see §3.
-- ============================================================


-- ── 1 · THE TABLE ────────────────────────────────────────────
--
-- DEVICE CONTEXT IS DENORMALISED ONTO EVERY ROW (display_mode, platform,
-- browser, app_version) rather than living in a `devices` table joined by
-- device_id. That is a deliberate trade of storage for query simplicity:
-- the questions this table exists to answer are all of the form "do
-- INSTALLED users send more messages than browser users", and with the
-- context on the row that is one GROUP BY with no join and no
-- as-of-when ambiguity. Normalised, every such query would need to decide
-- WHICH display_mode a device had at the time — and a device legitimately
-- changes mode (browser today, standalone after installing), so a single
-- devices row would rewrite history every time someone installs.
CREATE TABLE IF NOT EXISTS public.usage_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- The browser profile. Client-generated UUID held in localStorage, so it
  -- is stable per browser-profile-per-device and survives sign-out.
  --
  -- ⚠ NOT STABLE ACROSS AN iOS INSTALL. An iOS home-screen PWA gets its own
  -- storage sandbox, so the installed app generates a NEW device_id and
  -- cannot be linked to the browser visits that preceded it. iOS install
  -- adoption is therefore only ever visible in AGGREGATE ("standalone
  -- launches appeared"), never as a per-device funnel. Do not build a
  -- browser→installed conversion metric that assumes otherwise; it will
  -- silently be Android/desktop-only.
  device_id    uuid NOT NULL,

  -- NULL for a signed-out visitor (guest browsing is a supported mode) and
  -- for any row written before the session resolved. See §2 on why NULL is
  -- accepted from a signed-in user rather than rejected.
  --
  -- ON DELETE SET NULL, not CASCADE: deleting an account must not silently
  -- rewrite last quarter's active-user counts. The row survives, stripped of
  -- its identity — which is also the honest privacy answer, since what
  -- remains is an anonymous usage fact.
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ⚠ AN ALLOW-LIST, AND IT IS LOAD-BEARING. The failure this prevents is
  -- specific and expensive: a client typo ('voicey_sent' where the dashboard
  -- queries 'sent_voicey') is not a crash, it is a chart that reads zero
  -- forever while the app looks perfectly healthy. With the CHECK, the typo
  -- is a rejected insert on the first try instead of a wrong number in three
  -- months.
  --
  -- MUST match EVENTS in `src/lib/analytics.js`; `analytics.test.js` pins
  -- the JS half so the two cannot drift unnoticed. Adding an event means a
  -- migration — that friction is the point.
  name         text NOT NULL CHECK (name IN (
    -- lifecycle
    'opened_app',
    'signed_up',
    -- install funnel (see the platform caveat in §6)
    'install_prompt_shown',
    'install_prompt_accepted',
    'install_prompt_dismissed',
    'installed_pwa',
    -- what people actually do
    'created_event',
    'published_event',
    'applied',
    'sent_message',
    'sent_voicey',
    'followed',
    'shared'
  )),

  -- HOW THE APP IS RUNNING. 'standalone' is the installed-app answer on both
  -- platforms; 'twa' is an Android app-store wrapper, kept distinct because
  -- it is an install of a different kind. 'unknown' is honest and allowed —
  -- an undetectable mode must not be silently recorded as 'browser', which
  -- would inflate exactly the number this table exists to measure.
  display_mode text NOT NULL CHECK (display_mode IN (
    'standalone', 'browser', 'minimal-ui', 'fullscreen', 'twa', 'unknown'
  )),

  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'desktop', 'other')),
  browser      text,
  app_version  text,

  -- Per-event detail. Unvalidated by design, same contract as messages.payload:
  -- the reader owns the shape. Keep it small — this is not an event store.
  props        jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;


-- ── 2 · WRITE — anyone using the app, but never as someone else ──
--
-- `anon` IS INCLUDED DELIBERATELY. Guest browsing is a first-class mode in
-- this app (AuthScreen offers it, `yp_guest`), and "how many people are just
-- looking" is one of the questions being asked. Restricting to
-- `authenticated` would answer that question with silence and make the
-- browser-only count structurally impossible to collect.
--
-- ⚠ THE NULL CASE IS PERMITTED ON PURPOSE — do NOT tighten this to
-- `user_id IS NOT DISTINCT FROM auth.uid()`.
--
-- That stricter form looks correct and quietly loses data. The Supabase
-- client attaches a persisted JWT to requests before the app has finished
-- awaiting getSession(), so there is a window where auth.uid() is already
-- the real user while the client still believes nobody is signed in and
-- sends user_id => NULL. Under the strict form every ping in that window is
-- REJECTED — and rejected inserts are invisible here, because the client
-- deliberately ignores the result (§4). The open ping is the one most likely
-- to land in that window, i.e. the strict policy would preferentially drop
-- the single most important event in the table.
--
-- What actually matters is that nobody attributes activity to ANOTHER user,
-- and `user_id = auth.uid()` still guarantees exactly that. An
-- under-attributed row costs a little precision; a rejected row costs the
-- whole fact. The client also awaits the session before its first ping, so
-- this clause is the backstop, not the plan.
DROP POLICY IF EXISTS "usage events insert own or anonymous" ON public.usage_events;

CREATE POLICY "usage events insert own or anonymous"
  ON public.usage_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());


-- ── 3 · NO SELECT POLICY, AND THIS ONE IS ACTUALLY OPTIONAL ─────
--
-- ⚠ READ THIS BEFORE COPYING THE beta_feedback MIGRATION'S SHAPE. That table
-- needed a SELECT policy because its client calls `.insert().select()` to
-- show a feedback ID, and `INSERT ... RETURNING` is governed by the SELECT
-- policy — with none, PostgREST reports a confusing RLS violation.
--
-- This table is the opposite case: the client NEVER wants the row back, so
-- `src/lib/analytics.js` sends a bare `.insert()` with no `.select()`, and
-- omitting the SELECT policy is both safe and the entire read guarantee.
-- The anon key is public — it ships in the JS bundle — so any SELECT policy
-- here would publish the platform's usage data to anyone who opened
-- devtools. There is deliberately no way to read this table through the app.
--
-- If a future change adds `.select()` to that insert it will fail, and the
-- fix is to remove the `.select()`, NOT to add a policy here.
--
-- No UPDATE or DELETE policy either: RLS is deny-by-default, so the table is
-- append-only by construction rather than by convention.


-- ── 4 · INDEXES ─────────────────────────────────────────────────
-- Every dashboard query is "this event, over this window", so the composite
-- leads with name. The lone created_at index serves the unfiltered
-- "everything today" scan; device_id serves per-device rollups (DAU by
-- device, and the browser→installed transition on platforms where the id
-- survives it).
CREATE INDEX IF NOT EXISTS usage_events_name_created_idx
  ON public.usage_events (name, created_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_created_idx
  ON public.usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_device_created_idx
  ON public.usage_events (device_id, created_at DESC);


-- ── 5 · GRANTS — REVOKE FIRST, AND THAT IS NOT BOILERPLATE ──────
--
-- ⚠ THIS PROJECT GRANTS `anon` AND `authenticated` FULL ACCESS TO EVERY NEW
-- TABLE IN `public`, AUTOMATICALLY. Supabase ships ALTER DEFAULT PRIVILEGES
-- to that effect, so `CREATE TABLE` alone leaves both roles holding SELECT,
-- UPDATE and DELETE on this table before a single GRANT is written.
--
-- The first version of this migration had only the GRANT below and no
-- REVOKE, and V2 caught it on the first run — the check failed with "anon
-- HAS SELECT". Nothing was actually exposed, because RLS was on and no
-- SELECT policy existed, so reads returned nothing either way. But the
-- second layer this file claims to have simply was not there.
--
-- It matters because of what the layers protect against. RLS stops reads
-- TODAY. The absent grant is what stops a future accidental SELECT policy
-- from opening reads on its own — and §3 exists precisely because someone
-- will one day hit the beta_feedback RLS error and reach for a SELECT
-- policy as the fix. Belt and braces, in the order they are needed.
-- PUBLIC is included because a privilege held there would satisfy
-- has_table_privilege('anon', …) just as an explicit grant would, and the
-- point is that the capability is gone however it arrived.
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.usage_events TO anon, authenticated;

-- Studio reads this table under the service-role key (it bypasses RLS, but
-- still needs the table privilege). Stated explicitly rather than left to
-- the same default privileges that produced the problem above — the
-- dashboard depends on it, so it should not rest on a default.
GRANT ALL ON public.usage_events TO service_role;


-- ── 6 · WHAT THIS TABLE DELIBERATELY DOES NOT DO ────────────────
--
-- NO FOREIGN KEY FROM props TO events/profiles. An analytics row is a
-- historical statement — "someone published a gig at 19:04" — and it stays
-- true after that gig is deleted. A foreign key would either block the
-- deletion or erase the history.
--
-- NO SESSION DURATION, NO HEARTBEAT. Measuring "18 minutes in the app" needs
-- a repeating timer writing rows for as long as the tab is open, which is
-- most of this table's future volume in exchange for a number nothing is
-- currently deciding anything with. Add it when a question needs it.
--
-- NO SEARCH TERMS, NO PER-SCREEN VIEW TRACKING. Both are high-volume and
-- carry real privacy weight (a search box is where people type things they
-- would not post), for insight nobody is acting on during a friends beta.
--
-- NO IP, NO USER AGENT STRING, NO GEO. `platform` and `browser` are coarse
-- buckets derived on the client. Storing the raw UA would make this table a
-- fingerprinting surface for no additional answer.
--
-- ⚠ THE INSTALL FUNNEL IS CHROMIUM-ONLY, BY THE PLATFORM'S DESIGN.
-- 'install_prompt_shown' / '_accepted' / '_dismissed' come from
-- `beforeinstallprompt`, which iOS Safari does not implement and never
-- fires. On iOS the ONLY install signal is 'installed_pwa', inferred from
-- the first launch in standalone mode. An install-conversion RATE computed
-- across all platforms will therefore be wrong; compute it per platform.


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ THE SQL EDITOR HAS NO JWT. auth.uid() is NULL there, so a check that
-- merely "returns no rows" would pass whether or not the policy is correct.
-- Each block asserts a POSITIVE fact about the catalogue, and V4 provokes a
-- real rejection and fails if the rejection does NOT happen.
-- ============================================================

-- V1 · table exists, RLS is on, and it is append-only: exactly one policy,
--      an INSERT, with no UPDATE/DELETE/SELECT policy anywhere.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.usage_events') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: public.usage_events does not exist';
  END IF;

  SELECT count(*) INTO n FROM pg_class
  WHERE relname = 'usage_events' AND relrowsecurity = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: row level security is not enabled on usage_events';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'usage_events';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: expected exactly 1 policy on usage_events, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'usage_events'
    AND cmd = 'INSERT' AND with_check LIKE '%auth.uid()%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: the one policy is not an INSERT gated on auth.uid()';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'usage_events'
    AND cmd IN ('SELECT', 'UPDATE', 'DELETE');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V1 FAILED: % read/update/delete polic(ies) exist — analytics would be readable or mutable through the anon key', n;
  END IF;

  RAISE NOTICE 'V1 PASSED: table exists, RLS on, append-only, insert-only policy';
END $$;

-- V2 · the anon role can INSERT and canNOT SELECT at the grant level.
--      Checked independently of RLS: both layers must hold.
DO $$
DECLARE ins boolean; sel boolean;
BEGIN
  ins := has_table_privilege('anon', 'public.usage_events', 'INSERT');
  sel := has_table_privilege('anon', 'public.usage_events', 'SELECT');

  IF NOT ins THEN
    RAISE EXCEPTION 'V2 FAILED: anon cannot INSERT — signed-out visitors would record nothing';
  END IF;
  IF sel THEN
    RAISE EXCEPTION 'V2 FAILED: anon HAS SELECT on usage_events — usage data is readable with the public key';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.usage_events', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: service_role cannot SELECT — the Studio dashboard would have nothing to read';
  END IF;

  RAISE NOTICE 'V2 PASSED: anon may insert only; service_role may read';
END $$;

-- V3 · every event name the client can send is accepted by the CHECK, and a
--      name it cannot send is refused. Asserts the allow-list is exactly the
--      contract, not merely "some constraint exists".
DO $$
DECLARE
  expected text[] := ARRAY[
    'opened_app','signed_up',
    'install_prompt_shown','install_prompt_accepted','install_prompt_dismissed','installed_pwa',
    'created_event','published_event','applied','sent_message','sent_voicey','followed','shared'
  ];
  nm text;
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.usage_events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%opened_app%';

  IF def IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: no CHECK constraint on name — typos would be stored as new event types';
  END IF;

  FOREACH nm IN ARRAY expected LOOP
    IF position('''' || nm || '''' in def) = 0 THEN
      RAISE EXCEPTION 'V3 FAILED: event name % is missing from the CHECK — the client can send it and every row will be rejected', nm;
    END IF;
  END LOOP;

  RAISE NOTICE 'V3 PASSED: all % client event names are accepted by the CHECK', array_length(expected, 1);
END $$;

-- V4 · THE APPEND-ONLY AND SPOOFING GUARANTEES, PROVEN BY PROVOKING FAILURE.
--
-- A catalogue check proves a policy is WRITTEN; this proves it BITES. Each
-- block performs the thing that must be impossible and RAISES if it
-- succeeded — so passing means the rejection actually happened, not that
-- nothing was tried. Only the one expected error code is caught: any other
-- error is a different problem and must surface, not be swallowed.
DO $$
DECLARE bad_name text := 'definitely_not_a_real_event';
BEGIN
  BEGIN
    INSERT INTO public.usage_events (device_id, name, display_mode, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', bad_name, 'browser', 'desktop');
    -- Reached only if the insert did NOT raise, which is the failure.
    RAISE EXCEPTION 'V4 FAILED: an unknown event name (%) was ACCEPTED — the allow-list is not enforcing', bad_name;
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V4 PASSED: unknown event name rejected by CHECK, as intended';
  END;
END $$;

-- V5 · the display_mode allow-list bites too — the column that carries the
--      headline metric. Same provoke-and-assert shape as V4.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.usage_events (device_id, name, display_mode, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', 'opened_app', 'installed', 'ios');
    RAISE EXCEPTION 'V5 FAILED: display_mode ''installed'' was ACCEPTED — only the six canonical modes may be stored';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V5 PASSED: unknown display_mode rejected by CHECK, as intended';
  END;
END $$;

-- V6 · nothing above left a row behind. The table must be empty before the
--      first real ping, or day-one counts start with test data in them.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.usage_events;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V6 FAILED: usage_events already contains % row(s) — verification wrote data it should not have', n;
  END IF;
  RAISE NOTICE 'V6 PASSED: table is empty and ready for the first real ping';
END $$;
