-- ============================================================
-- M6a — can_act_as()  (SCHEMA — the authorization seam)
-- ============================================================
--
-- Run ALONE. No dependencies. Everything else in M6 requires it.
--
-- Identity v1.1 §A4: `can_act_as(profile_id)` is THE sole ownership
-- predicate. R3: authorization goes through the seam and only the
-- seam. R3.2: attribution must itself be authorized — a row may
-- claim `from_profile_id = X` only where `can_act_as(X)`.
--
-- ⚠ THE SIGNATURE IS FROZEN FOREVER (v1.1 §A4).
-- `can_act_as(uuid) RETURNS boolean`. The body may evolve — V1 is
-- single-owner; multi-manager arrives with Festival crew roles and
-- changes only what is inside this function. Every policy in the
-- system calls it, so changing the signature would mean rewriting
-- every policy at once. Do not add parameters. Do not overload it.
--
-- ── SEMANTICS ──
--
--  can_act_as(NULL)        → false   (never NULL; policies must not
--                                     have to null-guard every call)
--  unclaimed profile       → false   (user_id IS NULL — v1.0 §02;
--                                     nobody can act as an unclaimed
--                                     profile, that is what claiming
--                                     is for)
--  not signed in           → false   (auth.uid() IS NULL)
--  owns the profile        → true
--
-- Returns boolean, never NULL, for every input.
--
-- ── WHY SECURITY DEFINER ──
-- `profiles` has RLS. A caller must be able to ask "do I own X?"
-- without that question itself being filtered — otherwise the answer
-- depends on the asker's read policy rather than on ownership.
-- search_path is pinned, which is what makes SECURITY DEFINER safe
-- here: the function body cannot be redirected at a shadowed table.
--
-- STABLE, not VOLATILE: it only reads, and it returns the same
-- answer within a statement. This matters — the planner may call it
-- once per row in a policy, and VOLATILE would forbid caching.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ──
-- No policy is changed. Nothing calls this function yet. Installing
-- the seam and binding policies to it are separate steps on purpose
-- (v1.1 migration hard rule: RLS isolated), so this file cannot
-- break a live permission check. The M4 inline `auth.uid()` policies
-- keep working untouched; they are dropped at M8, not here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_act_as(profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = profile_id
      AND p.user_id IS NOT NULL
      AND p.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.can_act_as(uuid) IS
  'Identity v1.1 §A4 — the sole ownership predicate. Signature frozen; body may evolve (V1 single-owner). Returns false for NULL, unclaimed profiles, and unauthenticated callers.';

REVOKE ALL ON FUNCTION public.can_act_as(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_act_as(uuid) TO authenticated;

-- `anon` is deliberately NOT granted. An unauthenticated caller has
-- no uid, so every answer would be false — exposing it would only
-- offer a probe for which profile ids exist.

-- ============================================================
-- VERIFY
-- ============================================================
--
-- 1. It exists with the frozen signature:
--
--      SELECT p.proname,
--             pg_get_function_identity_arguments(p.oid) AS args,
--             pg_get_function_result(p.oid)             AS returns,
--             p.provolatile, p.prosecdef
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'can_act_as';
--
--    Expect: can_act_as │ profile_id uuid │ boolean │ s │ true
--
-- 2. NULL-safety (must be false, never NULL):
--
--      SELECT public.can_act_as(NULL) IS FALSE AS null_is_false;
--
-- 3. Unknown id is false, not an error:
--
--      SELECT public.can_act_as(gen_random_uuid()) AS unknown_is_false;
--
-- 4. Real check — run as a signed-in user in the app, not the SQL
--    editor (the editor has no auth.uid(), so everything is false
--    there and that is correct behaviour, not a failure):
--
--      SELECT id, type, public.can_act_as(id) FROM public.profiles
--      WHERE user_id = auth.uid();
--
--    Expect true for every row the signed-in user owns.
-- ============================================================
