-- ============================================================
-- E4 · MESSAGE EMAIL COOLDOWN — one conversation is one email
-- Requires: E3 (enqueue_email_delivery, email_category_for_type)
--
-- ⛔ Changes ONE thing: `messages` email is rate-limited per recipient. No
--    other category, no other channel, no notification behaviour.
-- ============================================================
--
-- ── ⚠⚠ MEASURED ON PRODUCTION, 2026-09-01 ──────────────────────
--
-- `new_message` is 66% of all notifications (53 of 80 in seven days), and it
-- CONCENTRATES. In the last week one recipient received:
--
--     17 message notifications in a single day
--      8 to a second person the same day
--      6 to a third
--
-- Under E3 as written that is SEVENTEEN SEPARATE EMAILS to one person in one
-- day, because a back-and-forth conversation writes one notification per
-- message. ⛔⛔ That is the pattern that gets a domain marked as spam.
--
-- ⚠ THE 20/HOUR CAP DOES NOT COVER THIS. That cap exists to bound abuse of the
-- open INSERT policy; 17 in a day never reaches it. Different problem, and it
-- needed its own answer.
--
-- ── ⭐ ONE EMAIL PER HOUR PER RECIPIENT, FOR THE `messages` EMAIL CATEGORY ──
--
-- ⚠⚠ THE GUARD IS ON THE CATEGORY, ⛔ NOT ON `new_message`. It reads
-- `v_category = 'messages'`, so any type that resolves to that category is
-- covered — including one added after this migration, which is the intended
-- behaviour and the reason it is written this way.
--
-- ⚠ AS OF 2026-09-01, `new_message` IS THE ONLY TYPE THAT RESOLVES TO
-- `messages`. Established by enumerating all 31 rows of
-- notification_expiry_policy through email_category_for_type(), ⛔ not by
-- reading the seed data, which would miss an override. That is a fact about
-- today's mapping, NOT a property of the mechanism, and V5 asserts it so the
-- day it stops being true something says so.
--
-- ⚠ yespleez.com currently publishes SPF and DKIM but NO DMARC RECORD.
-- Measured 2026-09-01 against two independent resolvers with a working control:
-- `_dmarc.yespleez.com` returns NXDOMAIN. A `p=none` record was intended and
-- has not landed. ⛔ This migration does not touch DNS. Update this comment
-- when the record is genuinely live, ⛔ not when it is believed to be.
--
-- Seventeen becomes about three. The reader still learns promptly that someone
-- is talking to them; they do not get a transcript delivered one envelope at a
-- time. ⛔ The in-app notification and the push are UNTOUCHED — every message
-- still lights the bell immediately. This governs the EMAIL copy of that fact
-- and nothing else.
--
-- ⛔ NOT A DIGEST. A digest would have to summarise conversation CONTENT, which
-- C32 forbids leaving the app and which the worker deliberately never reads. A
-- cooldown needs no content at all: it drops the duplicate notice, keeping the
-- first, which already says everything the email is allowed to say.
--
-- ⚠ THE SKIPPED ONES ARE NOT QUEUED AND NOT DEFERRED. They simply produce no
-- email. Nothing accumulates to be sent later, so there is no backlog to flood
-- with when the hour rolls over. The notification row itself is untouched.
-- ============================================================


CREATE OR REPLACE FUNCTION public.email_message_cooldown_ok(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.notification_deliveries d
      JOIN public.notifications n ON n.id = d.notification_id
     WHERE d.channel = 'email'
       AND n.to_user_id = p_user_id
       AND public.email_category_for_type(n.type) = 'messages'
       AND d.created_at > now() - interval '60 minutes'
  );
$$;

COMMENT ON FUNCTION public.email_message_cooldown_ok(uuid) IS
  'E4 — may this recipient be sent another email from the `messages` category '
  'yet? At most one per hour. Category-based, not type-based: any type '
  'resolving to `messages` is covered. As of 2026-09-01 new_message is the only '
  'such type. Measured need: one user received 17 message notifications in a '
  'single day, which E3 alone would have sent as 17 emails. ⛔ Governs email '
  'only; in-app and push still fire on every message.';

REVOKE ALL ON FUNCTION public.email_message_cooldown_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_message_cooldown_ok(uuid) TO service_role;


-- ── THE ENQUEUE, WITH ONE CLAUSE ADDED ─────────────────────────
--
-- ⚠ REPLACED IN FULL rather than patched, because a trigger function cannot be
-- amended in place. Everything below is E3's body verbatim except the single
-- `messages` guard, which is marked. ⛔ If you are diffing this against E3 and
-- find any OTHER difference, that is a mistake, not an intention.
CREATE OR REPLACE FUNCTION public.enqueue_email_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $fn$
DECLARE
  v_category text;
  v_key      text;
  v_url      text := 'https://doqzxvppibuzieajqkxm.supabase.co/functions/v1/email-worker';
BEGIN
  IF NEW.to_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.suppressed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_category := public.email_category_for_type(NEW.type);

  IF NOT public.email_category_in_scope(v_category) THEN
    RETURN NEW;
  END IF;

  IF NOT public.email_enabled_for_notification(NEW.to_user_id, NEW.type) THEN
    RETURN NEW;
  END IF;

  -- ⭐ E4, AND THE ONLY ADDITION TO E3'S BODY. One message email per hour.
  IF v_category = 'messages' AND NOT public.email_message_cooldown_ok(NEW.to_user_id) THEN
    RETURN NEW;
  END IF;

  IF public.email_rate_budget_remaining(NEW.to_user_id) <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_deliveries (notification_id, channel)
  VALUES (NEW.id, 'email')
  ON CONFLICT (notification_id, channel) DO NOTHING;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_worker_service_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'enqueue_email_delivery: email_worker_service_key not in Vault — notification % queued but no worker pinged', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_email_delivery: suppressed error for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;


