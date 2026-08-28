-- P3 · PROFILE CLAIM INTEGRITY — an ownerless profile can never be "claimed".
--
-- ⭐⭐ THERE WAS NO ROGUE WRITER. Traced 2026-08-29 across both apps and Studio:
-- Scene's seven profile writes all upsert the SIGNED-IN user's own row; none of
-- its 21 RPCs creates a profile; Festival's single insert sets `user_id`; and
-- Studio's importer passes `claim_status: 'unclaimed'` explicitly, guarded by
-- its own test. ⛔ Nothing in the codebase creates an ownerless claimed profile.
--
-- ⭐⭐ THE DEFECT IS THIS COLUMN'S DEFAULT, and the reason is worth keeping:
-- M1 (20260711000003) added `claim_status TEXT NOT NULL DEFAULT 'claimed'` and
-- justified it by MEASURING, not assuming —
--
--   "Confirmed before writing this migration: zero profiles rows have
--    user_id IS NULL, so claim_status DEFAULT 'claimed' is safe for 100% of
--    existing rows (not an assumption)."
--
-- ⚠⚠ THE MEASUREMENT WAS RIGHT AND THE DEFAULT OUTLIVED IT. Ownerless profiles
-- are now legitimate and ordinary — external acts on a public lineup — and by
-- 2026-08-29 **142 of 220** profiles had `user_id IS NULL`. So a fact that was
-- verified true became false without anything failing, and every insert that
-- omitted the field inherited "claimed".
-- ⭐ THE LESSON: a default justified by a measurement needs the measurement to
-- keep holding. This migration replaces it with a CONSTRAINT, which cannot go
-- quietly out of date.

-- ── 1 · The default now matches reality ────────────────────────────────────
-- ⭐ A new profile is UNCLAIMED until somebody owns it. ⛔ The opposite default
-- hands an unowned row the strongest possible statement about itself.
ALTER TABLE public.profiles ALTER COLUMN claim_status SET DEFAULT 'unclaimed';

-- ── 2 · Correct the existing rows ──────────────────────────────────────────
-- ⚠ VERIFIED BEFORE WRITING: exactly 14 rows match, and they are the Neverland
-- Weekender lineup batch (created 2026-08-27 13:18:31.027132, no `created_via`,
-- no `external_ref`, no `source` — the fingerprint of a writer outside the
-- application code, since every code path stamps provenance).
--
-- ⛔ THE PREDICATE IS THE SAFETY. It touches only rows that are BOTH ownerless
-- AND claimed. ⛔ No profile with a `user_id` can be affected, whatever its
-- status, so a real person's claim cannot be undone by this.
UPDATE public.profiles
   SET claim_status = 'unclaimed'
 WHERE user_id IS NULL
   AND claim_status = 'claimed';

-- ── 3 · Make it structural ─────────────────────────────────────────────────
-- ⭐⭐ A CONSTRAINT, NOT A CONVENTION. The default alone only helps an insert
-- that omits the column; this rejects the state itself however it is reached —
-- insert, update, backfill or hand-written SQL.
--
-- ⭐ It forbids exactly ONE combination and permits every other legitimate
-- state. Verified against the live vocabulary before writing: `claimed` (92)
-- and `unclaimed` (128) are the only values in use, and `pending`/`rejected`
-- (declared on `placeholder_profiles`, currently unused here) stay legal for an
-- ownerless row — a pending claim is precisely an unowned row mid-claim, and a
-- constraint that rejected it would break the claim flow the day it is used.
--
-- ⚠ ADDED AFTER THE UPDATE so it validates against a clean table rather than
-- being added NOT VALID and quietly never checked.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_claimed_requires_account
  CHECK (user_id IS NOT NULL OR claim_status <> 'claimed');

COMMENT ON CONSTRAINT profiles_claimed_requires_account ON public.profiles IS
  'An ownerless profile can never be claimed. claim_status is about ownership, and user_id is what ownership means.';
