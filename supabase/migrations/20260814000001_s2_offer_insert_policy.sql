-- S2 · AN OFFER BECOMES WRITABLE — AND ANSWERABLE.
--
-- ⭐ THE CANONICAL QUESTION IS "CAN THIS USER ACT AS THE FROM SIDE" (ratified
-- 2026-08-14, ENQUIRE-IS-UNIVERSAL). Both existing INSERT policies on
-- venue_enquiries are applicant-side only:
--
--   "Users can insert own enquiries"                    auth.uid() = applicant_user_id
--   "Applicant profile owner can insert own enquiries"  M4 profile leg, same semantics
--
-- A venue-initiated invite names the ARTIST as applicant, so neither check can
-- ever pass for it. Every ask-upward flow works; every offer-downward flow has
-- 42501'd since InviteSheet was built (docs/known-issues/
-- venue-enquiries-schema-drift.md — the schema half of that doc is fixed; this
-- closes the RLS half). The venue dashboard's OUTGOING tab exists and can
-- never fill.
--
-- ⚠ ADDITIVE-PERMISSIVE, DELIBERATELY, DESPITE SEC-1. Permissive policies OR
-- together and the loosest wins — which is exactly what an ADD needs here:
-- the applicant legs stay untouched for askers, this leg admits offerers. The
-- SEC-1 lesson forbids two policies where one is ACCIDENTALLY looser; this one
-- is scoped to rows the applicant legs can never admit (initiated_by='venue'
-- with the venue as actor), so the union is the intent, not an accident.
--
-- ⚠ can_act_as(), NOT a bare profiles join. §A4: the sole ownership predicate.
-- It already refuses NULL, unclaimed profiles and anonymous callers, so the
-- policy inherits those refusals instead of restating them.
--
-- ⚠ THE IDENTITY-CONSISTENCY GUARDS MIRROR THE M4 APPLICANT LEG, on both
-- column pairs, and must be dropped in the same M8 pass that drops M4's
-- (post-claim divergence — see the M4 policy comment).
--
-- ⚠ THE UPDATE LEG IS HALF THE FEATURE. ArtistDashboard answers an invite by
-- updating status — and both existing UPDATE policies are venue-side only, so
-- the recipient's accept/decline would update ZERO rows, silently (RLS filters
-- UPDATEs, it does not error them). Scoped to initiated_by='venue': on a row
-- the applicant initiated, the venue is the decider, and this leg must not let
-- the asker mark their own request accepted.
--
-- ⛔ NO new table, NO renamed columns, NO arbitrary profile pairs (rule 9).
-- ⛔ SQL editor runs ONE transaction and CREATE POLICY has no IF NOT EXISTS —
--    hence DROP IF EXISTS before each CREATE, making the file re-runnable.

DROP POLICY IF EXISTS "Venue profile owner can insert venue-initiated enquiries"
  ON public.venue_enquiries;

CREATE POLICY "Venue profile owner can insert venue-initiated enquiries"
  ON public.venue_enquiries FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by = 'venue'
    AND public.can_act_as(venue_profile_id)
    AND (venue_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.venue_profile_id
        AND p.user_id = venue_enquiries.venue_user_id))
    AND (applicant_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = venue_enquiries.applicant_profile_id
        AND p.user_id = venue_enquiries.applicant_user_id))
  );

COMMENT ON POLICY "Venue profile owner can insert venue-initiated enquiries"
  ON public.venue_enquiries IS
  'S2 2026-08-14: the offerer INSERT leg. Canonical rule: can_act_as(from side). '
  'Scoped to initiated_by=''venue'' so the applicant legs keep owning asks. '
  'Consistency guards mirror M4 and go when M4''s go (M8).';

DROP POLICY IF EXISTS "Applicant can respond to venue-initiated enquiries"
  ON public.venue_enquiries;

CREATE POLICY "Applicant can respond to venue-initiated enquiries"
  ON public.venue_enquiries FOR UPDATE TO authenticated
  USING (
    initiated_by = 'venue'
    AND public.can_act_as(applicant_profile_id)
  );

COMMENT ON POLICY "Applicant can respond to venue-initiated enquiries"
  ON public.venue_enquiries IS
  'S2 2026-08-14: the recipient of an offer accepts or declines it. Scoped to '
  'initiated_by=''venue'' — on applicant-initiated rows the venue decides, and '
  'this leg must not let an asker answer their own ask.';
