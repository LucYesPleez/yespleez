-- M9i · TWO NEW MESSAGE KINDS: `audio` and `profile`.
--
-- Asset-system slice 0b. Additive and schema-only: no column, no data, no
-- policy. Nothing sends either kind yet — this migration exists so that the
-- code which will can be written against a database that already accepts it.
--
-- ⚠ THE HAZARD IS ASYMMETRIC (design note, 2026-08-11): a constraint that
-- accepts a kind nothing sends is a non-event; code that sends a kind the
-- constraint rejects is an outage. So the database leads, by a whole commit.
--
-- ── WHAT THEY MEAN ──────────────────────────────────────────────────
--
-- `audio`    an uploaded audio FILE — a track, a master, a mixdown.
--            ⛔ NOT a Voicey. `voice` is the conversational recorder and stays
--            exactly as it is; "⛔ never compress an uploaded master into a
--            Voicey" is a standing rule. Voicey ≠ Audio ≠ HD Audio.
--
-- `profile`  a profile shared into a conversation, as a REFERENCE to the
--            canonical row. Same shape as `event`, which shipped 2026-08-11
--            and needed no migration because it was already legal here.
--            ⛔ Never a copy — "reference canonical assets and objects; do not
--            duplicate ownership merely because something passed through
--            messaging."
--
-- ── ⭐⭐ HD IS METADATA, NOT A KIND ──────────────────────────────────
--
-- `isLosslessAudio` already stamps `hd: true` into the payload, and `image`
-- already carries `payload.original` for the same reason. So:
--
--     audio  ├── hd: false   standard / compressed
--            └── hd: true    HD Audio, the lossless master
--     image  ├── hd: false
--            └── hd: true
--
-- ⛔ THERE IS NO `hd_audio` OR `hd_image` KIND, AND THERE MUST NOT BE. Every
-- quality tier added as its own kind doubles this list and forces every
-- consumer — renderer, notification preview, inbox row, index panel — to learn
-- a second name for the same thing. The payload already answers "how good is
-- it"; the kind answers "what is it".
--
-- ── WHY THE WHOLE LIST IS RESTATED ──────────────────────────────────
--
-- Postgres cannot amend a CHECK in place, so a new kind is always drop-and-
-- recreate with the full set. `messageKindContract.test.js` reads the LAST
-- migration that defines `messages_kind_valid` and diffs it against the
-- client's `KINDS` — ⚠ INCLUDING ORDER — so this file and `messageKindList.js`
-- must change together or the suite fails. That is the drift alarm working.
--
-- ⚠ `ADD CONSTRAINT` validates every existing row. All current rows hold kinds
-- from the previous list, which this one is a strict superset of, so nothing
-- can fail — but it does mean this is not free on a large table.

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_kind_valid;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_valid CHECK (
    kind IN (
      -- Authored by the sender · `audio` sits beside `voice` deliberately,
      -- because the distinction between them is the one people get wrong.
      'text', 'voice', 'audio', 'image', 'video', 'file', 'location', 'hand',
      -- Canonical objects shared into a conversation, by reference.
      'event', 'profile',
      -- Authored by a workflow act
      'application', 'booking', 'approval',
      -- ⚠⚠ NO ROUND BRACKETS IN COMMENTS INSIDE THIS LIST — not even in an
      -- aside, and not even quoting a regex. The contract test extracts the
      -- kinds by matching up to the first closing bracket, so ANY bracket here
      -- ends the match early and silently drops every kind below it. This
      -- comment originally said "via a system profile" with C29 bracketed
      -- after it, which dropped `system` and failed the suite; the rewrite
      -- then quoted the regex itself and dropped it a second time.
      -- Authored by the platform, via a system profile — see C29.
      'system'
    )
  );

-- ── VERIFY (run after applying) ─────────────────────────────────────
--
-- 1 · The two new kinds are accepted, and an unknown one is still rejected.
--     Rolls back, so it leaves nothing behind:
--
--     do $$
--     declare v_cid uuid; v_blocked boolean := false;
--     begin
--       select conversation_id into v_cid from public.messages limit 1;
--       if v_cid is null then raise exception 'CANNOT TEST - no messages'; end if;
--
--       insert into public.messages (conversation_id, kind, body)
--         values (v_cid, 'audio', 'Audio'), (v_cid, 'profile', 'Profile');
--
--       begin
--         insert into public.messages (conversation_id, kind, body)
--           values (v_cid, 'not-a-kind', 'x');
--       exception when check_violation then v_blocked := true;
--       end;
--
--       if not v_blocked then raise exception 'CHECK no longer rejects unknown kinds'; end if;
--       raise exception 'ROLLBACK - verification only';
--     end $$;
--
--     Expect: ERROR "ROLLBACK - verification only". Any other error is a real
--     failure. ⛔ The final raise is what stops this writing test rows.
