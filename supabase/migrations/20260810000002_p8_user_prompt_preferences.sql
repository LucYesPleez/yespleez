-- ═══════════════════════════════════════════════════════════════════
-- P8 · USER PROMPT PREFERENCES — "don't ask me this again"
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires nothing. Independent of P6/P7, shipped alongside them.
-- ═══════════════════════════════════════════════════════════════════
--
-- One row per prompt a person has chosen to stop seeing. The first is the
-- pre-send check on a venue availability enquiry: "here is what the venue will
-- see about you — send it?".
--
-- ── ⭐ WHY PER-USER AND NOT PER-PROFILE ──
--
-- `profiles` holds one row per ACT — a DJ profile, a band, a festival — so a
-- column there would mean "don't ask when sending as Dusky Waters" and would
-- ask again ten seconds later as the same person's solo act. The sentence on
-- the button is "don't ask ME again". The person is the subject, so `user_id`
-- is the key. Same reasoning NP1 recorded for notification preferences, from a
-- different direction.
--
-- ── ⭐ A ROW IS THE SUPPRESSION — THERE IS NO BOOLEAN ──
--
-- No `enabled` column, deliberately. A two-state flag invites the third state
-- nobody designed: a row saying `false` that means "asked to be asked again",
-- which is identical to no row at all and drifts from it the moment one write
-- path forgets. Presence means suppressed; absence means show it. Un-suppressing
-- is a DELETE, which cannot be half-done.
--
-- ── ⭐ ABSENCE MEANS ASK, AND THAT IS THE SAFE DIRECTION ──
--
-- No backfill: every existing person sees the prompt once, which is the point
-- of building it. A new prompt key is ON by default rather than silently
-- suppressed for everybody. And a FAILED READ shows the prompt rather than
-- skipping it — the recoverable direction, exactly as NP1 fails toward
-- delivery. Being asked once more is a mild annoyance; sending something you
-- did not mean to send is not.
--
-- ⛔ THIS IS A UI PREFERENCE AND NOTHING ELSE. It must never gate a write, a
-- permission or a requirement. Suppressing the pre-send check skips the
-- CONFIRMATION, never the enquiry requirements gate (P6) — those are enforced
-- in `canSendEnquiry` and are not a prompt anyone can dismiss.
--
-- `prompt_key` is deliberately unconstrained text, for P4's reason: an
-- unrecognised key is simply a prompt nobody shows, whereas a CHECK would have
-- to be migrated in lockstep with every new dialog and would reject the write
-- if code shipped first.

CREATE TABLE IF NOT EXISTS public.user_prompt_preferences (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt_key    text        NOT NULL,
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, prompt_key)
);

COMMENT ON TABLE public.user_prompt_preferences IS
  'P8 — one row per prompt a person has chosen not to see again. Presence IS '
  'the suppression; there is no boolean, so un-suppressing is a DELETE and '
  'cannot be half-done. Absence means SHOW, so no backfill is needed, a new '
  'prompt is on by default, and a failed read errs toward asking. Keyed by '
  'user, not profile: `profiles` holds one row per ACT, and "don''t ask me '
  'again" is about the person. ⛔ UI only — this may never gate a write, a '
  'permission, or the P6 enquiry requirements, which are not dismissible.';

COMMENT ON COLUMN public.user_prompt_preferences.prompt_key IS
  'Which prompt. First key: ''enquiry_pre_send_check'' — the "this is what the '
  'venue will see" confirmation before an availability enquiry. Unconstrained '
  'text on purpose: an unknown key is a prompt nobody shows, whereas a CHECK '
  'would reject writes whenever code shipped ahead of the migration.';

ALTER TABLE public.user_prompt_preferences ENABLE ROW LEVEL SECURITY;

-- Own rows only, in both directions. A prompt preference is nobody else's
-- business and there is no reason for it ever to be readable by another user.
DROP POLICY IF EXISTS user_prompt_preferences_select_own ON public.user_prompt_preferences;
CREATE POLICY user_prompt_preferences_select_own
  ON public.user_prompt_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_prompt_preferences_write_own ON public.user_prompt_preferences;
CREATE POLICY user_prompt_preferences_write_own
  ON public.user_prompt_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── VERIFY ──
-- 1. The table exists with three columns:
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'user_prompt_preferences'
--    ORDER BY ordinal_position;
--
-- 2. RLS is ON and both policies are own-row. Expect two rows, each qual
--    `(auth.uid() = user_id)`:
--
--   SELECT policyname, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'user_prompt_preferences';
--
-- 3. ⚠ THE ONE THAT MATTERS. RLS must actually be enabled — a table with
--    policies but RLS disabled is readable by everyone, and Supabase grants
--    ALL to anon by default. Expect `t`:
--
--   SELECT relrowsecurity
--     FROM pg_class
--    WHERE oid = 'public.user_prompt_preferences'::regclass;
--
-- ── ROLLBACK ──
--   DROP TABLE IF EXISTS public.user_prompt_preferences;
