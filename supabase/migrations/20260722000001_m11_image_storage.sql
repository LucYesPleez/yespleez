-- ============================================================
-- M11 · MESSAGE IMAGES — a private bucket for photos sent in a conversation
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- The direct sibling of M9b (voice notes), and deliberately identical in
-- shape: same `<conversation_id>/<uuid>.<ext>` layout, same two predicates,
-- same refusal to grant UPDATE or DELETE. Read M9b's header first — every
-- decision there applies here for the same reasons, and this file only
-- records where images differ.
--
-- ── WHY NOT THE EXISTING IMAGE BUCKETS ───────────────────────────────
--
-- `uploadImage.js` writes to `avatars` and `posters`, and both are PUBLIC.
-- That is correct for them: an avatar and an event poster are published
-- artefacts, and a public URL is the point. A photo sent in a conversation is
-- the opposite — it is private correspondence, and a public bucket would make
-- it readable by anyone holding the URL, forever, with no participation check.
-- Same file type, opposite visibility class. Hence a third bucket rather than
-- a folder in an existing one.
--
-- ── THE FIRST PATH SEGMENT IS LOad-BEARING ───────────────────────────
--
-- Both policies read the conversation id out of the object name. A client that
-- uploads to a flat path, or nests it one level deeper, writes a file that no
-- participant can read back. `messageImages.js` builds this path in exactly
-- one place for that reason.
-- ============================================================


-- ── 1 · PRECONDITION — M9b's predicates must already exist ─────
--
-- This migration does not define `is_conversation_participant`,
-- `can_write_to_conversation` or `safe_uuid`; M9b did. If M9b was never
-- applied to this project, the policies below would be created against
-- functions that do not exist and fail at USE time rather than at CREATE
-- time — a bucket that looks correctly protected and rejects every read.
--
-- ⚠ THIS BLOCK EXISTS TO FAIL. It is not a formality: its success is the
-- evidence that the rest of the file means what it says.
DO $$
BEGIN
  IF to_regprocedure('public.is_conversation_participant(uuid)') IS NULL
     OR to_regprocedure('public.can_write_to_conversation(uuid)') IS NULL
     OR to_regprocedure('public.safe_uuid(text)') IS NULL THEN
    RAISE EXCEPTION
      'M11 requires M9b. Apply 20260721000001_m9b_voice_storage.sql first — '
      'is_conversation_participant / can_write_to_conversation / safe_uuid are missing.';
  END IF;
END $$;


-- ── 2 · THE BUCKET ─────────────────────────────────────────────
--
-- The two limits are enforced by the storage API itself, so a client that
-- forgets to check — or one that is not ours — still cannot write a 40MB file
-- or an .exe into a conversation.
--
-- 8 MB: the client re-encodes to WebP at 1600px before uploading, which puts a
-- phone photo well under 1 MB. The limit is a backstop against a client that
-- skipped that step, not the expected size.
--
-- HEIC IS ABSENT ON PURPOSE. iPhones capture it, but browsers cannot decode it
-- and the client converts to WebP or JPEG during resize. Allowing it here would
-- accept files nothing in the app can display.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-images',
  'message-images',
  false,                                    -- signed URLs only. See M9b header.
  8388608,                                  -- 8 MB
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- DO UPDATE, not DO NOTHING: if the bucket was ever created by hand this
-- migration must CORRECT it, not silently accept a public bucket because
-- something with that name already existed.


-- ── 3 · READ — participants of that conversation, nobody else ──
DROP POLICY IF EXISTS "message images readable by conversation participants" ON storage.objects;

CREATE POLICY "message images readable by conversation participants"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'message-images'
    AND public.is_conversation_participant(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 4 · WRITE — only into a conversation you could send a message to ──
-- `can_write_to_conversation`, not `is_conversation_participant`: a restricted
-- or closed thread stays readable and refuses new photos. The read predicate
-- here would let someone drop an image into a thread they are forbidden to
-- speak in — the message insert would fail afterwards, but the file would
-- already be stored.
DROP POLICY IF EXISTS "message images writable by those who may send" ON storage.objects;

CREATE POLICY "message images writable by those who may send"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-images'
    AND public.can_write_to_conversation(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 5 · NO UPDATE AND NO DELETE POLICY, DELIBERATELY ───────────
-- As M9b. A photo that can be swapped after the fact is a message whose
-- history lies. RLS is deny-by-default, so omitting the policies denies both.
-- Orphan cleanup needs elevated rights and is an operations task.


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ THE SQL EDITOR HAS NO JWT. `auth.uid()` is NULL there, so both predicates
-- return false for every row and a check that merely "returns no rows" passes
-- whether or not the policy is correct. Each block below therefore asserts a
-- POSITIVE fact about the catalogue, and raises when it is not true.
-- ============================================================

-- V1 · the bucket exists and is PRIVATE with the limits set.
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'message-images';
  IF b IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: bucket message-images does not exist';
  END IF;
  IF b.public THEN
    RAISE EXCEPTION 'V1 FAILED: bucket is PUBLIC — every photo would be readable by URL';
  END IF;
  IF b.file_size_limit IS DISTINCT FROM 8388608 THEN
    RAISE EXCEPTION 'V1 FAILED: file_size_limit is %, expected 8388608', b.file_size_limit;
  END IF;
  RAISE NOTICE 'V1 PASSED: private bucket, 8MB cap, mime allow-list %', b.allowed_mime_types;
END $$;

-- V2 · both policies exist, and BOTH predicates are actually referenced.
--      Checking only that a policy exists would pass a policy whose USING
--      clause is `true`.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'message images readable by conversation participants'
    AND qual LIKE '%is_conversation_participant%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V2 FAILED: read policy missing or does not call is_conversation_participant';
  END IF;

  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'message images writable by those who may send'
    AND with_check LIKE '%can_write_to_conversation%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V2 FAILED: write policy missing or does not call can_write_to_conversation';
  END IF;

  RAISE NOTICE 'V2 PASSED: both policies present and calling the right predicate';
END $$;

-- V3 · there is NO update or delete policy on this bucket.
--      The guarantee is the ABSENCE, so this asserts the absence rather than
--      assuming it.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND cmd IN ('UPDATE', 'DELETE')
    AND (qual LIKE '%message-images%' OR with_check LIKE '%message-images%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: % update/delete polic(ies) exist — a sent photo could be swapped', n;
  END IF;
  RAISE NOTICE 'V3 PASSED: no update or delete path exists';
END $$;
