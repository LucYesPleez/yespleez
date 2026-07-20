-- ============================================================
-- M8d · READ STATE — per HUMAN, never per profile
-- Implements: Communication Architecture v1.0 §2.5 (`C11`), §5.6
-- Requires:   20260720000004_m8a_messaging_foundation.sql
--             20260720000005_m8b_messaging_rls.sql
--             20260720000006_m8c_conversation_creation.sql
-- ============================================================
--
-- `C11`: "Read state is per-human, per-conversation. Unread counts are never
-- per-profile. Read state is keyed (conversation, user)."
--
-- M8a's `conversation_participants` carries a comment forbidding read state
-- from being added to it, for the reason `C11` gives: two managers can act as
-- one venue profile, and a shared read row would let one of them mark a
-- negotiation read for a colleague who never saw it. That is invisible until a
-- profile has two owners — exactly when it is most expensive to discover.
--
-- This table is the sanctioned home. Note the FK: user_id references
-- auth.users, NOT profiles. That is the whole point, and it is the one place in
-- Messaging where a human id is the correct key rather than an audit column.
--
-- SCHEMA AND RLS TOGETHER, deliberately. M8a/M8b were split because M8a created
-- three tables and M8b was a substantial policy design. One table with three
-- obvious policies does not warrant the ceremony, and keeping them in one
-- migration means there is no window in which the table exists unprotected.
--
-- ── A WATERMARK, NOT PER-MESSAGE ROWS ───────────────────────────
--
-- Read state is one timestamp per (conversation, human): everything at or
-- before it is read. The alternative — a row per message per human — would grow
-- with traffic and buy nothing `C11` or §5.6 asks for.
--
-- §5.6 requires ONE counting rule across four surfaces (app icon, nav bar,
-- inbox, conversation) so they "cannot disagree". A watermark makes that
-- structural: all four call the same function below rather than each deriving a
-- count of its own.
--
-- ── C32 IS SAFE HERE ────────────────────────────────────────────
--
-- §1's carve-out is explicit: unread counts and read state "derive from message
-- *events*, not message *content*". Nothing below reads `messages.body`.
-- ============================================================


-- ── 1 · THE TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_read_state (
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,

  -- `C11` — the HUMAN. Not a profile id. Deleting the account removes the
  -- read state; the conversation and its messages are unaffected, because
  -- authorship is attributed to a profile (§A3) and survives independently.
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Everything created at or before this instant is read by this human.
  last_read_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, user_id)
);

COMMENT ON TABLE public.conversation_read_state IS
  'Communication Architecture v1.0 2.5 (C11) — read state is per-HUMAN, keyed '
  '(conversation, user). Deliberately NOT on conversation_participants, which is '
  'keyed by profile: two humans can act as one profile, and a shared read row '
  'would mark a thread read for a colleague who never saw it. Server-held so the '
  'four badge surfaces (5.6) synchronise across devices.';

COMMENT ON COLUMN public.conversation_read_state.user_id IS
  'C11 — the human, referencing auth.users. The one place in Messaging where a '
  'user id is the correct KEY rather than an audit column (contrast '
  'messages.from_user_id, which is audit-only and never a permission input).';

COMMENT ON COLUMN public.conversation_read_state.last_read_at IS
  'Watermark: messages created at or before this are read. A timestamp rather '
  'than per-message rows, so 5.6''s single counting rule is structural.';

-- Every badge query is "my read state, across my conversations".
CREATE INDEX IF NOT EXISTS idx_conversation_read_state_user
  ON public.conversation_read_state(user_id);

ALTER TABLE public.conversation_read_state ENABLE ROW LEVEL SECURITY;


-- ── 2 · RLS — YOUR OWN READ STATE, IN YOUR OWN CONVERSATIONS ───
--
-- Both halves are required, and they are doing different jobs:
--   user_id = auth.uid()                  — it is YOUR read state (`C11`)
--   is_conversation_participant(...)      — in a thread you may see (§2.2)
--
-- Without the first, one human could write another's read state. Without the
-- second, a user could accumulate rows against conversations they have no part
-- in — harmless-looking, but it leaks the existence of conversations by id.

DROP POLICY IF EXISTS conversation_read_state_select_own ON public.conversation_read_state;
CREATE POLICY conversation_read_state_select_own
  ON public.conversation_read_state FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  );

