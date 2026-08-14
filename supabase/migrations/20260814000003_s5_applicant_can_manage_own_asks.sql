-- S5 · AN ASKER CAN WITHDRAW AND TIDY THEIR OWN ASKS.
--
-- ⚠⚠ THE POLICY HALF IS A BUG FIX, NOT A FEATURE. `venue_enquiries` had NO
-- UPDATE policy for an applicant on a row the applicant themself initiated:
--
--   "Venue owner can update status"                  auth.uid() = venue_user_id
--   "Venue profile owner can update status"          venue side
--   "Applicant can respond to venue-initiated…" (S2) initiated_by = 'venue'
--
-- So CANCEL ENQUIRY updated ZERO rows and reported success — RLS filters an
-- UPDATE rather than erroring it, which is the failure mode that looks like a
-- working feature. It appeared to work in testing only because the tester owns
-- both sides of those rows (venue_user_id = auth.uid()), so the VENUE-side
-- policy admitted the write. ⛔ Against a venue you do not own it did nothing.
--
-- ⚠ SCOPED TO `initiated_by = 'applicant'`, so this leg governs asks you SENT
-- and never offers you RECEIVED — those stay with S2's response leg. Without
-- the scope an asker could rewrite an offer's terms.
--
-- ── THE COLUMN ───────────────────────────────────────────────────────
--
-- ⭐ CLEARING HIDES, IT DOES NOT DELETE (owner, 2026-08-14: "hide it from me
-- only"). One row has TWO viewers: deleting a declined enquiry from the
-- asker's side would erase the venue's own record of having answered it, which
-- is not the asker's call to make. A per-side marker lets each side tidy their
-- list without editing the other's history.
--
-- ⚠ A TIMESTAMP, NOT A BOOLEAN. `cleared` would say only that it happened;
-- the time it happened is free to store and is the difference between "tidied
-- last month" and "tidied just now" when someone asks why a row vanished.
-- NULL means never cleared, which is the majority and a correct answer.
--
-- ⚠ TWO COLUMNS, ONE PER SIDE (owner, 2026-08-14: "apply this to all of the
-- enquiry sections"). The venue tidies its own list with `venue_cleared_at`,
-- the asker with `applicant_cleared_at`, and NEITHER can see or affect the
-- other's. That is the whole point of a per-side marker: the same row leaves
-- one list while staying in the other, and no one edits anyone else's history.
--
-- ⛔ NOT ONE SHARED `cleared_at`. A single column would mean whoever tidied
-- first hid the row from both — the deletion problem wearing a different name.
--
-- ⛔ NOT A STATUS. Clearing says nothing about the outcome — a cleared row is
-- still whatever it was, still counted in the venue's history. Overloading
-- `status` with a display concern is how a status column stops meaning one
-- thing.
--
-- ── ⭐⭐ CANCELLED IS NOT DECLINED (owner, 2026-08-14) ─────────────────
--
-- "if i cancel an enquiry it doesnt go to declined. its removed from the table
-- completely. declined is only to show me applications that have been declined
-- by the places i applied to."
--
-- DECLINED is the OTHER SIDE'S VERDICT. Withdrawing your own ask is not a
-- verdict and must never be filed as one — a list of rejections you can learn
-- from is worthless if it also contains everything you changed your mind
-- about.
--
-- So a cancel writes `status = 'cancelled'` (⛔ NOT 'declined') AND sets
-- `applicant_cleared_at`, which are two different facts:
--
--   status = 'cancelled'    the VENUE stops seeing a live ask awaiting them
--   applicant_cleared_at    the ASKER stops seeing it at all
--
-- ⚠ 'cancelled' MUST BE TAUGHT TO THE INCOMING STATUS MAP (lib/enquiryUtils),
-- or a withdrawn ask falls through to the venue's NEW bucket — an enquiry the
-- asker has walked away from sitting at the top of the venue's inbox.

ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS applicant_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS venue_cleared_at     timestamptz;

COMMENT ON COLUMN public.venue_enquiries.venue_cleared_at IS
  'S5 2026-08-14: when the VENUE tidied this row out of their own list. NULL = '
  'never cleared. ⛔ The applicant''s mirror of this is applicant_cleared_at, '
  'and neither side can see or affect the other''s.';

COMMENT ON COLUMN public.venue_enquiries.applicant_cleared_at IS
  'S5 2026-08-14: when the ASKER tidied this row out of their own outgoing '
  'list. NULL = never cleared. ⛔ Hides for the applicant only — the venue''s '
  'view and the row itself are untouched. ⛔ Not a status: a cleared row is '
  'still whatever it was.';

DROP POLICY IF EXISTS "Applicant can update own enquiries" ON public.venue_enquiries;

CREATE POLICY "Applicant can update own enquiries"
  ON public.venue_enquiries FOR UPDATE TO authenticated
  USING (
    initiated_by = 'applicant'
    AND public.can_act_as(applicant_profile_id)
  )
  WITH CHECK (
    initiated_by = 'applicant'
    AND public.can_act_as(applicant_profile_id)
  );

COMMENT ON POLICY "Applicant can update own enquiries" ON public.venue_enquiries IS
  'S5 2026-08-14: the asker''s own two moves — withdraw (status) and tidy '
  '(applicant_cleared_at) — on rows they initiated. Scoped to '
  'initiated_by=''applicant'' so it can never touch an offer they received; '
  'those are S2''s response leg.';
