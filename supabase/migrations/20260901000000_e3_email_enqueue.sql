-- ============================================================
-- E3 · EMAIL ENQUEUE — the notification becomes a delivery
-- Requires: E1 (email_notification_preferences, notification_deliveries,
--           email_category_overrides, email_enabled_for_notification),
--           extensions `pg_net` and `supabase_vault`.
--
-- ⛔⛔ THIS FILE STILL SENDS NOTHING. It writes a `pending` row and pings a
--    worker. The worker is what talks to a provider, and it refuses to run
--    until its own credential exists. Applying this migration with no Vault
--    secret set leaves the queue filling and nothing draining — which is the
--    safe direction, and V4 below asserts it.
-- ============================================================
--
-- ── ⛔⛔ INSERT ONLY. THE CLAIM PATH MUST NOT ENQUEUE. ───────────
--
-- `N3` delivers HELD notifications by UPDATEing `to_user_id` on rows that may
-- be months old — a venue claims its profile and inherits its whole backlog at
-- once. That is the payoff of the held model for the FEED, and it is a
-- catastrophe for EMAIL: one claim would fire dozens of messages about
-- applications, follows and enquiries the person has never seen, all in the
-- same second, from a domain with no sending history.
--
-- The brief's rule — "do not send historical notifications; only future
-- qualifying notifications generate email" — is enforced HERE, by the trigger
-- being AFTER INSERT and nothing else. ⛔ Do not add `OR UPDATE OF to_user_id`
-- to make claimed notifications email; that is the flood, written as a feature.
--
-- ── WHY A TRIGGER RATHER THAN A CALL IN writeNotification.js ────
--
-- Same reason NP1 gives for suppression. There are ~24 client write paths plus
-- SQL triggers (`notify_new_message`) that have no client at all, and the
-- twenty-fifth call site would forget. The row is the event; react to the row.
--
-- ── ⭐⭐ THE QUEUE IS DRAINED BY THE NEXT NOTIFICATION, NOT BY A TIMER ──
--
-- ⚠⚠ THIS PROJECT HAS NO pg_cron. Recorded in the repository already
-- (20260821000000_fe1_featured_allocation, and the "no worker" house answer in
-- 20260724000004_n4b), and it rules out the obvious design of a scheduled
-- sweep.
--
-- So the trigger does TWO things: it writes a durable `pending` row, and it
-- PINGS the worker. The ping is fire-and-forget and may be lost; the row is
-- not. The worker, when it wakes, drains a BATCH — every pending row it can
-- see, not merely the one that woke it. Consequences, and they are the design:
--
--   ⭐ a failed delivery is retried by the NEXT notification's ping, so retry
--     costs no infrastructure at all
--   ⚠ on a completely idle platform a failed row can sit pending indefinitely.
--     ⛔ It is never lost and never duplicated — the PK forbids that — it is
--     merely late. Any external ping (a Cloudflare cron trigger, a manual
--     invoke) drains it, and one can be added without touching this file.
--
-- ⛔ THE PING CARRIES NO PAYLOAD. It says "there is work", never "send this".
-- A worker that trusted a payload would be a worker that could be told to send
-- something the database never approved.
-- ============================================================


