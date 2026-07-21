-- ============================================================
-- M9a · MESSAGE KINDS — the column the dispatch has been pretending to read
-- Implements: Communication Architecture v1.0 §2 (message shape)
-- Requires:   20260720000004_m8a_messaging_foundation.sql
-- ============================================================
--
-- `MessageBubble` already dispatches on `message.kind`, but `messages` has no
-- such column — every message resolved to 'text' through the `?? 'text'`
-- fallback. The architecture was in place and structurally unreachable.
--
-- This adds the two columns every future kind needs, and nothing else. No
-- renderers, no upload path, no Voiceys. Adding a kind after this is a value
-- in a CHECK plus a renderer.
--
-- ── WHY TWO COLUMNS AND NOT A JSON BLOB ─────────────────────────────
--
-- `body` stays exactly as it is: the human-readable text of a message, and for
-- non-text kinds the FALLBACK text — what an older client, a notification
-- preview or a screen reader says when it cannot render the kind. Every kind
-- must therefore still write something legible to `body`.
--
-- `payload` carries the kind-specific structure: a storage path and duration
-- for a voice note, an event id for an event card. Deliberately jsonb and
-- deliberately NOT validated per kind here — a CHECK per kind would need
-- rewriting on every addition, which is the opposite of what this migration is
-- for. The renderer owns the shape of its own payload.
--
-- ── C32 ─────────────────────────────────────────────────────────────
--
-- `payload` is conversation CONTENT. It is subject to C32 exactly as `body`
-- is: it must never feed ranking, recommendation, or any platform decision
-- system, and no notification may copy it (D1's two retention domains).
-- ============================================================


-- ── 1 · THE COLUMNS ────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kind    text  NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.messages.kind IS
  'What this message IS. Renderers dispatch on it. Defaults to text so every '
  'existing row is correct without a backfill, and so a client that does not '
  'set it keeps working.';

COMMENT ON COLUMN public.messages.payload IS
  'Kind-specific structure — storage path and duration for voice, an event id '
  'for an event card. NOT validated per kind by design: a per-kind CHECK would '
  'need rewriting on every addition. The renderer owns its payload shape. '
  'This is conversation CONTENT and is subject to C32 exactly as body is.';


-- ── 2 · THE CANONICAL KIND LIST ────────────────────────────────
-- One place. Adding a kind is one value here plus a renderer — that is the
-- whole point of doing this before Voiceys rather than during.
--
-- Grouped by who authors them:
--   the sender          text, voice, image, video, file, location
--   a workflow          event, application, booking, approval
--   the platform        system
--
-- `system` messages are written by system profiles, which send without
-- reading (`C29`). They are not a person speaking.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_kind_valid;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_valid CHECK (
    kind IN (
      'text', 'voice', 'image', 'video', 'file', 'location',
      'event', 'application', 'booking', 'approval',
      'system'
    )
  );


-- ── 3 · body STAYS REQUIRED, FOR EVERY KIND ────────────────────
-- M8a's messages_body_not_blank already enforces this and is deliberately
-- left alone. A voice note still writes something like 'Voice message' to
-- body, because that is what a notification preview, an older client and a
-- screen reader will use. A kind that cannot describe itself in text is a
-- kind that breaks those three surfaces silently.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1 · Existing rows defaulted correctly and the column is NOT NULL:
--
--     do $$
--     declare v_bad int;
--     begin
--       select count(*) into v_bad from public.messages where kind is null or kind <> 'text';
--       if v_bad <> 0 then
--         raise exception 'expected every existing row to be text, found % other', v_bad;
--       end if;
--     end $$;
--
-- 2 · The CHECK rejects an unknown kind. Raises if it does NOT:
--
--     do $$
--     declare v_blocked boolean := false; v_cid uuid;
--     begin
--       select conversation_id into v_cid from public.messages limit 1;
--       if v_cid is null then raise exception 'CANNOT TEST - no messages exist'; end if;
--
--       begin
--         insert into public.messages (conversation_id, from_profile_id, from_user_id, body, kind)
--         select v_cid, from_profile_id, from_user_id, 'x', 'not_a_kind'
--           from public.messages where conversation_id = v_cid limit 1;
--       exception when check_violation then
--         v_blocked := true;
--       end;
--
--       if not v_blocked then
--         raise exception 'M9a FAILED - an unknown kind was accepted';
--       end if;
--     end $$;
--
-- 3 · A known kind with a payload is accepted, and rolls back:
--
--     begin;
--       insert into public.messages (conversation_id, from_profile_id, from_user_id, body, kind, payload)
--       select conversation_id, from_profile_id, from_user_id,
--              'Voice message', 'voice', '{"duration_ms": 4200}'::jsonb
--         from public.messages limit 1;
--     rollback;
-- ============================================================
