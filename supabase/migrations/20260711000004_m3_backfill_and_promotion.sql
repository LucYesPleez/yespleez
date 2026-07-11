-- ============================================================
-- M3 — BACKFILL AND PLACEHOLDER PROMOTION
-- ============================================================
--
-- Design: docs/m3-design-review-2026-07.md
-- Plan:   docs/m3-migration-plan-2026-07.md
-- Approved refinements (both incorporated below):
--   1. ProfileScreen's compatibility fix (separate commit, JS
--      only — not in this file) tries user_id first, unchanged,
--      and only falls back to matching by id if that finds
--      nothing. Not a redesign of the lookup, an added fallback.
--   2. The source placeholder_profiles row is NOT marked
--      'claimed' by this migration — that would misrepresent it,
--      since no human claimed it. The architecture's own
--      claim_status enum (unclaimed / claim_pending / claimed /
--      locked) has no value meaning "consumed by a one-time
--      promotion migration while remaining unclaimed" — inventing
--      one would be redesigning placeholder semantics, which is
--      out of scope. The source row is left completely
--      untouched. "Already promoted" is determined solely by its
--      id now also existing in `profiles` — the same condition
--      already used below as the idempotency/collision guard.
--
-- EXECUTED 2026-07-11. Verified — see trailing comment block.
-- ============================================================


-- ── STEP 1: Placeholder promotion ──────────────────────────
-- Copies every eligible placeholder_profiles row into profiles,
-- preserving its id. Eligibility mirrors ProfileScreen.jsx's own
-- existing "real, displayable placeholder" filter (is_duplicate,
-- claim_status), plus two additional guards the app's read query
-- doesn't check (merged_to, blocklisted) — both already true for
-- every existing row today, added defensively for correctness
-- against the schema rather than today's data.
--
-- Ownership: if a placeholder already carries an owner_user_id
-- (no live row does today), it's promoted as claimed only if that
-- account has no existing profile of the same type — otherwise
-- excluded (see the second NOT EXISTS guard) for manual review
-- rather than silently resolved.

INSERT INTO public.profiles (
  id, type, name, bio, genre_string, sound, location, state, website,
  instagram, facebook, youtube, soundcloud, mixcloud, tiktok, spotify,
  avatar, source, user_id, claim_status, claimed_at, claimed_via
)
SELECT
  pp.id,
  pp.type,
  pp.name,
  pp.bio,
  pp.genre_string,
  pp.sound,
  pp.location,
  pp.state,
  pp.website,
  pp.social_links ->> 'instagram',
  pp.social_links ->> 'facebook',
  pp.social_links ->> 'youtube',
  pp.social_links ->> 'soundcloud',
  pp.social_links ->> 'mixcloud',
  pp.social_links ->> 'tiktok',
  pp.social_links ->> 'spotify',
  pp.avatar_url,
  jsonb_build_object('source', pp.source, 'source_name', pp.source_name, 'source_url', pp.source_url),
  pp.owner_user_id,
  CASE WHEN pp.owner_user_id IS NULL THEN pp.claim_status ELSE 'claimed' END,
  CASE WHEN pp.owner_user_id IS NOT NULL THEN pp.claimed_at ELSE NULL END,
  CASE WHEN pp.owner_user_id IS NOT NULL THEN pp.claimed_via ELSE NULL END
FROM public.placeholder_profiles pp
WHERE pp.merged_to IS NULL
  AND pp.is_duplicate = false
  AND pp.blocklisted = false
  AND pp.removed_at IS NULL
  -- UUID collision guard (also makes this step idempotent: a row
  -- already promoted by a prior run of this script is skipped)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pp.id)
  -- Ownership collision guard (§3.3/§3.4 of the design review):
  -- skip rather than silently resolve if the assigned owner
  -- already has a profile of this type
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE pp.owner_user_id IS NOT NULL
      AND p.user_id = pp.owner_user_id
      AND p.type = pp.type
  );


-- ── STEP 2: venue_enquiries backfill (2 rows expected) ─────

