-- ============================================================
-- BETA FEEDBACK — WORKFLOW STATUS
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- Infrastructure only: adds the column Studio's future Beta Feedback module
-- needs in order to treat a submission as a TICKET rather than a message.
-- No UI consumes this yet, by instruction.
-- ============================================================


-- ── 1 · THE COLUMN ───────────────────────────────────────────
--
-- DEFAULT 'new' AND NOT NULL, so every one of the existing rows becomes a
-- ticket in the correct starting state the moment this runs. A nullable
-- column would have meant "no status" and "not yet triaged" being different
-- things that render identically, and the first person to write a triage
-- query would have to remember which.
--
-- The submitter never sets this. beta_feedback has an INSERT policy but no
-- UPDATE policy, so an authenticated user cannot move their own ticket to
-- 'fixed' — only the service role (Studio) or the dashboard can, which is
-- the intended asymmetry: they report, you triage.
ALTER TABLE public.beta_feedback
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

-- Separate from the ADD COLUMN so re-running is safe: ADD COLUMN IF NOT
-- EXISTS silently skips its inline constraints on the second run, which
-- would leave the column present and unconstrained while the migration
-- reported success.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beta_feedback'::regclass
      AND conname = 'beta_feedback_status_check'
  ) THEN
    ALTER TABLE public.beta_feedback
      ADD CONSTRAINT beta_feedback_status_check
      CHECK (status IN ('new', 'investigating', 'fixed', 'closed'));
  END IF;
END $$;


-- ── 2 · INDEX ────────────────────────────────────────────────
-- Every triage query is "the open ones, newest first".
CREATE INDEX IF NOT EXISTS beta_feedback_status_created_idx
  ON public.beta_feedback (status, created_at DESC);


-- ── 3 · WHAT THIS DELIBERATELY DOES NOT ADD ──────────────────
--
-- NO `status_changed_at`, NO assignee, NO comment thread, NO audit trail.
-- Each is a real feature of a real ticket system and none is needed to make
-- the four states work. Adding a column is cheap; removing one that turned
-- out to mean nothing is not.
--
-- NO UPDATE POLICY for `authenticated`, deliberately. RLS is deny-by-default,
-- so the absence IS the rule: a submitter can send and re-read their own
-- feedback and can never change its status.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · the column exists, is NOT NULL, defaults to 'new', and every
--      pre-existing row was backfilled rather than left blank.
DO $$
DECLARE c record; n bigint;
BEGIN
  SELECT is_nullable, column_default, data_type INTO c
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'beta_feedback' AND column_name = 'status';

  IF c IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: beta_feedback.status does not exist';
  END IF;
  IF c.is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'V1 FAILED: status is nullable — "no status" and "not triaged" would be different values that look the same';
  END IF;
  IF c.column_default NOT LIKE '%new%' THEN
    RAISE EXCEPTION 'V1 FAILED: status default is %, expected ''new''', c.column_default;
  END IF;

  SELECT count(*) INTO n FROM public.beta_feedback WHERE status IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'V1 FAILED: % row(s) have a NULL status', n;
  END IF;

  RAISE NOTICE 'V1 PASSED: status exists, NOT NULL, defaults to new';
END $$;

-- V2 · THE ALLOW-LIST BITES. Provokes the rejection and fails if it does NOT
--      happen, so passing means the constraint actually refused something —
--      not merely that a constraint is listed in the catalogue.
DO $$
DECLARE victim bigint;
BEGIN
  SELECT id INTO victim FROM public.beta_feedback LIMIT 1;
  IF victim IS NULL THEN
    RAISE NOTICE 'V2 SKIPPED: no rows to test against';
    RETURN;
  END IF;

  BEGIN
    UPDATE public.beta_feedback SET status = 'wontfix' WHERE id = victim;
    RAISE EXCEPTION 'V2 FAILED: status ''wontfix'' was ACCEPTED — the allow-list is not enforcing';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V2 PASSED: an unknown status was rejected, as intended';
  END;
END $$;

-- V3 · every existing row landed in a valid state, and report the spread.
DO $$
DECLARE r record; total bigint;
BEGIN
  SELECT count(*) INTO total FROM public.beta_feedback;
  FOR r IN SELECT status, count(*) AS n FROM public.beta_feedback GROUP BY status ORDER BY n DESC LOOP
    RAISE NOTICE 'V3: % = % row(s)', r.status, r.n;
  END LOOP;
  RAISE NOTICE 'V3 PASSED: % feedback row(s) carry a valid status', total;
END $$;

-- V4 · a submitter still cannot change a status: no UPDATE policy exists.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'beta_feedback' AND cmd = 'UPDATE';
  IF n <> 0 THEN
    RAISE EXCEPTION 'V4 FAILED: % UPDATE polic(ies) exist — a submitter could mark their own report fixed', n;
  END IF;
  RAISE NOTICE 'V4 PASSED: no UPDATE policy — triage stays with the operator';
END $$;