-- ── 1 · WHICH CATEGORIES EMAIL AT ALL ──────────────────────────
--
-- ⭐ SCOPE IS BY CATEGORY, ⛔ not by a second list of types. The type→category
-- resolution already exists (`email_category_for_type`, E1) and adding a
-- parallel type list is the drift NP1's header warns about.
--
-- ⛔ `social` AND `contacts` ARE EXCLUDED, DELIBERATELY. A new follower and a
-- contact joining are pleasant, high-volume, and carry no deadline — precisely
-- the mail people mark as spam, and a spam complaint costs the deliverability
-- of the messages that DO matter. They remain in-app, where the cost of being
-- ignored is zero. ⛔ Widening this is a product decision, not a config tweak.
CREATE OR REPLACE FUNCTION public.email_category_in_scope(p_category text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_category IS NOT NULL
     AND p_category IN ('messages', 'bookings', 'schedule', 'events', 'account', 'payments');
$$;

COMMENT ON FUNCTION public.email_category_in_scope(text) IS
  'E3 — is this EMAIL category in scope for email at all? Separate from '
  'email_category_enabled(), which asks whether the USER wants it: this asks '
  'whether the PLATFORM sends it. social and contacts are excluded — high '
  'volume, no deadline, and the likeliest source of spam complaints, which '
  'would cost the deliverability of mail that matters.';


-- ── 2 · THE RATE CAP ───────────────────────────────────────────
--
-- ⛔⛔ THIS EXISTS BECAUSE OF A KNOWN, UNFIXED HOLE. The `notifications` INSERT
-- policy is `auth.role() = 'authenticated'`, and its own comment calls it an
-- interim residual: ANY signed-up user can write to ANY other user's inbox with
-- ANY content. Today that costs an in-app row. Wired to email it becomes mail
-- from a verified domain to a real person, at whatever rate the attacker likes.
--
-- ⚠ The cap does NOT close that hole — only a relationship-scoped INSERT policy
-- can, and that is a Notifications-milestone design exercise. What it does is
-- bound the damage: an abuser can annoy one recipient a limited number of times
-- per hour instead of mailbombing them, and the platform's sending reputation
-- survives the incident.
--
-- ⚠ CAPPED AT ENQUEUE, ⛔ not in the worker. A row that should not be sent must
-- never enter the queue; a queue that fills with rows the worker will refuse is
-- a queue that hides its own backlog.
CREATE OR REPLACE FUNCTION public.email_rate_budget_remaining(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, 20 - count(*)::int)
    FROM public.notification_deliveries d
    JOIN public.notifications n ON n.id = d.notification_id
   WHERE d.channel = 'email'
     AND n.to_user_id = p_user_id
     AND d.created_at > now() - interval '1 hour';
$$;

COMMENT ON FUNCTION public.email_rate_budget_remaining(uuid) IS
  'E3 — how many more emails this recipient may be sent this hour (cap 20). '
  'Bounds the blast radius of the known-open notifications INSERT policy; it '
  'does NOT close it. Counts ENQUEUED rows, not sent ones, so a provider '
  'outage cannot be used to bypass the cap by retrying.';


-- ── 3 · THE ENQUEUE ────────────────────────────────────────────
--
-- ⚠ SECURITY DEFINER for the reason NP1's trigger documents: the writer is
-- almost never the recipient, and the preference read must run with rights that
-- can see the RECIPIENT's rows. Under invoker rights and RLS it would read
-- nothing, and "absence means enabled" would turn every preference into a
-- no-op — a mute switch that reports success and does nothing.
--
-- ⛔ IT NEVER RAISES. Every failure path returns NEW. This runs inside the
-- transaction that wrote the notification, which is inside the transaction that
-- sent the message or accepted the application. ⛔⛔ Email must never be able to
-- fail a product action — the brief's rule, and the same rule MP4b states for
-- push.
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
  -- Held (N1): no delivery identity, nobody to email. It may become deliverable
  -- later via N3 — and deliberately will NOT enqueue then. See the header.
  IF NEW.to_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- NP1 / CJ2 already decided this row is not to be shown at all.
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

  IF public.email_rate_budget_remaining(NEW.to_user_id) <= 0 THEN
    RETURN NEW;
  END IF;

  -- ⭐ ON CONFLICT DO NOTHING is the second line of defence behind the PK. The
  -- PK is the guarantee; this stops a duplicate INSERT raising inside the
  -- product's own transaction, which is the one thing this trigger must never
  -- do.
  INSERT INTO public.notification_deliveries (notification_id, channel)
  VALUES (NEW.id, 'email')
  ON CONFLICT (notification_id, channel) DO NOTHING;

  -- ── THE PING ─────────────────────────────────────────────────
  -- ⚠ A MISSING SECRET IS A WARNING, ⛔ NEVER AN EXCEPTION. A fresh environment
  -- applies this migration before the Vault secret is stored, and raising here
  -- would roll back the notification — and the message, and the application.
  -- The row is already queued; only the wake-up is lost.
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_worker_service_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'enqueue_email_delivery: email_worker_service_key not in Vault — notification % queued but no worker pinged', NEW.id;
    RETURN NEW;
  END IF;

  -- ⛔ NO PAYLOAD. "There is work", never "send this". A worker that trusted a
  -- body could be told to send something the database never approved.
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
  -- ⛔⛔ THE LAST LINE OF THE SAME RULE. Anything unforeseen — a dropped
  -- extension, a permission change, a Vault outage — must cost the email and
  -- nothing else. ⛔ Never let this abort the product transaction.
  RAISE WARNING 'enqueue_email_delivery: suppressed error for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enqueue_email_delivery() IS
  'E3 — writes a pending notification_deliveries row and pings email-worker. '
  'AFTER INSERT ONLY: the N3 claim path must never enqueue, or claiming a '
  'profile would email its entire held backlog at once. Never raises — email '
  'must not be able to fail the product action that caused the notification.';

DROP TRIGGER IF EXISTS trg_enqueue_email_delivery ON public.notifications;

-- ⛔ AFTER INSERT, and ⛔ NOT `OR UPDATE OF to_user_id`. See the header.
CREATE TRIGGER trg_enqueue_email_delivery
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_email_delivery();


-- ── 4 · THE WORKER'S OWN VIEW OF ITS QUEUE ─────────────────────
--
-- ⭐⭐ THE WORKER IS HANDED IDS AND A TYPE, ⛔ NEVER `notifications.message`.
-- That column is written by whoever inserted the notification, and under the
-- current INSERT policy that is any authenticated user. Rendering it into an
-- email would let a stranger compose mail sent from the YesPleez domain to
-- another user. The worker's copy is a CONSTANT chosen by `type`; this function
-- decides which constant, and hands over nothing else that a caller wrote.
--
-- ⚠ Returns the recipient's ADDRESS because the worker must have it and
-- service_role is the only role that may see it. ⛔ It is never persisted —
-- `notification_deliveries` has no address column, by design.
CREATE OR REPLACE FUNCTION public.email_delivery_queue(p_limit integer DEFAULT 25)
RETURNS TABLE (
  notification_id uuid,
  notification_type text,
  email_category text,
  recipient_email text,
  attempts integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT d.notification_id,
         n.type,
         public.email_category_for_type(n.type),
         u.email::text,
         d.attempts
    FROM public.notification_deliveries d
    JOIN public.notifications n ON n.id = d.notification_id
    JOIN auth.users           u ON u.id = n.to_user_id
   WHERE d.channel = 'email'
     AND d.status  = 'pending'
     -- ⚠ RE-CHECKED AT SEND TIME, not merely at enqueue. A preference can change
     -- between the two, and the later answer is the honest one.
     AND n.suppressed_at IS NULL
     AND public.email_enabled_for_notification(n.to_user_id, n.type)
     -- ⛔ CONFIRMED ADDRESSES ONLY. An unconfirmed address is one nobody has
     -- proven they control.
     AND u.email IS NOT NULL
     AND u.email_confirmed_at IS NOT NULL
     -- ⚠ Give up after 5 attempts; the worker marks those failed.
     AND d.attempts < 5
   ORDER BY d.created_at
   LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

COMMENT ON FUNCTION public.email_delivery_queue(integer) IS
  'E3 — the worker''s queue: pending email deliveries with the recipient''s '
  'CONFIRMED address resolved from auth.users at read time. ⛔ Hands over ids '
  'and a type, NEVER notifications.message — that column is attacker-writable '
  'under the current INSERT policy and must never reach an email body. '
  'Re-checks suppression and preference at send time, because both can change '
  'after enqueue.';


-- ── 5 · EXPOSURE ───────────────────────────────────────────────
--
-- ⚠ `email_delivery_queue` RETURNS EMAIL ADDRESSES. It is service_role only,
-- and that is not a formality: a client able to call it could enumerate the
-- address of every user with a pending notification.
REVOKE ALL ON FUNCTION public.email_delivery_queue(integer)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_rate_budget_remaining(uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_delivery_queue(integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.email_rate_budget_remaining(uuid) TO service_role;

-- ⭐ The scope predicate reads no user data and is safe to expose: the settings
-- screen needs it to know which switches to draw.
REVOKE ALL ON FUNCTION public.email_category_in_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_category_in_scope(text) TO authenticated, service_role;


-- ============================================================
-- ⚠ ONE MANUAL STEP THIS FILE CANNOT CONTAIN
-- ============================================================
--
-- The ping needs a service_role credential, and a service_role key must NEVER
-- be committed. Stored in Vault and read by name at call time — the same
-- pattern MP4b uses for push, and a SEPARATE secret so that rotating one
-- channel's credential cannot silently break the other.
--
-- Run ONCE, with the real key, and do not paste the result anywhere:
--
--     select vault.create_secret(
--       '<SERVICE_ROLE_KEY>',
--       'email_worker_service_key',
--       'service_role key used only by enqueue_email_delivery'
--     );
--
-- ⚠ Until it exists the queue FILLS AND NOTHING DRAINS. That is deliberate and
-- reversible: no email is lost, none is duplicated, and the first ping after
-- the secret is stored drains the backlog. V4 warns rather than fails.
-- ============================================================


-- ============================================================
-- VERIFICATION — run AFTER applying, as one script.
--
-- ⚠⚠ WRAPPED IN BEGIN … ROLLBACK. V5–V9 PROVOKE the trigger with real
-- notification inserts, because a check that reads catalogue metadata proves a
-- trigger was DECLARED, not that it FIRES on the right rows and stays silent on
-- the wrong ones. Nothing survives, pass or fail.
--
-- ⚠ SIDE EFFECT, NAMED: inserting notifications fires BOTH the existing push
-- trigger and the new enqueue trigger. push-notify no-ops (types out of its
-- PUSH_TYPES), and pg_net queues transactionally so the ROLLBACK discards every
-- queued request — no push and no worker ping actually leave the database.
-- ============================================================

BEGIN;

-- V1 · the objects exist.
DO $v1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enqueue_email_delivery') THEN
    RAISE EXCEPTION 'V1 FAILED: enqueue_email_delivery() does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'email_delivery_queue') THEN
    RAISE EXCEPTION 'V1 FAILED: email_delivery_queue() does not exist — the worker would read nothing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'email_category_in_scope') THEN
    RAISE EXCEPTION 'V1 FAILED: email_category_in_scope() does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'email_rate_budget_remaining') THEN
    RAISE EXCEPTION 'V1 FAILED: email_rate_budget_remaining() does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.notifications'::regclass
       AND tgname = 'trg_enqueue_email_delivery' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: trg_enqueue_email_delivery is not on notifications — nothing would ever be queued';
  END IF;
  RAISE NOTICE 'V1 PASSED: four functions and the enqueue trigger exist';
END $v1$;


-- V2 · ⛔⛔ THE TRIGGER IS INSERT-ONLY. This is the "no historical flood" rule,
--      and reading the trigger definition is the only way to prove it without
--      waiting for someone to claim a profile.
DO $v2$
DECLARE d text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO d
    FROM pg_trigger
   WHERE tgrelid = 'public.notifications'::regclass AND tgname = 'trg_enqueue_email_delivery';

  IF d NOT LIKE '%AFTER INSERT%' THEN
    RAISE EXCEPTION 'V2 FAILED: the enqueue trigger is not AFTER INSERT: %', d;
  END IF;
  IF d ILIKE '%UPDATE%' THEN
    RAISE EXCEPTION 'V2 FAILED: the enqueue trigger fires on UPDATE — claiming a profile would email its entire held backlog at once: %', d;
  END IF;

  -- push and NP1/CJ2 are still there, and E3 added exactly one trigger.
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'V2 FAILED: notifications does not carry exactly 4 triggers (3 pre-existing + E3)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass
                   AND tgname = 'trg_trigger_push_notify' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'V2 FAILED: the push trigger is gone';
  END IF;

  RAISE NOTICE 'V2 PASSED: AFTER INSERT only, no UPDATE clause, 4 triggers, push intact';
END $v2$;


-- V3 · scope: the categories that email, and the two that must not.
DO $v3$
BEGIN
  IF NOT (public.email_category_in_scope('messages')
      AND public.email_category_in_scope('bookings')
      AND public.email_category_in_scope('schedule')
      AND public.email_category_in_scope('events')
      AND public.email_category_in_scope('account')
      AND public.email_category_in_scope('payments')) THEN
    RAISE EXCEPTION 'V3 FAILED: an operational category is out of email scope';
  END IF;
  IF public.email_category_in_scope('social') OR public.email_category_in_scope('contacts') THEN
    RAISE EXCEPTION 'V3 FAILED: social/contacts are in email scope — high volume, no deadline, and the likeliest source of spam complaints';
  END IF;
  IF public.email_category_in_scope(NULL) THEN
    RAISE EXCEPTION 'V3 FAILED: a NULL category is in scope';
  END IF;
  RAISE NOTICE 'V3 PASSED: six categories in scope, social/contacts/NULL excluded';
END $v3$;


-- V4 · the Vault secret. ⚠ WARNS rather than fails: applying before storing it
--      is a legitimate state, and the queue simply fills until it exists.
DO $v4$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM vault.decrypted_secrets WHERE name = 'email_worker_service_key';
  IF n = 0 THEN
    RAISE WARNING 'V4: email_worker_service_key is NOT in Vault — deliveries will QUEUE and nothing will drain until the one manual step in this file''s footer is run. No email is lost.';
  ELSE
    RAISE NOTICE 'V4 PASSED: email_worker_service_key present in Vault';
  END IF;
END $v4$;


-- V5 · ⭐⭐ AN ELIGIBLE NOTIFICATION ENQUEUES EXACTLY ONE ROW.
DO $v5$
DECLARE
  v_user uuid := gen_random_uuid();
  v_note uuid;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e3-eligible@example.invalid', now());

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_application', 'E3 verify', false)
  RETURNING id INTO v_note;

  SELECT count(*) INTO n FROM public.notification_deliveries
   WHERE notification_id = v_note AND channel = 'email';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V5 FAILED: expected 1 queued email delivery, got % — the trigger is not enqueuing', n;
  END IF;

  IF (SELECT status FROM public.notification_deliveries WHERE notification_id = v_note) <> 'pending' THEN
    RAISE EXCEPTION 'V5 FAILED: the queued row is not pending';
  END IF;

  RAISE NOTICE 'V5 PASSED: an eligible notification queues exactly one pending email delivery';
END $v5$;


-- V6 · ⛔⛔ THE CLAIM PATH DOES NOT ENQUEUE. A held row that becomes deliverable
--      later must produce NO email — this is the historical-flood rule, and it
--      is provoked rather than asserted.
-- ⚠ `to_profile_id` CARRIES A FOREIGN KEY TO `profiles`, and the first draft of
--   this block invented a uuid and died 23503 against it. Creating a real,
--   UNCLAIMED profile (no user_id) is not merely a fix — it is the honest N1
--   case, which a synthetic id never was.
DO $v6$
DECLARE
  v_user uuid := gen_random_uuid();
  v_prof uuid;
  v_note uuid;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e3-claim@example.invalid', now());

  INSERT INTO public.profiles (name) VALUES ('E3 verify profile')
  RETURNING id INTO v_prof;

  -- A HELD notification: addressed to a profile, no delivery identity (N1).
  INSERT INTO public.notifications (to_profile_id, type, message, read)
  VALUES (v_prof, 'new_application', 'E3 held', false)
  RETURNING id INTO v_note;

  SELECT count(*) INTO n FROM public.notification_deliveries WHERE notification_id = v_note;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V6 FAILED: a HELD notification was queued for email — there is nobody to email yet';
  END IF;

  -- Now the profile is claimed (N3): to_user_id is populated by UPDATE.
  UPDATE public.notifications SET to_user_id = v_user WHERE id = v_note;

  SELECT count(*) INTO n FROM public.notification_deliveries WHERE notification_id = v_note;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V6 FAILED: claim delivery queued an email — claiming a profile would mail its whole backlog at once';
  END IF;

  RAISE NOTICE 'V6 PASSED: held rows do not queue, and neither does claim delivery — no historical flood';
END $v6$;


-- V7 · the user's preference is honoured at enqueue.
DO $v7$
DECLARE
  v_user uuid := gen_random_uuid();
  v_note uuid;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e3-pref@example.invalid', now());

  INSERT INTO public.email_notification_preferences (user_id, category, enabled)
  VALUES (v_user, 'bookings', false);

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_application', 'E3 muted', false)
  RETURNING id INTO v_note;

  SELECT count(*) INTO n FROM public.notification_deliveries WHERE notification_id = v_note;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V7 FAILED: a muted category was queued for email — the off switch does nothing';
  END IF;

  -- ⭐ AND THE IN-APP NOTIFICATION STILL EXISTS. Preferences govern DELIVERY,
  -- never existence — the notification row is untouched by the email decision.
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id = v_note AND suppressed_at IS NULL) THEN
    RAISE EXCEPTION 'V7 FAILED: turning email off affected the in-app notification';
  END IF;

  RAISE NOTICE 'V7 PASSED: email preference honoured at enqueue, in-app notification unaffected';
END $v7$;


-- V8 · out-of-scope categories, and NP1 suppression.
DO $v8$
DECLARE
  v_user uuid := gen_random_uuid();
  v_a uuid; v_b uuid;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e3-scope@example.invalid', now());

  -- social is deliberately not an email category.
  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_follower', 'E3 social', false) RETURNING id INTO v_a;
  SELECT count(*) INTO n FROM public.notification_deliveries WHERE notification_id = v_a;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V8 FAILED: a social notification was queued for email';
  END IF;

  -- an explicitly suppressed row must never email.
  INSERT INTO public.notifications (to_user_id, type, message, read, suppressed_at)
  VALUES (v_user, 'new_application', 'E3 suppressed', false, now()) RETURNING id INTO v_b;
  SELECT count(*) INTO n FROM public.notification_deliveries WHERE notification_id = v_b;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V8 FAILED: a suppressed notification was queued for email';
  END IF;

  RAISE NOTICE 'V8 PASSED: social out of scope, suppressed rows never queue';
END $v8$;


-- V9 · ⭐ THE RATE CAP BOUNDS THE KNOWN-OPEN INSERT POLICY.
DO $v9$
DECLARE
  v_user uuid := gen_random_uuid();
  n int;
  i int;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_user, 'e3-cap@example.invalid', now());

  IF public.email_rate_budget_remaining(v_user) <> 20 THEN
    RAISE EXCEPTION 'V9 FAILED: a fresh recipient does not start with the full budget';
  END IF;

  FOR i IN 1..25 LOOP
    INSERT INTO public.notifications (to_user_id, type, message, read)
    VALUES (v_user, 'new_application', 'E3 flood ' || i, false);
  END LOOP;

  SELECT count(*) INTO n
    FROM public.notification_deliveries d
    JOIN public.notifications x ON x.id = d.notification_id
   WHERE x.to_user_id = v_user;

  IF n <> 20 THEN
    RAISE EXCEPTION 'V9 FAILED: 25 notifications produced % queued emails, expected the cap of 20', n;
  END IF;

  -- ⭐ AND ALL 25 IN-APP NOTIFICATIONS STILL EXIST. The cap governs DELIVERY,
  -- never existence.
  IF (SELECT count(*) FROM public.notifications WHERE to_user_id = v_user) <> 25 THEN
    RAISE EXCEPTION 'V9 FAILED: the rate cap suppressed notifications themselves';
  END IF;

  RAISE NOTICE 'V9 PASSED: 25 notifications, 20 emails queued, all 25 notifications kept';
END $v9$;


-- V10 · the worker's queue refuses unconfirmed addresses.
DO $v10$
DECLARE
  v_user uuid := gen_random_uuid();
  v_note uuid;
  n int;
BEGIN
  -- ⛔ No email_confirmed_at: nobody has proven they control this address.
  INSERT INTO auth.users (id, email) VALUES (v_user, 'e3-unconfirmed@example.invalid');

  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'new_application', 'E3 unconfirmed', false)
  RETURNING id INTO v_note;

  -- It may well queue — enqueue does not know about confirmation...
  SELECT count(*) INTO n FROM public.email_delivery_queue(100)
   WHERE notification_id = v_note;

  -- ...but the WORKER must never be handed it.
  IF n <> 0 THEN
    RAISE EXCEPTION 'V10 FAILED: an unconfirmed address reached the worker queue';
  END IF;

  RAISE NOTICE 'V10 PASSED: unconfirmed addresses never reach the worker';
END $v10$;


-- V11 · the queue hands over IDS AND A TYPE, ⛔ never the attacker-writable text.
DO $v11$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(p.proargnames::text, ',') INTO cols FROM pg_proc p WHERE p.proname = 'email_delivery_queue';
  IF cols ILIKE '%message%' THEN
    RAISE EXCEPTION 'V11 FAILED: email_delivery_queue returns a message column — notifications.message is attacker-writable and must never reach an email body';
  END IF;
  IF pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = 'email_delivery_queue')) ILIKE '%n.message%' THEN
    RAISE EXCEPTION 'V11 FAILED: email_delivery_queue reads notifications.message';
  END IF;
  RAISE NOTICE 'V11 PASSED: the queue never exposes notifications.message';
END $v11$;

-- ⛔ NOTHING THIS SCRIPT CREATED SURVIVES.
ROLLBACK;
