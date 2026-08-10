-- ═══════════════════════════════════════════════════════════════════
-- P7 · ENQUIRY REQUIREMENTS SNAPSHOT
-- Design: docs/professional-profile-requirements-engine-design-2026-08.md §12
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- Requires P6 (20260810000000) — profiles.required_items.
-- ═══════════════════════════════════════════════════════════════════
--
-- The enquiry twin of `applications.requirements_snapshot` (P5). Same shape,
-- same builder, same rules — deliberately, so there is one answer to "did they
-- meet what was asked, at the time" whichever door someone came through.
--
-- ── WHY A STORED VERDICT AND NOT A LIVE ONE ──
--
-- A venue's standing requirements are MORE volatile than an event's, not less.
-- An event's checklist is written once and the event happens; a venue's is
-- policy that gets tightened, loosened and re-tightened for years while
-- enquiries keep arriving against it. Recomputing on read would mean an
-- enquiry from March silently re-judged by August's rules — a venue could
-- raise the bar and retroactively make every past enquirer look ineligible,
-- or lower it and manufacture eligibility nobody actually had.
--
-- So `required_items` is copied into the verdict ON PURPOSE, exactly as P5
-- does: the snapshot must keep naming what was actually asked at the time, not
-- what the profile asks today.
--
-- Shape — built ONLY by snapshotEvaluation() in packages/requirements:
--
--   {
--     "v": 1,
--     "evaluated_at": "2026-08-10T04:12:55.019Z",
--     "required_items": ["BIO", "DEMO_MIX", "PRESS_KIT"],
--     "items": [{"key": "BIO", "state": "satisfied"}, ...],
--     "satisfied": 3,
--     "total": 3
--   }
--
-- NOT stored: labels (derivable from the registry, and a stored one goes stale
-- against it), profile field values, asset contents or paths. The profile
-- stays REFERENCED — `applicant_profile_id` is already on the row — never
-- copied. This is a verdict, not a third profile copy.
--
-- ── NULL IS THE NORMAL CASE, AND WILL BE FOR MOST ROWS ──
--
-- NULL means: the venue declared no requirements, the row predates P7, or the
-- enquiry came from the venue side. All three are ordinary. Readers render
-- nothing rather than "0/0" (Rendering Contract R3).
--
-- ⚠ In particular, a VENUE-INITIATED invitation (`initiated_by = 'venue'`,
-- written by InviteSheet) will always have NULL here. That path is never
-- gated — when the venue is doing the asking, requiring the artist to satisfy
-- the venue's own checklist first would invert the relationship. A non-null
-- snapshot on an `initiated_by = 'venue'` row means something has wired the
-- gate into the wrong direction.
--
-- ── SATISFIED-ONLY, BY CONSTRUCTION ──
--
-- Unlike P5, where an application can be saved in progress, an enquiry is only
-- ever inserted once the gate has passed. So in practice every stored verdict
-- here reads satisfied === total. It is still written in full rather than as a
-- boolean: "they met BIO, DEMO_MIX and PRESS_KIT on the 10th of August" is a
-- record that survives the venue later deleting DEMO_MIX from its list, and a
-- bare `true` is not.
--
-- jsonb, not a table: written once, read whole, never queried by part.

ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS requirements_snapshot jsonb;

COMMENT ON COLUMN public.venue_enquiries.requirements_snapshot IS
  'P7 (Requirements Engine, 2026-08) — the evaluation VERDICT at enquiry '
  'creation: {v, evaluated_at, required_items[], items[{key,state}], satisfied, '
  'total}. Built only by snapshotEvaluation() in packages/requirements. Stores '
  'the decision, never profile values — the applicant profile stays referenced '
  'via applicant_profile_id. `required_items` is duplicated here on purpose so '
  'a venue editing its standing requirements later cannot rewrite what an '
  'enquirer was asked. NULL = the venue declared no requirements, the row '
  'predates P7, or the enquiry was venue-initiated; render nothing, not 0/0. '
  '⚠ initiated_by = ''venue'' rows are NEVER gated and must always be NULL here '
  '— a value on one means the gate was wired into the wrong direction.';

-- No RLS change. `venue_enquiries` policies already govern the row ("Profile
-- owner can read their enquiries", M4, granting SELECT to either side by
-- profile ownership); the snapshot is an ordinary field of it and is visible
-- to exactly whoever the row is.

-- ── VERIFY ──
-- Expect one row: requirements_snapshot | jsonb | YES
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'venue_enquiries'
--      AND column_name  = 'requirements_snapshot';
--
-- Expect ZERO rows — no venue-initiated enquiry may ever carry a verdict:
--
--   SELECT id, initiated_by
--     FROM public.venue_enquiries
--    WHERE initiated_by = 'venue' AND requirements_snapshot IS NOT NULL;
--
-- ── ROLLBACK ──
--   ALTER TABLE public.venue_enquiries DROP COLUMN IF EXISTS requirements_snapshot;
