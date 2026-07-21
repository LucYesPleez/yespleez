-- ============================================================
-- M9i · MESSAGE PARTICIPANT STATE — one table for every fact a participant
--       has about a message
-- Implements: the Hand constitution (a MESSAGE Hand is METADATA)
-- Requires:   20260720000005_m8b_messaging_rls.sql  (the predicates)
--             20260721000002_m9h_hand_kind.sql
-- ============================================================
--
--     A CONVERSATION Hand is a MESSAGE.  A MESSAGE Hand is METADATA.
--
-- M9h built the first. This is the second, and it is deliberately NOT a
-- reactions table: `handed_at` is one fact a participant has about a message,
-- and `played_at` (has this voice note been heard) and `hidden_at` (delete for
-- me) are two more of exactly the same shape. Building a reactions subsystem
-- now would mean building it again when those arrive.
--
-- ── ONLY handed_at EXISTS YET, AND THAT IS THE POINT ─────────────────
--
-- The ratified decision was ONE TABLE rather than a separate reactions
-- subsystem. Creating that table with one column now and adding the others
-- later honours it exactly: ADD COLUMN is additive and non-breaking, whereas a
-- second table is neither.
--
-- `played_at` and `hidden_at` are deliberately absent rather than present-and-
-- unused, because they carry an unsettled question this migration must not
-- prejudge: a Hand is meant to be SEEN by the other party, while "I have played
-- this" and "I have hidden this" may not be. That is a visibility decision, and
-- the SELECT policy below grants conversation-wide read — correct for a
-- reaction, and possibly wrong for the other two. Adding them means revisiting
-- this policy, which is a deliberate speed bump.
--
-- ── WHY MESSAGES ARE STILL IMMUTABLE ─────────────────────────────────
--
-- `D9`: messages are immutable in v1, and there is still no UPDATE policy on
-- them. A Hand is not a modification of a message — it is a separate row
-- pointing at one. That is what lets a reaction exist without reopening D9.
-- ============================================================


