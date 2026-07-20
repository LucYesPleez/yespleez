-- ============================================================
-- M8b · MESSAGING RLS — access derives from can_act_as, and nothing else
-- Implements: Communication Architecture v1.0 §2.2, §4.3, §4.4
-- Requires:   20260720000004_m8a_messaging_foundation.sql
-- ============================================================
--
-- §2.2: "Access derives from `can_act_as` (v1.1 §A4) and nothing else. Whoever
-- can act as a participant profile can read and write the conversation. This is
-- the whole permission story at the read layer; §4 governs only initiation."
--
-- So the read rule is one sentence, and every policy below is a restatement of
-- it. Nothing consults from_user_id for permission (§A4: can_act_as is the sole
-- ownership predicate) and nothing consults subject_state.
--
-- ── WHAT IS DELIBERATELY NOT GRANTED ────────────────────────────
--
--   NO INSERT on conversations or conversation_participants.
--   §4.3 makes creation AUTOMATIC from workflow acts — application submitted,
--   invitation sent, booking offered, lineup confirmed. Manual creation exists
--   only for `general`, which is out of scope (needs Active Profile Context).
--   Creation therefore belongs to a SECURITY DEFINER function driven by those
--   workflow events (M8c), not to the client.
--
--   This is also the SEC-1 lesson applied before the fact. `notifications`
--   accepts direct client INSERT with `with_check = auth.role() =
--   'authenticated'`, which lets any logged-in user forge a notification to
--   anyone. A conversation row carries authority — it decides who may read a
--   thread — so it must never be client-insertable.
--
--   NO UPDATE on messages. `D9` default: messages are immutable in v1.
--   NO DELETE anywhere. §2.4's right to remove one's own contribution is
--   deferred with `D9`/`D12`, not denied; granting it later is additive.
--
--   NO UPDATE on conversations. status and subject_state are workflow-driven,
--   not user-driven: subject_state mirrors the workflow object (`C14`) and
--   status transitions are §4.4 consequences of relationships ending. Letting a
--   participant write either would let them re-open a `restricted` thread by
--   editing a column. last_message_at is maintained by trigger below instead.
--
-- ── WHY THE PREDICATES ARE FUNCTIONS, NOT INLINE SUBQUERIES ─────
--
-- A policy on conversation_participants that itself queries
-- conversation_participants recurses, and Postgres raises 42P17 — the exact
-- fault that makes `personal_events` return 500 on every query to this day
-- (backlog S30). SECURITY DEFINER functions run as the table owner, who
-- bypasses RLS, so the inner read does not re-enter the policy.
--
-- search_path is pinned on both so an elevated function cannot be redirected
-- to a shadowed table.
-- ============================================================


-- ── 1 · THE READ PREDICATE ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = p_conversation_id
       AND public.can_act_as(cp.profile_id)
  );
$$;

COMMENT ON FUNCTION public.is_conversation_participant(uuid) IS
  'Communication Architecture §2.2 — true when the caller can act as any '
  'participant profile of this conversation. SECURITY DEFINER to avoid 42P17: a '
  'policy on conversation_participants that queried the same table would recurse '
  '(see backlog S30, personal_events). Consults can_act_as only — never '
  'from_user_id, never subject_state.';


-- ── 2 · THE WRITE PREDICATE ────────────────────────────────────
-- §4.4: a `restricted` conversation is history-readable, writing refused.
-- §2.6: `closed` is read-only by default and re-openable by a participant —
-- re-opening is an explicit status change, so writing to a closed thread is
-- refused here until that happens. Only `active` accepts messages.
CREATE OR REPLACE FUNCTION public.can_write_to_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.status = 'active'
  )
  AND public.is_conversation_participant(p_conversation_id);
$$;

COMMENT ON FUNCTION public.can_write_to_conversation(uuid) IS
  'Communication Architecture §4.4 / §2.6 — participation AND status = active. '
  'A `restricted` conversation refuses new messages while remaining readable; a '
  '`closed` one is read-only until a participant re-opens it.';


-- ── 3 · CONVERSATIONS · SELECT ONLY ────────────────────────────
DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant
  ON public.conversations FOR SELECT
  USING (public.is_conversation_participant(id));

-- No INSERT (§4.3 — automatic creation, M8c), no UPDATE, no DELETE.


-- ── 4 · PARTICIPANTS · SELECT ONLY ─────────────────────────────
-- A participant may see the whole participant set — §2.2 makes a conversation
-- a relationship between profiles, and a thread whose other party is invisible
-- cannot be reasoned about. Not scoped to `can_act_as(profile_id)`, which would
-- show you only yourself.
DROP POLICY IF EXISTS conversation_participants_select_participant ON public.conversation_participants;
CREATE POLICY conversation_participants_select_participant
  ON public.conversation_participants FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

