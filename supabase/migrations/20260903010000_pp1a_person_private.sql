-- PP1a · PERSON_PRIVATE — the private canonical person layer.
--
-- ⚠⚠ THIS TABLE ALREADY EXISTED IN PRODUCTION. It was applied by the owner on
-- 2026-09-03 without a migration file; this file was written afterwards to
-- close the Git-reproducibility gap (M1), and APPLIED on 2026-09-04.
--
-- ✅ VERIFIED AGAINST THE LIVE CATALOGUE, 2026-09-04 — columns, types,
-- nullability, defaults, comments, constraints, grants, policies and the
-- trigger all match what is below. This file is no longer a reconstruction
-- with an asserted half; it is the schema.
--
-- ⛔⛔ ONE THING IT DOES NOT REPRODUCE, ON PURPOSE. Production also carries
-- `person_private_write_own` — a FOR ALL policy with the same
-- `auth.uid() = user_id` predicate, written before this file existed. The three
-- per-command policies below express exactly the same access, so the ALL policy
-- is redundant; it is omitted here and dropped by the cleanup migration rather
-- than carried forward.
--
-- ⚠ WHY PER-COMMAND RATHER THAN ONE `FOR ALL`: a FOR ALL policy silently
-- includes DELETE. Nothing can delete today only because the grant withholds
-- it, so the safety lives in one place instead of two, and the day somebody
-- grants DELETE for an unrelated reason the policy is already open. Three
-- explicit policies make "no delete" a thing you have to add, not a thing you
-- have to remember not to enable.
--
-- ⚠ THERE IS DELIBERATELY NO DELETE POLICY AND NO DELETE GRANT, matching live.
-- That is still a gap worth closing on purpose: this is a person's private data
-- and they should be able to remove it. `calendar_feeds` (CAL1) grants delete
-- on the same account-level shape. Decide it, then add it in its own migration.
--
-- ── WHY THE TABLE EXISTS AT ALL ────────────────────────────────────────
--
-- ⭐⭐ ONE HUMAN, ONE DATE OF BIRTH. `profiles` holds one row per act and an
-- account holds several of them; a date of birth that varied by profile would
-- be a different person on each. So this is keyed by the ACCOUNT, which is the
-- same rule the notification preference and calendar feed tables follow.
--
-- ⛔ NOT A SECOND IDENTITY SYSTEM. It adds the two private components the
-- canonical profile is missing. suburb, state, postcode and country STAY on
-- `profiles`; only the street line moved.

CREATE TABLE IF NOT EXISTS public.person_private (
  -- ⚠ REFERENCES auth.users, not `profiles`. PostgREST reports this foreign key
  -- as pointing at `accounts_with_email` because that view is the only exposed
  -- relation over auth.users; the constraint itself is on the table.
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ⛔⛔ NULLABLE ON PURPOSE. No row exists until somebody supplies something,
  -- and a null here means ABSENT — nobody has answered. A NOT NULL column with
  -- a placeholder date would make "unknown" indistinguishable from a real one.
  dob            date,
  street_address text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.person_private IS
  'Private canonical person data, keyed by account. profiles holds one row per act; DOB and home address belong to the person and must not vary by profile. Not a second identity system - the private extension of the existing one. No row is created until somebody supplies private data; nullable columns mean absence is a real answer.';

COMMENT ON COLUMN public.person_private.dob IS
  'Authoritative date of birth. profiles.age is a self-described text field (values include "31" and "prefer-not-to-say"), kept for backwards compatibility and never used for eligibility. Derive age from this at runtime; do not store a derived age, which goes stale silently.';

COMMENT ON COLUMN public.person_private.street_address IS
  'Residential/postal street line only. suburb, state, postcode and country stay on profiles - this is the missing component, not a duplicate address object.';

-- RLS ships in the same migration as the table. A per-person table is never
-- created open and tightened later.
ALTER TABLE public.person_private ENABLE ROW LEVEL SECURITY;

-- ⭐ THE EXPLICIT RESET IS THE M1 LESSON. Supabase auto-grants ALL to anon on a
-- new table in older projects, and a baseline without this reproduces an open
-- table. ⛔ anon gets NOTHING here and never will: this is the one table in the
-- schema whose entire purpose is that it is private.
--
-- ⛔⛔ NEVER RUN POSTGRES'S OWN HINT. A refused read from here answers with
-- "Grant the required privileges to the current role with: GRANT SELECT ON
-- public.person_private TO anon;" — that hint is the vulnerability, written out
-- as a suggestion.
REVOKE ALL ON public.person_private FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.person_private TO authenticated;
-- ⚠ Restated explicitly rather than relied upon. `service_role` can read this
-- table today; if that access arrived through PUBLIC, the REVOKE above would
-- take it away and every edge function touching this row would start failing
-- with a permission error that looks like an RLS problem and is not.
GRANT ALL ON public.person_private TO service_role;

-- ── AUTHORITY IS THE ACCOUNT, NOT A PROFILE ────────────────────────────
--
-- ⚠ `auth.uid() = user_id` rather than `can_act_as(...)`, and that is not a
-- breach of the ownership rule — it is the other half of it. `can_act_as` is
-- the sole predicate for objects owned by a PROFILE. This row is owned by an
-- ACCOUNT and has no profile column to test, exactly as CLAUDE.md prescribes
-- for account-level tables. `calendar_feeds` and the notification preferences
-- are written the same way.
DROP POLICY IF EXISTS person_private_select_own ON public.person_private;
CREATE POLICY person_private_select_own ON public.person_private
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS person_private_insert_own ON public.person_private;
CREATE POLICY person_private_insert_own ON public.person_private
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ⛔ BOTH HALVES. Without `with check` a caller could pass the `using` test on
-- their own row and then rewrite `user_id` to somebody else's, moving the row
-- out of their own reach and into another person's private record.
DROP POLICY IF EXISTS person_private_update_own ON public.person_private;
CREATE POLICY person_private_update_own ON public.person_private
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ⚠ `updated_at` would otherwise never move after the insert. The client upsert
-- does not send it, and a timestamp that is always the creation time is worse
-- than no column at all — it reads as "last changed then".
DROP TRIGGER IF EXISTS person_private_updated_at ON public.person_private;
CREATE TRIGGER person_private_updated_at
  BEFORE UPDATE ON public.person_private
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
