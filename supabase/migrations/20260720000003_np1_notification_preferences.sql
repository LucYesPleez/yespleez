-- ============================================================
-- NP1 · NOTIFICATION PREFERENCES — preferences govern DELIVERY,
--       never EXISTENCE.
-- Requires: 20260720000000_n1, 20260720000001_n3, 20260720000002_n4
-- ============================================================
--
-- The owner's rule, 2026-07-20:
--
--   "Preferences govern delivery, never existence. Notification rows are
--    historical facts and are always recorded. Suppression happens only at
--    delivery time, including when held notifications are delivered after a
--    profile is claimed."
--
-- This is `N1`'s principle applied to a second cause. `N1` refused to discard
-- a notification because its recipient had no account yet; NP1 refuses to
-- discard one because its recipient does not want to see it. In both cases the
-- row is a fact about something that happened, and in both cases the platform
-- keeps it and withholds only the delivery:
--
--     "A held notification is an asset; a suppressed one is a deleted fact."
--
-- So this migration adds no way to prevent a notification being written. There
-- is deliberately no "do not create" path anywhere below.
--
-- ── DELIVERY IS A TRANSITION, NOT A CALL SITE ───────────────────
--
-- A notification is delivered at the moment to_user_id becomes non-NULL. That
-- happens on TWO paths:
--
--   1. an ordinary insert that already carries a delivery identity
--   2. `N3` claim delivery, which UPDATEs to_user_id on a held row
--
-- Both are the same event. So suppression is bound to the transition with a
-- trigger, exactly as `N3` binds claim.completed to profiles.user_id going
-- NULL → NOT NULL, rather than being implemented in writeNotification.js.
--
-- Putting it in the client would mean: a preference read on every write, a
-- second implementation for the claim path (which is SQL and has no client),
-- and a rule the sixteenth call site forgets. The header of
-- writeNotification.js already records what that costs — fifteen write paths,
-- nine of them bypassing the helper.
--
-- ── WHY PREFERENCES ARE PER-USER, NOT PER-PROFILE ───────────────
--
-- Not merely because delivery keys on to_user_id. The decisive reason is
-- Identity v1.2 `U4`: to_profile_id is NULL whenever the destination profile
-- cannot be uniquely inferred, and those NULLs are correct answers, not gaps.
-- A per-profile preference would be UNENFORCEABLE for exactly those rows —
-- there is no profile to look the preference up against. Per-user is the only
-- scope that covers every notification.
--
-- ── ABSENCE MEANS ENABLED ───────────────────────────────────────
--
-- No row means delivered. Three consequences, all wanted: no backfill for
-- existing users; a newly added notification type is ON by default rather than
-- silently muted for everybody; and a failed preference read cannot
-- accidentally mute someone.
-- ============================================================


-- ── 1 · EVERY TYPE BELONGS TO A CATEGORY ───────────────────────
-- 27 types is far too many to put in front of a user. Categories are the unit
-- a person actually has an opinion about.
--
-- The category lives on the EXISTING per-type table rather than in a second
-- registry of its own. Two parallel type registries would drift, and this
-- repo has that scar twice already: lib/eventBadges.js exists because three
-- copies of the same definitions disagreed on casing, and UnclaimedBadge
-- exists because the pill had been re-implemented per page. One row per type,
-- carrying everything known about that type.
--
-- The table name still says "expiry" and is now slightly narrow. That is
-- preferred to renaming a table that shipped hours ago — the comment carries
-- the truth, and a rename would churn migration history for cosmetics.
ALTER TABLE public.notification_expiry_policy
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON TABLE public.notification_expiry_policy IS
  'Per-type notification registry. `policy` is the Phase 13.2 `N4` expiry rule '
  '(never / event / enquiry). `category` is the NP1 preference grouping — the '
  'unit a user mutes. A type absent from this table is never expired and, '
  'having no category, is never suppressed: both defaults fail toward '
  'delivery, which is the recoverable direction.';

COMMENT ON COLUMN public.notification_expiry_policy.category IS
  'NP1 preference grouping: bookings / events / social / payments / messages / '
  'account. NULL means the type predates categorisation and is always '
  'delivered.';

UPDATE public.notification_expiry_policy SET category = 'bookings' WHERE type IN (
  'new_application','shortlisted','application_declined',
  'slot_offer','slot_accepted','slot_declined','slot_removed',
  'event_invite','invite_accepted','invite_declined',
  'booking_confirmed','booking_cancelled','availability_request');

