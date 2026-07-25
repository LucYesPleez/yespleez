-- ============================================================
-- MR1 · MESSAGE REACTIONS — a second, independent fact per participant
-- Requires: 20260721000003_m9i_message_participant_state.sql
--
-- ✅ APPLIED 2026-07-25, verified: reaction column, mps_reaction_valid and
--    mps_update_own all present on the live database.
-- ============================================================
--
-- M9i built `message_participant_state` as "one table for every fact a
-- participant has about a message", with `handed_at` first and an explicit
-- note that further facts arrive by ADD COLUMN because that is additive and
-- non-breaking where a second table is neither. This is that column.
--
-- ── ⚠ A REACTION IS NOT A HAND, AND THIS COLUMN IS NOT handed_at ─────
--
-- Owner's decision, 2026-07-25: *"the hand is purely on the command bar.
-- it's not an emoji so will not be grouped with them. it also is the one I
-- really want people to use more often. these are just backups for the
-- random times when a laugh emoji would be really good."*
--
-- So they are SEPARATE COLUMNS, and the client registry
-- (v2/src/lib/reactions.js) deliberately contains no 'hand' entry. Do not
-- "tidy" them into one column — the separation is what keeps the Yes from
-- being one of N equal choices behind a long press.
--
-- ⚠ SEPARATE COLUMNS, BUT MUTUALLY EXCLUSIVE IN PRACTICE.
--
-- The schema permits a row to carry both. The PRODUCT does not: the chosen
-- emoji sits in exactly the slot the Hand occupies on the bubble (owner,
-- 2026-07-25 — carrying both is "weird"), so two marks would compete for one
-- position and the UI would have to invent a winner.
--
-- That rule is enforced in `v2/src/lib/messageState.js`, at the single write
-- path: `handMessage` nulls `reaction`, `setReaction` nulls `handed_at`.
-- Deliberately NOT a CHECK constraint — it is a presentation decision, and
-- the day the badge can hold two marks it should change in one file rather
-- than needing a migration. If a second write path is ever added, it inherits
-- this obligation.
--
-- ── ONE ACTIVE REACTION PER PERSON, ENFORCED BY THE KEY ──────────────
--
-- The primary key is already (message_id, profile_id). One row per person
-- per message therefore means one reaction per person per message, with no
-- new constraint and no way for the UI and the database to disagree about
-- it. Changing a reaction is an UPDATE of this column, not a second row.
--
-- ── WHY THE VALUE IS A KEY, NOT THE EMOJI ────────────────────────────
--
-- `😶‍🌫️` is three codepoints joined by a ZERO WIDTH JOINER, and several of
-- the others carry variation selectors on some platforms. Storing glyphs
-- means a CHECK that passes or fails depending on which client normalised
-- the string, and rows that look identical in a query result but do not
-- match. The registry owns the glyphs; this column stores 'clouds'.
--
-- ── ⚠ TWO CLIENT BUGS THIS COLUMN CREATED, BOTH FIXED IN THE SAME
--      COMMIT — do not reintroduce either ───────────────────────────
--
--   1. `unhandMessage` used to DELETE the row. With a reaction on the same
--      row, taking back a Yes would silently delete the reaction too. It
--      now nulls `handed_at` and leaves the row.
--   2. `handMessage` used `ignoreDuplicates: true` (ON CONFLICT DO
--      NOTHING). A row may now already exist carrying only a reaction, so
--      DO NOTHING made the Yes silently fail for anyone who had reacted to
--      that message first. It now merges.
--
-- Both are pinned by tests in v2/src/lib/messageState.test.js.
-- ============================================================


-- ── 1 · THE COLUMN ─────────────────────────────────────────────
ALTER TABLE public.message_participant_state
  ADD COLUMN IF NOT EXISTS reaction text;

COMMENT ON COLUMN public.message_participant_state.reaction IS
  'MR1 — the participant''s single emoji reaction to this message, as a stable '
  'key ("clouds"), never the glyph. NULL means no reaction, which is distinct '
  'from handed_at being NULL (no Yes). The schema permits both, but the client '
  'keeps them mutually exclusive because they share one badge slot on the '
  'bubble — see messageState.js. One active reaction per person per message is '
  'enforced by the primary key.';


