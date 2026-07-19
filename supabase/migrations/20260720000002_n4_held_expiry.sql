-- ============================================================
-- N4 · HELD NOTIFICATIONS EXPIRE BY THEIR OWN TIME-SENSITIVITY
-- Phase 13.2 Q1, docs/phase-13-q1-notifications-unclaimed-owners-2026-07.md
-- Requires: 20260720000000_n1, 20260720000001_n3
-- ============================================================
--
-- `N4`: "A held item expires when it stops being useful — and that differs
-- by kind. A global TTL would get this wrong in both directions, expiring
-- follows that stay valuable and retaining applications long past the gig.
-- Time-sensitivity is a property of the message, not of the holding."
--
-- ── THIS APPLIES TO HELD NOTIFICATIONS ONLY ─────────────────────
--
-- Expiry and retention are different policies and must not be conflated:
--
--   HELD (to_user_id IS NULL)  — waiting for a claim that may never come.
--                                Expiry asks: is this still worth
--                                delivering to whoever claims this profile?
--   DELIVERED (to_user_id set) — somebody's mail. Already received. How
--                                long it is kept is RETENTION, a separate
--                                policy that is NOT implemented here.
--
-- Every statement below filters `to_user_id IS NULL`. A delivered
-- notification is never touched by expiry, so no historical notice can
-- vanish from a user's feed as a side effect of this migration.
--
-- ── EXPIRY MARKS, IT DOES NOT DELETE ────────────────────────────
--
-- `N1` is explicit that "a held notification is an asset; a suppressed one
-- is a deleted fact", and the platform's ability to answer "did anyone try
-- to reach this venue before it joined?" is the entire claim pitch. Deleting
-- on expiry would destroy exactly that record.
--
-- So expiry sets expired_at. The row survives, stays held, and stays
-- countable for `N5` (Operations sees counts, never content). It simply
-- stops being deliverable.
--
-- ── UNKNOWN TYPES NEVER EXPIRE, BY DESIGN ───────────────────────
--
-- Policy is per-type and explicit. A type with no policy row is RETAINED,
-- not expired. `N4` requires time-sensitivity to be a property of the
-- message, so expiring a type nobody has classified would be a global TTL
-- wearing a disguise — and it would destroy an asset on the strength of an
-- assumption. Failing toward retention is the recoverable direction:
-- a wrongly-kept notification can be expired later, a wrongly-expired one
-- is gone. Verification query 4 lists unclassified types.
-- ============================================================


-- ── 1 · THE EXPIRY MARK ────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

COMMENT ON COLUMN public.notifications.expired_at IS
  'Phase 13.2 `N4` — when this HELD notification stopped being worth '
  'delivering. NULL means live. Only ever set on rows with to_user_id IS NULL; '
  'delivered notifications are governed by retention, not expiry. The row is '
  'retained deliberately: `N1` treats a held notification as an asset and a '
  'suppressed one as a deleted fact, and the held pile is the claim pitch.';

-- Held-and-live is the set both delivery and expiry scan.
CREATE INDEX IF NOT EXISTS idx_notifications_held_live
  ON public.notifications(to_profile_id)
  WHERE to_user_id IS NULL AND expired_at IS NULL;