UPDATE public.notification_expiry_policy SET category = 'events' WHERE type IN (
  'event_reminder','event_updated','event_published','event_nearly_full',
  'set_times_released','festival_opened');

UPDATE public.notification_expiry_policy SET category = 'social' WHERE type IN (
  'new_follower','venue_followed','artist_updated');

UPDATE public.notification_expiry_policy SET category = 'payments' WHERE type IN (
  'payment_requested','payment_received');

UPDATE public.notification_expiry_policy SET category = 'messages' WHERE type IN (
  'new_message');

UPDATE public.notification_expiry_policy SET category = 'account' WHERE type IN (
  'profile_claimed','generic');

-- Types the N4 migration never classified (festival_opened, new_message,
-- artist_updated, generic) are inserted here so the registry covers all 27.
-- They remain policy='never' — categorisation is not an expiry decision.
INSERT INTO public.notification_expiry_policy (type, policy, category, note) VALUES
  ('festival_opened', 'never', 'events',   'NP1: announcement; no event_id today so it cannot be event-bound'),
  ('new_message',     'never', 'messages', 'NP1: messaging unbuilt; conversations are not date-bound'),
  ('artist_updated',  'never', 'social',   'NP1: a profile change names no date'),
  ('generic',         'never', 'account',  'NP1: catch-all; no semantics to reason about')
ON CONFLICT (type) DO UPDATE SET category = EXCLUDED.category;


-- ── 2 · THE PREFERENCES THEMSELVES ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE public.notification_preferences IS
  'NP1 — per-USER delivery preferences, one row per muted category. Absence of '
  'a row means ENABLED, so no backfill is required and a new type is on by '
  'default. Per-user rather than per-profile because Identity v1.2 `U4` leaves '
  'to_profile_id NULL whenever it cannot be uniquely inferred, which would make '
  'a per-profile preference unenforceable for exactly those rows. '
  'Governs DELIVERY only — nothing here can prevent a notification being '
  'written.';

-- This table holds user data, so it ships WITH RLS and WITH policies, in the
-- migration. The owner's standing rule is that schema must be reproducible
-- from the repository — dashboard-applied DDL is a HIGH-rated existing defect
-- (live-schema audit D5b). A new table containing per-user rows must never be
-- created open and tightened later from a dialog.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_select_own ON public.notification_preferences;
CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS notification_preferences_write_own ON public.notification_preferences;
CREATE POLICY notification_preferences_write_own
  ON public.notification_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── 3 · THE SUPPRESSION MARK ───────────────────────────────────
-- Same shape as `N4`'s expired_at, deliberately: mark, never delete. A
-- suppressed notification is a fact that happened and was not shown.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;

COMMENT ON COLUMN public.notifications.suppressed_at IS
  'NP1 — when delivery was withheld because the recipient had muted this '
  'category. NULL means deliverable. The row is retained: preferences govern '
  'delivery, never existence. Readers MUST require this to be NULL, alongside '
  'to_user_id, or muted notifications reappear in the feed.';


