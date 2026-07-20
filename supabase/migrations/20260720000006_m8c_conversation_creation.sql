-- ============================================================
-- M8c · CONVERSATION CREATION — the only way a thread comes into being
-- Implements: Communication Architecture v1.0 §4.3, `C15`, §2.1
-- Requires:   20260720000004_m8a_messaging_foundation.sql
--             20260720000005_m8b_messaging_rls.sql
-- ============================================================
--
-- M8b granted no INSERT on conversations or conversation_participants, so
-- nothing can create a thread today. That was deliberate: §4.3 makes creation
-- automatic from workflow acts, and a conversation row carries authority — it
-- decides who may read a thread. This migration supplies the one sanctioned
-- path, elevated and guarded, rather than loosening the policy.
--
-- ── THE CALLER RULE (owner decision, 20 Jul 2026) ────────────────
--
-- STRICT. The caller must be able to `can_act_as` at least one participant
-- profile. Conversation creation derives from PARTICIPANT AUTHORITY, never
-- merely from authentication or visibility.
--
-- The rejected reading was "any authenticated caller may open a conversation
-- for a workflow object they can see". Visibility is not authority: a caller
-- who can act as neither party has no business opening a thread between them,
-- and granting that is the same shape of hole as SEC-1 on `notifications`,
-- where `auth.role() = 'authenticated'` lets any logged-in user forge a row.
--
-- Note what the rule does NOT require: that the caller act as a *particular*
-- side. §2.2 makes a conversation a relationship, so authority over either end
-- is authority to open it. Requiring a specific side would be a new rule.
--
-- ── `C15` IS SATISFIED BY RETURNING, NOT RAISING ────────────────
--
-- "One artist applying twice to the same event produces one conversation."
-- A second call with the same (context_type, context_id, participant set)
-- returns the existing id. Idempotence is the specified behaviour, so a caller
-- re-running a workflow act does not need to defend against duplicates.
-- ============================================================


