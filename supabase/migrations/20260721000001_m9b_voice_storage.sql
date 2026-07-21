-- ============================================================
-- M9b · VOICE NOTE STORAGE — a private bucket that answers to the same
--        authority as the messages it belongs to
-- Implements: Communication Architecture v1.0 §2.2 (access derives from
--             can_act_as), C32 (conversation content)
-- Requires:   20260720000005_m8b_messaging_rls.sql  (the two predicates)
--             20260721000000_m9a_message_kinds.sql  (the `voice` kind)
-- ============================================================
--
-- ⚠ NOT APPLIED. Authored ahead of the client so the storage contract can be
--   reviewed on its own. M9a must be applied FIRST — a voice message is a row
--   with kind = 'voice', and that kind does not exist until it is.
--
-- ── WHY A PRIVATE BUCKET, WHEN EVERY OTHER BUCKET HERE IS PUBLIC ────
--
-- `uploadImage.js` uploads avatars and posters and calls `getPublicUrl` on
-- both. That is correct for those: a poster is advertising, and a public URL
-- is the point.
--
-- A voice note is the opposite. It is conversation CONTENT under C32, and a
-- public bucket would put private audio behind a URL that is unguessable but
-- permanent, unrevocable, and readable by anyone it is ever forwarded to —
-- including after the sender leaves the conversation. "Hard to guess" is not
-- an access policy. So: `public = false`, and reads go through signed URLs
-- with a short life.
--
-- ── WHY THE POLICIES CALL M8b's FUNCTIONS INSTEAD OF RE-DERIVING ────
--
-- §2.2: access derives from `can_act_as` and nothing else. M8b already turned
-- that into two predicates, and messages themselves are governed by them.
-- If these policies re-expressed participation with their own subquery there
-- would be TWO definitions of who may read a conversation, and the failure is
-- silent in the worst direction: the audio outliving the thread's own rules.
-- One authority, called twice.
--
-- Both are SECURITY DEFINER, which also avoids re-entering RLS from inside a
-- storage policy.
--
-- ── THE PATH IS THE ACCESS CONTROL, SO THE PATH IS ENFORCED ─────────
--
--     voice-notes/<conversation_id>/<random uuid>.webm
--
-- The first segment is what the policy reads to decide. That makes the layout
-- load-bearing rather than cosmetic: an object written outside this shape has
-- no conversation to check against, so INSERT refuses it rather than storing
-- something unreachable.
--
-- The filename is a client-generated uuid and NOT the message id, because the
-- upload necessarily happens BEFORE the row exists — the row's payload has to
-- point at something. A failed insert after a successful upload therefore
-- leaves an orphan object. Deliberately not solved here: reaping orphans is an
-- operations job, and the alternative (a row pointing at audio that may not
-- have uploaded) is the worse failure.
-- ============================================================


