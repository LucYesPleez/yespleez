-- ═══════════════════════════════════════════════════════════════════
-- P6 · PROFILE REQUIREMENTS — standing eligibility for enquiries
-- Design: docs/professional-profile-requirements-engine-design-2026-08.md
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires P4 (20260803000000) — the requirement key registry this references.
-- ═══════════════════════════════════════════════════════════════════
--
-- ── TWO HOLDERS OF ONE SHAPE, AND WHY THAT IS NOT A DUPLICATE ──
--
-- `events.required_items` (P4) asks: what does THIS OCCASION need from an
-- applicant. It is written when an opportunity is defined and dies with it.
--
-- `profiles.required_items` (here) asks: what does this venue or host need
-- before ANYONE asks them about a date. It is standing policy — set once,
-- outlives every enquiry, and is published rather than attached to an event.
--
-- Same shape, different question, so the same engine evaluates both and there
-- is exactly one registry, one evaluator and one vocabulary. The requirements
-- package states this deliberately: it "knows nothing about who is asking …
-- whether the ask is an application, an enquiry, a booking or an
-- accreditation". This column is that sentence made real. ⛔ A second
-- requirements system — a `venue_requirements` table, a parallel key list —
-- would be the defect this design exists to prevent.
--
-- ── SCOPE: VENUE AND HOST ONLY ──
--
-- Deliberately NOT constrained to those types in SQL. `profiles` holds every
-- type in one table, and a CHECK tying a column to `type` would have to be
-- revisited every time a type is added — while the real guard is that only the
-- venue and host EDITORS render the checklist. An artist row with a non-null
-- `required_items` is not corruption; it is unused data.
--
-- ⚠ HOST REQUIREMENTS ARE DORMANT ON PURPOSE. Hosts can set them today, but
-- nothing evaluates them: there is no artist → host availability enquiry to
-- gate. The column is here so the editor and the data land together rather
-- than a host being asked to fill in a checklist that did not exist when the
-- flow arrives. ⛔ Do not wire host requirements into any venue-initiated flow
-- to "make them do something" — see below.
--
-- ── WHAT THIS GATES, AND WHAT IT MUST NOT ──
--
--   artist  → venue   availability enquiry   GATED (ProfileScreen.sendEnquiry)
--   venue   → artist  invitation             ⛔ NEVER GATED (InviteSheet)
--
-- The gate belongs to the direction where the artist is the one asking. When a
-- venue invites an artist, the venue is doing the asking, and requiring the
-- artist to satisfy the venue's own checklist first would invert the
-- relationship: a venue could make itself unable to invite anyone.
-- `venue_enquiries.initiated_by` already records the direction absolutely
-- ('venue' | 'applicant'), so the two paths cannot be confused.
--
-- ── UNCONSTRAINED, FOR THE SAME REASON AS P4 ──
--
-- No CHECK against the key registry. P4's comment records why: the engine
-- treats an unrecognised key as non-blocking and surfaces it, whereas a CHECK
-- would reject the owner's ENTIRE save because one key was renamed in code
-- before the database heard about it. Failing open on one row beats failing
-- closed on the whole profile.
--
-- NULL and '{}' both mean "no requirements declared" — anyone may enquire.
-- That is the default for every existing row, so this migration changes no
-- behaviour until a venue ticks something.
--
-- ── RLS: NOTHING TO DO, AND WHY THAT IS CORRECT ──
--
-- `profiles` is already world-readable ("Anyone can read profiles" and "enable
-- read for everyone", both FOR SELECT USING (true)), so this column is public
-- the moment it exists. That is the intent, not an oversight: a standing
-- requirement is PUBLISHED ELIGIBILITY POLICY. The enquiring artist's client
-- must read it to know whether they can ask, and telling someone what they
-- need before they ask is the entire feature. Nothing here is private — it is
-- a list of requirement keys, never a profile's values.
--
-- Writes are already governed by "enable all for authenticated users"
-- (auth.uid() = user_id), so an owner can set their own and nobody else's.
--
-- ⚠ ENFORCEMENT IS CLIENT-SIDE, exactly as `ApplyButton` has always been for
-- `events.required_items`. This blocks the UI, not a determined caller with a
-- REST client. That is a deliberate, consistent choice — ⛔ do not read this
-- column as a security boundary. Making it authoritative needs a trigger or an
-- RPC on `venue_enquiries`, which is a separate piece of work with its own
-- decision to make.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS required_items text[];

COMMENT ON COLUMN public.profiles.required_items IS
  'P6 (Requirements Engine, 2026-08) — STANDING eligibility: requirement keys a '
  'venue or host demands before an artist may enquire about availability. Keys '
  'come from REQUESTABLE_KEYS in packages/requirements; evaluated by the same '
  'engine as events.required_items, never a second system. NULL and ''{}'' both '
  'mean no requirements — anyone may enquire. Venue and host only by convention '
  '(the editors), not by CHECK. Deliberately unconstrained for P4''s reason: an '
  'unknown key is surfaced as non-blocking, whereas a CHECK would reject the '
  'owner''s entire profile save. PUBLIC by design — it is published policy an '
  'enquirer must read before asking. ⚠ Enforced client-side only, like '
  'ApplyButton; not a security boundary. ⚠ Host requirements are DORMANT: no '
  'artist → host enquiry flow exists yet, and they must NOT be wired into the '
  'venue-initiated invitation path (InviteSheet), which is never gated.';

-- ── VERIFY ──
-- Expect one row: required_items | ARRAY | YES
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'profiles'
--      AND column_name  = 'required_items';
--
-- Expect the two permissive SELECT policies to still be USING (true) — this
-- migration adds no policy and must not have altered one:
--
--   SELECT policyname, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';
--
-- ── ROLLBACK ──
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS required_items;
