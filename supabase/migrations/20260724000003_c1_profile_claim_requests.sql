-- ============================================================
-- C1 · PROFILE CLAIM REQUESTS — §07 stage C, made real
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- Until now a "claim" was an Instagram DM or an email: ClaimDialog persisted
-- nothing, nothing ever wrote claim_status = 'pending', and the app rendered
-- a pending state that could not occur. This migration gives §07 stage C its
-- table, and stage D its two decision functions.
--
-- ── WHAT DELIBERATELY DOES NOT CHANGE ────────────────────────────────
--
-- CLAIM COMPLETION. A claim still completes at exactly one place: the
-- NULL → NOT NULL transition of profiles.user_id, where the N3 trigger
-- (20260720000001) delivers every held notification. Nothing here writes
-- profiles.user_id except approve_profile_claim(), which is EXECUTABLE ONLY
-- BY THE REVIEWING SIDE — the app's roles cannot call it. So the app
-- SUBMITS claims; it can never COMPLETE one, and claimDelivery.test.js's
-- invariant ("no app code writes profiles.user_id") stays true.
--
-- N3's own header warns its INVOKER-rights delivery must be revisited
-- "BEFORE moving claim completion into the app". Completion is NOT moving
-- into the app — approval runs in the SQL editor today and under Studio's
-- service role later, both of which RLS does not constrain — so that debt
-- stays parked, deliberately.
--
-- ── Q7 COMPLIANCE, BY CLAUSE ─────────────────────────────────────────
--
--   §07 C   claimant + target + asserted relationship + evidence  → columns
--   Q7 5.2  pending visible on the public profile — THE FACT, never the
--           claimant → trigger sets profiles.claim_status='pending', which
--           ProfileScreen already renders as "Claim under review"; the
--           request row itself is readable only by its claimant + reviewers
--   §07 D   approve → attach / reject → return to unclaimed WITH A REASON
--           → approve_profile_claim() / reject_profile_claim(note)
--   Q7 5.4  recorded verification basis → decision_note on the request row
--   Q7 5.5  (P6, pending expiry) is POLICY, deferred with the policy doc —
--           created_at is recorded so any future window can be enforced
-- ============================================================


-- ── 1 · THE TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_claim_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- The target. CASCADE: a deleted profile takes its claim requests with it —
  -- a request to own a profile that no longer exists is not a record worth
  -- keeping, unlike usage_events where history outlives its subject.
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The claimant. §07 stage C requires an account — there is no anonymous
  -- claim, because approval attaches ownership to exactly this identity.
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- §07 C "asserted relationship". An allow-list for the same reason as
  -- usage_events.name: a free-text field here becomes an unqueryable mess of
  -- "im the dj", and the tier policy (Q7 5.1) will want to branch on it.
  relationship  text NOT NULL CHECK (relationship IN
    ('owner', 'manager', 'member', 'representative')),

  -- §07 C "evidence". Free text — links, handles, whatever the claimant has.
  -- Non-blank, same contract as messages.body: an empty evidence field is a
  -- claim with nothing to review.
  evidence      text NOT NULL CHECK (btrim(evidence) <> ''),

  status        text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'approved', 'rejected')),

  -- §07 D: rejection carries a reason; Q7 5.4: the decision basis is
  -- retained. NULL until decided.
  decided_at    timestamptz,
  decision_note text
);

-- One LIVE claim per claimant per profile. Partial, so a rejected claimant
-- can try again with better evidence — the history rows keep their place and
-- only the pending one is unique. Two DIFFERENT claimants pending on the same
-- profile is allowed on purpose: that is a contested claim, and review is
-- where it gets resolved (Q7-R4).
CREATE UNIQUE INDEX IF NOT EXISTS profile_claim_requests_one_pending
  ON public.profile_claim_requests (profile_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS profile_claim_requests_status_created_idx
  ON public.profile_claim_requests (status, created_at DESC);

ALTER TABLE public.profile_claim_requests ENABLE ROW LEVEL SECURITY;


-- ── 2 · RLS — submit your own, read your own, change nothing ─────
--
-- INSERT: only as yourself, and only against a profile that is still
-- unowned. The subquery runs as the inserting user; profiles is publicly
-- readable so it can always be evaluated.
DROP POLICY IF EXISTS "claim requests insert own" ON public.profile_claim_requests;
CREATE POLICY "claim requests insert own"
  ON public.profile_claim_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = profile_id AND pr.user_id IS NULL
    )
  );

