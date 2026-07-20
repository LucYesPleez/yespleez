-- ============================================================
-- M8h · DIRECT MESSAGES — amends `C17` (no cold DM)
-- Owner decision, 20 Jul 2026: "I 100% want people to cold DM people."
-- ============================================================
--
-- Communication Architecture v1.0 `C17` forbade cold DMs, and `C16` derived the
-- right to converse from the right to perform the act that created the
-- conversation. That is why M8a's CHECK allowed only five contexts, each with a
-- workflow object behind it.
--
-- The owner has amended that rule. This migration is the amendment (`D8`:
-- adding a context is an amendment, not a schema change — so it is recorded
-- as one rather than slipped in).
--
-- WHAT CHANGES: any profile may open a conversation with any other profile.
-- WHAT DOES NOT: the STRICT caller rule from M8c still applies — you must be
-- able to act as the profile you are sending AS. You can message anyone; you
-- cannot message anyone AS someone else.
--
-- ── WHY context_id IS DERIVED, NOT "the other profile" ───────────────
--
-- The obvious choice — context_id = the recipient's profile id — breaks `C15`.
-- A messaging B would key (direct, B, {A,B}) while B messaging A would key
-- (direct, A, {A,B}): different rows, same pair, two threads for one
-- conversation, each side seeing half the history.
--
-- Deriving the id from the SORTED pair makes it symmetric, so `C15`'s existing
-- uniqueness gives exactly one DM thread per pair with no new constraint.
-- ============================================================


-- ── 1 · ALLOW THE `direct` CONTEXT ─────────────────────────────
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_context_type_valid;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_context_type_valid CHECK (
    context_type IN ('application', 'invitation', 'booking', 'event', 'venue', 'direct')
  );

COMMENT ON COLUMN public.conversations.context_type IS
  '`C13`/`C14` — the act that caused this conversation. IMMUTABLE. Five derived '
  'contexts plus `direct` (M8h, C17 amended 20 Jul 2026: cold DMs are permitted). '
  'For `direct`, context_id is derived from the sorted participant pair so the '
  'thread is symmetric — see open_direct_conversation.';


-- ── 2 · THE SYMMETRIC PAIR KEY ─────────────────────────────────
-- md5 returns 32 hex characters, which casts directly to uuid. Sorting first is
-- the whole point: the same two profiles must produce the same id whichever of
-- them initiates.
CREATE OR REPLACE FUNCTION public.direct_context_id(p_a uuid, p_b uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT md5(
    CASE WHEN p_a::text < p_b::text
      THEN p_a::text || ':' || p_b::text
      ELSE p_b::text || ':' || p_a::text
    END
  )::uuid;
$fn$;

COMMENT ON FUNCTION public.direct_context_id(uuid, uuid) IS
  'Symmetric context id for a direct conversation. Sorted so A→B and B→A resolve '
  'to ONE thread under C15 — the asymmetric alternative silently splits a '
  'conversation in two, each side seeing half of it.';


-- ── 3 · OPEN A DIRECT CONVERSATION ─────────────────────────────
-- A thin wrapper over open_conversation, so the strict caller rule, the C15
-- idempotence and the advisory lock all still apply — none of it is reimplemented.
CREATE OR REPLACE FUNCTION public.open_direct_conversation(
  p_from_profile_id uuid,
  p_to_profile_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_context uuid;
BEGIN
  IF p_from_profile_id IS NULL OR p_to_profile_id IS NULL THEN
    RAISE EXCEPTION 'open_direct_conversation: both profiles are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_from_profile_id = p_to_profile_id THEN
    RAISE EXCEPTION 'open_direct_conversation: cannot open a conversation with yourself'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.direct_context_id(p_from_profile_id, p_to_profile_id);

  -- open_conversation enforces the STRICT caller rule: the caller must be able
  -- to act as one of these profiles. Unchanged by this amendment.
  RETURN public.open_conversation('direct', v_context,
                                  ARRAY[p_from_profile_id, p_to_profile_id]);
END;
$fn$;

COMMENT ON FUNCTION public.open_direct_conversation(uuid, uuid) IS
  'M8h — opens a direct conversation between two profiles. Wraps '
  'open_conversation so the strict caller rule, C15 idempotence and the '
  'advisory lock are inherited rather than reimplemented. You may message '
  'anyone; you may not message anyone AS someone else.';

REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid, uuid) TO authenticated;


-- ============================================================
-- VERIFICATION — success is the evidence
-- ============================================================
--
-- 1 · The pair key is symmetric. Raises if it is not:
--
--     do $$
--     declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
--     begin
--       if public.direct_context_id(a,b) <> public.direct_context_id(b,a) then
--         raise exception 'ASYMMETRIC - A to B and B to A would create two threads';
--       end if;
--     end $$;
--
-- 2 · One thread per pair, either direction. Rolled back.
--
--     begin;
--       set local request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--       do $v$
--       declare v_mine uuid; v_theirs uuid; v1 uuid; v2 uuid;
--       begin
--         select id into v_mine from public.profiles
--          where public.can_act_as(id) order by id limit 1;
--         select id into v_theirs from public.profiles
--          where user_id is not null and user_id <> auth.uid() order by id limit 1;
--
--         v1 := public.open_direct_conversation(v_mine, v_theirs);
--         v2 := public.open_direct_conversation(v_theirs, v_mine);   -- reversed
--         if v1 is distinct from v2 then
--           raise exception 'C15 FAILED - reversed order created a second thread';
--         end if;
--       end $v$;
--     rollback;
--
-- 3 · You still cannot send AS someone else (strict rule intact). Raises if you can:
--
--     begin;
--       set local request.jwt.claims = '{"sub":"<ACCOUNT_ID>"}';
--       do $v$
--       declare a uuid; b uuid; refused boolean := false;
--       begin
--         select id into a from public.profiles
--          where user_id is not null and user_id <> auth.uid() order by id limit 1;
--         select id into b from public.profiles
--          where user_id is not null and user_id <> auth.uid() order by id desc limit 1;
--         if a = b then raise exception 'CANNOT TEST - need 2 foreign profiles'; end if;
--         begin
--           perform public.open_direct_conversation(a, b);
--         exception when insufficient_privilege then refused := true;
--         end;
--         if not refused then
--           raise exception 'M8h FAILED - opened a thread between two profiles the caller does not own';
--         end if;
--       end $v$;
--     rollback;
-- ============================================================