DROP POLICY IF EXISTS conversation_read_state_insert_own ON public.conversation_read_state;
CREATE POLICY conversation_read_state_insert_own
  ON public.conversation_read_state FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  );

DROP POLICY IF EXISTS conversation_read_state_update_own ON public.conversation_read_state;
CREATE POLICY conversation_read_state_update_own
  ON public.conversation_read_state FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  );

-- NO SELECT on anyone else's read state — v1 has NO READ RECEIPTS.
-- §2.5 draws this line itself: "someone on your team replied" is a
-- profile-level signal about AUTHORSHIP, not a read receipt. Exposing other
-- humans' read state would invent a feature the specification does not
-- describe, and would expose one human's behaviour inside a shared profile.
-- Granting it later is additive; retracting it would not be.
--
-- NO DELETE. Clearing read state is `last_read_at`, not row removal.


-- ── 3 · MARKING READ ───────────────────────────────────────────
-- SECURITY INVOKER (the default) on purpose: the policies above already say
-- exactly who may write this row, so running elevated would move the authority
-- out of RLS and into a second place that could disagree with it. Contrast
-- open_conversation, which MUST be elevated because M8b grants no INSERT at all.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mark_conversation_read: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_read_state (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), v_now)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
    -- GREATEST, so an out-of-order or replayed call cannot move the watermark
    -- BACKWARDS and silently resurrect read messages as unread.
    SET last_read_at = GREATEST(public.conversation_read_state.last_read_at, EXCLUDED.last_read_at);

  RETURN v_now;
END;
$fn$;

COMMENT ON FUNCTION public.mark_conversation_read(uuid) IS
  'Advances this human''s read watermark for one conversation. SECURITY INVOKER '
  'so RLS remains the single authority. Monotonic (GREATEST): a replayed or '
  'out-of-order call cannot resurrect read messages as unread.';