-- SELECT own — NOT OPTIONAL, and scoped to the claimant. The client sends
-- INSERT ... RETURNING (governed by this policy — the beta_feedback lesson),
-- and the dialog shows "you already have a claim under review" by reading
-- back its own rows. Scoping to user_id also implements Q7-R4: the PUBLIC
-- pending signal lives on the profile row; the request rows never reveal WHO
-- claimed to anyone but the claimant and the reviewers.
DROP POLICY IF EXISTS "claim requests select own" ON public.profile_claim_requests;
CREATE POLICY "claim requests select own"
  ON public.profile_claim_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE or DELETE policy, deliberately: a submitted claim is a record.
-- Withdrawal, if ever wanted, is a decision function like the other two.

-- Supabase default-privileges auto-grant ALL on new tables to anon and
-- authenticated — REVOKE first or the grants below are decorative.
REVOKE ALL ON public.profile_claim_requests FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.profile_claim_requests TO authenticated;
GRANT ALL ON public.profile_claim_requests TO service_role;


-- ── 3 · SUBMISSION SETS THE PUBLIC PENDING STATE ─────────────────
--
-- SECURITY DEFINER because the claimant cannot (and must not) update
-- profiles themselves; this narrow function does it for them, and does
-- nothing else. search_path pinned — a DEFINER function without it can be
-- retargeted via a crafted search path.
--
-- The guard repeats the policy's "still unowned" check: between the policy
-- evaluating and the trigger running, a race with approval is possible, and
-- an owned profile must never be flipped back to pending.
CREATE OR REPLACE FUNCTION public.set_profile_claim_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET claim_status = 'pending'
   WHERE id = NEW.profile_id
     AND user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_request_pending ON public.profile_claim_requests;
CREATE TRIGGER trg_claim_request_pending
  AFTER INSERT ON public.profile_claim_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profile_claim_pending();


-- ── 4 · THE STAGE-D DECISION FUNCTIONS — reviewer-only ───────────
--
-- INVOKER rights, deliberately: they run in the SQL editor today and under
-- Studio's service role later, neither of which RLS constrains, and the N3
-- trigger fires correctly under both. EXECUTE is revoked from the app's
-- roles below, so "the app cannot complete a claim" is enforced by the
-- database rather than promised by the client.

