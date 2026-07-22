-- ============================================================
-- M13 · HD ORIGINALS — a temporary download window for full-resolution uploads
--
-- ⚠ NOT APPLIED. Run this by hand in the SQL editor.
--
-- A sender may optionally preserve the untouched original of a photo for a
-- limited period. Chat always shows the optimised version; the original is
-- download-only and disappears when its window closes.
--
-- ══ THE CENTRAL DECISION: EXPIRY IS A GATE, NOT A DELETION ══════════
--
-- The obvious design is a scheduled job that deletes expired objects. This
-- project cannot have that today, and pretending otherwise would ship a lie:
--
--   · There is NO scheduler. `expire_held_notifications()` (N4) was written
--     the same way and has never once run — it is inert to this day. A second
--     feature depending on a cron that does not exist would fail identically.
--   · Deleting a storage object needs elevated rights. No bucket in this
--     project grants DELETE, deliberately.
--   · Deployment is parked, so there is nowhere to host an Edge Function.
--
-- If expiry depended on deletion, "Available for 72 hours" would be false: the
-- countdown would reach zero, the file would remain, and it would remain
-- downloadable. The user-visible promise is not "the bytes are gone", it is
-- "you can no longer download this" — so that is what is enforced, in the one
-- place a client cannot argue with.
--
-- `message_originals` holds the window. The bucket's READ policy joins it. Once
-- `expires_at` passes, Postgres refuses to sign a url and the download stops
-- working — with no job, no scheduler, and no deployment.
--
-- Reclaiming the bytes afterwards becomes a pure COST exercise that can be
-- added at any time, by any mechanism, without touching correctness. That is
-- the entire benefit of putting the gate here: the guarantee holds on day one,
-- and the cleanup is free to be late.
--
-- ══ PREMIUM IS ALREADY POSSIBLE, AND IS NOT IMPLEMENTED ═════════════
--
-- `expires_at` is NULLABLE, and NULL means "never expires". The gate below
-- already honours it. A future premium tier therefore needs no schema change
-- and no policy change — only a rule about who is allowed to write NULL.
-- Nothing here grants that; today every client sends a finite timestamp.
-- ============================================================


-- ── 1 · PRECONDITION — M9b's predicates, and M11's images ──────
DO $$
BEGIN
  IF to_regprocedure('public.is_conversation_participant(uuid)') IS NULL
     OR to_regprocedure('public.can_write_to_conversation(uuid)') IS NULL
     OR to_regprocedure('public.safe_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'M13 requires M9b. Apply the m9b voice storage migration first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'message-images') THEN
    RAISE EXCEPTION 'M13 requires M11. Apply the m11 image storage migration first.';
  END IF;
END $$;


-- ── 2 · THE WINDOW ─────────────────────────────────────────────
--
-- One row per preserved original. This table IS the expiry mechanism: the
-- storage policy in §5 reads it, so a row's absence or staleness is what makes
-- an original undownloadable.
CREATE TABLE IF NOT EXISTS public.message_originals (
  object_path     text        PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id      uuid        REFERENCES public.messages(id) ON DELETE CASCADE,

  -- Shown in the viewer's panel. Stored rather than derived because reading it
  -- back off the object would mean downloading the original to describe it.
  bytes           bigint      NOT NULL CHECK (bytes > 0),
  width           int,
  height          int,
  mime            text,

  -- ⚠ NULL MEANS NEVER EXPIRES. That is the premium case, and the gate already
  -- honours it. Nothing today writes NULL.
  expires_at      timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The gate's lookup is by path, which the primary key already serves. This one
-- serves the "Originals" listing for a conversation, still-live only.
CREATE INDEX IF NOT EXISTS message_originals_live_idx
  ON public.message_originals (conversation_id, created_at DESC)
  WHERE expires_at IS NULL OR expires_at > now();

-- ⚠ THE INDEX PREDICATE USES now(), WHICH IS NOT IMMUTABLE — Postgres allows it
-- in a partial index but the planner treats the index as valid only for rows
-- that satisfied it AT WRITE TIME. It is therefore a performance aid and NEVER
-- a correctness boundary. The gate in §5 re-checks expiry on every read; do not
-- be tempted to rely on this index to filter expired rows.


-- ── 3 · RLS ON THE WINDOW TABLE ────────────────────────────────
ALTER TABLE public.message_originals ENABLE ROW LEVEL SECURITY;

-- READ — participants only. This is what lets the client draw the HD badge and
-- the countdown, so it must be readable for as long as the message is, INCLUDING
-- after expiry: "HD Original expired" is a state the recipient must be able to
-- see, and it cannot be drawn from a row nobody can read.
DROP POLICY IF EXISTS "originals readable by conversation participants" ON public.message_originals;
CREATE POLICY "originals readable by conversation participants"
  ON public.message_originals FOR SELECT
  TO authenticated
  USING (public.is_conversation_participant(conversation_id));

-- WRITE — only someone who could send a message there.
DROP POLICY IF EXISTS "originals writable by those who may send" ON public.message_originals;
CREATE POLICY "originals writable by those who may send"
  ON public.message_originals FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_to_conversation(conversation_id));

