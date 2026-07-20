-- ============================================================
-- M8a · MESSAGING FOUNDATION — conversations, participants, messages
-- Implements: Communication Architecture v1.0 (CANONICAL, ratified 20 Jul 2026)
--             docs/architecture/communication-v1.0.md
-- Governed by: Identity v1.1 §A5 (frozen) — conversations belong to PROFILES
-- ============================================================
--
-- SCHEMA LAYER ONLY. RLS is enabled here with NO POLICIES, which denies all
-- access — policies are the next migration (M8b). A messaging table must never
-- exist unprotected, even briefly, so enabling RLS is part of creating it.
--
-- Scope: the FIVE DERIVED CONTEXTS. `general` is excluded because it has no
-- workflow object to derive participants from and therefore needs Active
-- Profile Context, which does not exist. `festival` and `operations` are future
-- products. Adding a context later is an amendment (`D8`), not a schema change.
--
-- ── CONSTITUTIONAL INVARIANTS ENCODED HERE ──────────────────────
--
--   §A5   conversations belong to profiles — participants are profile ids,
--         never account ids. Built profile-owned from day one; no retrofit.
--   `C15` one conversation per (context_type, context_id, participant set)
--   `C13` context is immutable — enforced by trigger, not convention
--   `C14` context records the ORIGIN; subject_state records the PRESENT.
--         An `application` conversation that reaches `booked` stays an
--         `application` conversation
--   `C11` read state is per-HUMAN, keyed (conversation, user) — NOT here.
--         See the warning on conversation_participants
--   §2.1  the participant set and the subject are FIXED. A new set or subject
--         means a NEW conversation, never a mutation
--   §2.6  `archived` is per-participant, never global — so it is NOT a
--         conversation status
--   §A3   every message records both the acting profile and the human
-- ============================================================


-- ── 1 · CONVERSATIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- `C15`/§2.3 — the context is a TYPE plus a REFERENCE to the object that
  -- caused the conversation. Polymorphic by necessity: the referent lives in a
  -- different table per type, so no foreign key is possible. The type column is
  -- what makes the reference resolvable.
  context_type    text        NOT NULL,
  context_id      uuid        NOT NULL,

  -- `C14` — what has since become of the subject. Free text by design: each
  -- workflow owns its own vocabulary (applied → shortlisted → booked, or
  -- → declined). Mirrored here per §2.7 so a conversation list renders without
  -- joining five workflow tables. NEVER consulted for permission.
  subject_state   text,

  -- §2.6 — `archived` is deliberately ABSENT. Archiving is per-participant and
  -- lives on conversation_participants. A global archive would let one party
  -- hide a thread from the other.
  status          text        NOT NULL DEFAULT 'active',

  -- `C15` — a stable digest of the sorted participant profile ids. Maintained
  -- by trigger (§4 below) because participants are inserted after the
  -- conversation row exists. Safe to derive precisely because §2.1 fixes the
  -- participant set: the key cannot drift after creation.
  participant_key text        NOT NULL DEFAULT '',

  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,

  CONSTRAINT conversations_context_type_valid CHECK (
    context_type IN ('application', 'invitation', 'booking', 'event', 'venue')
  ),
  CONSTRAINT conversations_status_valid CHECK (
    status IN ('active', 'closed', 'restricted')
  )
);

COMMENT ON TABLE public.conversations IS
  'Communication Architecture v1.0 §2.1. A durable, ordered sequence of messages '
  'between a FIXED set of profiles about a FIXED subject. Participants belong to '
  'profiles (Identity v1.1 §A5), never accounts.';

COMMENT ON COLUMN public.conversations.context_type IS
  '`C13`/`C14` — the workflow act that caused this conversation. IMMUTABLE: it '
  'records the origin, not the present. Constrained to the five derived contexts; '
  '`general` needs Active Profile Context, `festival`/`operations` are future '
  'products. Adding one is an amendment (`D8`).';

COMMENT ON COLUMN public.conversations.subject_state IS
  '`C14` — what has become of the subject since. Changes freely; the context does '
  'not. An `application` conversation that reaches `booked` remains an '
  '`application` conversation. Display only — never consulted for permission.';

COMMENT ON COLUMN public.conversations.status IS
  '§2.6 — active / closed / restricted. `archived` is NOT here: it is '
  'per-participant (conversation_participants.archived_at), because a global '
  'archive would let one party hide the thread from the other.';