-- ============================================================
-- VERIFICATION — run AFTER applying, as one script.
-- ⚠ Provokes with real inserts inside BEGIN … ROLLBACK. Nothing survives.
-- ============================================================

BEGIN;

-- V1 · ⭐⭐ THE COOLDOWN COLLAPSES A CONVERSATION. Provoked with the real
--      measured shape: 17 message notifications to one person.
DO $v1$
DECLARE
  v_user uuid := gen_random_uuid();
  n int;
  i int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e4-msg@example.invalid', now());

  FOR i IN 1..17 LOOP
    INSERT INTO public.notifications (to_user_id, type, message, read)
    VALUES (v_user, 'new_message', 'E4 msg ' || i, false);
  END LOOP;

  SELECT count(*) INTO n
    FROM public.notification_deliveries d
    JOIN public.notifications x ON x.id = d.notification_id
   WHERE x.to_user_id = v_user;

  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: 17 message notifications produced % emails, expected 1 within the cooldown hour', n;
  END IF;

  -- ⭐ AND ALL 17 IN-APP NOTIFICATIONS SURVIVE. The cooldown governs the EMAIL
  -- copy of the fact, never the fact.
  IF (SELECT count(*) FROM public.notifications WHERE to_user_id = v_user) <> 17 THEN
    RAISE EXCEPTION 'V1 FAILED: the cooldown suppressed notifications themselves';
  END IF;

  RAISE NOTICE 'V1 PASSED: 17 message notifications, 1 email, 17 notifications kept';
END $v1$;


-- V2 · ⛔ IT IS MESSAGES ONLY. A booking notice in the same hour must still send.
DO $v2$
DECLARE
  v_user uuid := gen_random_uuid();
  n int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e4-mixed@example.invalid', now());

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_message', 'E4 first message', false);

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_message', 'E4 second message', false);

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'slot_offer',  'E4 a slot offer',  false);

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'availability_request', 'E4 an enquiry', false);

  SELECT count(*) INTO n
    FROM public.notification_deliveries d
    JOIN public.notifications x ON x.id = d.notification_id
   WHERE x.to_user_id = v_user;

  -- 1 message (2nd suppressed) + slot_offer + availability_request = 3
  IF n <> 3 THEN
    RAISE EXCEPTION 'V2 FAILED: expected 3 emails (1 message + 2 operational), got % — the cooldown is leaking into other categories', n;
  END IF;

  RAISE NOTICE 'V2 PASSED: the cooldown applies to messages only; bookings and enquiries are unaffected';
END $v2$;


-- V3 · the predicate itself, and its exposure.
DO $v3$
DECLARE v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e4-fresh@example.invalid', now());

  IF NOT public.email_message_cooldown_ok(v_user) THEN
    RAISE EXCEPTION 'V3 FAILED: a recipient with no history is already on cooldown';
  END IF;

  IF has_function_privilege('anon', 'public.email_message_cooldown_ok(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_message_cooldown_ok(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V3 FAILED: the cooldown predicate is client-callable';
  END IF;

  RAISE NOTICE 'V3 PASSED: fresh recipients are not on cooldown, predicate not client-callable';
END $v3$;


-- V4 · ⛔⛔ NOTHING ELSE MOVED. E4 touches one function; push, in-app and the
--      registry must be exactly where E3 left them.
DO $v4$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'V4 FAILED: the trigger count on notifications changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass
                   AND tgname = 'trg_trigger_push_notify' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'V4 FAILED: the push trigger is gone';
  END IF;
  IF pg_get_triggerdef((SELECT oid FROM pg_trigger
        WHERE tgrelid = 'public.notifications'::regclass
          AND tgname = 'trg_enqueue_email_delivery')) ILIKE '%UPDATE%' THEN
    RAISE EXCEPTION 'V4 FAILED: the enqueue trigger now fires on UPDATE — the claim path would flood';
  END IF;
  IF (SELECT category FROM public.notification_expiry_policy WHERE type = 'slot_changed') IS NOT NULL THEN
    RAISE EXCEPTION 'V4 FAILED: the frozen registry was modified';
  END IF;
  RAISE NOTICE 'V4 PASSED: 4 triggers, push intact, still INSERT-only, registry untouched';
END $v4$;


-- V5 · ⭐ WHAT ACTUALLY RESOLVES TO `messages` TODAY.
--      ⚠ A TRIPWIRE, ⛔ not a guard. The cooldown is category-based by design,
--      so this does not constrain the mechanism. It pins the DATA: if a second
--      type ever lands in this category, the cooldown silently starts
--      throttling it too, and whoever added it should find out here rather than
--      from a user who stopped getting emails.
DO $v5$
DECLARE
  types text;
  n int;
BEGIN
  SELECT string_agg(p.type, ', ' ORDER BY p.type), count(*)
    INTO types, n
    FROM public.notification_expiry_policy p
   WHERE public.email_category_for_type(p.type) = 'messages';

  IF types IS DISTINCT FROM 'new_message' THEN
    RAISE EXCEPTION 'V5: the messages email category now contains % type(s) [%] — the cooldown throttles ALL of them as one bucket. Confirm that is intended, then update this assertion.', n, types;
  END IF;

  RAISE NOTICE 'V5 PASSED: new_message is the only type in the messages email category (1 of 31 registry types)';
END $v5$;

ROLLBACK;