-- ── 1 · OPEN A CONVERSATION FROM A WORKFLOW ACT ────────────────
CREATE OR REPLACE FUNCTION public.open_conversation(
  p_context_type    text,
  p_context_id      uuid,
  p_participant_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_participants    uuid[];
  v_participant_key text;
  v_conversation_id uuid;
  v_authorised      boolean;
BEGIN
  -- ── Argument hygiene ──────────────────────────────────────────
  IF p_context_type IS NULL OR p_context_id IS NULL THEN
    RAISE EXCEPTION 'open_conversation: context_type and context_id are required'
      USING ERRCODE = '22023';
  END IF;

  -- Deduplicate and drop NULLs. The participant set is a SET (§2.1); the
  -- primary key on conversation_participants would collapse duplicates anyway,
  -- but the `C15` key must be computed from the same collapsed set the table
  -- will hold, or the lookup below would miss an existing conversation.
  SELECT array_agg(DISTINCT pid)
    INTO v_participants
    FROM unnest(COALESCE(p_participant_ids, '{}'::uuid[])) AS pid
   WHERE pid IS NOT NULL;

  IF v_participants IS NULL OR cardinality(v_participants) = 0 THEN
    RAISE EXCEPTION 'open_conversation: at least one participant profile is required'
      USING ERRCODE = '22023';
  END IF;

  -- A one-participant conversation is NOT rejected here. M8a's `C15` note
  -- contemplates one, and forbidding it would be a new rule this migration has
  -- no authority to make. Adding a minimum later is additive.

  -- ── The caller rule, before anything is written ───────────────
  SELECT EXISTS (
    SELECT 1
      FROM unnest(v_participants) AS pid
     WHERE public.can_act_as(pid)
  ) INTO v_authorised;

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'open_conversation: caller cannot act as any participant profile. Conversation creation derives from participant authority (4.3), not from authentication or visibility.'
      USING ERRCODE = '42501';
  END IF;

  -- ── `C15` key, derived exactly as M8a's trigger derives it ────
  -- Any divergence between these two expressions would silently defeat the
  -- idempotence lookup: this function would find nothing, insert, and only
  -- then collide with the constraint at COMMIT.
  SELECT md5(string_agg(pid::text, ',' ORDER BY pid::text))
    INTO v_participant_key
    FROM unnest(v_participants) AS pid;

  -- ── Serialise concurrent creation of the SAME conversation ────
  -- Two rapid workflow acts (a double-submitted application) would otherwise
  -- both find nothing and both insert. The deferrable constraint would catch
  -- that at COMMIT — correctly, but as an error surfaced to a caller who did
  -- nothing wrong, and after `C15` promised idempotence instead.
  --
  -- A transaction-scoped advisory lock keyed on the identity of the
  -- conversation makes the check-then-insert atomic. It is released at COMMIT,
  -- and the second caller then re-reads under a fresh READ COMMITTED snapshot
  -- and finds the committed row.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_context_type || ':' || p_context_id::text || ':' || v_participant_key)
  );

  -- ── `C15` — return the existing conversation, do not raise ────
  SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
   WHERE c.context_type    = p_context_type
     AND c.context_id      = p_context_id
     AND c.participant_key = v_participant_key;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  -- ── Create conversation and participants in ONE transaction ───
  -- This is what M8a's DEFERRABLE INITIALLY DEFERRED constraint exists for.
  -- The participant rows go in one at a time, so participant_key passes
  -- through a one-participant intermediate state that could collide with a
  -- real one-participant conversation. The constraint is checked at COMMIT,
  -- by which point the set is complete.
  INSERT INTO public.conversations (context_type, context_id)
  VALUES (p_context_type, p_context_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  SELECT v_conversation_id, pid
    FROM unnest(v_participants) AS pid;

  -- participant_key is now set by M8a's AFTER trigger. Not written here:
  -- deriving it in two places is how the two derivations drift apart.

  RETURN v_conversation_id;
END;
$$;

COMMENT ON FUNCTION public.open_conversation(text, uuid, uuid[]) IS
  'Communication Architecture v1.0 4.3 — the ONLY sanctioned way to create a '
  'conversation. SECURITY DEFINER because M8b grants no client INSERT on '
  'conversations or conversation_participants (SEC-1 applied before the fact). '
  'STRICT caller rule: the caller must be able to can_act_as at least one '
  'participant profile — creation derives from participant authority, never '
  'from authentication or visibility. Idempotent per C15: a repeated workflow '
  'act returns the existing conversation rather than raising.';


-- ── 2 · EXECUTE IS GRANTED NARROWLY ────────────────────────────
-- An elevated function is only as safe as the set of callers who can reach it.
-- anon must never create a conversation; PUBLIC would include it.
REVOKE ALL ON FUNCTION public.open_conversation(text, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_conversation(text, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_conversation(text, uuid, uuid[]) TO authenticated;


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- Every block below is written so that SUCCESS IS THE EVIDENCE: it raises on
-- failure rather than reporting an outcome in a NOTICE. That is the discipline
-- `C13` was checked without, and why `C13` sat unverified.
--
-- 1. The function exists, is elevated, and has a pinned search_path
--    (expect prosecdef = t and {search_path=public, pg_temp}):
--
--      SELECT p.proname, p.prosecdef, p.proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'open_conversation';
--
-- 2. anon cannot execute it, authenticated can (expect f then t):
--
--      SELECT has_function_privilege('anon',
--               'public.open_conversation(text,uuid,uuid[])', 'EXECUTE'),
--             has_function_privilege('authenticated',
--               'public.open_conversation(text,uuid,uuid[])', 'EXECUTE');
--
-- 3. END TO END as a real user. Substitute a real account id, two profile ids
--    that account can act as (:profile_a, :profile_b), and one profile it
--    CANNOT (:profile_x). Rolled back, so it leaves nothing behind.
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<account id>"}';
--
--        -- creation succeeds, and returns an id
--        SELECT public.open_conversation(
--          'application', '11111111-1111-1111-1111-111111111111',
--          ARRAY[:'profile_a', :'profile_b']::uuid[]);            -- ⇒ :cid
--
--        -- C15: the SAME call returns the SAME id, it does not raise
--        SELECT public.open_conversation(
--          'application', '11111111-1111-1111-1111-111111111111',
--          ARRAY[:'profile_b', :'profile_a']::uuid[]);   -- order must not matter
--
--        -- the participant set was written, and the key derived
--        SELECT count(*) FROM public.conversation_participants
--         WHERE conversation_id = :cid;                            -- ⇒ 2
--        SELECT participant_key <> '' FROM public.conversations
--         WHERE id = :cid;                                         -- ⇒ t
--
--        -- a DIFFERENT participant set on the same context is a NEW
--        -- conversation (C15's own example: two artists, one event)
--      ROLLBACK;
--
-- 4. THE CALLER RULE — the point of this migration. Success is the evidence:
--    this block raises if an unauthorised caller is ALLOWED to create.
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<account id>"}';
--
--        DO $v$
--        DECLARE v_refused boolean := false;
--        BEGIN
--          BEGIN
--            PERFORM public.open_conversation(
--              'application', gen_random_uuid(),
--              ARRAY['<profile_x>'::uuid, '<another foreign profile>'::uuid]);
--          EXCEPTION WHEN insufficient_privilege THEN
--            v_refused := true;                  -- narrow: 42501 ONLY
--          END;
--
--          IF NOT v_refused THEN
--            RAISE EXCEPTION
--              'M8c FAILED - a caller who can act as NO participant created a conversation';
--          END IF;
--        END $v$;
--      ROLLBACK;
--
--    Note this handler catches ONE named condition and converts it into the
--    documented outcome. It is not the `WHEN others` blanket that made the
--    first `C13` check report success either way.
--
-- 5. Clients still cannot create conversations directly — M8c must not have
--    loosened M8b. Expect ERROR 42501:
--
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<account id>"}';
--        INSERT INTO public.conversations (context_type, context_id)
--        VALUES ('application', gen_random_uuid());
--      ROLLBACK;
-- ============================================================