CREATE OR REPLACE FUNCTION public.approve_profile_claim(p_request_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  req public.profile_claim_requests%ROWTYPE;
BEGIN
  SELECT * INTO req FROM public.profile_claim_requests
   WHERE id = p_request_id FOR UPDATE;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'approve_profile_claim: no request %', p_request_id;
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'approve_profile_claim: request % is already %', p_request_id, req.status;
  END IF;

  -- The profile must still be unowned. If it is not, this claim lost a race
  -- — surface that rather than silently reattributing (N3 fires only on
  -- NULL → NOT NULL, so a silent overwrite would also skip delivery).
  PERFORM 1 FROM public.profiles
   WHERE id = req.profile_id AND user_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_profile_claim: profile % already has an owner', req.profile_id;
  END IF;

  -- THE ATTACH (§07 stage E). This UPDATE is the canonical claim.completed
  -- event — the N3 trigger fires here and delivers the held pile.
  UPDATE public.profiles
     SET user_id      = req.user_id,
         claim_status = 'claimed',
         claimed_at   = now(),
         claimed_via  = 'in_app_claim'
   WHERE id = req.profile_id;

  UPDATE public.profile_claim_requests
     SET status = 'approved', decided_at = now()
   WHERE id = req.id;

  -- Contested claims that lost: resolved now, honestly, rather than left
  -- pending against a profile that can no longer be claimed.
  UPDATE public.profile_claim_requests
     SET status = 'rejected', decided_at = now(),
         decision_note = 'Profile was claimed by another account.'
   WHERE profile_id = req.profile_id AND status = 'pending' AND id <> req.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_profile_claim(p_request_id bigint, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  req public.profile_claim_requests%ROWTYPE;
  remaining integer;
BEGIN
  SELECT * INTO req FROM public.profile_claim_requests
   WHERE id = p_request_id FOR UPDATE;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'reject_profile_claim: no request %', p_request_id;
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'reject_profile_claim: request % is already %', p_request_id, req.status;
  END IF;

  UPDATE public.profile_claim_requests
     SET status = 'rejected', decided_at = now(), decision_note = p_note
   WHERE id = req.id;

  -- §07 stage D: "reject → return to unclaimed". Only when this was the LAST
  -- pending claim — another claimant's still-open request keeps the public
  -- pending signal true — and only if the profile is still unowned.
  SELECT count(*) INTO remaining FROM public.profile_claim_requests
   WHERE profile_id = req.profile_id AND status = 'pending';
  IF remaining = 0 THEN
    UPDATE public.profiles
       SET claim_status = 'unclaimed'
     WHERE id = req.profile_id AND user_id IS NULL;
  END IF;
END;
$$;

-- The enforcement that makes the header's promise true.
REVOKE EXECUTE ON FUNCTION public.approve_profile_claim(bigint)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_profile_claim(bigint, text)     FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.approve_profile_claim(bigint) IS
  '§07 stage D approve → stage E attach. Sets profiles.user_id (firing N3 held-notification '
  'delivery), stamps claimed_at/claimed_via, resolves losing contested claims. Reviewer-only: '
  'EXECUTE revoked from app roles. Call from the SQL editor or Studio''s service role.';
COMMENT ON FUNCTION public.reject_profile_claim(bigint, text) IS
  '§07 stage D reject, with a reason. Returns the profile to unclaimed only when no other '
  'pending claim remains. Reviewer-only.';


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · table, RLS, exactly the two intended policies.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.profile_claim_requests') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: table does not exist';
  END IF;
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'profile_claim_requests' AND relrowsecurity = true;
  IF n <> 1 THEN RAISE EXCEPTION 'V1 FAILED: RLS not enabled'; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profile_claim_requests';
  IF n <> 2 THEN RAISE EXCEPTION 'V1 FAILED: expected 2 policies, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profile_claim_requests'
     AND cmd IN ('UPDATE', 'DELETE');
  IF n <> 0 THEN RAISE EXCEPTION 'V1 FAILED: a claimant could alter a submitted claim'; END IF;
  RAISE NOTICE 'V1 PASSED';
END $$;

-- V2 · grants: authenticated may insert+select only; anon nothing; the
--      decision functions are NOT callable by app roles.
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.profile_claim_requests', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.profile_claim_requests', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: authenticated cannot submit or read back';
  END IF;
  IF has_table_privilege('authenticated', 'public.profile_claim_requests', 'UPDATE')
     OR has_table_privilege('anon', 'public.profile_claim_requests', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: over-granted';
  END IF;
  IF has_function_privilege('authenticated', 'public.approve_profile_claim(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reject_profile_claim(bigint, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.approve_profile_claim(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V2 FAILED: an app role can complete a claim — the core invariant is broken';
  END IF;
  RAISE NOTICE 'V2 PASSED: app submits, reviewers decide';
END $$;

-- V3 · END-TO-END ON A THROWAWAY PROFILE. Exercises submit → pending →
--      reject → unclaimed, then submit → approve → owned + N3 fired, then
--      cleans up completely. Uses a real user id (FK) but a profile created
--      and deleted inside this block, so no live profile is touched and the
--      N3 trigger fires against a profile with no held notifications.
DO $$
DECLARE
  test_user uuid;
  test_profile uuid;
  r1 bigint; r2 bigint;
  st text; ps text; owner uuid; via text; ca timestamptz;
BEGIN
  SELECT user_id INTO test_user FROM public.profiles WHERE user_id IS NOT NULL LIMIT 1;
  IF test_user IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: no user available to test with';
  END IF;

  INSERT INTO public.profiles (type, name, claim_status)
  VALUES ('artist', 'ZZ C1 VERIFICATION THROWAWAY', 'unclaimed')
  RETURNING id INTO test_profile;

  -- submit → trigger sets pending
  INSERT INTO public.profile_claim_requests (profile_id, user_id, relationship, evidence)
  VALUES (test_profile, test_user, 'owner', 'verification run')
  RETURNING id INTO r1;
  SELECT claim_status INTO ps FROM public.profiles WHERE id = test_profile;
  IF ps <> 'pending' THEN
    RAISE EXCEPTION 'V3 FAILED: submission did not set pending (got %)', ps;
  END IF;

  -- duplicate pending must be refused by the partial unique index
  BEGIN
    INSERT INTO public.profile_claim_requests (profile_id, user_id, relationship, evidence)
    VALUES (test_profile, test_user, 'owner', 'duplicate');
    RAISE EXCEPTION 'V3 FAILED: a second pending claim by the same user was ACCEPTED';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- intended
  END;

  -- reject → reason recorded, profile back to unclaimed
  PERFORM public.reject_profile_claim(r1, 'verification: not enough evidence');
  SELECT status, decision_note INTO st, via FROM public.profile_claim_requests WHERE id = r1;
  SELECT claim_status INTO ps FROM public.profiles WHERE id = test_profile;
  IF st <> 'rejected' OR via IS NULL OR ps <> 'unclaimed' THEN
    RAISE EXCEPTION 'V3 FAILED: reject path (status %, note %, profile %)', st, via, ps;
  END IF;

  -- resubmit (allowed — the pending index is partial) → approve → attached
  INSERT INTO public.profile_claim_requests (profile_id, user_id, relationship, evidence)
  VALUES (test_profile, test_user, 'owner', 'verification run 2')
  RETURNING id INTO r2;
  PERFORM public.approve_profile_claim(r2);

  SELECT user_id, claim_status, claimed_via, claimed_at INTO owner, ps, via, ca
  FROM public.profiles WHERE id = test_profile;
  IF owner IS DISTINCT FROM test_user OR ps <> 'claimed' OR via <> 'in_app_claim' OR ca IS NULL THEN
    RAISE EXCEPTION 'V3 FAILED: approve did not attach correctly (owner %, status %, via %, at %)', owner, ps, via, ca;
  END IF;
  SELECT status INTO st FROM public.profile_claim_requests WHERE id = r2;
  IF st <> 'approved' THEN
    RAISE EXCEPTION 'V3 FAILED: request not marked approved';
  END IF;

  -- approving twice must refuse
  BEGIN
    PERFORM public.approve_profile_claim(r2);
    RAISE EXCEPTION 'V3 FAILED: a decided request was approved twice';
  EXCEPTION WHEN raise_exception THEN
    NULL; -- intended
  END;

  -- cleanup: the CASCADE removes both request rows with the profile
  DELETE FROM public.profiles WHERE id = test_profile;
  IF EXISTS (SELECT 1 FROM public.profile_claim_requests WHERE profile_id = test_profile) THEN
    RAISE EXCEPTION 'V3 FAILED: cleanup left request rows behind';
  END IF;

  RAISE NOTICE 'V3 PASSED: submit → pending → reject → unclaimed → approve → attached, cleaned up';
END $$;

-- V4 · nothing from verification survives.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.profiles WHERE name = 'ZZ C1 VERIFICATION THROWAWAY';
  IF n <> 0 THEN RAISE EXCEPTION 'V4 FAILED: throwaway profile still exists'; END IF;
  SELECT count(*) INTO n FROM public.profile_claim_requests;
  RAISE NOTICE 'V4 PASSED: no test debris; % real claim request(s) in the table', n;
END $$;
