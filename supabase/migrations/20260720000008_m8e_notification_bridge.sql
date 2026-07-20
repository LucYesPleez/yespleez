-- ============================================================
-- M8e · NOTIFICATION BRIDGE — delivery derives from current authority
-- Implements: Communication Architecture v1.0 §5.3, `C11`, `C18`, `C32`
--             Identity v1.1 §A7 (three identities), Phase 13.2 `N1` (held)
-- Requires:   M8a–M8d, N1, NP1
-- ============================================================
--
-- OWNER DECISION (20 Jul 2026): notification delivery is DERIVED FROM CURRENT
-- PARTICIPANT AUTHORITY. If several humans can act as a participant profile,
-- each receives their own notification. No second authority model, and no
-- ownership snapshot — authority is read at send time, from the same source
-- `can_act_as` reads.
--
-- ── NO SCHEMA CHANGE TO `notifications`. ────────────────────────
--
-- This was the surprise, and it is worth stating: fan-out needs nothing new.
-- §A7 already separates the three identities, and `N1` already gives the
-- unclaimed case a meaning:
--
--   to_user_id       DELIVERY  — the human. ONE ROW PER HUMAN is the fan-out.
--   to_profile_id    RECIPIENT — which profile the notice is for.
--   about_profile_id SUBJECT   — the profile that sent the message.
--
-- A recipient profile with three owners produces three rows differing only in
-- to_user_id. A recipient profile with NO owner produces one HELD row
-- (to_user_id NULL), which `N1` already defines and CHECK notifications_
-- addressable already permits. Fan-out and the held pile are the same mechanism
-- viewed at different owner counts — which is why nothing needed adding.
--
-- NP1's `apply_notification_preferences` trigger fires on these inserts like
-- any other, so muting works with no involvement from this migration.
-- `new_message` is already classified (`messages` / `never`) in
-- `notification_expiry_policy`.
--
-- ── WHY A TRIGGER, NOT A CALL IN THE SEND PATH ──────────────────
--
-- `C18` and §A7: notifications originate from shared services, never from UI.
-- A trigger is the strongest form of that rule — a send path cannot forget to
-- notify, and there is no second call site to drift. This mirrors
-- `touch_conversation_last_message` (M8b), which is maintained the same way and
-- for the same reason.
-- ============================================================


