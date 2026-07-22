-- ============================================================
-- M12 · MESSAGE FILES — a private bucket for documents sent in a conversation
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- The third bucket in the same family, after M9b (voice) and M11 (images), and
-- deliberately identical in shape: `<conversation_id>/<uuid>.<ext>`, the same
-- two predicates, no UPDATE and no DELETE. Read M9b's header for the reasoning.
-- This file records only what differs.
--
-- ── WHY NOT JUST WIDEN `message-images` ──────────────────────────────
--
-- Because the LIMITS are the protection, and they differ by an order of
-- magnitude. Images are re-encoded client-side to WebP and land under 1 MB, so
-- an 8 MB ceiling is a tight backstop. A document or an audio master is
-- uploaded byte-for-byte with no client-side reduction available, so it needs
-- 50 MB — and putting them in the image bucket would raise that ceiling too,
-- quietly removing the guarantee that a photo cannot be enormous.
--
-- A bucket is a policy boundary, not a folder. Two limits means two buckets.
-- ============================================================


-- ── 1 · PRECONDITION — M9b's predicates must already exist ─────
--
-- ⚠ THIS BLOCK EXISTS TO FAIL. Without these functions the policies below
-- would be created successfully and then reject every read at USE time — a
-- bucket that looks protected and is simply broken.
DO $$
BEGIN
  IF to_regprocedure('public.is_conversation_participant(uuid)') IS NULL
     OR to_regprocedure('public.can_write_to_conversation(uuid)') IS NULL
     OR to_regprocedure('public.safe_uuid(text)') IS NULL THEN
    RAISE EXCEPTION
      'M12 requires M9b. Apply the m9b voice storage migration first — '
      'is_conversation_participant / can_write_to_conversation / safe_uuid are missing.';
  END IF;
END $$;


-- ── 2 · THE BUCKET ─────────────────────────────────────────────
--
-- ⚠ 50 MB, AND LOSSLESS AUDIO IS WHAT SETS IT. Documents would be comfortable
-- at 25 — a long PDF is a few megabytes. A three-minute WAV is about 30, and
-- the "Upload HD audio" row exists precisely so a musician can send a master
-- WITHOUT it being re-encoded. A cap that quietly refuses the files the row was
-- built for would be worse than not offering the row.
--
-- ⚠ THE MIME LIST IS AN ALLOW-LIST, AND THAT IS THE POINT. It is enforced by
-- the storage API itself, so a client that is not ours still cannot put an
-- executable in a conversation. Adding a type here is a security decision, not
-- a convenience one.
--
-- Notably ABSENT and deliberately so: anything executable or script-like
-- (.exe, .bat, .sh, .js, .html), because a file that can be opened and RUN is a
-- different risk class from one that can only be read. HTML is excluded
-- specifically because a signed URL serving text/html is a page running on our
-- storage origin.
--
-- Images are absent too: they belong in `message-images`, where they are
-- re-encoded and capped at 8 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-files',
  'message-files',
  false,                                    -- signed URLs only
  52428800,                                 -- 50 MB. See note above.
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    -- Audio a musician would actually send. NOT the voice-note path: that is
    -- `voice-notes`, recorded in-app and capped at 10 MB.
    -- ⚠ THE SAME FORMAT UNDER EVERY NAME BROWSERS ACTUALLY REPORT. A .wav is
    -- 'audio/wav' in Chrome, 'audio/x-wav' or 'audio/wave' elsewhere, and a
    -- file whose reported type is missing here is REFUSED BY THE SERVER after
    -- the user has already waited for the upload. Omitting an alias is not a
    -- tighter allow-list, it is an intermittent bug.
    'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
    'audio/flac', 'audio/x-flac',
    'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/aiff', 'audio/x-aiff'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- DO UPDATE, not DO NOTHING: if the bucket was ever created by hand this must
-- CORRECT it rather than accept a public bucket because the name existed.


-- ── 3 · READ — participants of that conversation, nobody else ──
DROP POLICY IF EXISTS "message files readable by conversation participants" ON storage.objects;

CREATE POLICY "message files readable by conversation participants"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'message-files'
    AND public.is_conversation_participant(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 4 · WRITE — only into a conversation you could send a message to ──
DROP POLICY IF EXISTS "message files writable by those who may send" ON storage.objects;

CREATE POLICY "message files writable by those who may send"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-files'
    AND public.can_write_to_conversation(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 5 · NO UPDATE AND NO DELETE POLICY, DELIBERATELY ───────────
-- As M9b and M11. A document that can be swapped after the fact is a message
-- whose history lies. RLS is deny-by-default; omitting the policies denies both.


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ THE SQL EDITOR HAS NO JWT, so auth.uid() is NULL and any "returns no rows"
-- check passes whether or not the policy is right. These assert positive facts
-- and raise instead.
-- ============================================================

DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'message-files';
  IF b IS NULL THEN RAISE EXCEPTION 'V1 FAILED: bucket message-files does not exist'; END IF;
  IF b.public THEN RAISE EXCEPTION 'V1 FAILED: bucket is PUBLIC — every attachment readable by URL'; END IF;
  IF b.file_size_limit IS DISTINCT FROM 52428800 THEN
    RAISE EXCEPTION 'V1 FAILED: file_size_limit is %, expected 52428800', b.file_size_limit; END IF;
  IF b.allowed_mime_types IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: allowed_mime_types is NULL — ANY file type would be accepted'; END IF;
  RAISE NOTICE 'V1 PASSED: private bucket, 50MB cap, % allowed types', array_length(b.allowed_mime_types, 1);
END $$;

-- V2 · the allow-list must not have acquired anything executable.
--      Asserts the ABSENCE, because that is the actual guarantee.
DO $$
DECLARE b record; bad text;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'message-files';
  FOREACH bad IN ARRAY ARRAY['text/html','application/x-msdownload','application/x-sh','text/javascript']
  LOOP
    IF bad = ANY(b.allowed_mime_types) THEN
      RAISE EXCEPTION 'V2 FAILED: % is allowed — a runnable file in a conversation', bad;
    END IF;
  END LOOP;
  RAISE NOTICE 'V2 PASSED: no executable or html type is accepted';
END $$;

-- V3 · both policies exist AND call the right predicate. Checking only for
--      existence would pass a policy whose USING clause is `true`.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname='message files readable by conversation participants'
     AND qual LIKE '%is_conversation_participant%';
  IF n <> 1 THEN RAISE EXCEPTION 'V3 FAILED: read policy missing or does not call the predicate'; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname='message files writable by those who may send'
     AND with_check LIKE '%can_write_to_conversation%';
  IF n <> 1 THEN RAISE EXCEPTION 'V3 FAILED: write policy missing or does not call the predicate'; END IF;

  RAISE NOTICE 'V3 PASSED: both policies present and calling the right predicate';
END $$;

-- V4 · no update or delete path exists.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('UPDATE','DELETE')
     AND (qual LIKE '%message-files%' OR with_check LIKE '%message-files%');
  IF n <> 0 THEN RAISE EXCEPTION 'V4 FAILED: % update/delete polic(ies) exist', n; END IF;
  RAISE NOTICE 'V4 PASSED: no update or delete path exists';
END $$;
