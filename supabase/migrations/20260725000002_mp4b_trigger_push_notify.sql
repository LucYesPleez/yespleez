-- ============================================================
-- MP4b · FIRE push-notify ON EVERY NEW NOTIFICATION
-- Requires: MP1 (push_subscriptions), M8e (notify_new_message),
--           extensions `pg_net` and `supabase_vault`
--
-- ✅ APPLIED 2026-07-25, verified: V1/V2 passed, and real pushes were
--    delivered to an Android and an iPhone device through this path.
-- ============================================================
--
-- ── WHY THIS IS A TRIGGER AND NOT A DASHBOARD WEBHOOK ───────────
--
-- The intended mechanism was Supabase's Database Webhooks UI. It cannot be
-- used on this project: creating a hook fails with
--
--     ERROR 3F000: schema "supabase_functions" does not exist
--
-- — the platform never provisioned the schema that feature is built on, and
-- enabling pg_net alone does not create it. Rather than chase a dashboard
-- feature, the same effect is built directly here.
--
-- That turned out to be the better artefact anyway: a dashboard webhook is
-- invisible to the repository, cannot be code-reviewed, cannot be diffed,
-- and has to be recreated by hand on any new environment. This migration
-- reproduces it exactly.
--
-- ⚠ ONE MANUAL STEP THIS FILE CANNOT CONTAIN ────────────────────
--
-- The call needs a service_role credential, and a service_role key must
-- NEVER be committed. It is stored in Vault instead and read by name at
-- call time. Run ONCE per environment, with the real key, and do not paste
-- the result anywhere:
--
--     select vault.create_secret(
--       '<SERVICE_ROLE_KEY>',
--       'push_notify_service_key',
--       'service_role key used only by trigger_push_notify'
--     );
--
-- V2 below warns (does not fail) when the secret is absent, because a fresh
-- environment legitimately applies the migration before storing the secret.
--
-- ── FIRE AND FORGET, DELIBERATELY ───────────────────────────────
--
-- net.http_post queues the request and returns immediately. Push is a
-- delivery channel, never a source of truth (MP4's rule): a push that fails
-- must not fail, delay, or roll back the notification INSERT it is reacting
-- to. The notifications row is the record; the push is a courtesy.
-- ============================================================


CREATE OR REPLACE FUNCTION public.trigger_push_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $fn$
DECLARE
  v_key text;
  v_url text := 'https://doqzxvppibuzieajqkxm.supabase.co/functions/v1/push-notify';
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'push_notify_service_key';

  -- A missing secret must not break message sending. WARNING, not EXCEPTION:
  -- this runs inside the transaction that writes the notification, which is
  -- itself inside the transaction that sends a message.
  IF v_key IS NULL THEN
    RAISE WARNING 'trigger_push_notify: push_notify_service_key not in Vault — no push sent for notification %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    -- Shaped like a Supabase Database Webhook payload on purpose: the edge
    -- function reads `record`, so if the dashboard feature is ever fixed and
    -- adopted, the function needs no change.
    body    := jsonb_build_object(
      'type',   'INSERT',
      'table',  'notifications',
      'schema', 'public',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.trigger_push_notify() IS
  'MP4b — fires the push-notify edge function on every notifications INSERT '
  'via pg_net, reading its credential from Vault (push_notify_service_key) so '
  'no service_role key is ever committed. Replaces Supabase Database Webhooks, '
  'which this project cannot use (missing supabase_functions schema, 3F000). '
  'Fire-and-forget: push is a delivery channel and must never fail the write '
  'it reacts to.';

DROP TRIGGER IF EXISTS trg_trigger_push_notify ON public.notifications;

CREATE TRIGGER trg_trigger_push_notify
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_push_notify();


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · the trigger exists on the right table and fires per row.
DO $v1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.notifications'::regclass
       AND tgname  = 'trg_trigger_push_notify'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: trg_trigger_push_notify is not on public.notifications — nothing would ever be pushed';
  END IF;
  RAISE NOTICE 'V1 PASSED: trigger present on notifications';
END $v1$;

-- V2 · the credential is reachable. A WARNING rather than a failure: a new
--      environment applies this before the Vault secret is stored, and
--      failing here would roll the whole migration back.
DO $v2$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM vault.decrypted_secrets WHERE name = 'push_notify_service_key';
  IF n = 0 THEN
    RAISE WARNING 'V2: push_notify_service_key is NOT in Vault — every push will silently no-op until the one manual step in this file''s header is run.';
  ELSE
    RAISE NOTICE 'V2 PASSED: push_notify_service_key present in Vault';
  END IF;
END $v2$;