-- ── 4 · CATEGORIES THAT CANNOT BE MUTED ────────────────────────
-- Owner's decision, 2026-07-20: payments and account always deliver.
--
-- A missed payment or an account/claim notice has consequences OUTSIDE the
-- app, and neither is the kind of noise anyone rationally opts out of. Booking
-- notices stay mutable — a busy artist may legitimately want them off, and
-- overriding that would be the platform deciding it knows better.
CREATE OR REPLACE FUNCTION public.notification_category_is_mutable(p_category text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_category IS NOT NULL
     AND p_category NOT IN ('payments', 'account');
$$;

COMMENT ON FUNCTION public.notification_category_is_mutable(text) IS
  'NP1 — payments and account always deliver, per the owner 2026-07-20. A NULL '
  'category (an uncategorised type) is also treated as un-mutable, so an '
  'unclassified type is delivered rather than silently withheld.';


-- ── 5 · SUPPRESSION AT THE MOMENT OF DELIVERY ──────────────────
--
-- ⚠ SECURITY DEFINER, AND IT IS REQUIRED HERE — NOT A CONVENIENCE.
--
-- Most notifications are written by somebody OTHER than the recipient: an
-- artist applies and the venue is notified; a host shortlists and the artist
-- is notified. The trigger must therefore read the RECIPIENT's preferences
-- while running as the SENDER.
--
-- With invoker rights and RLS on notification_preferences (select own only),
-- that read returns NOTHING for every cross-user notification. Combined with
-- "absence means enabled", preferences would then appear to work — no error,
-- no warning — while silently never suppressing anything except a user's
-- notifications to themselves. That is the worst available failure: a mute
-- switch that reports success and does nothing.
--
-- search_path is pinned so the elevated function cannot be redirected to a
-- shadowed table.
CREATE OR REPLACE FUNCTION public.apply_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category text;
  v_enabled  boolean;
BEGIN
  -- Only ever acts at the moment of delivery: to_user_id becoming non-NULL.
  IF NEW.to_user_id IS NULL THEN
    RETURN NEW;                       -- held (N1) — not delivered, nothing to suppress
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.to_user_id IS NOT NULL THEN
    RETURN NEW;                       -- already delivered; not a delivery event
  END IF;
  IF NEW.suppressed_at IS NOT NULL THEN
    RETURN NEW;                       -- an explicit caller decision is left alone
  END IF;

  SELECT category INTO v_category
    FROM public.notification_expiry_policy
   WHERE type = NEW.type;

  IF NOT public.notification_category_is_mutable(v_category) THEN
    RETURN NEW;                       -- payments / account / uncategorised: always deliver
  END IF;

  SELECT enabled INTO v_enabled
    FROM public.notification_preferences
   WHERE user_id = NEW.to_user_id
     AND category = v_category;

  -- Absence means enabled. Only an explicit `false` withholds delivery.
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    NEW.suppressed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_notification_preferences() IS
  'NP1 — stamps suppressed_at when the recipient has muted this notification''s '
  'category, at the moment to_user_id becomes non-NULL. Covers BOTH delivery '
  'paths: an ordinary insert and `N3` claim delivery. SECURITY DEFINER because '
  'the writer is usually not the recipient, and under RLS an invoker-rights '
  'read of the recipient''s preferences would silently return nothing.';

DROP TRIGGER IF EXISTS trg_apply_notification_preferences ON public.notifications;

CREATE TRIGGER trg_apply_notification_preferences
  BEFORE INSERT OR UPDATE OF to_user_id ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_notification_preferences();


-- ── 6 · READERS' INDEX ─────────────────────────────────────────
-- Every feed query is now (to_user_id, suppressed_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_notifications_deliverable
  ON public.notifications(to_user_id)
  WHERE suppressed_at IS NULL;


-- ============================================================
-- ⚠ NOT DONE HERE
-- ============================================================
--
-- 1 · NO UI. The preferences screen is a separate increment. Until it exists
--     no row is ever written to notification_preferences, so every category
--     is enabled and this migration is behaviourally inert. That is the
--     intended order: the engine is verifiable on its own.
--
-- 2 · READERS ARE NOT YET FILTERING on suppressed_at. Until the app change
--     lands, a suppressed row would still surface. Harmless while no
--     preferences exist (nothing is ever suppressed), and it is the very next
--     step. THE APP CHANGE MUST LAND BEFORE THE UI.
--
-- 3 · NO CHANNELS. In-app only. Push notifications are a later milestone and
--     will need a channel dimension; the PK is (user_id, category) and would
--     become (user_id, category, channel). Deliberately not pre-built —
--     the shape of push delivery is not yet decided.
-- ============================================================


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. Every one of the 27 types now has a category (expect 0 rows):
--
--      SELECT type FROM public.notification_expiry_policy WHERE category IS NULL;
--
-- 2. Category spread (expect bookings 13, events 6, social 3, payments 2,
--    messages 1, account 2 — 27 total):
--
--      SELECT category, count(*) FROM public.notification_expiry_policy
--       GROUP BY category ORDER BY category;
--
-- 3. The un-mutable rule:
--
--      SELECT public.notification_category_is_mutable('bookings'),  -- true
--             public.notification_category_is_mutable('payments'),  -- false
--             public.notification_category_is_mutable('account'),   -- false
--             public.notification_category_is_mutable(NULL);        -- false
--
-- 4. The trigger exists and covers both delivery paths:
--
--      SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--       WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal;
--
-- 5. Preferences are locked down (expect rowsecurity = true, 2 policies):
--
--      SELECT relrowsecurity FROM pg_class
--       WHERE oid = 'public.notification_preferences'::regclass;
--      SELECT count(*) FROM pg_policies
--       WHERE tablename = 'notification_preferences';
-- ============================================================