-- ── 2 · A CAST THAT CANNOT ABORT THE RUN ───────────────────────
-- events.config->>'date' is FREE TEXT inside JSONB, not a date column, and
-- the app's own date inputs have historically admitted garbage (a year
-- 0006 is on record — native date inputs accept typed input). A bare
-- (config->>'date')::date would raise on the first malformed row and abort
-- the entire expiry run, so one bad event would silently freeze expiry for
-- every profile. Postgres has no TRY_CAST; this is it.
CREATE OR REPLACE FUNCTION public.safe_date(txt text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN
    RETURN NULL;
  END IF;
  RETURN txt::date;
EXCEPTION WHEN others THEN
  RETURN NULL;              -- unparseable ⇒ unknown date ⇒ never expires
END;
$$;

COMMENT ON FUNCTION public.safe_date(text) IS
  'Parse text to date, returning NULL instead of raising. Used because event '
  'dates live in JSONB free text and malformed values exist; an unknown date '
  'must mean "cannot expire this", never "abort the run".';


-- ── 3 · WHEN AN EVENT IS OVER ──────────────────────────────────
-- There is no end-date column. An event carries config->>'date' and, for
-- multi-day events, config->'days' — an array of {name, slots} with NO date
-- of its own. So the end is DERIVED: start + (number of days - 1). That is
-- read off the structure rather than guessed, and a single-day event
-- collapses to its own date.
--
-- Returns NULL when the date is absent or unparseable, which means "never
-- expires" downstream — the safe direction.
CREATE OR REPLACE FUNCTION public.event_end_date(p_event_id uuid)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT public.safe_date(e.config->>'date')
       + GREATEST(COALESCE(jsonb_array_length(
           CASE WHEN jsonb_typeof(e.config->'days') = 'array'
                THEN e.config->'days' END), 1) - 1, 0)
  FROM public.events e
  WHERE e.id = p_event_id;
$$;

COMMENT ON FUNCTION public.event_end_date(uuid) IS
  'Phase 13.2 `N4` — the last day an event is actionable. Derived: '
  'config->>''date'' plus (length of config->''days'' - 1), because events '
  'have no end-date column and day objects carry no dates. NULL when the '
  'date is missing or unparseable.';


-- ── 4 · THE POLICY, AS DATA ────────────────────────────────────
-- A table rather than a CASE, so "which types expire and how" is queryable
-- by Operations and reviewable without reading a function body — and so
-- "which types have no policy" is a query rather than an audit.
CREATE TABLE IF NOT EXISTS public.notification_expiry_policy (
  type   text PRIMARY KEY,
  policy text NOT NULL CHECK (policy IN ('never', 'event', 'enquiry')),
  note   text
);

COMMENT ON TABLE public.notification_expiry_policy IS
  'Phase 13.2 `N4` — per-type expiry rules for HELD notifications. '
  'never = enduring, retained indefinitely as a claim incentive. '
  'event = expires once the related event is over (data->>''event_id''). '
  'enquiry = expires once the requested date has passed (data->>''enquiry_id''). '
  'A type absent from this table is NEVER expired — see the migration header.';

INSERT INTO public.notification_expiry_policy (type, policy, note) VALUES
  -- ENDURING SOCIAL RELATIONSHIPS — never expire.
  -- `N4`: "Not time-bound. 'Twelve people follow you' is as true in six
  -- months, and is pure claim incentive." These are the rows that make the
  -- claim moment worth anything; expiring them would defeat `N3`.
  ('new_follower',          'never',   'N4: follows are not time-bound and are pure claim incentive'),
  ('venue_followed',        'never',   'N4: as above'),
  ('profile_claimed',       'never',   'account-level fact, not time-bound'),
  ('payment_received',      'never',   'financial record — never silently expired'),
  ('payment_requested',     'never',   'financial record — never silently expired'),

  -- EVENT-BOUND — expire once the event is over.
  -- `N4`: "An application delivered after the gig is worse than none: it
  -- tells the venue about an opportunity they already missed, and tells the
  -- artist their message sat unread."
  ('new_application',       'event',   'N4: expires with the event'),
  ('shortlisted',           'event',   'N4: expires with the event'),
  ('application_declined',  'event',   'N4: expires with the event'),
  ('booking_confirmed',     'event',   'N4: expires with the event'),
  ('booking_cancelled',     'event',   'N4: expires with the event'),
  ('slot_offer',            'event',   'N4: a response window that closes with the event'),
  ('slot_accepted',         'event',   'N4: expires with the event'),
  ('slot_declined',         'event',   'N4: expires with the event'),
  ('slot_removed',          'event',   'N4: expires with the event'),
  ('event_invite',          'event',   'N4: a response window that closes with the event'),
  ('invite_accepted',       'event',   'N4: expires with the event'),
  ('invite_declined',       'event',   'N4: expires with the event'),
  ('event_reminder',        'event',   'meaningless after the event'),
  ('event_updated',         'event',   'meaningless after the event'),
  ('event_published',       'event',   'meaningless after the event'),
  ('event_nearly_full',     'event',   'meaningless after the event'),
  ('set_times_released',    'event',   'meaningless after the event'),

  -- DATE-BOUND ENQUIRIES.
  -- `N4`: "Date-bound, per the enquiry. Same reasoning — it names a date."
  ('availability_request',  'enquiry', 'N4: expires once the requested date has passed')
ON CONFLICT (type) DO NOTHING;   -- re-runnable; never overwrites a curated policy


-- ── 5 · THE SWEEP ──────────────────────────────────────────────
-- Idempotent and safe to run repeatedly. Returns the number newly expired.
CREATE OR REPLACE FUNCTION public.expire_held_notifications()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  expired integer;
BEGIN
  UPDATE public.notifications n
     SET expired_at = now()
    FROM public.notification_expiry_policy p
   WHERE p.type = n.type
     AND n.to_user_id IS NULL          -- HELD ONLY. Delivered mail is retention, not expiry.
     AND n.expired_at IS NULL          -- not already expired
     AND (
          -- event-bound: the event is over
          (p.policy = 'event'
             AND public.event_end_date((n.data->>'event_id')::uuid) IS NOT NULL
             AND public.event_end_date((n.data->>'event_id')::uuid) < current_date)
       OR
          -- enquiry-bound: the requested date has passed
          (p.policy = 'enquiry'
             AND EXISTS (
                   SELECT 1 FROM public.venue_enquiries ve
                    WHERE ve.id = (n.data->>'enquiry_id')::uuid
                      AND public.safe_date(ve.date_requested::text) IS NOT NULL
                      AND public.safe_date(ve.date_requested::text) < current_date))
         );
  -- p.policy = 'never' matches no branch, so those rows are untouched.
  -- A type with no policy row fails the join entirely — also untouched.

  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$;

COMMENT ON FUNCTION public.expire_held_notifications() IS
  'Phase 13.2 `N4` — mark held notifications that have stopped being worth '
  'delivering. Touches ONLY rows with to_user_id IS NULL: delivered '
  'notifications are governed by retention and are never affected. Marks '
  'expired_at rather than deleting, so the held record survives for the claim '
  'pitch and for `N5` counts. Idempotent; returns the number newly expired. '
  'NOT SCHEDULED — invoke deliberately; scheduling is an operations decision.';


-- ── 6 · DELIVERY MUST NOT HAND OVER EXPIRED ITEMS ──────────────
-- `N3` as first written delivered everything held. With expiry in place it
-- must skip expired rows, or a claim would deliver applications for gigs
-- already played — which is the outcome `N4` exists to prevent.
CREATE OR REPLACE FUNCTION public.deliver_held_notifications(
  p_profile_id uuid,
  p_user_id    uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  delivered integer;
BEGIN
  IF p_profile_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications
     SET to_user_id = p_user_id
   WHERE to_profile_id = p_profile_id
     AND to_user_id IS NULL          -- held only (N1)
     AND expired_at IS NULL;         -- and still worth delivering (N4)

  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$$;

COMMENT ON FUNCTION public.deliver_held_notifications(uuid, uuid) IS
  'Phase 13.2 `N3` — deliver every LIVE held notification for a profile to its '
  'new owner by populating to_user_id. Skips rows expired under `N4`. '
  'Idempotent; read/created_at untouched, so a claimant sees the notices unread '
  'and dated when they actually happened.';


-- ============================================================
-- ⚠ NOT DONE HERE
-- ============================================================
--
-- 1 · NOT SCHEDULED. expire_held_notifications() is never called
--     automatically. Whether it runs on pg_cron, from an Edge Function, or
--     by hand is an operations decision, and scheduling a destructive-ish
--     sweep without that decision would be the wrong default. Expiry is
--     also not urgent while no held rows exist.
--
-- 2 · RETENTION OF DELIVERED NOTIFICATIONS is deliberately absent. Nothing
--     here can remove or hide a notification somebody has already received.
--
-- 3 · `N5` COUNTS FOR OPERATIONS are not built. expired_at makes the query
--     possible (held, expired, live) without exposing content.
-- ============================================================


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. A follow held against an unclaimed profile NEVER expires, however old:
--
--      INSERT INTO public.notifications (to_profile_id, type, message, created_at)
--      VALUES (:pid, 'new_follower', 'Someone followed your profile.',
--              now() - interval '2 years');
--      SELECT public.expire_held_notifications();
--      SELECT expired_at FROM public.notifications
--       WHERE to_profile_id = :pid AND type = 'new_follower';   -- ⇒ NULL
--
-- 2. An application held against a PAST event does expire:
--
--      INSERT INTO public.notifications (to_profile_id, type, message, data)
--      VALUES (:pid, 'shortlisted', 'You have been shortlisted.',
--              jsonb_build_object('event_id', :past_event_id));
--      SELECT public.expire_held_notifications();          -- ⇒ 1
--      SELECT expired_at IS NOT NULL FROM public.notifications
--       WHERE data->>'event_id' = :past_event_id::text;    -- ⇒ true
--
-- 3. DELIVERED notifications are never touched — the invariant that matters
--    most, because a false positive here deletes somebody's mail:
--
--      SELECT count(*) FROM public.notifications
--       WHERE to_user_id IS NOT NULL AND expired_at IS NOT NULL;   -- ⇒ 0
--
-- 4. Types with NO policy — these are retained by default. Review and
--    classify deliberately; do not add a catch-all:
--
--      SELECT DISTINCT n.type
--        FROM public.notifications n
--        LEFT JOIN public.notification_expiry_policy p ON p.type = n.type
--       WHERE p.type IS NULL;
--
-- 5. A malformed event date must not abort the sweep (the year-0006 case):
--
--      SELECT public.safe_date('0006-01-01'), public.safe_date('not a date'),
--             public.safe_date(''), public.safe_date(NULL);
--      -- ⇒ 0006-01-01, NULL, NULL, NULL — and no exception
--
-- 6. Expired rows are not delivered on claim:
--
--      SELECT public.deliver_held_notifications(:pid, :uid);
--      -- expired rows remain to_user_id IS NULL
-- ============================================================
