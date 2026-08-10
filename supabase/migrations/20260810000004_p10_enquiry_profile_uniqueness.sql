-- ═══════════════════════════════════════════════════════════════════
-- P10 · ENQUIRY UNIQUENESS BY PROFILE — ADDED ALONGSIDE, NOT INSTEAD
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires P9 (20260810000003) — both profile columns NOT NULL.
-- ═══════════════════════════════════════════════════════════════════
--
-- ⭐ WHAT AN ENQUIRY IS: this ACT asking this VENUE about this DATE.
--
-- The baseline constraint says something subtly different — this PERSON asking
-- this ACCOUNT about this date:
--
--     UNIQUE (venue_user_id, applicant_user_id, date_requested)
--
-- So one person's DJ act enquiring stops their own band enquiring, and someone
-- owning two venues has both keyed as one. Neither is the intended rule.
--
-- ⭐ THE CODEBASE ALREADY DECIDED THIS, IN THE READ PATH. ArtistDashboard's own
-- comment: `applicant_user_id` "counted every profile's offers on every
-- profile's dashboard … falling back to the account key would reinstate the
-- cross-over. That clause is the bug: it is what shows one profile's work on
-- another." This constraint is that same bug surviving in the WRITE path.
-- notifActions says it from the other side: where an account owns several
-- performer profiles it leaves attribution NULL rather than guessing, and
-- names `venue_enquiries.applicant_profile_id` as the thing to prefer.
--
-- ── ⛔ THIS MIGRATION CHANGES NO BEHAVIOUR. THAT IS THE POINT. ──
--
-- The old constraint REMAINS and keeps rejecting the cross-act case. Adding
-- this one is purely additive and fully reversible: drop it and the database is
-- exactly as it was. The behavioural change is P11, deliberately separated so
-- it can be reverted alone.
--
-- ── IT CANNOT FAIL ON EXISTING ROWS ──
--
-- Not merely "the data looks clean" — it is structural. profile → user is
-- many-to-one, so any two rows colliding on (venue_profile, applicant_profile,
-- date) necessarily collide on (venue_user, applicant_user, date), which the
-- OLD constraint already forbids. A violation here would mean the old
-- constraint was already violated.
--
-- ⚠ A named UNIQUE constraint, not a bare index: it must be droppable by name
-- in P11's mirror image, and it belongs in the table definition rather than
-- looking like a performance index somebody added.

ALTER TABLE public.venue_enquiries
  ADD CONSTRAINT venue_enquiries_venue_profile_applicant_profile_date_key
  UNIQUE (venue_profile_id, applicant_profile_id, date_requested);

COMMENT ON CONSTRAINT venue_enquiries_venue_profile_applicant_profile_date_key
  ON public.venue_enquiries IS
  'P10 — an enquiry is THIS ACT asking THIS VENUE about THIS DATE. Added '
  'alongside the baseline user-level key, which P11 drops separately. Total '
  'because P9 made both columns NOT NULL — with a nullable column a null row '
  'would be exempt, since Postgres treats NULLs as distinct.';

-- ── VERIFY ──
-- Expect BOTH constraints present after this migration — the new one and the
-- baseline user-level one. P11 is what removes the second:
--
--   SELECT conname
--     FROM pg_constraint
--    WHERE conrelid = 'public.venue_enquiries'::regclass AND contype = 'u'
--    ORDER BY conname;
--
-- Expect zero rows — nothing may violate the new key:
--
--   SELECT venue_profile_id, applicant_profile_id, date_requested, count(*)
--     FROM public.venue_enquiries
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
-- ── ROLLBACK ──
--   ALTER TABLE public.venue_enquiries
--     DROP CONSTRAINT IF EXISTS venue_enquiries_venue_profile_applicant_profile_date_key;