-- ── 1 · THE INVERSE OF `can_act_as` ────────────────────────────
--
-- `can_act_as(profile)` answers "may *I* act as this?". Fan-out needs "WHO may
-- act as this?" — the same question, quantified the other way.
--
-- ⚠ THIS AND `can_act_as` MUST READ THE SAME SOURCE. They do: `profiles.user_id`
-- (M6a, `20260718000003_m6a_can_act_as.sql`). `can_act_as`'s own comment says
-- "signature frozen; body may evolve (V1 single-owner)" — when that body evolves
-- to a multi-owner join, THIS FUNCTION MUST EVOLVE IN THE SAME COMMIT. They are
-- two projections of one fact, not two models.
--
-- That obligation is not left to a comment: the verification section below
-- asserts the two agree for every profile, and it can be re-run at any time.
--
-- Today this returns AT MOST ONE ROW, because V1 is single-owner. That is the
-- point of writing the bridge against a SET rather than a scalar: multi-owner
-- becomes a change to this function alone, not a rewrite of delivery.
CREATE OR REPLACE FUNCTION public.profile_actors(p_profile_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.user_id
    FROM public.profiles p
   WHERE p.id = p_profile_id
     AND p.user_id IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.profile_actors(uuid) IS
  'Every human who can CURRENTLY act as this profile — the inverse of '
  'can_act_as, reading the same source (profiles.user_id, M6a). MUST evolve in '
  'the same commit as can_act_as body changes; they are two projections of one '
  'fact. Returns no rows for an unclaimed profile, which is what produces an N1 '
  'held notification. NOT granted to any client role: it maps a profile to the '
  'humans behind it, which no client may enumerate.';

-- ⚠ DELIBERATELY NOT GRANTED TO `authenticated`.
-- This function turns a profile id into the account ids behind it. Exposing it
-- would let any logged-in user enumerate who owns any profile — a privacy leak
-- that has nothing to do with messaging. It is called only by the elevated
-- trigger below.
REVOKE ALL ON FUNCTION public.profile_actors(uuid) FROM PUBLIC, anon, authenticated;


-- ── 2 · THE BRIDGE ─────────────────────────────────────────────
--
-- ── `C32` · NO MESSAGE CONTENT LEAVES THE CONVERSATION ──────────
--
-- The notification carries NO part of `messages.body`. Two independent reasons,
-- either sufficient:
--
--   1. `C32` — conversation content is excluded from the platform's systems.
--      §1's carve-out permits delivering and displaying messages, but a
--      notification row is a different store with its own lifecycle.
--   2. `D1`'s TWO RETENTION DOMAINS — conversations are erasable, workflow
--      objects are retained. Copying body text into `notifications` would put
--      conversation content into a domain with different retention rules, so
--      erasing a conversation would leave its content behind.
--
-- The row carries ids. The client resolves what to display, from the
-- conversation, under RLS — where the participant could read it anyway.
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_recipient_profile uuid;
  v_actor             uuid;
  v_actor_count       integer;
BEGIN
  -- Every participant profile EXCEPT the one that spoke. §2.1 fixes the
  -- participant set, so this is the complete audience.
  FOR v_recipient_profile IN
    SELECT cp.profile_id
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = NEW.conversation_id
       AND cp.profile_id <> NEW.from_profile_id
  LOOP
    v_actor_count := 0;

    FOR v_actor IN
      SELECT a FROM public.profile_actors(v_recipient_profile) AS a
    LOOP
      -- Counted BEFORE the skip below, on purpose: the count answers "is this
      -- profile claimed?", not "did we send anything?". A profile whose only
      -- owner is the sender is claimed, so it must NOT fall through to the held
      -- branch — there is simply nobody to tell.
      v_actor_count := v_actor_count + 1;

      -- Never notify the human who just sent. `C11` again: this is the HUMAN
      -- (from_user_id), not the profile. A colleague acting as the sending
      -- profile is a different human and DOES get notified.
      IF v_actor IS DISTINCT FROM NEW.from_user_id THEN
        INSERT INTO public.notifications
          (to_user_id, to_profile_id, about_profile_id, type, message, data, read)
        VALUES (
          v_actor,                    -- §A7 DELIVERY — one row per human
          v_recipient_profile,        -- §A7 RECIPIENT
          NEW.from_profile_id,        -- §A7 SUBJECT — who spoke
          'new_message',
          'New message',              -- `C32`: no body, ever
          jsonb_build_object(
            'conversation_id', NEW.conversation_id,
            'message_id',      NEW.id
          ),
          false
        );
      END IF;
    END LOOP;

    -- `N1` — an UNCLAIMED recipient profile is HELD, never suppressed. The
    -- absence of to_user_id IS the held state. When the profile is claimed, N3
    -- claim delivery hands these over: "a venue claims and finds enquiries
    -- waiting". Nothing extra is needed here for that to work.
    IF v_actor_count = 0 THEN
      INSERT INTO public.notifications
        (to_user_id, to_profile_id, about_profile_id, type, message, data, read)
      VALUES (
        NULL,                         -- HELD (N1)
        v_recipient_profile,
        NEW.from_profile_id,
        'new_message',
        'New message',
        jsonb_build_object(
          'conversation_id', NEW.conversation_id,
          'message_id',      NEW.id
        ),
        false
      );
    END IF;
  END LOOP;

  RETURN NULL;                        -- AFTER trigger; return value unused
END;
$fn$;

COMMENT ON FUNCTION public.notify_new_message() IS
  'Communication Architecture 5.3 / C11 — fan-out. One notification per HUMAN '
  'who can currently act as each recipient profile, derived from profile_actors '
  'at send time rather than from an ownership snapshot. Unclaimed recipient '
  'profiles produce an N1 held row. Carries NO message body (C32, and D1 two '
  'retention domains). SECURITY DEFINER: it must read participants and write '
  'notifications on behalf of a caller who may do neither directly.';

DROP TRIGGER IF EXISTS trg_notify_new_message ON public.messages;

CREATE TRIGGER trg_notify_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_message();


-- ============================================================
-- ⚠ WHAT THIS DOES **NOT** DO
-- ============================================================
--
-- **It does not make multi-owner profiles exist.** `can_act_as` reads
-- `profiles.user_id`, a single-owner column, so today `profile_actors` returns
-- at most one row and fan-out fans out to one. That is not a limitation of this
-- migration — it is the current shape of identity, and M8e is written so that
-- when identity changes, delivery does not have to.
--
-- The §6 handover item "notification fan-out — the notification system delivers
-- to one" is therefore now STRUCTURALLY resolved and FACTUALLY unchanged. The
-- bridge asks "who can act as this profile?" and delivers to all of them; the
-- answer is currently always zero or one. Do not read a single delivered row in
-- production as evidence the fan-out is broken.
-- ============================================================


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- ⚠ THESE BLOCKS RUN PRIVILEGED (no `SET LOCAL role authenticated`), setting
-- ONLY request.jwt.claims. Two reasons, both of which make the naive version
-- silently useless:
--
--   1. `profile_actors` is not granted to `authenticated` (§1), so an
--      impersonated caller cannot invoke it at all.
--   2. Reading `notifications` back as `authenticated` is RLS-filtered to your
--      own rows — so a row delivered to ANOTHER human, or a HELD row belonging
--      to nobody, is invisible. Those are precisely the rows fan-out exists to
--      create. Asserting on a filtered view would report zero and look like a
--      bug in the bridge.
--
-- auth.uid() reads the JWT claim, not the role, so can_act_as and
-- open_conversation still behave as the named user. What is NOT being tested
-- here is RLS on messages — M8b already covers that.
--
-- Substitute nothing but <ACCOUNT_ID>.
--
-- 1 · THE AUTHORITY-MODEL CHECK. profile_actors and can_act_as must agree for
--     every profile. This is the assertion that keeps them one model rather
--     than two; re-run it after ANY change to either.
--
--     BEGIN;
--       SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--       DO $v$
--       DECLARE v_bad int;
--       BEGIN
--         SELECT count(*) INTO v_bad
--           FROM public.profiles p
--          WHERE public.can_act_as(p.id)
--                <> EXISTS (SELECT 1 FROM public.profile_actors(p.id) a
--                            WHERE a = auth.uid());
--         IF v_bad <> 0 THEN
--           RAISE EXCEPTION
--             'AUTHORITY MODELS DISAGREE - can_act_as and profile_actors differ on % profile(s)', v_bad;
--         END IF;
--       END $v$;
--     ROLLBACK;
--
-- 2 · FAN-OUT END TO END. Rolled back; writes nothing.
--
--     ⚠ THE RECIPIENT MUST BE A PROFILE OWNED BY A **DIFFERENT** ACCOUNT.
--     The obvious version — two profiles the tester owns — proves nothing:
--     the recipient's only actor would be the sender, who is correctly skipped,
--     so ZERO notifications is the RIGHT answer and the test would fail on a
--     working bridge. This dataset makes that mistake easy: one account owns
--     five profiles.
--
--     BEGIN;
--       SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--       DO $v$
--       DECLARE
--         v_a uuid; v_b uuid; v_b_owner uuid;
--         v_cid uuid; v_mid uuid; v_n int;
--       BEGIN
--         SELECT id INTO v_a FROM public.profiles
--          WHERE public.can_act_as(id) ORDER BY id LIMIT 1;
--         IF v_a IS NULL THEN
--           RAISE EXCEPTION 'SETUP FAILED - the named account can act as no profile';
--         END IF;
--
--         SELECT id, user_id INTO v_b, v_b_owner FROM public.profiles
--          WHERE user_id IS NOT NULL AND user_id <> auth.uid()
--          ORDER BY id LIMIT 1;
--         IF v_b IS NULL THEN
--           RAISE EXCEPTION
--             'CANNOT TEST fan-out - no profile owned by another account. Do NOT record M8e as verified.';
--         END IF;
--
--         v_cid := public.open_conversation('application', gen_random_uuid(),
--                                           ARRAY[v_a, v_b]);
--
--         INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--         VALUES (v_cid, v_a, auth.uid(), 'bridge test') RETURNING id INTO v_mid;
--
--         -- EXACTLY ONE row, delivered to the OTHER profile's owner
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE type = 'new_message'
--            AND data->>'message_id' = v_mid::text
--            AND to_profile_id = v_b
--            AND to_user_id    = v_b_owner;
--         IF v_n <> 1 THEN
--           RAISE EXCEPTION 'M8e FAILED - expected 1 delivered notification to the recipient owner, found %', v_n;
--         END IF;
--
--         -- SUBJECT is the sending profile (§A7)
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text
--            AND about_profile_id = v_a;
--         IF v_n <> 1 THEN
--           RAISE EXCEPTION 'M8e FAILED - about_profile_id is not the sender';
--         END IF;
--
--         -- NOTHING addressed to, or delivered to, the sender
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text
--            AND (to_profile_id = v_a OR to_user_id = auth.uid());
--         IF v_n <> 0 THEN
--           RAISE EXCEPTION 'M8e FAILED - notified the sender (% rows)', v_n;
--         END IF;
--
--         -- No held row: the recipient profile IS claimed
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text AND to_user_id IS NULL;
--         IF v_n <> 0 THEN
--           RAISE EXCEPTION 'M8e FAILED - held row written for a CLAIMED profile (% rows)', v_n;
--         END IF;
--
--         -- `C32` — no message content escaped into the notification store
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text
--            AND (message ILIKE '%bridge test%' OR data::text ILIKE '%bridge test%');
--         IF v_n <> 0 THEN
--           RAISE EXCEPTION 'C32 VIOLATED - message body leaked into a notification';
--         END IF;
--       END $v$;
--     ROLLBACK;
--
-- 2b · THE SENDER-SKIP, isolated. Both profiles owned by the tester, so the
--      recipient's only actor IS the sender. Correct behaviour is NOTHING
--      WRITTEN — no delivered row, and no held row either, because the profile
--      is claimed. This is the block that would fail if the actor count were
--      taken AFTER the skip instead of before it.
--
--     BEGIN;
--       SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--       DO $v$
--       DECLARE v_mine uuid[]; v_cid uuid; v_mid uuid; v_n int;
--       BEGIN
--         SELECT array_agg(id) INTO v_mine
--           FROM (SELECT id FROM public.profiles
--                  WHERE public.can_act_as(id) ORDER BY id LIMIT 2) s;
--         IF v_mine IS NULL OR cardinality(v_mine) < 2 THEN
--           RAISE EXCEPTION 'SETUP FAILED - need 2 profiles owned by this account';
--         END IF;
--
--         v_cid := public.open_conversation('application', gen_random_uuid(),
--                                           ARRAY[v_mine[1], v_mine[2]]);
--         INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--         VALUES (v_cid, v_mine[1], auth.uid(), 'self test') RETURNING id INTO v_mid;
--
--         SELECT count(*) INTO v_n FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text;
--         IF v_n <> 0 THEN
--           RAISE EXCEPTION
--             'M8e FAILED - % row(s) written when the only recipient actor was the sender', v_n;
--         END IF;
--       END $v$;
--     ROLLBACK;
--
-- 3 · THE HELD PATH (`N1`). Uses an UNCLAIMED profile as recipient, so no
--     actor exists and exactly one held row must appear. Skips honestly if the
--     dataset has no unclaimed profile.
--
--     BEGIN;
--       SET LOCAL request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--
--       DO $v$
--       DECLARE
--         v_a uuid; v_unclaimed uuid; v_cid uuid; v_mid uuid; v_held int;
--       BEGIN
--         SELECT id INTO v_a FROM public.profiles
--          WHERE public.can_act_as(id) ORDER BY id LIMIT 1;
--
--         SELECT id INTO v_unclaimed FROM public.profiles
--          WHERE user_id IS NULL ORDER BY id LIMIT 1;
--
--         IF v_unclaimed IS NULL THEN
--           RAISE EXCEPTION
--             'CANNOT TEST the held path - no unclaimed profile exists. Do NOT record N1 fan-out as verified.';
--         END IF;
--
--         v_cid := public.open_conversation('application', gen_random_uuid(),
--                                           ARRAY[v_a, v_unclaimed]);
--
--         INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--         VALUES (v_cid, v_a, auth.uid(), 'held test') RETURNING id INTO v_mid;
--
--         SELECT count(*) INTO v_held
--           FROM public.notifications
--          WHERE data->>'message_id' = v_mid::text
--            AND to_user_id IS NULL
--            AND to_profile_id = v_unclaimed;
--
--         IF v_held <> 1 THEN
--           RAISE EXCEPTION 'N1 FAILED - expected 1 held row for the unclaimed recipient, found %', v_held;
--         END IF;
--       END $v$;
--     ROLLBACK;
-- ============================================================