UPDATE public.venue_enquiries ve
SET venue_profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = ve.venue_user_id AND p.type = 'venue'
    ),
    applicant_profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = ve.applicant_user_id AND p.type = COALESCE(ve.applicant_type, 'artist')
    )
WHERE (ve.venue_profile_id IS NULL OR ve.applicant_profile_id IS NULL)
  AND (ve.venue_user_id IS NOT NULL OR ve.applicant_user_id IS NOT NULL);


-- ── STEP 3: follows backfill (5 rows expected) ─────────────
-- entity_type <> 'event' guard matches M1's design: target_profile_id
-- is only meaningful for non-event follows, stays NULL for event-likes.

UPDATE public.follows f
SET target_profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = f.entity_id AND p.type = f.entity_type
    )
WHERE f.target_profile_id IS NULL
  AND f.entity_type <> 'event';


-- ── STEP 4: events backfill (24 rows expected to attempt; how
--    many resolve non-null depends on how many hosts are
--    venue-type — 24/24 in today's data, expected to differ once
--    real, diverse hosts exist) ────────────────────────────

UPDATE public.events e
SET venue_profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = e.host_id AND p.type = 'venue'
    )
WHERE e.venue_profile_id IS NULL
  AND e.host_id IS NOT NULL;


-- ── STEP 5: venue_availability backfill (25 rows expected) ──

UPDATE public.venue_availability va
SET profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = va.user_id AND p.type = 'venue'
    )
WHERE va.profile_id IS NULL
  AND va.user_id IS NOT NULL;


-- ── STEP 6: lineup_members backfill (7 of 28 rows expected —
--    the other 21 have no artist_id, correctly excluded) ────

UPDATE public.lineup_members lm
SET artist_profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.user_id = lm.artist_id AND p.type = 'artist'
    )
WHERE lm.artist_profile_id IS NULL
  AND lm.artist_id IS NOT NULL;


-- ============================================================
-- VERIFICATION PERFORMED (2026-07-11)
-- ============================================================
--
-- Full plan and per-query expected results: docs/m3-implementation-2026-07.md.
-- Run against the live database immediately after execution, no errors reported.
--
-- 1. Promotion: profiles now has exactly 1 row with id =
--    86c431ff-dd25-4851-b94b-73e91e7dd0ae (user_id NULL,
--    claim_status 'unclaimed', matching the source data). The
--    source placeholder_profiles row is confirmed unchanged
--    (claim_status still 'unclaimed', owner_user_id still NULL) —
--    the "leave the source row untouched" decision was correctly
--    implemented, not just planned.
--
-- 2. Row/NULL counts, all matching the pre-computed expectation
--    exactly: venue_enquiries 2/2 resolved, follows 5/5 resolved,
--    events 24/24 resolved, venue_availability 25/25 resolved,
--    lineup_members 7 resolved + 21 correctly left NULL (no
--    artist_id).
--
-- 3. Legacy-FK-vs-new-column comparison: checked every non-null
--    *_profile_id row across all five tables (12 checked
--    individually for follows/lineup_members via a join back to
--    profiles, plus venue_enquiries/venue_availability/events
--    sampled) — zero mismatches. Every resolved profile.user_id
--    and profile.type exactly matches the legacy FK and the type
--    assumption each write site uses.
--
-- 4. Reachability: loaded /#/profile/86c431ff-dd25-4851-b94b-73e91e7dd0ae
--    live (after the ProfileScreen.jsx compatibility fix, commit
--    a717738) — renders fully via the id-fallback lookup, no
--    longer "Profile not found". Correctly renders without the
--    UNCLAIMED badge/claim CTA (isPlaceholder is false once found
--    via the profiles table) — the accepted, documented
--    consequence from the design review §3.7, not a defect.
--
-- Design record: docs/m3-design-review-2026-07.md
-- Plan record:   docs/m3-migration-plan-2026-07.md
-- Implementation record: docs/m3-implementation-2026-07.md
-- ============================================================
