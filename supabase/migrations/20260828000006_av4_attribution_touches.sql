-- ============================================================
-- AV4 · ATTRIBUTION TOUCHES — how someone arrived, as evidence
--
-- ⚠ NOT YET APPLIED. Run after AV3.
--
-- A touch records that a device arrived carrying campaign context —
-- a QR scan's ?src=bar_qr, a shared link, a bio link. It is ADDITIVE
-- CONTEXT, never identity: nothing about a touch claims who the
-- person is, and no touch is ever joined to identity except through
-- the explicit, labelled resolution rules (identity_links).
--
-- ⭐ THE QR LAW IS UNTOUCHED: a scan still writes NOTHING. The printed
-- code encodes the canonical /q/{type}/{id} address; campaign params
-- ride alongside in the query string, and it is the APP LOAD that
-- records the touch — same moment, same actor, same fire-and-forget
-- contract as every usage_event.
--
-- ── ⚠ PLACEMENT: public SCHEMA, DELIBERATELY — a documented
--    deviation from the Blueprint's analytics.attribution_touches ──
--
-- The Blueprint placed this table in the analytics schema with an
-- anon INSERT policy. AV0, applied since, strips anon/authenticated
-- of even USAGE on that schema and VERIFIES it — the schema's whole
-- security claim is "no public key can reach anything here". A
-- client-writable table there would need USAGE granted back,
-- weakening that claim for every table in the schema at once.
--
-- Resolution: client-writable analytics surfaces live in `public`
-- with the A1 write-only asymmetry (RLS, INSERT-only, no SELECT
-- policy, no SELECT grant); the analytics schema stays sealed,
-- service-role only. Same rule that already governs usage_events,
-- now stated as the rule for any future client-written table.
--
-- Append-only, INSERT-only for clients. A device may accumulate many
-- touch rows (rescans, repeat arrivals); the SERVICE coalesces at
-- read time. No last_seen UPDATE from clients — an updatable column
-- would be the first crack in append-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attribution_touches (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),

  device_id       uuid NOT NULL,
  session_id      uuid,
  -- The account known AT TOUCH TIME. NULL for an anonymous arrival,
  -- and never updated later — resolution happens through
  -- analytics.identity_links, labelled, at read time.
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  campaign        text,
  source          text NOT NULL,
  medium          text NOT NULL CHECK (medium IN ('qr', 'link', 'share', 'other')),
  placement       text,
  creative        text,
  -- The canonical destination, verbatim — /q/{type}/{id} or a path.
  -- ⛔ Never renamed after printing; the QR law owns this string.
  destination_key text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'desktop', 'other')),

  -- Small structural detail only; the reader owns the shape.
  props           jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.attribution_touches ENABLE ROW LEVEL SECURITY;

-- The A1 asymmetry, verbatim in spirit: anyone may record their own
-- arrival (guest browsing included), nobody may attribute an arrival
-- to ANOTHER account, and the NULL case is permitted on purpose — the
-- getSession() race under-attributes rather than rejects.
DROP POLICY IF EXISTS "attribution touches insert own or anonymous" ON public.attribution_touches;
CREATE POLICY "attribution touches insert own or anonymous"
  ON public.attribution_touches FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- No SELECT policy, and none may ever be added: the anon key is
-- public, and a read policy would publish the platform's campaign
-- performance to anyone with devtools. Reads happen in the Analytics
-- service under the service role. (If a client insert ever grows a
-- .select(), the fix is removing the .select() — A1 §3.)

REVOKE ALL ON public.attribution_touches FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.attribution_touches TO anon, authenticated;
GRANT ALL ON public.attribution_touches TO service_role;

CREATE INDEX IF NOT EXISTS attribution_touches_device_idx
  ON public.attribution_touches (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attribution_touches_source_idx
  ON public.attribution_touches (source, created_at DESC);


-- ============================================================
-- VERIFICATION
-- ============================================================

-- V1 · RLS on; exactly one policy; it is INSERT-only.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.attribution_touches') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: attribution_touches does not exist';
  END IF;
  SELECT count(*) INTO n FROM pg_class
  WHERE relname = 'attribution_touches' AND relrowsecurity = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: RLS is not enabled';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'attribution_touches';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: expected exactly 1 policy, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'attribution_touches'
    AND cmd IN ('SELECT', 'UPDATE', 'DELETE');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V1 FAILED: a read/update/delete policy exists — campaign data would be public';
  END IF;
  RAISE NOTICE 'V1 PASSED: append-only, insert-only policy, RLS on';
END $$;

-- V2 · grant level: anon may INSERT and canNOT SELECT.
DO $$
BEGIN
  IF NOT has_table_privilege('anon', 'public.attribution_touches', 'INSERT') THEN
    RAISE EXCEPTION 'V2 FAILED: anon cannot INSERT — anonymous arrivals would record nothing';
  END IF;
  IF has_table_privilege('anon', 'public.attribution_touches', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: anon HAS SELECT — campaign data readable with the public key';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.attribution_touches', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: service_role cannot read touches';
  END IF;
  RAISE NOTICE 'V2 PASSED: anon may insert only; service_role may read';
END $$;

-- V3 · the medium allow-list bites (provoke-and-assert).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.attribution_touches (device_id, source, medium, destination_key, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', 'probe', 'billboard', '/q/event/x', 'desktop');
    RAISE EXCEPTION 'V3 FAILED: an unknown medium was ACCEPTED';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V3 PASSED: unknown medium rejected by CHECK, as intended';
  END;
END $$;

-- V4 · nothing above left a row behind.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.attribution_touches;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V4 FAILED: % verification row(s) left behind', n;
  END IF;
  RAISE NOTICE 'V4 PASSED: table empty, ready for the first real arrival';
END $$;

NOTIFY pgrst, 'reload schema';