-- ── 2 · THE ALLOW-LIST ─────────────────────────────────────────
-- Named explicitly so a later migration can drop it by name rather than
-- hunting for a Postgres-generated one. This project has already lost two
-- migrations to guessed schema facts.
ALTER TABLE public.message_participant_state
  DROP CONSTRAINT IF EXISTS mps_reaction_valid;

ALTER TABLE public.message_participant_state
  ADD CONSTRAINT mps_reaction_valid CHECK (
    reaction IS NULL OR reaction IN (
      'salute',    -- 🫡
      'joycat',    -- 😹
      'woozy',     -- 🥴
      'flushed',   -- 😳
      'clouds',    -- 😶‍🌫️
      'facepalm',  -- 🤦
      'nails'      -- 💅
    )
  );

COMMENT ON CONSTRAINT mps_reaction_valid ON public.message_participant_state IS
  'MR1 — must mirror REACTIONS in v2/src/lib/reactions.js. Adding a reaction '
  'means adding it in BOTH places, in the same commit; the client would '
  'otherwise offer a button whose write the database rejects.';


-- ── 3 · UPDATE BECOMES POSSIBLE, AND ONLY FOR YOUR OWN ROW ─────
--
-- M9i deliberately shipped with INSERT and DELETE only: a Hand was created
-- or taken back, never edited, so an UPDATE policy would have been surface
-- with no purpose. Changing a reaction genuinely is an update of an existing
-- row, so the policy is added here — narrowly.
--
-- ⚠ Scoped to the caller's OWN row by the same predicate as the insert
-- policy. Without USING *and* WITH CHECK, a participant could edit someone
-- else's reaction, or move their own row onto another profile.
DROP POLICY IF EXISTS mps_update_own ON public.message_participant_state;

CREATE POLICY mps_update_own
  ON public.message_participant_state FOR UPDATE
  USING      (public.can_act_as(profile_id) AND from_user_id = auth.uid())
  WITH CHECK (public.can_act_as(profile_id) AND from_user_id = auth.uid());


-- ── 4 · READING A THREAD'S REACTIONS ───────────────────────────
-- Every render of a conversation asks "all state for these messages".
CREATE INDEX IF NOT EXISTS mps_by_message_reaction
  ON public.message_participant_state (message_id)
  WHERE reaction IS NOT NULL;


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================

-- V1 · the three objects this migration exists to create. All must be 1.
DO $v1$
DECLARE n_col int; n_chk int; n_pol int;
BEGIN
  SELECT count(*) INTO n_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'message_participant_state'
     AND column_name = 'reaction';

  SELECT count(*) INTO n_chk FROM pg_constraint
   WHERE conrelid = 'public.message_participant_state'::regclass
     AND conname = 'mps_reaction_valid';

  SELECT count(*) INTO n_pol FROM pg_policy
   WHERE polrelid = 'public.message_participant_state'::regclass
     AND polname = 'mps_update_own';

  IF n_col <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: the reaction column does not exist';
  END IF;
  IF n_chk <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: mps_reaction_valid is missing — any key would be storable';
  END IF;
  IF n_pol <> 1 THEN
    RAISE EXCEPTION
      'V1 FAILED: mps_update_own is missing — every reaction write would be REJECTED by RLS, '
      'silently, because a policy denial is not an error the client can see.';
  END IF;

  RAISE NOTICE 'V1 PASSED: column, CHECK and UPDATE policy all present';
END $v1$;

-- V2 · the column is nullable. A plain Yes carries no reaction and must
--      still be storable.
DO $v2$
DECLARE v_nullable text;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'message_participant_state'
     AND column_name = 'reaction';

  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'V2 FAILED: reaction is NOT NULL — a Yes with no reaction could not be stored';
  END IF;
  RAISE NOTICE 'V2 PASSED: reaction is nullable';
END $v2$;
