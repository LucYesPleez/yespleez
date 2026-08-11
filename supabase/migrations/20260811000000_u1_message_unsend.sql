-- ═══════════════════════════════════════════════════════════════════
-- U1 · UNSEND — a sender may withdraw their own message, for a while
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires nothing. Additive: the columns are nullable and every existing
-- row reads exactly as it did.
-- ═══════════════════════════════════════════════════════════════════
--
-- ⭐ THIS WAS PLANNED, NOT INVENTED. `messages` has carried this comment since
-- the baseline:
--
--   "IMMUTABLE in v1 (D9 default) — no edited_at, no deleted_at, no UPDATE
--    policy. 2.4 right to remove one own contribution is deferred, not denied;
--    implementing it is additive."
--
-- This is that deferral being taken up, on the terms it named.
--
-- ── ⭐ A TOMBSTONE, NOT A DELETE ──
--
-- The row survives with its content redacted. A hard DELETE would silently
-- corrupt everything counted from messages — unread counts, `last_message_at`,
-- the reply a later message is answering — and would leave a hole in a
-- conversation rather than an acknowledgement. Both people should be able to
-- see that something WAS said and withdrawn; that is honest, and it is what
-- stops "did you just delete something?" being unanswerable.
--
-- ── ⚠⚠ THE UPDATE POLICY IS THE DANGEROUS PART, AND THE TRIGGER IS WHY ──
--
-- Messages have never had an UPDATE policy. Granting one to redact a message
-- also, by construction, grants the ability to REWRITE one — a sender could
-- change `body` after the fact and the conversation would show words the other
-- person never received. That is a far worse defect than the one being fixed.
--
-- So the client's UPDATE is not trusted to say what the row becomes. It may
-- only express INTENT — set `deleted_at` to anything non-null — and the trigger
-- below discards every other value it sent and writes the redaction itself.
-- Same principle as the participation spine, where the SERVER stamps
-- `verification_method` rather than believing the client's copy.
--
-- ── ⭐ THE BODY CANNOT BE BLANKED ──
--
-- `messages_body_not_blank` forbids an empty body, so the tombstone carries a
-- sentinel instead. It is human-readable on purpose: a client running the
-- previous build has no idea `deleted_at` exists and will render `body`
-- verbatim, so the fallback has to be a sentence rather than a marker. The new
-- client ignores the text entirely and renders from `deleted_at`.
--
-- ── ⚠ THE WINDOW IS ENFORCED HERE, NOT IN THE APP ──
--
-- 15 minutes, measured from `created_at`. The client hides the action once it
-- has passed, but that is a courtesy; this policy is the rule. If the two ever
-- disagree, the app is wrong.

BEGIN;

-- ── 1 · THE COLUMNS ────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

COMMENT ON COLUMN public.messages.deleted_at IS
  'U1. Set when the sender withdrew this message. Stamped by the server in redact_message_on_unsend; a client value is never trusted. NULL = live.';
COMMENT ON COLUMN public.messages.deleted_by IS
  'U1. The auth user who withdrew it. Always equal to from_user_id today — kept distinct so a future moderator removal is distinguishable from a sender withdrawing their own.';

-- Reading a conversation filters on this constantly; partial, because only the
-- withdrawn rows are ever looked up by it.
CREATE INDEX IF NOT EXISTS messages_deleted_at_idx
  ON public.messages (conversation_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── 2 · THE REDACTION ITSELF ───────────────────────────────────
-- ⚠ Runs as the OWNER of the row change, not as a definer: it must see the
-- caller's `auth.uid()` to stamp `deleted_by`.
CREATE OR REPLACE FUNCTION public.redact_message_on_unsend()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- An already-withdrawn message is final. Without this, a second UPDATE would
  -- re-stamp the timestamp and move the message back inside its own window.
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'message % is already withdrawn', OLD.id
      USING ERRCODE = '42501';
  END IF;

  -- The only intent this table accepts. Any other UPDATE — an edit dressed up
  -- as one — is refused outright rather than quietly ignored, so a client
  -- attempting it gets an error instead of believing it worked.
  IF NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'messages may only be updated to withdraw them'
      USING ERRCODE = '42501';
  END IF;

  -- ⭐ EVERYTHING THE CLIENT SENT IS DISCARDED HERE. The row is rebuilt from
  -- OLD, so an UPDATE that also tried to change the body, the kind, the author
  -- or the timestamp changes none of them.
  NEW.id              := OLD.id;
  NEW.conversation_id := OLD.conversation_id;
  NEW.from_profile_id := OLD.from_profile_id;
  NEW.from_user_id    := OLD.from_user_id;
  NEW.created_at      := OLD.created_at;
  NEW.client_id       := OLD.client_id;
  NEW.kind            := OLD.kind;

  -- The content goes. `payload` is emptied because it is where a voice note's
  -- segments, an image's URLs and a file's name live — leaving it would mean a
  -- "withdrawn" photo whose link still works for anyone reading the row.
  NEW.body       := 'This message was deleted';
  NEW.payload    := '{}'::jsonb;
  NEW.deleted_at := now();
  NEW.deleted_by := auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_redact_on_unsend ON public.messages;
CREATE TRIGGER messages_redact_on_unsend
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.redact_message_on_unsend();

-- ── 3 · WHO MAY WITHDRAW, AND WHEN ─────────────────────────────
-- The identity pair mirrors messages_insert_participant: the profile is the
-- attribution and the user is the audit. Both, for the same reason — one alone
-- lets a person withdraw a message they did not send, from a profile they do
-- not own, in one direction or the other.
DROP POLICY IF EXISTS messages_unsend_own ON public.messages;
CREATE POLICY messages_unsend_own
  ON public.messages FOR UPDATE
  USING (
    from_user_id = auth.uid()
    AND public.can_act_as(from_profile_id)
    AND deleted_at IS NULL
    AND created_at > now() - interval '15 minutes'
  )
  WITH CHECK (
    from_user_id = auth.uid()
    AND public.can_act_as(from_profile_id)
  );

COMMIT;

-- ── ROLLBACK (not executed) ────────────────────────────────────
-- ⚠ The columns are NOT dropped: by the time this is reversed, real messages
-- have been withdrawn and dropping them would restore nothing while destroying
-- the record that they were. Removing the policy is enough to stop new ones.
--
--   DROP POLICY IF EXISTS messages_unsend_own ON public.messages;
--   DROP TRIGGER IF EXISTS messages_redact_on_unsend ON public.messages;
--   DROP FUNCTION IF EXISTS public.redact_message_on_unsend();
