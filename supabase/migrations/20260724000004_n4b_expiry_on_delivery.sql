-- ============================================================
-- N4b · EXPIRY IS EVALUATED AT DELIVERY, NOT BY A SCHEDULER
-- Requires: 20260720000002_n4_held_expiry.sql
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
-- ============================================================
--
-- ── THE GAP N4 LEFT, STATED PLAINLY ─────────────────────────────
--
-- N4 built the whole policy: a per-type table, event/enquiry date
-- derivation, a safe cast, and an `expired_at` mark. It then wired delivery
-- to skip expired rows:
--
--     AND expired_at IS NULL        -- and still worth delivering (N4)
--
-- That filter is correct and it is INERT, because `expired_at` is only ever
-- set by expire_held_notifications(), and N4's own closing note records that
-- the sweep "is never called automatically... scheduling is an operations
-- decision". Nothing schedules it. Nothing has ever called it.
--
-- So every held row still has expired_at IS NULL, the filter matches
-- everything, and the FIRST REAL CLAIM would hand a venue applications for
-- gigs played months ago — the precise outcome N4 exists to prevent, from a
-- migration that is fully applied and looks complete.
--
-- ── WHY NOT JUST SCHEDULE THE SWEEP ─────────────────────────────
--
-- Because a schedule is a promise about infrastructure this project does not
-- have. There is no pg_cron, no Edge Function, no worker — the same absence
-- that made attachment expiry a READ GATE rather than a deletion job. A
-- nightly sweep would also still leave a window: a claim completed an hour
-- after a gig ended, but before the next sweep, delivers the stale pile.
--
-- Expiry is a question about the CURRENT MOMENT, and the moment that matters
-- is the claim. So it is evaluated there, every time, with no dependency on
-- anything having run beforehand.
--
-- ── BOUND TO THE FUNCTION, NOT THE CALLER ───────────────────────
--
-- The expire-then-deliver step lives INSIDE deliver_held_notifications(),
-- not in the trigger that calls it. N3 chose the same shape for the same
-- reason: "binding to the transition rather than to the caller means none of
-- those future paths has to remember to call anything." Studio's approve
-- endpoint, the SQL editor, a repair script and any future admin tool all
-- inherit the guarantee without knowing it exists.
--
-- The scheduled sweep remains available and is now strictly optional — it
-- keeps `expired_at` tidy, but correctness no longer waits on it.
--
-- ── ONE PREDICATE, THREE CALLERS ────────────────────────────────
--
-- "Is this held row stale?" is defined ONCE, in held_notification_is_stale().
-- The sweep marks by it, the counter reports by it, and delivery expires by
-- it. Writing that condition out a second time is how a dashboard comes to
-- promise a venue eleven waiting notices and hand over four.
-- ============================================================