-- ── 1 · SAFE UUID CAST ─────────────────────────────────────────
-- The first path segment is untrusted text. `'nonsense'::uuid` RAISES, and a
-- raise inside a policy is an error surfaced to the caller rather than a
-- refusal — so a malformed path would 500 instead of returning "denied".
--
-- Same shape and same reason as `safe_date` in N4: unparseable input must mean
-- "this cannot be authorised", never "abort".
CREATE OR REPLACE FUNCTION public.safe_uuid(txt text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN
    RETURN NULL;
  END IF;
  RETURN txt::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;              -- not a uuid ⇒ no conversation ⇒ denied, not 500
END;
$$;

COMMENT ON FUNCTION public.safe_uuid(text) IS
  'Parse text to uuid, returning NULL instead of raising. Used by storage '
  'policies, where the object path is untrusted input and a raise would '
  'surface as a 500 rather than a refusal. Mirrors safe_date (N4).';


-- ── 2 · THE BUCKET ─────────────────────────────────────────────
-- Created HERE and not in the dashboard. Dashboard-applied configuration is a
-- rated defect (D5b, live-schema audit): it makes the deployment
-- unreproducible from the repository, and nothing records that it happened.
--
-- The two limits are enforced by the storage API itself, so a client that
-- forgets to check — or one that is not ours — still cannot write a 40MB file
-- or a .exe into a conversation.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-notes',
  'voice-notes',
  false,                                    -- signed URLs only. See header.
  10485760,                                 -- 10 MB ≈ 10 min of Opus at 128kbps
  ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- DO UPDATE, not DO NOTHING: if the bucket was ever created by hand this
-- migration must CORRECT it, not silently accept a public bucket because
-- something with that name already existed.


-- ── 3 · READ — participants of that conversation, nobody else ──
DROP POLICY IF EXISTS "voice notes readable by conversation participants" ON storage.objects;

CREATE POLICY "voice notes readable by conversation participants"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'voice-notes'
    AND public.is_conversation_participant(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 4 · WRITE — only into a conversation you could send a message to ──
-- `can_write_to_conversation` and not `is_conversation_participant`, so the
-- audio obeys §4.4 and §2.6 exactly as the message row does: a `restricted` or
-- `closed` thread stays readable and refuses new voice notes. Using the read
-- predicate here would let someone drop audio into a thread they are forbidden
-- to speak in — the message insert would fail afterwards, but the file would
-- already be stored.
DROP POLICY IF EXISTS "voice notes writable by those who may send" ON storage.objects;

CREATE POLICY "voice notes writable by those who may send"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'voice-notes'
    AND public.can_write_to_conversation(
          public.safe_uuid((storage.foldername(name))[1])
        )
  );


-- ── 5 · NO UPDATE AND NO DELETE POLICY, DELIBERATELY ───────────
-- Messages are not editable or deletable in this model, and the audio must not
-- be either — a voice note that can be swapped after the fact is a message
-- whose history lies. Omitting the policies denies both: RLS is deny-by-
-- default, so there is nothing to write here.
--
-- Orphan cleanup therefore needs elevated rights and is an operations task,
-- not a client one. Noted rather than solved. See header.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1 · The bucket exists and is PRIVATE. Raises if it is public:
--
--     do $$
--     declare v_public boolean;
--     begin
--       select public into v_public from storage.buckets where id = 'voice-notes';
--       if v_public is null then raise exception 'M9b FAILED - bucket not created'; end if;
--       if v_public then raise exception 'M9b FAILED - bucket is PUBLIC'; end if;
--     end $$;
--
-- 2 · safe_uuid swallows garbage instead of raising. Raises if it propagates:
--
--     do $$
--     begin
--       if public.safe_uuid('not-a-uuid') is not null then
--         raise exception 'M9b FAILED - safe_uuid returned non-null for garbage';
--       end if;
--       if public.safe_uuid(null) is not null then
--         raise exception 'M9b FAILED - safe_uuid(null) should be null';
--       end if;
--       -- and a real one still parses, or the function is uselessly safe
--       if public.safe_uuid('00000000-0000-0000-0000-000000000001') is null then
--         raise exception 'M9b FAILED - safe_uuid rejected a valid uuid';
--       end if;
--     end $$;
--
-- 3 · Both policies exist and point at the right predicates:
--
--     select policyname, cmd, qual, with_check
--       from pg_policies
--      where schemaname = 'storage' AND tablename = 'objects'
--        and policyname like 'voice notes%';
--
-- 4 · A NON-participant cannot read. Run as a real user who is NOT in the
--     conversation; expects 0 rows, and the reversible role trick means it
--     tests the POLICY rather than the privileged editor:
--
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<a non-participant user id>"}';
--       select count(*) from storage.objects
--        where bucket_id = 'voice-notes'
--          and (storage.foldername(name))[1] = '<a conversation they are not in>';
--     rollback;
--
--     ⚠ A plain SELECT here proves NOTHING — the SQL editor runs privileged and
--       bypasses RLS entirely. The `set local role` is the whole test.
-- ============================================================
