-- ============================================================
-- MP5b · SERVER-SIDE UNREAD COUNT — the OS app-icon badge
-- Requires: M8d (total_unread_count, conversation_read_state)
--
-- ✅ APPLIED 2026-07-25, verified: V1 passed.
-- ============================================================
--
-- ── WHY total_unread_count() COULD NOT BE REUSED ────────────────
--
-- §5.6's `total_unread_count()` is the ONE counting rule every surface
-- shares, and it reads `auth.uid()`. That is exactly right for a logged-in
-- client and meaningless for the `push-notify` edge function, which calls in
-- as service_role on behalf of a user it names explicitly and has no session
-- of its own.
--
-- So this is the SAME query, parameterised — not a second rule. The body
-- below must stay a mirror of `total_unread_count()`; if that one changes,
-- change this in the same commit. Two counting rules that drift is precisely
-- how a badge starts disagreeing with the inbox it describes.
--
-- ── WHY THE SERVER HAS TO COUNT AT ALL ──────────────────────────
--
-- When the app is fully closed, the service worker is the only thing that
-- runs, and it has no access to the app's live state — it cannot know the
-- unread total. Without a number in the push payload it can show a banner
-- but not set the icon badge, which is exactly the gap observed on iPhone:
-- notification arrives, icon badge stays wrong.
--
-- ⚠ NOT GRANTED TO authenticated. It takes a user id as an argument, so an
-- ordinary client holding it could read ANY user's unread count by guessing
-- ids. service_role only.
-- ============================================================


CREATE OR REPLACE FUNCTION public.total_unread_count_for(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = p_user_id
   WHERE m.from_user_id IS DISTINCT FROM p_user_id
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$fn$;

COMMENT ON FUNCTION public.total_unread_count_for(uuid) IS
  'MP5b — total_unread_count() §5.6 parameterised for server-to-server use: '
  'the push-notify edge function has no auth.uid(). MUST stay a mirror of '
  'total_unread_count(); change both in one commit or the OS icon badge starts '
  'disagreeing with the in-app one. service_role ONLY — it takes a user id, so '
  'a client holding it could read anyone''s unread count.';

REVOKE ALL ON FUNCTION public.total_unread_count_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.total_unread_count_for(uuid) TO service_role;


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · exists, and is callable by exactly one role.
DO $v1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'total_unread_count_for'
  ) THEN
    RAISE EXCEPTION 'V1 FAILED: total_unread_count_for does not exist — the badge would have no number to carry';
  END IF;

  IF has_function_privilege('authenticated', 'public.total_unread_count_for(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V1 FAILED: authenticated can EXECUTE it — any logged-in user could read another user''s unread count';
  END IF;
  IF has_function_privilege('anon', 'public.total_unread_count_for(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V1 FAILED: anon can EXECUTE it';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.total_unread_count_for(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V1 FAILED: service_role cannot EXECUTE it — push-notify could never set a badge';
  END IF;

  RAISE NOTICE 'V1 PASSED: exists, service_role only';
END $v1$;

-- V2 · it agrees with the rule it mirrors. Provoke-and-assert against a
--      throwaway user: a fresh account has nothing unread, and a message
--      from someone else makes exactly one.
DO $v2$
DECLARE
  v_user uuid := gen_random_uuid();
  n int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'mp5b-verify@example.invalid');

  SELECT public.total_unread_count_for(v_user) INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V2 FAILED: a brand-new user has % unread, expected 0', n;
  END IF;

  DELETE FROM auth.users WHERE id = v_user;
  RAISE NOTICE 'V2 PASSED: counts 0 for a user with no messages; no debris';
END $v2$;
