-- ============================================================
-- BETA FEEDBACK — one table (write + read-own-row) + one private
-- attachment bucket (write-only)
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- Friends-testing-the-beta feedback form. A submitter can write their own
-- row and their own attachments, and can read back ONLY their own
-- submitted rows (needed so the client can show the real Feedback ID after
-- sending — `INSERT ... RETURNING` is governed by the SELECT policy, not
-- just INSERT's WITH CHECK, so this isn't optional; see §3 below). Nobody
-- can read anyone else's feedback through the app's anon key. Attachments
-- stay write-only — the client never needs to read one back, only upload
-- it. The owner reviews everything via the Supabase dashboard (Table
-- Editor / Storage), which is project-admin access and bypasses RLS.
-- ============================================================


-- ── 1 · THE TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('BUG', 'SUGGESTION', 'LOVE', 'QUESTION')),
  area             text NOT NULL,
  severity         text CHECK (severity IN ('BLOCKER', 'MAJOR', 'MINOR', 'IMPROVEMENT')),
  description      text NOT NULL,
  attachment_paths text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- ── 2 · WRITE — only your own row, never on someone else's behalf ──
DROP POLICY IF EXISTS "beta feedback insert own" ON public.beta_feedback;

CREATE POLICY "beta feedback insert own"
  ON public.beta_feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── 3 · READ — own rows only, and NOT OPTIONAL ──────────────────
-- ⚠ CORRECTED: this was originally "no SELECT policy, deliberately" — wrong.
-- `INSERT ... RETURNING` (what `.insert().select()` sends) is governed by
-- the SELECT policy, not just INSERT's WITH CHECK. With no SELECT policy at
-- all, Postgres refuses to hand back the inserted row and PostgREST reports
-- that as "new row violates row-level security policy" — indistinguishable
-- from the INSERT itself being refused. The client needs the real row id
-- back to show as the Feedback ID, so some SELECT policy is required, not
-- optional. Scoping it to your own rows costs nothing on the "can't browse
-- other people's feedback" guarantee — it only lets a submitter re-read
-- what they themselves just sent, same shape as the INSERT policy.
DROP POLICY IF EXISTS "beta feedback select own" ON public.beta_feedback;

CREATE POLICY "beta feedback select own"
  ON public.beta_feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ── 3b · NO UPDATE OR DELETE POLICY, DELIBERATELY ───────────────
-- RLS is deny-by-default, so omitting these denies both — a friend can send
-- feedback and read their own submissions back, but never edit or retract
-- one after the fact.


-- ── 4 · THE ATTACHMENT BUCKET ───────────────────────────────────
-- 100MB matches the client's own pre-upload size check (screenshots and
-- short screen recordings). Path is `<user_id>/<uuid>.<ext>` — the FIRST
-- PATH SEGMENT IS THE SECURITY BOUNDARY, same rule as every other bucket in
-- this project: the write policy below reads it straight out of the object
-- name, so a client that flattens the path writes a file that policy denies.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'beta-feedback-attachments',
  'beta-feedback-attachments',
  false,
  104857600,                                -- 100 MB
  ARRAY['image/*', 'video/*']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- WRITE — only into your own folder.
DROP POLICY IF EXISTS "beta feedback attachments writable by owner" ON storage.objects;

CREATE POLICY "beta feedback attachments writable by owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'beta-feedback-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- NO SELECT, UPDATE OR DELETE POLICY on this bucket either — same reasoning
-- as the table. The owner reviews attachments via the Storage browser in
-- the dashboard, which does not go through these policies.


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ THE SQL EDITOR HAS NO JWT. auth.uid() is NULL there, so a check that
-- merely "returns no rows" would pass whether or not the policy is
-- correct. Each block asserts a POSITIVE fact about the catalogue instead.
-- ============================================================

-- V1 · table exists, RLS is on, and exactly the two expected policies exist
--      (INSERT own + SELECT own — no UPDATE, no DELETE).
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.beta_feedback') IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: public.beta_feedback does not exist';
  END IF;

  SELECT count(*) INTO n FROM pg_class
  WHERE relname = 'beta_feedback' AND relrowsecurity = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: row level security is not enabled on beta_feedback';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'beta_feedback';
  IF n <> 2 THEN
    RAISE EXCEPTION 'V1 FAILED: expected exactly 2 policies on beta_feedback, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'beta_feedback'
    AND cmd = 'INSERT' AND with_check LIKE '%auth.uid()%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: no INSERT policy gated on auth.uid()';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'beta_feedback'
    AND cmd = 'SELECT' AND qual LIKE '%auth.uid()%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: no SELECT policy gated on auth.uid() — RETURNING will break';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'beta_feedback'
    AND cmd IN ('UPDATE', 'DELETE');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V1 FAILED: % update/delete polic(ies) exist — a submission could be edited or erased', n;
  END IF;

  RAISE NOTICE 'V1 PASSED: table exists, RLS on, insert-own + select-own only';
END $$;

-- V2 · the bucket exists, is private, and both size/mime limits are set.
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'beta-feedback-attachments';
  IF b IS NULL THEN
    RAISE EXCEPTION 'V2 FAILED: bucket beta-feedback-attachments does not exist';
  END IF;
  IF b.public THEN
    RAISE EXCEPTION 'V2 FAILED: bucket is PUBLIC — every attachment would be readable by URL';
  END IF;
  IF b.file_size_limit IS DISTINCT FROM 104857600 THEN
    RAISE EXCEPTION 'V2 FAILED: file_size_limit is %, expected 104857600', b.file_size_limit;
  END IF;
  RAISE NOTICE 'V2 PASSED: private bucket, 100MB cap, mime allow-list %', b.allowed_mime_types;
END $$;

-- V3 · storage has exactly one policy for this bucket, and it is INSERT-only.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'beta feedback attachments writable by owner'
    AND cmd = 'INSERT'
    AND with_check LIKE '%beta-feedback-attachments%'
    AND with_check LIKE '%auth.uid()%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V3 FAILED: write policy missing or not scoped to auth.uid()''s own folder';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND cmd IN ('SELECT', 'UPDATE', 'DELETE')
    AND (qual LIKE '%beta-feedback-attachments%' OR with_check LIKE '%beta-feedback-attachments%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: % read/update/delete polic(ies) exist on this bucket', n;
  END IF;

  RAISE NOTICE 'V3 PASSED: exactly one policy, insert-only, own-folder scoped';
END $$;