-- ── 1 · THE CONVERSATION A MESSAGE BELONGS TO ──────────────────
-- SECURITY DEFINER so the policies below can resolve a message to its
-- conversation without re-entering `messages`' own RLS. The same reasoning as
-- M8b's predicates: a policy that queries a table under RLS is a policy whose
-- behaviour depends on another policy.
CREATE OR REPLACE FUNCTION public.message_conversation(p_message_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.conversation_id FROM public.messages m WHERE m.id = p_message_id;
$$;

COMMENT ON FUNCTION public.message_conversation(uuid) IS
  'The conversation a message belongs to. SECURITY DEFINER so RLS policies on '
  'message_participant_state can authorise without re-entering messages RLS.';


-- ── 2 · THE TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_participant_state (
  message_id   uuid NOT NULL REFERENCES public.messages(id)  ON DELETE CASCADE,
  -- §A3 ATTRIBUTION — WHICH PROFILE gave the Yes. This is what is displayed,
  -- and it is the participant identity, matching conversation_participants.
  profile_id   uuid NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  -- §A3 AUDIT — the human who acted. Never displayed, never caller-supplied.
  -- Two humans who can act as one profile produce ONE Hand from that profile,
  -- which is why the key is the profile and this is only a record of who.
  from_user_id uuid NOT NULL REFERENCES auth.users(id),

  handed_at    timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- One row per (message, profile). Makes handing idempotent and makes "did
  -- this profile hand it" a lookup rather than a count.
  PRIMARY KEY (message_id, profile_id)
);

COMMENT ON TABLE public.message_participant_state IS
  'One row per (message, participant profile) holding every fact that '
  'participant has about that message. handed_at today; played_at and '
  'hidden_at belong here too and are deliberately not yet added — see the '
  'migration header, they raise a visibility question this policy prejudges.';

COMMENT ON COLUMN public.message_participant_state.handed_at IS
  'When this profile gave the message a Yes. NULL is impossible in practice — '
  'un-handing DELETEs the row rather than nulling, so a row means a Yes.';

-- Reading a thread asks "which of these messages were handed", so the index
-- that matters is by message.
CREATE INDEX IF NOT EXISTS message_participant_state_message_idx
  ON public.message_participant_state (message_id);


-- ── 3 · RLS ────────────────────────────────────────────────────
ALTER TABLE public.message_participant_state ENABLE ROW LEVEL SECURITY;

-- READ — anyone in the conversation.
-- A Hand is meant to be seen: a reaction only the sender can see is not a
-- reaction. This is the policy the header warns about before played_at and
-- hidden_at are added.
DROP POLICY IF EXISTS mps_select_participant ON public.message_participant_state;
CREATE POLICY mps_select_participant
  ON public.message_participant_state FOR SELECT
  USING (public.is_conversation_participant(public.message_conversation(message_id)));

-- WRITE — as a profile you can act as, into a conversation you may speak in.
--
-- `can_write_to_conversation` and not `is_conversation_participant`, so a
-- `restricted` or `closed` thread refuses reactions exactly as it refuses
-- messages (§4.4, §2.6). It also means the messaging-availability constitution
-- gets this for free: availability hooks into that same predicate, so a
-- withdrawn party cannot react either — which they must not be able to, or the
-- boundary leaks through a gesture.
DROP POLICY IF EXISTS mps_insert_own ON public.message_participant_state;
CREATE POLICY mps_insert_own
  ON public.message_participant_state FOR INSERT
  WITH CHECK (
    public.can_write_to_conversation(public.message_conversation(message_id))
    AND public.can_act_as(profile_id)
    AND from_user_id = auth.uid()
  );

-- UN-HAND — remove your own row, and only your own.
-- Scoped to can_act_as alone, not can_write_to_conversation: withdrawing a Yes
-- must stay possible even in a thread that has since closed. Refusing to let
-- someone take back an endorsement because the conversation ended is the wrong
-- default in a professional network.
DROP POLICY IF EXISTS mps_delete_own ON public.message_participant_state;
CREATE POLICY mps_delete_own
  ON public.message_participant_state FOR DELETE
  USING (public.can_act_as(profile_id));

-- No UPDATE policy. Nothing here is edited today — handing INSERTs and
-- un-handing DELETEs. When played_at arrives it will need one, and that is the
-- moment to decide whether it may be un-set.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1 · The table, the key and the policies exist:
--
--     select policyname, cmd from pg_policies
--      where schemaname='public' and tablename='message_participant_state'
--      order by cmd;
--     -- expect exactly three: DELETE, INSERT, SELECT. NO update.
--
-- 2 · message_conversation resolves. Raises if it does not:
--
--     do $$
--     declare v_mid uuid; v_cid uuid; v_expect uuid;
--     begin
--       select id, conversation_id into v_mid, v_expect from public.messages limit 1;
--       if v_mid is null then raise exception 'CANNOT TEST - no messages exist'; end if;
--       v_cid := public.message_conversation(v_mid);
--       if v_cid is distinct from v_expect then
--         raise exception 'M9i FAILED - message_conversation returned % want %', v_cid, v_expect;
--       end if;
--       raise notice 'M9i OK';
--     end $$;
--
-- 3 · A NON-participant cannot read a Hand. Expects 0 rows, and the role trick
--     is the whole test — a plain SELECT runs privileged and proves nothing:
--
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<a non-participant user id>"}';
--       select count(*) from public.message_participant_state;
--     rollback;
--
-- 4 · The PK makes handing idempotent — raises if a duplicate is accepted:
--
--     do $$
--     declare v_blocked boolean := false; v_mid uuid; v_pid uuid; v_uid uuid;
--     begin
--       select m.id, m.from_profile_id, m.from_user_id into v_mid, v_pid, v_uid
--         from public.messages m limit 1;
--       begin
--         insert into public.message_participant_state (message_id, profile_id, from_user_id, handed_at)
--         values (v_mid, v_pid, v_uid, now()), (v_mid, v_pid, v_uid, now());
--       exception when unique_violation then
--         v_blocked := true;
--       end;
--       if not v_blocked then
--         raise exception 'M9i FAILED - a profile handed one message twice';
--       end if;
--     end $$;
-- ============================================================
