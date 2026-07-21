-- ============================================================
-- M9h · THE HAND — YesPleez's universal acknowledgement, as a message kind
-- Implements: the Hand constitution (ratified 21 Jul 2026)
-- Requires:   20260721000000_m9a_message_kinds.sql
-- ============================================================
--
-- The Hand means YES. Not "like", not a high-five — yes, agreed, I'm in, nice
-- one, confirmed, approved. It is one gesture with two forms, and the ratified
-- rule that separates them is:
--
--     A CONVERSATION Hand is a MESSAGE.  A MESSAGE Hand is METADATA.
--
--   composer  → tap the Hand → this migration: a message with kind = 'hand'
--   message   → double-tap   → `handed_at` in participant message state,
--                              a LATER design pass, NOT a reactions subsystem
--
-- This migration builds only the first. The second is deliberately absent:
-- building a reactions table now and folding it into participant state later
-- means building it twice.
--
-- ── WHY THIS IS ONE LINE OF SQL ──────────────────────────────────────
--
-- M9a exists so that adding a kind is a value in this CHECK plus a renderer.
-- The Hand is the first kind added since, and it is the test of that claim.
--
-- ── USER-FACING LANGUAGE IS "YES", NOT "HAND" ────────────────────────
--
-- `hand` names the MARK; the product never says it. Every string a person can
-- read says Yes: "Send a Yes", "Luke said Yes to your message". The kind value
-- is an internal identifier and is not a copy decision.
-- ============================================================


-- ── 1 · ADD THE KIND ───────────────────────────────────────────
-- Full list restated rather than patched, because a CHECK cannot be amended in
-- place — it is dropped and recreated, so this file must carry the whole
-- authority. `messageKindContract.test.js` reads the LAST migration that
-- defines this constraint and fails if the client list disagrees.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_kind_valid;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_valid CHECK (
    kind IN (
      'text', 'voice', 'image', 'video', 'file', 'location', 'hand',
      'event', 'application', 'booking', 'approval',
      'system'
    )
  );


-- ── 2 · body, FOR A KIND WITH NO WORDS ─────────────────────────
-- M8a's messages_body_not_blank still applies, and it is doing real work here.
-- A Hand has no text of its own, but an inbox preview, a push notification and
-- a screen reader can only ever render text — so it writes 'Yes'.
--
-- That is also why the fallback word matters: a client too old to know this
-- kind shows 'Yes', which is exactly what was meant. The message degrades to
-- its own meaning rather than to a placeholder.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1 · The kind is accepted, and rolls back:
--
--     begin;
--       insert into public.messages (conversation_id, from_profile_id, from_user_id, body, kind)
--       select conversation_id, from_profile_id, from_user_id, 'Yes', 'hand'
--         from public.messages limit 1;
--     rollback;
--
-- 2 · An unknown kind is STILL rejected — raises if the CHECK was widened by
--     accident rather than by one value:
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
--         raise exception 'M9h FAILED - the CHECK no longer rejects unknown kinds';
--       end if;
--       raise notice 'M9h OK';
--     end $$;
-- ============================================================