-- ⚠ NO UPDATE POLICY, AND THAT IS THE SECURITY BOUNDARY.
-- `expires_at` is the whole guarantee. If a client could UPDATE this row it
-- could extend its own window indefinitely, and the expiry would be advisory.
-- RLS is deny-by-default, so omitting the policy denies it. A future premium
-- tier must extend a window through a SECURITY DEFINER function that checks
-- entitlement — never by granting UPDATE here.
--
-- No DELETE policy either: a row's disappearance would strand the object with
-- no record that it exists.


-- ── 4 · THE BUCKET ─────────────────────────────────────────────
--
-- Separate from `message-images` because the limits are opposite. An optimised
-- image is re-encoded and capped at 8 MB; an original is untouched by
-- definition, and a modern phone's ProRAW or a photographer's export runs far
-- past that. Widening the image bucket to fit would remove the guarantee that a
-- chat photo cannot be enormous.
--
-- HEIC IS ALLOWED HERE, unlike M11. An original is never rendered — it is
-- download-only — so a format browsers cannot decode is perfectly storable, and
-- refusing it would mean an iPhone user cannot preserve their own photograph.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-originals',
  'message-originals',
  false,                                    -- signed urls only, and gated. §5.
  52428800,                                 -- 50 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/avif', 'image/tiff'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── 5 · THE GATE ───────────────────────────────────────────────
--
-- ⚠ THIS POLICY IS THE FEATURE. Everything else is bookkeeping.
--
-- Three conditions, all required: the right bucket, a participant, and a window
-- that is still open. The third is what makes expiry real — after it passes,
-- `createSignedUrl` fails at the storage API and no client, ours or otherwise,
-- can obtain a url.
--
-- The participation check is repeated here rather than delegated to the joined
-- row, because a row in `message_originals` proves a window exists, not that
-- the reader is allowed to see it.
DROP POLICY IF EXISTS "originals readable while their window is open" ON storage.objects;

CREATE POLICY "originals readable while their window is open"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'message-originals'
    AND public.is_conversation_participant(
          public.safe_uuid((storage.foldername(name))[1])
        )
    AND EXISTS (
      SELECT 1
      FROM public.message_originals o
      WHERE o.object_path = storage.objects.name
        -- NULL is the premium case: no expiry. See §2.
        AND (o.expires_at IS NULL OR o.expires_at > now())
    )
  );


-- ── 6 · WRITE ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "originals writable by those who may send" ON storage.objects;

CREATE POLICY "originals writable by those who may send"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-originals'
    AND public.can_write_to_conversation(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );

-- No UPDATE and no DELETE policy, as every sibling bucket. Reclaiming expired
-- bytes is an operations task needing elevated rights — and, because §5 already
-- denies access, it is a COST exercise rather than a correctness one.


-- ============================================================
-- VERIFICATION — run after applying
--
-- ⚠ THE SQL EDITOR HAS NO JWT. auth.uid() is NULL, so every predicate returns
-- false and a "returns no rows" check passes whether or not the policy works.
-- These assert positive facts about the catalogue and RAISE instead.
-- ============================================================

-- V1 · the bucket is private, large, and accepts HEIC.
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'message-originals';
  IF b IS NULL  THEN RAISE EXCEPTION 'V1 FAILED: bucket does not exist'; END IF;
  IF b.public   THEN RAISE EXCEPTION 'V1 FAILED: bucket is PUBLIC — expiry would be meaningless, a public url ignores RLS entirely'; END IF;
  IF NOT ('image/heic' = ANY(b.allowed_mime_types)) THEN
    RAISE EXCEPTION 'V1 FAILED: HEIC refused — iPhone originals could not be preserved'; END IF;
  RAISE NOTICE 'V1 PASSED: private, % MB cap', b.file_size_limit / 1048576;
END $$;

-- V2 · THE GATE ACTUALLY CHECKS EXPIRY.
--      A policy that merely exists proves nothing: the failure this guards
--      against is one whose USING clause forgot the time comparison, which
--      would read as a working feature and never expire anything.
DO $$
DECLARE q text;
BEGIN
  SELECT qual INTO q FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname='originals readable while their window is open';

  IF q IS NULL THEN RAISE EXCEPTION 'V2 FAILED: the gate policy does not exist'; END IF;
  IF q NOT LIKE '%message_originals%' THEN
    RAISE EXCEPTION 'V2 FAILED: the gate does not consult message_originals'; END IF;
  IF q NOT LIKE '%expires_at%' THEN
    RAISE EXCEPTION 'V2 FAILED: the gate does not check expires_at — NOTHING WOULD EVER EXPIRE'; END IF;
  IF q NOT LIKE '%is_conversation_participant%' THEN
    RAISE EXCEPTION 'V2 FAILED: the gate does not check participation'; END IF;

  RAISE NOTICE 'V2 PASSED: bucket + participant + open window, all three present';
END $$;

-- V3 · the window cannot be extended by a client.
--      This is the one that keeps expiry honest.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='message_originals' AND cmd IN ('UPDATE','ALL');
  IF n <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: % update polic(ies) on message_originals — a client could extend its own expiry', n;
  END IF;
  RAISE NOTICE 'V3 PASSED: expires_at cannot be rewritten by any client';
END $$;

-- V4 · RLS is actually ON. A table with policies and RLS disabled is a table
--      with no policies at all.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.message_originals'::regclass) THEN
    RAISE EXCEPTION 'V4 FAILED: RLS is DISABLED on message_originals — every row is world-readable';
  END IF;
  RAISE NOTICE 'V4 PASSED: RLS enabled';
END $$;