-- No INSERT (§4.3), no DELETE — §2.1 fixes the participant set at creation.
-- archived_at is per-participant state and will need a narrow UPDATE policy
-- when archiving ships; deliberately not granted here, since granting UPDATE
-- broadly would also expose profile_id to rewriting.


-- ── 5 · MESSAGES · SELECT AND INSERT ───────────────────────────
DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant
  ON public.messages FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

-- The identity pair is enforced at the point of writing, per §A3:
--   from_profile_id — must be a profile the caller can act as (attribution)
--   from_user_id    — must be the caller (audit); it is never a permission input
-- Both are required. Checking only can_act_as would let a user attribute a
-- message to their own profile while recording someone else as the human;
-- checking only auth.uid() would let them speak as a profile they do not own.
DROP POLICY IF EXISTS messages_insert_participant ON public.messages;
CREATE POLICY messages_insert_participant
  ON public.messages FOR INSERT
  WITH CHECK (
    public.can_write_to_conversation(conversation_id)
    AND public.can_act_as(from_profile_id)
    AND from_user_id = auth.uid()
  );

-- No UPDATE (`D9` — messages are immutable in v1).
-- No DELETE (§2.4 removal right deferred with `D9`/`D12`).


-- ── 6 · last_message_at, MAINTAINED BY TRIGGER ─────────────────
-- §2.7 lists last-message-at as conversation metadata, and a list must sort by
-- it without joining messages. It is maintained here rather than granting the
-- client UPDATE on conversations — which would also hand them status and
-- subject_state.
--
-- SECURITY DEFINER because there is deliberately no UPDATE policy on
-- conversations; an invoker-rights trigger would match zero rows and fail
-- silently, exactly the failure mode recorded against deliver_held_notifications.
CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.touch_conversation_last_message() IS
  'Maintains conversations.last_message_at (§2.7) so a conversation list sorts '
  'without joining messages. SECURITY DEFINER because conversations has no '
  'UPDATE policy by design — an invoker-rights trigger would match zero rows '
  'and fail silently.';

DROP TRIGGER IF EXISTS trg_touch_conversation_last_message ON public.messages;

CREATE TRIGGER trg_touch_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_conversation_last_message();


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. Policy inventory. Expect exactly four, all SELECT except the one INSERT,
--    and NO update/delete rows anywhere:
--
--      SELECT tablename, policyname, cmd
--        FROM pg_policies
--       WHERE tablename IN ('conversations','conversation_participants','messages')
--       ORDER BY tablename, cmd, policyname;
--
--    conversations             · conversations_select_participant             · SELECT
--    conversation_participants · conversation_participants_select_participant · SELECT
--    messages                  · messages_insert_participant                  · INSERT
--    messages                  · messages_select_participant                  · SELECT
--
-- 2. Both predicates are elevated with a pinned search_path (expect true and
--    {search_path=public, pg_temp} for all three functions):
--
--      SELECT p.proname, p.prosecdef, p.proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('is_conversation_participant',
--                           'can_write_to_conversation',
--                           'touch_conversation_last_message');
--
-- 3. END TO END, as a real authenticated user, in a rolled-back transaction.
--    Substitute a real account id and two profile ids that account can act as.
--
--      BEGIN;
--        -- create a conversation as the privileged role (M8c will do this)
--        INSERT INTO public.conversations (context_type, context_id)
--        VALUES ('application', gen_random_uuid()) RETURNING id;          -- :cid
--        INSERT INTO public.conversation_participants (conversation_id, profile_id)
--        VALUES (:cid, :profile_a), (:cid, :profile_b);
--
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<account id>"}';
--
--        -- reads: expect 1 conversation, 2 participants
--        SELECT count(*) FROM public.conversations WHERE id = :cid;
--        SELECT count(*) FROM public.conversation_participants WHERE conversation_id = :cid;
--
--        -- write as a profile you CAN act as: expect success
--        INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--        VALUES (:cid, :profile_a, auth.uid(), 'hello');
--
--        -- forge the human: expect ERROR 42501
--        INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--        VALUES (:cid, :profile_a, gen_random_uuid(), 'forged human');
--
--        -- speak as a profile you do NOT own: expect ERROR 42501
--        INSERT INTO public.messages (conversation_id, from_profile_id, from_user_id, body)
--        VALUES (:cid, '<a profile owned by someone else>', auth.uid(), 'forged profile');
--
--        -- messages are immutable: expect 0 rows (no UPDATE policy)
--        UPDATE public.messages SET body = 'edited' WHERE conversation_id = :cid;
--
--        -- clients cannot create conversations: expect ERROR 42501
--        INSERT INTO public.conversations (context_type, context_id)
--        VALUES ('application', gen_random_uuid());
--      ROLLBACK;
--
-- 4. A non-participant sees nothing (expect 0, not an error — RLS filters,
--    it does not raise on SELECT):
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<an unrelated account id>"}';
--        SELECT count(*) FROM public.conversations;
--        SELECT count(*) FROM public.messages;
--      ROLLBACK;
-- ============================================================