-- `C15` · one conversation per (context_type, context_id, participant set).
--
-- DEFERRABLE INITIALLY DEFERRED is load-bearing. Creating a two-party
-- conversation inserts participants one row at a time, so the key passes
-- through a one-participant intermediate state that could collide with a real
-- one-participant conversation. Checking at COMMIT rather than per-statement
-- makes the whole creation atomic, which is what `C15` actually means.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_c15_unique;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_c15_unique
  UNIQUE (context_type, context_id, participant_key)
  DEFERRABLE INITIALLY DEFERRED;

-- Resolving "the conversations for this workflow object" is the commonest read.
CREATE INDEX IF NOT EXISTS idx_conversations_context
  ON public.conversations(context_type, context_id);

CREATE INDEX IF NOT EXISTS idx_conversations_recent
  ON public.conversations(last_message_at DESC NULLS LAST);


-- ── 2 · CONVERSATION_PARTICIPANTS — the participant source of truth ──
--
-- ⚠ READ STATE DOES NOT BELONG IN THIS TABLE.
--
-- `C11`: read state is per-HUMAN, keyed (conversation, user). Two managers can
-- act as the same venue profile; if read state lived on the participant row,
-- one manager opening a negotiation would mark it read for the other, who would
-- never see it. That is invisible until a profile has two owners — which is
-- exactly when it is most expensive to discover.
--
-- `archived_at` IS correct here: §2.6 makes archiving per-participant, and a
-- participant is a profile.
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, profile_id)
);

COMMENT ON TABLE public.conversation_participants IS
  'The participant source of truth. Participants are PROFILES (Identity v1.1 §A5), '
  'never accounts. The set is FIXED at creation (§2.1) — a different set means a '
  'NEW conversation. ⚠ READ STATE MUST NOT BE ADDED HERE: `C11` keys it '
  '(conversation, user), because two humans can act as one profile.';

COMMENT ON COLUMN public.conversation_participants.archived_at IS
  '§2.6 — hides the conversation from THIS participant''s list only. Never '
  'global; one party cannot archive a thread out of the other''s view.';

CREATE INDEX IF NOT EXISTS idx_conversation_participants_profile
  ON public.conversation_participants(profile_id);


-- ── 3 · MESSAGES ───────────────────────────────────────────────
--
-- §A3 — every message records BOTH identities: the profile that spoke
-- (attribution) and the human who typed it (audit). They are never conflated,
-- and from_user_id is never displayed as the actor.
--
-- `D9` DEFAULT: messages are IMMUTABLE in v1. There is no edited_at, no
-- deleted_at, and M8b grants no UPDATE policy. This is the restrictive
-- default — adding columns and loosening a policy later is additive, whereas
-- shipping mutable and tightening would not be.
--
-- Note §2.4 grants participants the right to remove their own contribution.
-- That right is NOT implemented in v1 and nothing here prevents it: it lands
-- with `D9`/`D12` as additive columns plus a policy.
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,

  from_profile_id uuid        NOT NULL REFERENCES public.profiles(id),
  from_user_id    uuid        NOT NULL REFERENCES auth.users(id),

  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_body_not_blank CHECK (btrim(body) <> '')
);

COMMENT ON TABLE public.messages IS
  'Communication Architecture v1.0 §2. IMMUTABLE in v1 (`D9` default) — no '
  'edited_at, no deleted_at, and no UPDATE policy. §2.4''s right to remove one''s '
  'own contribution is deferred, not denied; implementing it is additive.';

COMMENT ON COLUMN public.messages.from_profile_id IS
  'Identity v1.1 §A3 — ATTRIBUTION. The profile that spoke. This is what is '
  'displayed as the author.';

COMMENT ON COLUMN public.messages.from_user_id IS
  'Identity v1.1 §A3 — the HUMAN who acted. For audit and delivery. NEVER '
  'displayed as the actor, and never consulted for permission (§A4: can_act_as '
  'is the sole ownership predicate).';

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages(conversation_id, created_at);


-- ── 4 · `C15` PARTICIPANT KEY, MAINTAINED BY TRIGGER ───────────
-- Derived rather than supplied, so a caller cannot desynchronise it from the
-- actual participant rows. Safe because §2.1 fixes the set at creation.
CREATE OR REPLACE FUNCTION public.conversation_participant_key(p_conversation_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    md5(string_agg(profile_id::text, ',' ORDER BY profile_id::text)),
    ''
  )
  FROM public.conversation_participants
  WHERE conversation_id = p_conversation_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_conversation_participant_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation_id uuid := COALESCE(NEW.conversation_id, OLD.conversation_id);
