-- ============================================================
-- N1 · HELD NOTIFICATIONS — a notification to an unclaimed profile
--      is CREATED AND HELD, never suppressed.
-- Phase 13.2 Q1, docs/phase-13-q1-notifications-unclaimed-owners-2026-07.md
-- ============================================================
--
-- WHAT WAS WRONG
--
-- `N1` defines a held notification as one written with its recipient
-- (to_profile_id) and NO DELIVERY IDENTITY. The schema could not
-- represent that: to_user_id was NOT NULL, so the application had no
-- choice but to discard. writeNotification.js returned early when
-- toUserId was missing, and ProfileScreen.jsx skipped the write
-- entirely for an unclaimed profile — so every follow of an unclaimed
-- profile was a deleted fact, which is precisely what `N1` forbids:
--
--   "A held notification is an asset; a suppressed one is a deleted fact."
--
-- This matters because `N3` makes the held pile the payoff of the whole
-- model — a venue claims its profile and finds followers and enquiries
-- waiting — and `N4` singles out follows as the kind that NEVER expires.
-- Those were the exact rows being thrown away.
--
-- ── THE STATE IS IMPLICIT, DELIBERATELY ─────────────────────────
--
-- held  ⇔  to_user_id IS NULL
--
-- No delivery_state column. `N1` defines held as the ABSENCE of a
-- delivery identity, so a separate flag would be a second source of
-- truth that can disagree with to_user_id — and when they disagree
-- there is no principled winner. Delivery on claim (`N3`) is therefore
-- a single UPDATE populating to_user_id, with no flag to keep in step.
--
-- ── WHY THE CHECK IS AN OR, NOT to_profile_id NOT NULL ──────────
--
-- ⚠ The obvious constraint is WRONG. Requiring to_profile_id on every
-- row would break Identity v1.2 `U4`, which says to_profile_id is NULL
-- whenever the destination profile cannot be UNIQUELY inferred (the
-- recipient owns several profiles of the type). Those rows are
-- correct, delivered, and must stay legal.
--
-- The real invariant is that a notification is ADDRESSABLE — it must
-- carry at least one identity that can reach someone, now or later:
--
--   delivered  to_user_id NOT NULL, to_profile_id may be NULL (U4)
--   held       to_user_id NULL,     to_profile_id NOT NULL     (N1)
--   forbidden  both NULL — addressed to nobody, unreachable forever
--
-- The OR admits the first two and forbids the third, which is exactly
-- "every notification has a valid recipient profile, even if no user
-- account currently exists."
-- ============================================================


-- ── PRE-FLIGHT ─────────────────────────────────────────────────
-- Fail loudly and legibly if any existing row would violate the new
-- constraint, rather than surfacing a bare CHECK violation. If
-- to_user_id was NOT NULL before this migration, this cannot fire.
DO $$
DECLARE orphaned bigint;
BEGIN
  SELECT count(*) INTO orphaned
  FROM public.notifications
  WHERE to_user_id IS NULL AND to_profile_id IS NULL;

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'N1 pre-flight: % notification row(s) have neither to_user_id nor to_profile_id. '
      'These are addressed to nobody and cannot be held or delivered. '
      'Resolve them before applying this migration.', orphaned;
  END IF;
END $$;


-- ── 1 · THE SCHEMA MUST PERMIT A HELD ROW ──────────────────────
-- Idempotent: succeeds whether or not the column is currently NOT NULL.
ALTER TABLE public.notifications
  ALTER COLUMN to_user_id DROP NOT NULL;


-- ── 2 · THE ADDRESSABILITY INVARIANT ───────────────────────────
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_addressable;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_addressable
  CHECK (to_user_id IS NOT NULL OR to_profile_id IS NOT NULL);


-- ── 3 · CLAIM DELIVERY WILL QUERY BY PROFILE ───────────────────
-- Partial index: held rows only. `N3` delivers by looking up every held
-- row for the profile just claimed. Not built yet — this is the index
-- that query will need, and it costs nothing while the pile is small.
CREATE INDEX IF NOT EXISTS idx_notifications_held_by_profile
  ON public.notifications(to_profile_id)
  WHERE to_user_id IS NULL;


-- ── 4 · DOCUMENT THE STATE IN THE SCHEMA ───────────────────────
COMMENT ON COLUMN public.notifications.to_user_id IS
  'Identity v1.1 §A7 — DELIVERY: the human with the device. '
  'NULL means HELD (Phase 13.2 `N1`): the notification is addressed to '
  'to_profile_id, an unclaimed profile with no owner yet. It is created '
  'and retained, never suppressed, and becomes deliverable when the '
  'profile is claimed (`N3`) by populating this column. '
  'Readers MUST filter on this column so held rows stay invisible.';

COMMENT ON CONSTRAINT notifications_addressable ON public.notifications IS
  'Every notification must be addressable: a delivery identity (to_user_id) '
  'or a recipient profile (to_profile_id), or both. Deliberately an OR — '
  'requiring to_profile_id would break Identity v1.2 `U4`, under which a '
  'delivered row correctly has a NULL to_profile_id when the destination '
  'profile is not uniquely inferable.';


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. The column now permits held rows (expect is_nullable = YES):
--
--      SELECT column_name, is_nullable
--      FROM information_schema.columns
--      WHERE table_schema = 'public'
--        AND table_name   = 'notifications'
--        AND column_name IN ('to_user_id', 'to_profile_id');
--
--    NOTE: this also answers the question that could not be answered
--    before the migration was written — the app has no way to read
--    information_schema (PostgREST does not expose it), so the prior
--    nullability was never observed, only worked around by making the
--    change idempotent.
--
-- 2. The invariant rejects an unaddressable row (expect ERROR
--    'notifications_addressable'):
--
--      INSERT INTO public.notifications (type, message)
--      VALUES ('test', 'should be rejected');
--
-- 3. A held row is now insertable (expect success, then clean up):
--
--      INSERT INTO public.notifications (to_profile_id, type, message)
--      VALUES ('<any real profile id>', 'test_held', 'held row')
--      RETURNING id, to_user_id, to_profile_id;
--
--      DELETE FROM public.notifications WHERE type = 'test_held';
--
-- 4. Held rows are invisible to readers. Every reader filters
--    .eq('to_user_id', <uuid>), and SQL equality never matches NULL,
--    so held rows cannot surface. Confirm the count is 0 for any user:
--
--      SELECT count(*) FROM public.notifications
--      WHERE to_user_id = '<any real user id>' AND to_user_id IS NULL;
-- ============================================================
