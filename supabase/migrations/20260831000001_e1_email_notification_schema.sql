-- ============================================================
-- E1 · EMAIL NOTIFICATIONS — SCHEMA ONLY
-- Requires: NP1 (notification_preferences, notification_expiry_policy.category,
--           notification_category_is_mutable), N1 (held rows), notifications.
--
-- ⛔⛔ THIS MIGRATION SENDS NOTHING AND ENQUEUES NOTHING. There is no trigger
--    here, deliberately. Phase 2 is the shape only; the enqueue trigger, the
--    worker, the templates and the settings UI are separate increments, in that
--    order. Applying this file changes no observable behaviour anywhere.
--
-- ⛔⛔ IT MODIFIES NOTHING THAT EXISTS. No ALTER on `notifications`, none on
--    `notification_expiry_policy`, none on `notification_preferences`, no change
--    to `notification_category_is_mutable()`, no touched trigger, no touched
--    CHECK. Every object below is NEW. Push and in-app cannot be affected by
--    this file, and V5 provokes that claim rather than asserting it.
-- ============================================================
--
-- ── EMAIL IS A THIRD CHANNEL, NOT A THIRD NOTIFICATION SYSTEM ───
--
-- `public.notifications` remains the sole source of truth. Email hangs off a
-- row that already exists and was already approved by the authorities that
-- govern it — N1 held-ness, NP1 suppression, CJ2 channel. Nothing here can
-- cause a notification to be written, and nothing here can prevent one.
--
-- ⛔⛔ `notifications.channel` IS NOT TOUCHED, AND MUST NOT BE. That column is
-- CJ2's ROUTE choice and its CHECK is ('push','in_app','off') — three values
-- that are mutually EXCLUSIVE, one of which the user picks. Email is ADDITIVE:
-- a notification can be in-app AND email. Adding 'email' to that CHECK would
-- make an exclusive column express a non-exclusive fact, and would silently
-- change what `trg_trigger_push_notify`'s
-- `WHEN (new.channel IS DISTINCT FROM 'in_app')` clause matches — i.e. it would
-- alter PUSH. Email's own state lives in `notification_deliveries` instead.
--
-- ── WHY A SEPARATE PREFERENCE TABLE RATHER THAN A CHANNEL COLUMN ON NP1 ──
--
-- NP1's own closing note anticipated widening its PK to (user_id, category,
-- channel). That is the tidier model on paper and the wrong change here, for
-- one concrete reason: `apply_notification_preferences()` reads that table on
-- EVERY delivery to decide `suppressed_at`, and `suppressed_at` is what the
-- in-app readers filter on AND what `push-notify` checks as its eligibility
-- gate. Widening that PK means editing that function — a change whose blast
-- radius is in-app and push, both frozen.
--
-- ── ABSENCE MEANS ENABLED, exactly as NP1 ───────────────────────
--
-- No backfill, no opt-in, no historical flood: every existing account is
-- already opted in without a row being written, and enabling a preference is
-- not an event. Only notifications created AFTER the (not yet written) enqueue
-- trigger exists can ever produce a delivery.
-- ============================================================