-- ── 4 · THE ONE COUNTING RULE (§5.6) ───────────────────────────
-- Four surfaces, one function, so they cannot disagree.
--
-- SECURITY INVOKER again: RLS on `messages` already restricts the scan to
-- conversations the caller participates in, so the count is correctly scoped
-- with no predicate of its own. An elevated version would have to re-implement
-- that scoping and could drift from it.
--
-- Messages the HUMAN sent are excluded — from_user_id, not from_profile_id.
-- Per `C11` the count belongs to the human, so a colleague's message sent as
-- the same profile SHOULD count as unread for you. Using from_profile_id here
-- would be the per-profile mistake `C11` exists to prevent.
CREATE OR REPLACE FUNCTION public.conversation_unread_count(p_conversation_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = auth.uid()
   WHERE m.conversation_id = p_conversation_id
     AND m.from_user_id IS DISTINCT FROM auth.uid()
     -- No read-state row means never opened: everything counts.
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$fn$;

COMMENT ON FUNCTION public.conversation_unread_count(uuid) IS
  'Communication Architecture 5.6 — the single counting rule. Excludes messages '
  'this HUMAN sent (from_user_id): a colleague acting as the same profile is '
  'still unread to you, which is what C11 means. Reads message events only, '
  'never body — C32 1 carve-out.';

CREATE OR REPLACE FUNCTION public.total_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = auth.uid()
   WHERE m.from_user_id IS DISTINCT FROM auth.uid()
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$fn$;

COMMENT ON FUNCTION public.total_unread_count() IS
  'Communication Architecture 5.6 — app-icon / nav-bar badge. Scoped by RLS on '
  'messages rather than by a predicate of its own, so it cannot drift from what '
  'the caller may actually see. See the ARCHIVED note in this migration: this '
  'count does NOT exclude archived conversations, and that is a recorded '
  'decision, not an oversight.';


-- ── 5 · GRANTS ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversation_unread_count(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.total_unread_count()              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_unread_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.total_unread_count()            TO authenticated;


-- ============================================================
-- ⚠ RECORDED TENSION — ARCHIVED CONVERSATIONS AND THE BADGE
-- ============================================================
--
-- §2.6 makes `archived` PER-PARTICIPANT, and a participant is a PROFILE.
-- §2.5 makes unread counts PER-HUMAN.
--
-- So "should an archived conversation still badge?" has no clean answer: a
-- human acting as two profiles could have the same thread archived by one and
-- not the other, and a per-human count cannot depend on per-profile state
-- without reintroducing exactly the coupling `C11` forbids.
--
-- DECIDED HERE: archived conversations DO still count. Rationale — the
-- restrictive direction is the one that cannot hide a real message from a
-- human. The opposite default risks silently suppressing a booking enquiry.
--
-- This is a v1 default, not a ruling. It is recorded rather than resolved
-- because resolving it is a specification question (§2.6 vs §2.5), not an
-- implementation one, and no multi-owner profile exists yet to make it bite.
-- Raise it with the owner before building the inbox UI.
-- ============================================================


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
-- As always: every block raises on failure, so a clean run IS the evidence.
-- Substitute nothing except <ACCOUNT_ID>.
--
-- 1 · Table shape, RLS on, three policies and no DELETE:
--
--      SELECT c.relrowsecurity,
--             (SELECT count(*) FROM pg_policies p
--               WHERE p.tablename = 'conversation_read_state')
--        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relname = 'conversation_read_state';
--      -- ⇒ t, 3
--
-- 2 · END TO END. Rolled back; writes nothing.
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--        DO $v$
--        DECLARE
--          v_mine uuid[]; v_a uuid; v_b uuid;
--          v_cid uuid; v_n int; v_t1 timestamptz; v_t2 timestamptz;
--        BEGIN
--          SELECT array_agg(id) INTO v_mine
--            FROM (SELECT id FROM public.profiles
--                   WHERE public.can_act_as(id) ORDER BY id LIMIT 2) s;
--          IF v_mine IS NULL OR cardinality(v_mine) < 2 THEN
--            RAISE EXCEPTION 'SETUP FAILED - need 2 actable profiles';
--          END IF;
--          v_a := v_mine[1]; v_b := v_mine[2];
--
--          v_cid := public.open_conversation('application', gen_random_uuid(),
--                                            ARRAY[v_a, v_b]);
--
--          -- a message I sent must NOT count as unread to me
--          INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--          VALUES (v_cid, v_a, auth.uid(), 'mine');
--          v_n := public.conversation_unread_count(v_cid);
--          IF v_n <> 0 THEN
--            RAISE EXCEPTION 'M8d FAILED - own message counted as unread (%)', v_n;
--          END IF;
--
--          -- marking read is monotonic: a second call must not move it back
--          v_t1 := public.mark_conversation_read(v_cid);
--          v_t2 := public.mark_conversation_read(v_cid);
--          IF (SELECT last_read_at FROM public.conversation_read_state
--               WHERE conversation_id = v_cid AND user_id = auth.uid()) < v_t1 THEN
--            RAISE EXCEPTION 'M8d FAILED - watermark moved backwards';
--          END IF;
--
--          -- exactly one row, and it is mine
--          SELECT count(*) INTO v_n FROM public.conversation_read_state
--           WHERE conversation_id = v_cid;
--          IF v_n <> 1 THEN
--            RAISE EXCEPTION 'M8d FAILED - expected 1 read-state row, found %', v_n;
--          END IF;
--        END $v$;
--      ROLLBACK;
--
-- 3 · You cannot write ANOTHER human's read state. Raises if you can:
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--        DO $v$
--        DECLARE v_cid uuid; v_other uuid; v_refused boolean := false; v_mine uuid[];
--        BEGIN
--          SELECT array_agg(id) INTO v_mine
--            FROM (SELECT id FROM public.profiles
--                   WHERE public.can_act_as(id) ORDER BY id LIMIT 2) s;
--          v_cid := public.open_conversation('application', gen_random_uuid(),
--                                            ARRAY[v_mine[1], v_mine[2]]);
--
--          -- A DIFFERENT real account, hardcoded on purpose: auth.users is not
--          -- selectable by the `authenticated` role, so discovering it here would
--          -- fail on permissions and be misread as the test failing.
--          v_other := '6758a44e-64fd-4837-999c-838644503142';
--          IF v_other = auth.uid() THEN
--            RAISE EXCEPTION 'CANNOT TEST - pick an account id other than the caller';
--          END IF;
--
--          BEGIN
--            INSERT INTO public.conversation_read_state (conversation_id, user_id)
--            VALUES (v_cid, v_other);
--          EXCEPTION WHEN insufficient_privilege THEN
--            v_refused := true;
--          END;
--
--          IF NOT v_refused THEN
--            RAISE EXCEPTION 'M8d FAILED - wrote another human''s read state';
--          END IF;
--        END $v$;
--      ROLLBACK;
-- ============================================================