BEGIN
  UPDATE public.conversations
     SET participant_key = public.conversation_participant_key(v_conversation_id)
   WHERE id = v_conversation_id;
  RETURN NULL;                      -- AFTER trigger; return value unused
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_participant_key ON public.conversation_participants;

CREATE TRIGGER trg_sync_participant_key
  AFTER INSERT OR DELETE ON public.conversation_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_conversation_participant_key();


-- ── 5 · `C13` CONTEXT IS IMMUTABLE — ENFORCED, NOT ASSUMED ─────
-- §3.2 makes context immutable and `C14` explains why: it records the origin.
-- A convention would be honoured until the first time a workflow "corrects" a
-- mis-created thread by rewriting its context, silently rewriting history.
CREATE OR REPLACE FUNCTION public.reject_context_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.context_type IS DISTINCT FROM OLD.context_type
     OR NEW.context_id IS DISTINCT FROM OLD.context_id THEN
    -- Single literal deliberately: RAISE's format argument must be a string
    -- literal, and relying on adjacent-literal concatenation there is a risk
    -- not worth taking in a migration that cannot be dry-run.
    RAISE EXCEPTION 'C13: a conversation context is immutable (% % -> % %). Context records the origin, not the present — use subject_state, or create a new conversation (2.1).',
      OLD.context_type, OLD.context_id, NEW.context_type, NEW.context_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_context_mutation ON public.conversations;

CREATE TRIGGER trg_reject_context_mutation
  BEFORE UPDATE OF context_type, context_id ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_context_mutation();


-- ── 6 · RLS ENABLED, NO POLICIES YET — DENY ALL ────────────────
-- Policies land in M8b. Enabling RLS at creation means these tables are never
-- reachable unprotected, not even between two migrations.
ALTER TABLE public.conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                  ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. Tables exist with RLS on and NO policies (expect 3 rows, rowsecurity t,
--    policy count 0):
--
--      SELECT c.relname, c.relrowsecurity,
--             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)
--        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public'
--         AND c.relname IN ('conversations','conversation_participants','messages');
--
-- 2. The five contexts, and only those (expect ERROR on the sixth):
--
--      INSERT INTO public.conversations (context_type, context_id)
--      VALUES ('general', gen_random_uuid());
--      -- ⇒ ERROR: conversations_context_type_valid
--
-- 3. `C13` context immutability (expect ERROR mentioning C13):
--
--      INSERT INTO public.conversations (context_type, context_id)
--      VALUES ('application', gen_random_uuid()) RETURNING id;      -- ⇒ :cid
--      UPDATE public.conversations SET context_type = 'booking' WHERE id = :cid;
--      -- ⇒ ERROR: C13: a conversation's context is immutable
--
-- 4. `C15` participant key is derived, and the constraint is deferred:
--
--      BEGIN;
--      INSERT INTO public.conversations (context_type, context_id)
--      VALUES ('application', '<a real application id>') RETURNING id;   -- ⇒ :c1
--      INSERT INTO public.conversation_participants (conversation_id, profile_id)
--      VALUES (:c1, '<profile A>'), (:c1, '<profile B>');
--      SELECT participant_key FROM public.conversations WHERE id = :c1;  -- ⇒ non-empty md5
--      COMMIT;
--
--      -- the same context AND the same pair must now be refused:
--      BEGIN;
--      INSERT INTO public.conversations (context_type, context_id)
--      VALUES ('application', '<the same application id>') RETURNING id; -- ⇒ :c2
--      INSERT INTO public.conversation_participants (conversation_id, profile_id)
--      VALUES (:c2, '<profile A>'), (:c2, '<profile B>');
--      COMMIT;   -- ⇒ ERROR: conversations_c15_unique  (raised AT COMMIT, deferred)
--
--      -- but a DIFFERENT pair on the same context is allowed (§C15's example:
--      -- two artists applying to the same event = two conversations)
--
-- 5. Clean up anything created above:
--
--      DELETE FROM public.conversations WHERE context_id = '<the test id>';
--      -- participants and messages cascade
-- ============================================================