-- ── 0 · A SECOND CAST THAT CANNOT ABORT THE RUN ────────────────
--
-- ⚠ THIS FIXES A LATENT BUG IN THE APPLIED N4 SWEEP.
--
-- N4's enquiry branch compares `ve.id = (n.data->>'enquiry_id')::uuid`, but
-- venue_enquiries.id is a BIGINT. That is a type error, and it shipped:
-- plpgsql function bodies are only syntax-checked at creation, so
-- expire_held_notifications() was created happily and would have raised
--
--     operator does not exist: bigint = uuid
--
-- the first time it swept with an availability_request held row present —
-- aborting the entire run for every profile. It has never fired only because
-- nothing ever called the sweep. Rewriting the predicate in LANGUAGE sql
-- surfaced it immediately, because that IS type-checked at creation.
--
-- Same reasoning as safe_date: a bare ::bigint would raise on any non-numeric
-- value (a uuid string written by an older client, say) and abort the run.
-- Unparseable ⇒ NULL ⇒ the row never expires, which is N4's safe direction.
CREATE OR REPLACE FUNCTION public.safe_bigint(txt text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $safeint$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN
    RETURN NULL;
  END IF;
  RETURN txt::bigint;
EXCEPTION WHEN others THEN
  RETURN NULL;              -- unparseable ⇒ unknown enquiry ⇒ never expires
END;
$safeint$;

COMMENT ON FUNCTION public.safe_bigint(text) IS
  'Parse text to bigint, returning NULL instead of raising. Companion to '
  'safe_date: notification payloads are free-form JSONB, and a bad id must '
  'mean "cannot expire this", never "abort the run".';


-- ── 1 · THE PREDICATE — the single definition of "stale" ────────
--
-- STABLE, not IMMUTABLE: it reads other tables and depends on current_date.
-- Returns false for anything it cannot judge — an unknown type, a missing
-- event, an unparseable date — because N4's rule is that failing toward
-- RETENTION is the recoverable direction. A wrongly-kept notification can be
-- expired later; a wrongly-expired one is gone.
CREATE OR REPLACE FUNCTION public.held_notification_is_stale(p_type text, p_data jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $stale$
  SELECT EXISTS (
    SELECT 1
      FROM public.notification_expiry_policy p
     WHERE p.type = p_type
       AND (
            -- event-bound: the event is over
            (p.policy = 'event'
               AND public.event_end_date((p_data->>'event_id')::uuid) IS NOT NULL
               AND public.event_end_date((p_data->>'event_id')::uuid) < current_date)
         OR
            -- enquiry-bound: the requested date has passed.
            -- ⚠ venue_enquiries.id is BIGINT, not uuid — see §0.
            (p.policy = 'enquiry'
               AND public.safe_bigint(p_data->>'enquiry_id') IS NOT NULL
               AND EXISTS (
                     SELECT 1 FROM public.venue_enquiries ve
                      WHERE ve.id = public.safe_bigint(p_data->>'enquiry_id')
                        AND public.safe_date(ve.date_requested::text) IS NOT NULL
                        AND public.safe_date(ve.date_requested::text) < current_date))
           )
  );
  -- policy 'never' matches no branch; a type with no policy row matches no
  -- row at all. Both are retained.
$stale$;

COMMENT ON FUNCTION public.held_notification_is_stale(text, jsonb) IS
  'Phase 13.2 `N4` — THE definition of whether a held notification has stopped '
  'being worth delivering, evaluated against today. Used by the sweep, the '
  'counter and delivery so the three cannot disagree. Returns false for '
  'anything unjudgeable (unknown type, missing event, unparseable date): N4 '
  'fails toward retention because a wrongly-kept notice is recoverable and a '
  'wrongly-expired one is not.';


-- ── 2 · THE SWEEP — now scoped, and using the predicate ─────────
--
-- Dropped and recreated rather than overloaded: a no-arg function plus one
-- with a defaulted argument makes `expire_held_notifications()` an ambiguous
-- call. Nothing references the old signature (it has never been called), so
-- this is safe. NULL scope keeps the original behaviour — sweep everything.
DROP FUNCTION IF EXISTS public.expire_held_notifications();
DROP FUNCTION IF EXISTS public.expire_held_notifications(uuid);

CREATE FUNCTION public.expire_held_notifications(p_profile_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $sweep$
DECLARE
  expired integer;
BEGIN
  UPDATE public.notifications n
     SET expired_at = now()
   WHERE n.to_user_id IS NULL          -- HELD ONLY. Delivered mail is retention, not expiry.
     AND n.expired_at IS NULL          -- not already expired
     AND (p_profile_id IS NULL OR n.to_profile_id = p_profile_id)
     AND public.held_notification_is_stale(n.type, n.data);

  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$sweep$;

COMMENT ON FUNCTION public.expire_held_notifications(uuid) IS
  'Phase 13.2 `N4` — mark held notifications that have stopped being worth '
  'delivering. Pass a profile id to scope the sweep, or NULL/omit for every '
  'profile. Touches ONLY rows with to_user_id IS NULL: delivered notifications '
  'are governed by retention and are never affected. Marks expired_at rather '
  'than deleting, so the held record survives for the claim pitch. Idempotent; '
  'returns the number newly expired. Called automatically by '
  'deliver_held_notifications() (N4b); a scheduled run is optional.';


-- ── 3 · THE COUNTER — read-only, for reviewers ──────────────────
--
-- Studio's claim queue tells a reviewer what approving hands over, and the
-- held count is the headline. Counting rows with `to_user_id IS NULL` alone
-- would OVERSTATE it, because a stale row is only marked at the moment of
-- delivery — so the panel would promise eleven and deliver four.
--
-- Read-only on purpose: a GET endpoint must not mutate. It judges with the
-- same predicate the sweep marks with, so the number shown is exactly the
-- number that will be handed over.
CREATE OR REPLACE FUNCTION public.held_notification_counts(p_profile_id uuid)
RETURNS TABLE (live bigint, stale bigint, total bigint)
LANGUAGE sql
STABLE
AS $counts$
  SELECT
    count(*) FILTER (WHERE NOT judged.is_stale)::bigint AS live,
    count(*) FILTER (WHERE judged.is_stale)::bigint      AS stale,
    count(*)::bigint                                     AS total
  FROM (
    SELECT (n.expired_at IS NOT NULL)
        OR public.held_notification_is_stale(n.type, n.data) AS is_stale
      FROM public.notifications n
     WHERE n.to_profile_id = p_profile_id
       AND n.to_user_id IS NULL
  ) AS judged;
$counts$;

COMMENT ON FUNCTION public.held_notification_counts(uuid) IS
  'Phase 13.2 `N4`/`N5` — held notifications for a profile, split into what '
  'would be delivered now (live) and what has stopped being worth delivering '
  '(stale). Read-only; judges with the same predicate the sweep marks with, so '
  'a reviewer is shown the number that will actually be handed over.';


-- ── 4 · DELIVERY EXPIRES FIRST, THEN DELIVERS ───────────────────
--
-- One extra statement, and it is what makes N4 real. Scoped to the profile
-- being claimed, so a claim costs one small update rather than a full sweep.
CREATE OR REPLACE FUNCTION public.deliver_held_notifications(
  p_profile_id uuid,
  p_user_id    uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $deliver$
DECLARE
  delivered integer;
BEGIN
  IF p_profile_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- N4b: evaluate staleness NOW, for this profile. Without this the filter
  -- below matches everything, because nothing else ever sets expired_at.
  PERFORM public.expire_held_notifications(p_profile_id);

  UPDATE public.notifications
     SET to_user_id = p_user_id
   WHERE to_profile_id = p_profile_id
     AND to_user_id IS NULL          -- held only (N1)
     AND expired_at IS NULL;         -- and still worth delivering (N4)

  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$deliver$;

COMMENT ON FUNCTION public.deliver_held_notifications(uuid, uuid) IS
  'Phase 13.2 `N3` + `N4b` — deliver every LIVE held notification for a profile '
  'to its new owner. Evaluates N4 expiry for that profile FIRST, so staleness is '
  'judged at the moment of the claim and does not depend on any scheduled sweep '
  'having run. Idempotent; read/created_at untouched, so a claimant sees the '
  'notices unread and dated when they actually happened.';


-- ============================================================
-- VERIFICATION — run after applying
--
-- Builds a throwaway profile, a past event and a future event, exercises
-- every branch, then deletes everything and asserts no debris. Uses a real
-- user id only because delivery requires one (FK).
-- ============================================================

DO $v1$
DECLARE
  -- ⚠ ID TYPES ARE NOT UNIFORM IN THIS SCHEMA. Audited against live data
  -- rather than assumed, because two migrations in a row have now failed on
  -- exactly this:
  --   profiles.id, events.id, notifications.id, profiles.user_id → uuid
  --   venue_enquiries.id, profile_claim_requests.id              → bigint
  test_user    uuid;
  test_profile uuid;
  past_event   uuid;
  future_event uuid;
  n_follow     uuid;      -- notifications.id is uuid, not bigint
  n_stale      uuid;
  n_future     uuid;
  n_delivered  uuid;
  delivered_ct integer;
  swept        integer;
  c            record;
  enq_id       bigint;
  enq_date     date;
  expected     boolean;
BEGIN
  SELECT user_id INTO test_user FROM public.profiles WHERE user_id IS NOT NULL LIMIT 1;
  IF test_user IS NULL THEN
    RAISE EXCEPTION 'N4b V1 FAILED: no user available to test delivery with';
  END IF;

  INSERT INTO public.profiles (type, name, claim_status)
  VALUES ('venue', 'ZZ N4B THROWAWAY VENUE', 'unclaimed')
  RETURNING id INTO test_profile;

  INSERT INTO public.events (name, status, config)
  VALUES ('ZZ N4B PAST EVENT', 'draft', jsonb_build_object('date', to_char(current_date - 30, 'YYYY-MM-DD')))
  RETURNING id INTO past_event;

  INSERT INTO public.events (name, status, config)
  VALUES ('ZZ N4B FUTURE EVENT', 'draft', jsonb_build_object('date', to_char(current_date + 30, 'YYYY-MM-DD')))
  RETURNING id INTO future_event;

  -- Three held rows: an enduring follow, a stale application, a live one.
  INSERT INTO public.notifications (to_profile_id, type, message, created_at)
  VALUES (test_profile, 'new_follower', 'Someone followed you.', now() - interval '2 years')
  RETURNING id INTO n_follow;

  INSERT INTO public.notifications (to_profile_id, type, message, data)
  VALUES (test_profile, 'new_application', 'Application for a past gig.',
          jsonb_build_object('event_id', past_event))
  RETURNING id INTO n_stale;

  INSERT INTO public.notifications (to_profile_id, type, message, data)
  VALUES (test_profile, 'new_application', 'Application for an upcoming gig.',
          jsonb_build_object('event_id', future_event))
  RETURNING id INTO n_future;

  -- A DELIVERED row against the same profile — the invariant that matters
  -- most: expiry must never touch somebody's existing mail.
  INSERT INTO public.notifications (to_profile_id, to_user_id, type, message, data)
  VALUES (test_profile, test_user, 'new_application', 'Already received, past gig.',
          jsonb_build_object('event_id', past_event))
  RETURNING id INTO n_delivered;

  -- ── the counter, BEFORE anything is marked ──
  -- The number a reviewer sees must already be right, without a sweep having
  -- run. This is the assertion that catches "promised eleven, delivered four".
  SELECT * INTO c FROM public.held_notification_counts(test_profile);
  IF c.live <> 2 OR c.stale <> 1 OR c.total <> 3 THEN
    RAISE EXCEPTION 'V1 FAILED: counts before any sweep were live=% stale=% total=%, expected 2/1/3',
      c.live, c.stale, c.total;
  END IF;
  RAISE NOTICE 'V1 PASSED: the reviewer''s count is correct with no sweep having run (live 2, stale 1)';

  -- ── the scoped sweep ──
  swept := public.expire_held_notifications(test_profile);
  IF swept <> 1 THEN
    RAISE EXCEPTION 'V2 FAILED: expected exactly 1 row to expire (the past-event application), got %', swept;
  END IF;
  IF (SELECT expired_at FROM public.notifications WHERE id = n_follow) IS NOT NULL THEN
    RAISE EXCEPTION 'V2 FAILED: a 2-year-old follow expired — policy ''never'' was not honoured';
  END IF;
  IF (SELECT expired_at FROM public.notifications WHERE id = n_stale) IS NULL THEN
    RAISE EXCEPTION 'V2 FAILED: an application for a past event did NOT expire';
  END IF;
  IF (SELECT expired_at FROM public.notifications WHERE id = n_future) IS NOT NULL THEN
    RAISE EXCEPTION 'V2 FAILED: an application for a FUTURE event expired';
  END IF;
  IF (SELECT expired_at FROM public.notifications WHERE id = n_delivered) IS NOT NULL THEN
    RAISE EXCEPTION 'V2 FAILED: a DELIVERED notification was expired — that is somebody''s mail';
  END IF;
  RAISE NOTICE 'V2 PASSED: follow kept, past-event application expired, future kept, delivered untouched';

  -- ── V3 · THE POINT OF THIS MIGRATION ──
  -- Reset the marks so nothing has been pre-expired, then deliver. Delivery
  -- must expire the stale row ITSELF and hand over only the live ones.
  UPDATE public.notifications SET expired_at = NULL
   WHERE to_profile_id = test_profile;

  delivered_ct := public.deliver_held_notifications(test_profile, test_user);

  IF delivered_ct <> 2 THEN
    RAISE EXCEPTION 'V3 FAILED: expected 2 live rows delivered (follow + future application), got %', delivered_ct;
  END IF;
  IF (SELECT to_user_id FROM public.notifications WHERE id = n_stale) IS NOT NULL THEN
    RAISE EXCEPTION 'V3 FAILED: the stale application was DELIVERED — N4 is still inert';
  END IF;
  IF (SELECT expired_at FROM public.notifications WHERE id = n_stale) IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: delivery did not expire the stale row on its own';
  END IF;
  IF (SELECT to_user_id FROM public.notifications WHERE id = n_follow) IS DISTINCT FROM test_user
     OR (SELECT to_user_id FROM public.notifications WHERE id = n_future) IS DISTINCT FROM test_user THEN
    RAISE EXCEPTION 'V3 FAILED: a live held notification was not delivered';
  END IF;
  RAISE NOTICE 'V3 PASSED: delivery expired the stale row itself and handed over only the live ones';

  -- ── V4 · idempotence ──
  IF public.deliver_held_notifications(test_profile, test_user) <> 0 THEN
    RAISE EXCEPTION 'V4 FAILED: a second delivery delivered something';
  END IF;
  RAISE NOTICE 'V4 PASSED: re-delivery is a no-op';

  -- ── V4b · THE ENQUIRY BRANCH — the bug this migration found ──
  -- N4 compared a BIGINT id against a ::uuid cast. Any evaluation of this
  -- branch raised and aborted the whole sweep. These calls must simply
  -- return, and must agree with the enquiry's own date.
  SELECT id, date_requested INTO enq_id, enq_date
    FROM public.venue_enquiries ORDER BY id LIMIT 1;

  IF enq_id IS NOT NULL THEN
    expected := (public.safe_date(enq_date::text) IS NOT NULL
                 AND public.safe_date(enq_date::text) < current_date);
    IF public.held_notification_is_stale(
         'availability_request', jsonb_build_object('enquiry_id', enq_id)) <> expected THEN
      RAISE EXCEPTION 'V4b FAILED: enquiry branch disagreed with the enquiry date (expected %)', expected;
    END IF;
  END IF;

  -- A non-numeric id (an older client could have written a uuid) and an id
  -- with no matching row must both be retained, not raise.
  IF public.held_notification_is_stale('availability_request', jsonb_build_object('enquiry_id', 'not-a-number'))
     OR public.held_notification_is_stale('availability_request', jsonb_build_object('enquiry_id', '999999999')) THEN
    RAISE EXCEPTION 'V4b FAILED: an unresolvable enquiry id was treated as stale';
  END IF;
  RAISE NOTICE 'V4b PASSED: enquiry branch evaluates without raising (the bigint/uuid bug is fixed)';

  -- ── cleanup ──
  DELETE FROM public.notifications WHERE to_profile_id = test_profile;
  DELETE FROM public.profiles WHERE id = test_profile;
  DELETE FROM public.events WHERE id IN (past_event, future_event);
END $v1$;

-- V5 · the global invariant, across ALL real data: no delivered notification
--      anywhere carries an expiry mark.
DO $v5$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.notifications
   WHERE to_user_id IS NOT NULL AND expired_at IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V5 FAILED: % delivered notification(s) are marked expired', n;
  END IF;
  RAISE NOTICE 'V5 PASSED: no delivered notification is marked expired';
END $v5$;

-- V6 · no debris, and report what the classification currently misses.
DO $v6$
DECLARE n bigint; t text;
BEGIN
  SELECT count(*) INTO n FROM public.profiles WHERE name LIKE 'ZZ N4B%';
  IF n <> 0 THEN RAISE EXCEPTION 'V6 FAILED: % throwaway profile(s) remain', n; END IF;
  SELECT count(*) INTO n FROM public.events WHERE name LIKE 'ZZ N4B%';
  IF n <> 0 THEN RAISE EXCEPTION 'V6 FAILED: % throwaway event(s) remain', n; END IF;

  -- Unclassified types are RETAINED by design; listing them is how they get
  -- classified deliberately rather than by a catch-all.
  FOR t IN
    SELECT DISTINCT nn.type FROM public.notifications nn
     LEFT JOIN public.notification_expiry_policy pp ON pp.type = nn.type
     WHERE pp.type IS NULL
  LOOP
    RAISE NOTICE 'V6 NOTE: type % has no expiry policy — retained by default', t;
  END LOOP;

  RAISE NOTICE 'V6 PASSED: no test debris';
END $v6$;