-- ── 1 · EMAIL PREFERENCES ──────────────────────────────────────
--
-- ⛔ NO CHECK CONSTRAINT ON `category`, matching NP1, and the reason is drift
-- rather than laziness. Verified against production 2026-08-31: the registry
-- holds 31 types across 7 categories, but `contacts`, `festival_accepted`,
-- `festival_declined` and `slot_changed` were all added OUTSIDE this repository
-- and appear in no migration. A CHECK written today would have been written
-- without `contacts`, and the next category added outside the repo would start
-- REJECTING preference writes — a user unable to save a setting, for a value
-- the platform itself considers valid. An unknown category here is inert
-- instead: nothing reads it, so it is a dead row, not an outage.
CREATE TABLE IF NOT EXISTS public.email_notification_preferences (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE public.email_notification_preferences IS
  'E1 — per-USER email delivery preferences, one row per category the user has '
  'an opinion about. Absence of a row means ENABLED, so operational email is on '
  'by default for every existing account with no backfill and no historical '
  'send. Per-user, never per-profile: delivery identity is '
  'notifications.to_user_id, and Identity v1.2 `U4` leaves to_profile_id NULL '
  'whenever it cannot be uniquely inferred, which would make a per-profile '
  'preference unenforceable for exactly those rows. Governs EMAIL delivery '
  'only: nothing here affects in-app, push, or whether a notification exists.';

COMMENT ON COLUMN public.email_notification_preferences.category IS
  'E1 — an EMAIL category, resolved by email_category_for_type(). Usually the '
  'same string as notification_expiry_policy.category; may differ where '
  'email_category_overrides says so. The reserved value ''all'' is the '
  'account-level master switch: enabled=false there means no operational email '
  'at all, whatever the per-category rows say.';


-- ── 2 · THE EMAIL CATEGORY OVERRIDE ────────────────────────────
--
-- ⭐⭐ WHY THIS EXISTS (owner, 2026-08-31). `slot_changed` carries a NULL
-- category in the live registry. NP1's `notification_category_is_mutable()`
-- treats NULL as UN-MUTABLE — correct for in-app, where "always deliver" is a
-- harmless default — but under E1 that would mean SET-TIME-CHANGE EMAIL THAT
-- CANNOT BE TURNED OFF. An un-disableable email is a support ticket and, at
-- scale, a spam complaint. It is the one thing this table exists to prevent.
--
-- ⛔⛔ AND THE OBVIOUS FIX IS FORBIDDEN, CORRECTLY. Categorising `slot_changed`
-- in `notification_expiry_policy` would make it mutable for IN-APP and PUSH
-- too, silently converting a notice that has always been delivered into one a
-- user can already have muted — because a `notification_preferences` row saying
-- `bookings = false` exists TODAY for anyone who set it, and would begin
-- applying retroactively to a type it never covered. That is a behaviour change
-- to two frozen channels, dressed as a data fix.
--
-- ⭐⭐ SO EMAIL OWNS ITS OWN MAPPING, AND ONLY WHERE IT DIFFERS. This is an
-- EXCEPTION LIST, ⛔ NOT a second registry. NP1's header states the rule this
-- obeys: "Two parallel type registries would drift, and this repo has that scar
-- twice already." A full email-side copy of all 31 types would be exactly that
-- scar a third time — and worse, because every future type would need
-- registering twice or silently fall out of the email model.
--
-- Resolution is one line: COALESCE(override, registry). A type with no row here
-- uses the notification category it always had, so adding this table changes
-- the email mapping of NOTHING except the rows it explicitly names.
--
-- ⚠ NO FOREIGN KEY TO notification_expiry_policy, deliberately. An FK would be
-- the stronger integrity guarantee and it would place a referencing constraint
-- ON the frozen registry, which this phase is not permitted to touch. V8 below
-- asserts referential validity instead, so a typo'd type fails loudly at
-- verification rather than silently overriding nothing.
CREATE TABLE IF NOT EXISTS public.email_category_overrides (
  type           text        PRIMARY KEY,
  email_category text        NOT NULL,
  note           text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_category_overrides IS
  'E1 — the EMAIL category for a notification type, where it differs from '
  'notification_expiry_policy.category. An EXCEPTION LIST, ⛔ not a second '
  'registry: a type with no row here keeps the category it already has, so this '
  'table changes the email mapping of nothing it does not name. Exists because '
  'email needs `slot_changed` to be mutable while in-app and push must keep '
  'treating it exactly as they do today — the registry cannot express both, and '
  'it is frozen. Also the mechanism by which email may later offer a finer '
  'user-facing grouping than the notification registry uses, without touching '
  'it. ⛔ Read-only to clients; seeded by migration.';

COMMENT ON COLUMN public.email_category_overrides.email_category IS
  'E1 — the category the EMAIL preference system uses for this type. May be a '
  'value that appears nowhere in notification_expiry_policy (''schedule'' is '
  'the first). ⛔ It must not be ''payments'' or ''account'' unless the intent '
  'is genuinely to make that type un-disableable — those are un-mutable via '
  'notification_category_is_mutable() and would produce mandatory email.';

-- ── THE SEED — two rows, and the pair is the point ─────────────
--
-- ⭐⭐ ONE SWITCH FOR ONE QUESTION (owner, 2026-09-01): "Schedule & slot
-- changes" governs BOTH types, because a performer asking "when do I go on"
-- does not distinguish between the running order being PUBLISHED and their own
-- slot being MOVED. Those are one concern with two triggers, and splitting them
-- across two switches would mean turning one off and still getting the other.
--
-- ⚠ 'schedule' IS A NEW, EMAIL-ONLY CATEGORY, and that is the point: it names
-- the thing the user actually has an opinion about rather than forcing these
-- types into `bookings` (offers and applications admin) or `events` (reminders
-- and lineup news), neither of which a performer muting them would expect to
-- also silence a change to when they play.
--
-- ⛔⛔ THE TWO ROWS ARE HERE FOR DIFFERENT REASONS, AND THE DIFFERENCE MATTERS
-- TO A FUTURE READER:
--
--   slot_changed        A DEFECT FIX. NULL in the registry, which
--                       notification_category_is_mutable() treats as
--                       un-mutable — correct for in-app ("always deliver"),
--                       but under E1 it would mean un-disableable email.
--                       Without this row the migration ships a switch the
--                       user cannot turn off.
--
--   set_times_released  A PRODUCT DECISION. It is already mutable (registry
--                       category `events`), so email works either way. This
--                       row moves it under the same user-facing switch as its
--                       twin. ⛔ Reversible by deleting one row; deleting it
--                       returns the type to the `events` email switch and
--                       breaks nothing.
--
-- ⛔ NEITHER ROW TOUCHES THE REGISTRY. In-app and push continue to treat both
-- types exactly as they did before this file existed — V10 provokes that.
INSERT INTO public.email_category_overrides (type, email_category, note) VALUES
  ('slot_changed', 'schedule',
   'E1 defect fix: NULL in notification_expiry_policy, which '
   'notification_category_is_mutable() treats as un-mutable. Correct for in-app '
   '(always deliver); would mean un-disableable email. Email-side only.'),
  ('set_times_released', 'schedule',
   'E1 product decision (owner, 2026-09-01): grouped with slot_changed so one '
   'switch answers "when do I go on". Registry category stays `events`, so '
   'in-app and push are unaffected.')
ON CONFLICT (type) DO NOTHING;   -- re-runnable; never overwrites a curated row


-- ── 3 · THE DELIVERY LEDGER, WHICH IS ALSO THE IDEMPOTENCY KEY ──
--
-- ⭐⭐ THE PRIMARY KEY IS THE ENTIRE DUPLICATE GUARANTEE. (notification_id,
-- channel) means one notification can have at most ONE email delivery row, for
-- all time. A retrying worker re-reads its own row and updates it; a second
-- enqueue attempt hits the PK and is refused by the database. There is no
-- application-level dedupe to get wrong, and no surrogate id — a surrogate
-- would permit exactly the duplicate this table exists to prevent.
--
-- ⛔⛔ NO RECIPIENT ADDRESS COLUMN, AND THAT IS A SECURITY DECISION, NOT AN
-- OMISSION. The address is resolved at send time from `auth.users` by a
-- service-role worker and never persisted here. Consequences, all wanted: this
-- table can never leak an address; a user who changes theirs has every pending
-- delivery follow them; and a row can never disagree with the account.
--
-- ⚠⚠ `channel` HERE IS NOT `notifications.channel`. They share a word and mean
-- different things, and confusing them is the likeliest mistake a future reader
-- makes. THAT column is CJ2's exclusive route choice ('push'|'in_app'|'off'),
-- one value per notification, chosen by the user. THIS column names WHICH
-- DELIVERY MECHANISM a ledger row accounts for, and rows are additive.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  notification_id     uuid        NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel             text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  attempts            integer     NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  PRIMARY KEY (notification_id, channel),
  -- ⚠ 'email' ONLY, stated rather than left open. Push is NOT recorded here and
  -- must not be: it has its own working pipeline, and this table would become a
  -- second, disagreeing account of whether a push happened.
  CONSTRAINT notification_deliveries_channel_check
    CHECK (channel IN ('email')),
  CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT notification_deliveries_attempts_check
    CHECK (attempts >= 0),
  -- ⚠ A SENT ROW MUST CARRY ITS TIMESTAMP AND NOTHING ELSE MAY. Without this a
  -- worker crash between "provider accepted" and "stamp sent_at" leaves a row
  -- that reads sent with no time, which no later sweep can tell from a bug.
  CONSTRAINT notification_deliveries_sent_at_agrees
    CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

COMMENT ON TABLE public.notification_deliveries IS
  'E1 — one row per (notification, delivery channel). The composite PRIMARY KEY '
  'IS the idempotency boundary: a notification can produce at most one email '
  'delivery, ever, so a worker retry updates its own row and a duplicate '
  'enqueue is refused by the database rather than by application logic. Email '
  'only — push has its own pipeline and must not be accounted for twice. '
  '⛔ Holds NO recipient address by design: the worker resolves it from '
  'auth.users at send time. Service-role only; no client ever reads it.';

COMMENT ON COLUMN public.notification_deliveries.channel IS
  'E1 — ⚠ NOT the same thing as notifications.channel. That column is CJ2''s '
  'exclusive route choice (push|in_app|off), one per notification. This one '
  'names the delivery mechanism a ledger row accounts for, and rows are '
  'additive. Constrained to ''email'' today.';

COMMENT ON COLUMN public.notification_deliveries.status IS
  'E1 — pending (enqueued, not yet attempted or awaiting retry) / sent '
  '(provider accepted it) / failed (give up; last_error says why). ⛔ There is '
  'deliberately no ''skipped'': a delivery that should not happen is never '
  'enqueued, so absence of a row is the honest record of "no email was owed".';

CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx
  ON public.notification_deliveries (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_deliveries_failed_idx
  ON public.notification_deliveries (updated_at)
  WHERE status = 'failed';


-- ── 4 · RESOLUTION — type to EMAIL category ────────────────────
--
-- ⭐ ONE LINE, AND THE PRECEDENCE IS THE WHOLE DESIGN: the override wins, the
-- registry is the default. A type with no override resolves exactly as it
-- always has, so this function is a no-op for 30 of the 31 live types.
--
-- ⚠ STILL RETURNS NULL for a type in neither place — a type invented after this
-- migration and never registered. That resolves to un-mutable (always deliver),
-- which is the same fail-toward-delivery direction NP1 chose and the
-- recoverable one. V9 exists so the condition is LOUD rather than latent.
CREATE OR REPLACE FUNCTION public.email_category_for_type(p_type text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT o.email_category FROM public.email_category_overrides   o WHERE o.type = p_type),
    (SELECT p.category       FROM public.notification_expiry_policy p WHERE p.type = p_type)
  );
$$;

COMMENT ON FUNCTION public.email_category_for_type(text) IS
  'E1 — the EMAIL category for a notification type: the override if one exists, '
  'otherwise notification_expiry_policy.category. ⛔ Reads the registry, never '
  'writes it. NULL when a type is registered nowhere, which resolves to '
  'un-mutable (always deliver) — the recoverable direction, and asserted '
  'against by V9.';


-- ── 5 · THE PREDICATE — "email this?" in one place ─────────────
--
-- ⛔ NOT A TRIGGER. It reads, it decides, it sends nothing and writes nothing.
-- It exists in the schema increment because it IS the semantics of the
-- preference model, and because a predicate can be proven by the verification
-- block below where a trigger could not be without creating deliveries.
--
-- ⭐⭐ IT REUSES `notification_category_is_mutable()` RATHER THAN RESTATING THE
-- RULE — called with the RESOLVED EMAIL category, which is an argument, ⛔ not
-- a modification. That function already encodes the owner's 2026-07-20 decision
-- that payments and account always deliver, so the brief's "essential account
-- email must not become suppressible through operational settings" is satisfied
-- by the rule that already exists, in one place, for both channels at once.
--
-- ⚠ SECURITY DEFINER, for the same reason NP1's trigger needs it: the eventual
-- caller runs as the notification's WRITER, who is almost never its recipient,
-- and under RLS an invoker-rights read of the recipient's preferences returns
-- nothing — a mute switch that reports success and does nothing.
CREATE OR REPLACE FUNCTION public.email_category_enabled(
  p_user_id  uuid,
  p_category text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  -- No recipient, no decision. A held notification (N1) has no delivery
  -- identity, so there is nobody to email.
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- payments / account / unresolvable always deliver — the existing rule.
  IF NOT public.notification_category_is_mutable(p_category) THEN
    RETURN true;
  END IF;

  -- The master switch, checked BEFORE the category row so that turning email
  -- off entirely cannot be contradicted by a stale per-category `true`.
  SELECT enabled INTO v_enabled
    FROM public.email_notification_preferences
   WHERE user_id = p_user_id AND category = 'all';
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN false;
  END IF;

  SELECT enabled INTO v_enabled
    FROM public.email_notification_preferences
   WHERE user_id = p_user_id AND category = p_category;

  -- Absence means enabled. Only an explicit false withholds.
  RETURN COALESCE(v_enabled, true);
END;
$$;

COMMENT ON FUNCTION public.email_category_enabled(uuid, text) IS
  'E1 — does this user want email for this EMAIL category? Absence of a '
  'preference row means YES. The reserved category ''all'' is the master switch '
  'and is checked first. Un-mutable categories (payments, account, and any '
  'unresolvable one) always return true, read from '
  'notification_category_is_mutable() rather than restated. ⛔ Decides DELIVERY '
  'only. Sends nothing: a predicate, not a trigger.';


-- ⭐ THE ONE FUNCTION PHASE 4 WILL CALL. Composed rather than duplicated, so
-- "which category is this type" and "does the user want it" each have exactly
-- one implementation and cannot drift apart.
CREATE OR REPLACE FUNCTION public.email_enabled_for_notification(
  p_user_id uuid,
  p_type    text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.email_category_enabled(p_user_id, public.email_category_for_type(p_type));
$$;

COMMENT ON FUNCTION public.email_enabled_for_notification(uuid, text) IS
  'E1 — should this user be emailed about a notification of this type? The '
  'composition of email_category_for_type() and email_category_enabled(), and '
  'the single entry point the Phase 4 enqueue trigger will use. ⛔ Sends '
  'nothing and enqueues nothing.';


-- ── 6 · RLS ────────────────────────────────────────────────────
--
-- ⚠⚠ REVOKE FIRST, THEN GRANT BACK — the MP1 pattern, ⛔ not NP1's. Supabase
-- grants ALL to anon and authenticated on every new table, so a table created
-- with RLS alone is still TABLE-granted to anon and relies entirely on a policy
-- being correct. Measured on production 2026-08-31 with the publishable key:
-- `push_subscriptions` (which revokes) answers 401; `notification_preferences`
-- (which does not) answers 200 with an empty array. Both are safe today; only
-- the first stays safe if a policy is ever dropped or mis-edited.

ALTER TABLE public.email_notification_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_notification_preferences TO authenticated;
GRANT ALL ON public.email_notification_preferences TO service_role;

DROP POLICY IF EXISTS email_notification_preferences_select_own ON public.email_notification_preferences;
CREATE POLICY email_notification_preferences_select_own
  ON public.email_notification_preferences FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS email_notification_preferences_write_own ON public.email_notification_preferences;
CREATE POLICY email_notification_preferences_write_own
  ON public.email_notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ⭐ THE OVERRIDE MAP IS READ-ONLY TO CLIENTS, and readable on purpose: the
-- settings screen must know which categories to draw, and the mapping is not
-- secret — it is the same public fact as "applications are a booking notice".
-- ⛔ WRITE stays with the migration. A client that could write here could
-- remap a type into `account` and make its own email un-disableable, or into a
-- category it has muted and silence a notice it should receive.
ALTER TABLE public.email_category_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_category_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_category_overrides TO authenticated;
GRANT ALL ON public.email_category_overrides TO service_role;

DROP POLICY IF EXISTS email_category_overrides_read ON public.email_category_overrides;
CREATE POLICY email_category_overrides_read
  ON public.email_category_overrides FOR SELECT TO authenticated
  USING (true);


-- ⛔⛔ THE LEDGER IS SERVICE-ROLE ONLY — NO CLIENT READS IT, EVER.
-- RLS is enabled AND every client grant is revoked, so it is closed by two
-- independent mechanisms. There is deliberately NO policy: with RLS on and no
-- policy, even a role holding a table grant sees zero rows — belt and braces
-- against a future GRANT written without reading this comment. service_role
-- bypasses RLS by design and is unaffected.
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;


-- ── 7 · FUNCTION EXPOSURE ──────────────────────────────────────
--
-- ⚠ A SECURITY DEFINER function is executable by PUBLIC unless revoked, and the
-- two preference-reading ones read ANOTHER user's rows by construction. Left
-- open, any authenticated user could probe whether an arbitrary account has
-- muted a category. Free to close, so closed.
REVOKE ALL ON FUNCTION public.email_category_enabled(uuid, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_enabled_for_notification(uuid, text)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_category_enabled(uuid, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.email_enabled_for_notification(uuid, text) TO service_role;

-- ⭐ The type→category resolver takes NO user id and reads no user data, so the
-- settings screen may call it to label its own switches.
REVOKE ALL ON FUNCTION public.email_category_for_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_category_for_type(text) TO authenticated, service_role;


-- ============================================================
-- ⚠ NOT DONE HERE — the deliberate order
-- ============================================================
-- 1 · NO ENQUEUE TRIGGER. Nothing writes notification_deliveries yet, so this
--     migration is behaviourally inert — the shape is verifiable on its own,
--     exactly as NP1's engine was before its UI.
-- 2 · NO WORKER, NO PROVIDER CALL, NO TEMPLATES.
-- 3 · NO SETTINGS UI. Until it exists no preference row is ever written, so
--     every category is enabled — the intended default for operational email.
-- 4 · `notifications`, `notification_expiry_policy`, `notification_preferences`
--     and `notification_category_is_mutable()` are ALL UNCHANGED.
-- ============================================================


-- ============================================================
-- VERIFICATION — run AFTER applying, as one script.
--
-- ⚠⚠ WRAPPED IN BEGIN … ROLLBACK ON PURPOSE. V2, V4, V5, V6 and V10 PROVOKE
-- the constraints rather than describing them — they insert a temporary user, a
-- temporary notification and temporary rows, because a check that only reads
-- catalogue metadata proves a constraint was DECLARED, not that it FIRES. The
-- rollback is what makes provoking safe: nothing survives, pass or fail. If any
-- block raises, the transaction aborts and nothing survives either.
--
-- ⚠ ONE SIDE EFFECT, NAMED SO IT IS NOT A SURPRISE: inserting a notification
-- fires the existing `trg_trigger_push_notify`, exactly as every ordinary
-- notification does. The test row's type is not in push-notify's PUSH_TYPES, so
-- the function no-ops and NO PUSH IS DELIVERED — and pg_net queues its request
-- transactionally, so the ROLLBACK discards even that. Push is not touched.
-- ============================================================

BEGIN;

-- V1 · the shape the rest of the milestone depends on.
DO $v1$
BEGIN
  IF to_regclass('public.email_notification_preferences') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: email_notification_preferences does not exist';
  END IF;
  IF to_regclass('public.email_category_overrides') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: email_category_overrides does not exist';
  END IF;
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: notification_deliveries does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
     WHERE table_schema = 'public' AND table_name = 'notification_deliveries'
       AND constraint_name = 'notification_deliveries_pkey'
       AND column_name IN ('notification_id', 'channel')
     GROUP BY constraint_name HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: the primary key is not (notification_id, channel) — retries could duplicate email';
  END IF;

  -- The address must never be stored here.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_deliveries'
       AND column_name IN ('email', 'to_email', 'recipient', 'recipient_email', 'address')
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: notification_deliveries carries a recipient address column — it must resolve from auth.users at send time';
  END IF;

  RAISE NOTICE 'V1 PASSED: three tables exist, PK is (notification_id, channel), no address column';
END $v1$;


-- V2 · PROVOKE THE IDEMPOTENCY BOUNDARY. Passing means the duplicate was
--      REFUSED, not that nothing was attempted.
DO $v2$
DECLARE
  v_user uuid := gen_random_uuid();
  v_note uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'e1-verify@example.invalid');

  INSERT INTO public.notifications (to_user_id, type, message, data, read)
  VALUES (v_user, 'generic', 'E1 verification row', '{}'::jsonb, false)
  RETURNING id INTO v_note;

  INSERT INTO public.notification_deliveries (notification_id, channel)
  VALUES (v_note, 'email');

  BEGIN
    INSERT INTO public.notification_deliveries (notification_id, channel)
    VALUES (v_note, 'email');
    RAISE EXCEPTION 'V2 FAILED: a SECOND email delivery was accepted for one notification — a worker retry would send the same email twice';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- intended
  END;

  BEGIN
    INSERT INTO public.notification_deliveries (notification_id, channel)
    VALUES (v_note, 'push');
    RAISE EXCEPTION 'V2 FAILED: channel push was accepted — push has its own pipeline and must not be double-accounted here';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- intended
  END;

  RAISE NOTICE 'V2 PASSED: duplicate email delivery refused, non-email channel refused';
END $v2$;


-- V3 · the tables are closed to clients, and the worker can still work.
DO $v3$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_notification_preferences'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_category_overrides'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_deliveries'::regclass) THEN
    RAISE EXCEPTION 'V3 FAILED: RLS is off on one of the three E1 tables';
  END IF;

  IF has_table_privilege('anon', 'public.email_notification_preferences', 'SELECT')
     OR has_table_privilege('anon', 'public.email_category_overrides', 'SELECT')
     OR has_table_privilege('anon', 'public.notification_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'V3 FAILED: anon holds a SELECT privilege on an E1 table';
  END IF;

  IF has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'V3 FAILED: authenticated can read the delivery ledger — it is worker-only';
  END IF;

  -- The override map is readable so the settings screen can label switches,
  -- but a client must never be able to remap a type.
  IF NOT has_table_privilege('authenticated', 'public.email_category_overrides', 'SELECT') THEN
    RAISE EXCEPTION 'V3 FAILED: authenticated cannot read the override map — the settings screen could not label its switches';
  END IF;
  IF has_table_privilege('authenticated', 'public.email_category_overrides', 'INSERT')
     OR has_table_privilege('authenticated', 'public.email_category_overrides', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.email_category_overrides', 'DELETE') THEN
    RAISE EXCEPTION 'V3 FAILED: a client can WRITE the override map — it could remap a type into account and make its own email un-disableable';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.notification_deliveries', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.notification_deliveries', 'UPDATE') THEN
    RAISE EXCEPTION 'V3 FAILED: service_role cannot read/update the ledger — the worker would silently deliver nothing';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.email_notification_preferences', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.email_notification_preferences', 'UPDATE') THEN
    RAISE EXCEPTION 'V3 FAILED: authenticated cannot write its own email preferences — the settings screen would fail';
  END IF;

  IF has_function_privilege('anon', 'public.email_category_enabled(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_category_enabled(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_enabled_for_notification(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V3 FAILED: a preference-reading function is client-callable — any user could probe another account';
  END IF;

  RAISE NOTICE 'V3 PASSED: RLS on all three, anon has nothing, ledger worker-only, override map read-only, predicates not client-callable';
END $v3$;


-- V4 · THE PREFERENCE SEMANTICS, provoked one case at a time.
DO $v4$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'e1-verify-prefs@example.invalid');

  -- 1 · absence means ENABLED. The whole "no backfill, no opt-in" claim.
  IF NOT public.email_category_enabled(v_user, 'bookings') THEN
    RAISE EXCEPTION 'V4 FAILED: absence of a row did not mean enabled — every existing account would silently get no email';
  END IF;

  -- 2 · an explicit false withholds.
  INSERT INTO public.email_notification_preferences (user_id, category, enabled)
  VALUES (v_user, 'bookings', false);
  IF public.email_category_enabled(v_user, 'bookings') THEN
    RAISE EXCEPTION 'V4 FAILED: an explicit enabled=false did not withhold — the off switch does nothing';
  END IF;

  -- 3 · a different category is unaffected.
  IF NOT public.email_category_enabled(v_user, 'events') THEN
    RAISE EXCEPTION 'V4 FAILED: muting one category muted another';
  END IF;

  -- 4 · the master switch overrides an explicit per-category TRUE.
  INSERT INTO public.email_notification_preferences (user_id, category, enabled)
  VALUES (v_user, 'events', true), (v_user, 'all', false);
  IF public.email_category_enabled(v_user, 'events') THEN
    RAISE EXCEPTION 'V4 FAILED: the master switch did not override a per-category true';
  END IF;

  -- 5 · ESSENTIAL CATEGORIES SURVIVE THE MASTER SWITCH, read from the EXISTING
  --     notification_category_is_mutable(). The brief's "essential account
  --     email must not become suppressible" — asserted, not assumed.
  IF NOT public.email_category_enabled(v_user, 'payments') THEN
    RAISE EXCEPTION 'V4 FAILED: payments email was suppressed by an operational preference';
  END IF;
  IF NOT public.email_category_enabled(v_user, 'account') THEN
    RAISE EXCEPTION 'V4 FAILED: account email was suppressed by an operational preference';
  END IF;

  -- 6 · an unresolvable category fails toward delivery, matching NP1.
  IF NOT public.email_category_enabled(v_user, NULL) THEN
    RAISE EXCEPTION 'V4 FAILED: a NULL category was suppressed — it must fail toward delivery';
  END IF;

  -- 7 · a held notification has nobody to email.
  IF public.email_category_enabled(NULL, 'bookings') THEN
    RAISE EXCEPTION 'V4 FAILED: a NULL recipient returned true — a held (N1) row would produce an undeliverable email';
  END IF;

  RAISE NOTICE 'V4 PASSED: absence=on, explicit off works, master overrides, payments/account/NULL always on, NULL user never';
END $v4$;


-- V5 · PUSH AND IN-APP ARE UNCHANGED. The single most important check here.
DO $v5$
DECLARE
  v_user uuid := gen_random_uuid();
  v_def  text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO v_def
    FROM pg_trigger
   WHERE tgrelid = 'public.notifications'::regclass
     AND tgname  = 'trg_trigger_push_notify'
     AND NOT tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'V5 FAILED: trg_trigger_push_notify is gone — push would stop entirely';
  END IF;
  IF v_def NOT LIKE '%in_app%' THEN
    RAISE EXCEPTION 'V5 FAILED: the push trigger lost its WHEN channel IS DISTINCT FROM in_app clause';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass
                   AND tgname = 'trg_apply_notification_preferences' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'V5 FAILED: trg_apply_notification_preferences is gone — category mutes would stop working';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass
                   AND tgname = 'trg_apply_notification_channel' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'V5 FAILED: trg_apply_notification_channel is gone';
  END IF;

  -- Exactly three triggers on notifications: E1 added none.
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'V5 FAILED: notifications does not carry exactly the 3 known triggers — E1 must add none';
  END IF;

  -- notifications.channel was NOT widened. Provoked, not read.
  INSERT INTO auth.users (id, email) VALUES (v_user, 'e1-verify-push@example.invalid');
  BEGIN
    INSERT INTO public.notifications (to_user_id, type, message, channel, read)
    VALUES (v_user, 'generic', 'E1 channel probe', 'email', false);
    RAISE EXCEPTION 'V5 FAILED: notifications.channel accepted email — CJ2 exclusive route column has been widened and the push trigger WHEN clause now means something different';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- intended: the CHECK is still (push, in_app, off)
  END;

  IF to_regclass('public.push_subscriptions') IS NULL THEN
    RAISE EXCEPTION 'V5 FAILED: push_subscriptions is gone';
  END IF;
  IF has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'V5 FAILED: anon can read push credentials';
  END IF;

  RAISE NOTICE 'V5 PASSED: 3 triggers intact incl. push WHEN clause, channel CHECK unwidened, push_subscriptions untouched';
END $v5$;


-- V6 · a sent row cannot lie about when it was sent.
DO $v6$
DECLARE
  v_user uuid := gen_random_uuid();
  v_note uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'e1-verify-sent@example.invalid');
  INSERT INTO public.notifications (to_user_id, type, message, read)
  VALUES (v_user, 'generic', 'E1 sent_at probe', false)
  RETURNING id INTO v_note;

  BEGIN
    INSERT INTO public.notification_deliveries (notification_id, channel, status)
    VALUES (v_note, 'email', 'sent');
    RAISE EXCEPTION 'V6 FAILED: status=sent was accepted with a NULL sent_at';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.notification_deliveries (notification_id, channel, status, sent_at)
    VALUES (v_note, 'email', 'pending', now());
    RAISE EXCEPTION 'V6 FAILED: a pending row was accepted carrying a sent_at';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.notification_deliveries (notification_id, channel, status)
    VALUES (v_note, 'email', 'queued');
    RAISE EXCEPTION 'V6 FAILED: an unknown status was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.notification_deliveries (notification_id, channel, status, sent_at, provider_message_id)
  VALUES (v_note, 'email', 'sent', now(), 'probe-provider-id');

  RAISE NOTICE 'V6 PASSED: sent requires sent_at, pending forbids it, unknown status refused, valid row accepted';
END $v6$;


-- V7 · nothing was enqueued by merely applying the migration.
DO $v7$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM public.notification_deliveries d
    JOIN public.notifications nf ON nf.id = d.notification_id
   WHERE nf.message NOT LIKE 'E1 %';
  IF n <> 0 THEN
    RAISE EXCEPTION 'V7 FAILED: % delivery rows exist that this script did not create — something is already enqueuing, which Phase 2 must not do', n;
  END IF;
  RAISE NOTICE 'V7 PASSED: no deliveries enqueued — the migration is behaviourally inert, as intended';
END $v7$;


-- V8 · EVERY OVERRIDE NAMES A REAL TYPE. This is the integrity the deliberately
--      omitted foreign key would have given, checked instead of enforced so the
--      frozen registry carries no new constraint. A typo here would silently
--      override nothing, which is the failure mode this catches.
DO $v8$
DECLARE bad text;
BEGIN
  SELECT string_agg(o.type, ', ') INTO bad
    FROM public.email_category_overrides o
   WHERE NOT EXISTS (
     SELECT 1 FROM public.notification_expiry_policy p WHERE p.type = o.type
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'V8 FAILED: override rows name types that do not exist in the registry (%) — they would silently do nothing', bad;
  END IF;

  -- An override into an un-mutable category would create MANDATORY email.
  SELECT string_agg(type, ', ') INTO bad
    FROM public.email_category_overrides
   WHERE NOT public.notification_category_is_mutable(email_category);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'V8 FAILED: override maps % into an un-mutable category — that email could never be turned off', bad;
  END IF;

  RAISE NOTICE 'V8 PASSED: every override names a real type and lands in a mutable category';
END $v8$;


-- V9 · ⭐⭐ NO TYPE PRODUCES UN-DISABLEABLE EMAIL. The reason this migration was
--      revised: `slot_changed` had a NULL category, which
--      notification_category_is_mutable() treats as un-mutable. Every
--      OPERATIONAL type must now resolve to a mutable email category; only the
--      two deliberately un-mutable ones may not.
DO $v9$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.type || ' -> ' || COALESCE(public.email_category_for_type(p.type), 'NULL'), ', ')
    INTO bad
    FROM public.notification_expiry_policy p
   WHERE NOT public.notification_category_is_mutable(public.email_category_for_type(p.type))
     AND COALESCE(p.category, '') NOT IN ('payments', 'account');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'V9 FAILED: these types resolve to an un-mutable EMAIL category and would send email nobody can turn off: %', bad;
  END IF;
  RAISE NOTICE 'V9 PASSED: every operational type resolves to a mutable email category';
END $v9$;


-- V10 · ⭐⭐ THE SCHEDULE SWITCH, ALL SEVEN CLAIMS (owner, 2026-09-01).
--
--   1 slot_changed        resolves to schedule
--   2 set_times_released  resolves to schedule
--   3 disabling schedule disables BOTH
--   4 disabling schedule does NOT disable slot_offer      (a bookings notice)
--   5 disabling schedule does NOT disable ordinary events notices
--   6 the registry still has slot_changed.category = NULL
--   7 the registry still has set_times_released.category = 'events'
--
-- ⛔⛔ 6 AND 7 ARE THE ONES THAT MATTER MOST, and they are why this block reads
-- the frozen registry directly rather than trusting that nothing touched it.
-- The whole design rests on email remapping these two types WITHOUT the
-- notification registry changing; if either assertion ever fails, in-app and
-- push mute behaviour has silently moved and existing notification_preferences
-- rows have begun applying to types they never covered.
DO $v10$
DECLARE
  v_user uuid := gen_random_uuid();
  v_slot text;
  v_stre text;
BEGIN
  -- ── 6 · the registry still says NULL for slot_changed ────────
  SELECT category INTO v_slot
    FROM public.notification_expiry_policy WHERE type = 'slot_changed';
  IF v_slot IS NOT NULL THEN
    RAISE EXCEPTION 'V10.6 FAILED: notification_expiry_policy.category for slot_changed is now % — the frozen registry was modified, so in-app/push mute behaviour has changed and existing notification_preferences rows now apply to it', v_slot;
  END IF;
  IF public.notification_category_is_mutable(v_slot) THEN
    RAISE EXCEPTION 'V10.6 FAILED: slot_changed became mutable for IN-APP — a frozen-channel behaviour change';
  END IF;

  -- ── 7 · the registry still says events for set_times_released ─
  SELECT category INTO v_stre
    FROM public.notification_expiry_policy WHERE type = 'set_times_released';
  IF v_stre IS DISTINCT FROM 'events' THEN
    RAISE EXCEPTION 'V10.7 FAILED: notification_expiry_policy.category for set_times_released is %, expected events — the email override must NOT have been applied to the registry', COALESCE(v_stre, 'NULL');
  END IF;

  -- ── 1 & 2 · both resolve to the EMAIL category schedule ──────
  IF public.email_category_for_type('slot_changed') <> 'schedule' THEN
    RAISE EXCEPTION 'V10.1 FAILED: slot_changed does not resolve to the schedule email category';
  END IF;
  IF public.email_category_for_type('set_times_released') <> 'schedule' THEN
    RAISE EXCEPTION 'V10.2 FAILED: set_times_released does not resolve to the schedule email category — the override did not win over the registry';
  END IF;

  INSERT INTO auth.users (id, email) VALUES (v_user, 'e1-verify-slot@example.invalid');

  -- Both are ON by default, before any preference row exists.
  IF NOT public.email_enabled_for_notification(v_user, 'slot_changed')
     OR NOT public.email_enabled_for_notification(v_user, 'set_times_released') THEN
    RAISE EXCEPTION 'V10 FAILED: schedule email is off by default — operational email must be on';
  END IF;

  -- ── 3 · one switch turns BOTH off ────────────────────────────
  INSERT INTO public.email_notification_preferences (user_id, category, enabled)
  VALUES (v_user, 'schedule', false);

  IF public.email_enabled_for_notification(v_user, 'slot_changed') THEN
    RAISE EXCEPTION 'V10.3 FAILED: slot_changed email could NOT be turned off — the defect this override exists to fix';
  END IF;
  IF public.email_enabled_for_notification(v_user, 'set_times_released') THEN
    RAISE EXCEPTION 'V10.3 FAILED: set_times_released email survived the schedule switch — the two types are not governed together';
  END IF;

  -- ── 4 · a bookings notice is unaffected ──────────────────────
  IF NOT public.email_enabled_for_notification(v_user, 'slot_offer') THEN
    RAISE EXCEPTION 'V10.4 FAILED: muting schedule also muted slot_offer, which is a bookings notice';
  END IF;

  -- ── 5 · ordinary events notices are unaffected ───────────────
  --    ⚠ set_times_released can no longer serve as the events probe — it is
  --    now a schedule notice. These three are the events category proper.
  IF NOT public.email_enabled_for_notification(v_user, 'event_reminder') THEN
    RAISE EXCEPTION 'V10.5 FAILED: muting schedule also muted event_reminder';
  END IF;
  IF NOT public.email_enabled_for_notification(v_user, 'event_updated') THEN
    RAISE EXCEPTION 'V10.5 FAILED: muting schedule also muted event_updated';
  END IF;
  IF NOT public.email_enabled_for_notification(v_user, 'event_published') THEN
    RAISE EXCEPTION 'V10.5 FAILED: muting schedule also muted event_published';
  END IF;

  -- ⭐ AND THE CONVERSE, so the pair is proven separable in both directions:
  --   muting `events` must not silence the schedule switch's types.
  INSERT INTO public.email_notification_preferences (user_id, category, enabled)
  VALUES (v_user, 'events', false);
  DELETE FROM public.email_notification_preferences
   WHERE user_id = v_user AND category = 'schedule';
  IF NOT public.email_enabled_for_notification(v_user, 'set_times_released') THEN
    RAISE EXCEPTION 'V10.5 FAILED: muting events silenced set_times_released — the override is not taking precedence over the registry category';
  END IF;
  IF public.email_enabled_for_notification(v_user, 'event_reminder') THEN
    RAISE EXCEPTION 'V10.5 FAILED: the events switch itself stopped working';
  END IF;

  -- A type with no override still falls through to the registry.
  IF public.email_category_for_type('new_application') <> 'bookings' THEN
    RAISE EXCEPTION 'V10 FAILED: an un-overridden type did not fall through to the registry';
  END IF;

  RAISE NOTICE 'V10 PASSED: registry untouched (slot_changed NULL, set_times_released events); both map to schedule; one switch mutes both; slot_offer and events notices unaffected in both directions';
END $v10$;

-- ⛔ NOTHING THIS SCRIPT CREATED SURVIVES.
ROLLBACK;
