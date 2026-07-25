-- ============================================================
-- MP1 · PUSH SUBSCRIPTIONS — one row per subscribed device
-- Requires: nothing (standalone table)
--
-- ✅ APPLIED 2026-07-25, verified: V1–V3 below all passed against the
--    live project, and two real devices (Android/FCM + iPhone/Apple)
--    registered against it in the same session.
-- ============================================================
--
-- Stores the Web Push endpoint for every browser a user has granted
-- notification permission on. Read only by MP4's `push-notify` edge
-- function; written only by the client, from an explicit settings toggle.
--
-- ── KEYED ON user_id, NOT ON A PROFILE ──────────────────────────
--
-- Push is a DELIVERY channel, and delivery in this system is per-HUMAN:
-- `notifications.to_user_id` is the delivery identity (Identity v1.1 §A7),
-- and App.jsx's unread badge already aggregates by user_id alone under
-- `R5` so that an artist browsing as Personal still sees a venue enquiry.
-- Keying push on a profile would invent a second, disagreeing model of who
-- a notification is for.
--
-- ── ONE ROW PER DEVICE IS CORRECT, NOT A DUPLICATE ──────────────
--
-- A user with a phone and a laptop has two rows and must receive two
-- pushes. `endpoint` is UNIQUE across the whole table — a browser push
-- endpoint is globally unique by construction — so a device re-subscribing
-- upserts its own row rather than accumulating copies, and MP4 can prune a
-- dead device by endpoint without touching any other.
--
-- ⚠ THE ENDPOINT IS A CREDENTIAL. Anyone holding endpoint + p256dh + auth
-- can push arbitrary notifications to that device. That is why RLS is
-- owner-only below and why anon gets nothing at all.
-- ============================================================


CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_subscriptions IS
  'MP1 — one row per subscribed device. endpoint is globally unique by '
  'construction, so a re-subscribe upserts on conflict(endpoint) rather than '
  'duplicating, and MP4 prunes a dead device by endpoint alone. Keyed on '
  'user_id because push delivery is per-HUMAN (§A7), matching the unread '
  'badge. Endpoint + keys are a credential — see the RLS below.';

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);


-- ── RLS IS THE ONLY DOOR ───────────────────────────────────────
--
-- Supabase grants ALL to anon and authenticated on every new table, so a
-- table created without this block is world-readable with the public key.
-- Revoke first, grant back deliberately, then policy.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- anon deliberately gets NOTHING: a signed-out visitor has no user_id to
-- subscribe under. A logged-out install flow would be a deliberate future
-- decision, not an oversight to patch quietly.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · the shape the rest of the milestone depends on.
DO $v1$
DECLARE c record;
BEGIN
  SELECT is_nullable, data_type INTO c
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
     AND column_name = 'user_id';

  IF c IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: push_subscriptions.user_id does not exist';
  END IF;
  IF c.is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'V1 FAILED: user_id is nullable — a subscription with no owner is undeliverable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.push_subscriptions'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%endpoint%'
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: endpoint has no UNIQUE constraint — re-subscribing would duplicate rows and double every push';
  END IF;

  RAISE NOTICE 'V1 PASSED: NOT NULL user_id, UNIQUE endpoint';
END $v1$;

-- V2 · the credential stays unreadable with the public key, and the edge
--      function can still read it.
DO $v2$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_subscriptions'::regclass) THEN
    RAISE EXCEPTION 'V2 FAILED: RLS is not enabled — every subscription is readable by every user';
  END IF;

  IF has_table_privilege('anon', 'public.push_subscriptions', 'SELECT')
     OR has_table_privilege('anon', 'public.push_subscriptions', 'INSERT')
     OR has_table_privilege('anon', 'public.push_subscriptions', 'UPDATE')
     OR has_table_privilege('anon', 'public.push_subscriptions', 'DELETE') THEN
    RAISE EXCEPTION 'V2 FAILED: anon holds a privilege on push_subscriptions — push credentials readable with the public key';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: service_role cannot SELECT — push-notify would find no devices and silently deliver nothing';
  END IF;

  RAISE NOTICE 'V2 PASSED: RLS on, anon has nothing, service_role can read';
END $v2$;

-- V3 · PROVOKE AND ASSERT. Passing means the duplicate was REFUSED, not
--      that nothing was attempted. Cleans up after itself either way.
DO $v3$
DECLARE
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  n bigint;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_a, 'mp1-verify-a@example.invalid'),
    (user_b, 'mp1-verify-b@example.invalid');

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (user_a, 'https://example.invalid/ep-mp1-verify', 'p256dh-test', 'auth-test');

  SELECT count(*) INTO n FROM public.push_subscriptions WHERE user_id = user_a;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V3 FAILED: expected 1 row for user_a, got %', n;
  END IF;

  BEGIN
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (user_b, 'https://example.invalid/ep-mp1-verify', 'p256dh-2', 'auth-2');
    RAISE EXCEPTION 'V3 FAILED: the SAME endpoint was accepted for a second user — one device would receive another person''s notifications';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- intended
  END;

  DELETE FROM public.push_subscriptions WHERE user_id IN (user_a, user_b);
  DELETE FROM auth.users WHERE id IN (user_a, user_b);

  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id IN (user_a, user_b)) THEN
    RAISE EXCEPTION 'V3 FAILED: cleanup left rows behind';
  END IF;

  RAISE NOTICE 'V3 PASSED: insert works, cross-user duplicate endpoint refused, no debris';
END $v3$;
