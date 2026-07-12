# Soak / Polish Backlog — post-M5.1, pre-M6

**Status:** ACTIVE. The identity migration is paused at M5.1 (2026-07-12); M6 does not begin until explicitly resumed. This document is the single prioritized backlog for the soak period: real-user testing across every profile type, with each reported issue investigated fresh and classified before any action.

**Triage taxonomy** (assigned after investigation, never assumed):
1. **BUG** — genuine defect
2. **POLISH** — UX/polish improvement
3. **DEBT** — technical debt
4. **REGRESSION** — traced to M5/M5.1 specifically
5. **M6-BLOCKER** — blocks the write cutover or risks data integrity → the only class eligible for immediate fixing during soak

**Action rule:** M6-BLOCKER and data-integrity items get fixed immediately (investigated → atomic fix → verified → isolated commit). Everything else is logged here and waits.

**Testing-environment note:** the dev servers serve HEAD **plus the uncommitted feature work** (enquiry flow UI, DJ/PROMOTER rebrand, profile-form refactor, dashboard polish across ~20 files). An issue seen while browsing may live in the uncommitted layer, not in HEAD — classification must say which.

---

## Pre-seeded from the migration's known-issues records (already investigated)

| # | Item | Class | Where tracked | Notes |
|---|---|---|---|---|
| S1 | Profile FOLLOW button silently fails for everyone — insert sends `entity_type: 'profile'`, rejected by CHECK constraint, error unchecked | BUG (pre-existing, high) | `known-issues/profile-follow-entity-type-drift.md` | Post-M5 the natural fix is one line (write the loaded profile's real type) + error handling. Worth early polish: follows are a core loop. Not an M6 blocker per se, but M6's write cutover touches this exact insert — fixing it *before* M6 keeps M6 clean. |
| S2 | Venue availability invisible to non-owners — no public-read policy; the CHECK AVAILABILITY calendar and enquiry picker render empty for exactly their audience | BUG blocking the (uncommitted) enquiry feature | `known-issues/enquiry-feature-rls-gaps.md` (F2) | Needs a product decision (public vs authenticated-only read). RLS change = its own isolated migration when decided. |
| S3 | Applicant accept/decline on enquiries is a silent no-op — UPDATE policy is venue-side only; UI optimistically lies | BUG (pre-existing) | same doc (F3) | Business-rule decision (should applicants write status?) — flagged for the enquiries/Booking rework. |
| S4 | Venue-initiated invites (InviteSheet) can never insert — policy requires `auth.uid() = applicant_user_id` | BUG (pre-existing, diagnosed) | `known-issues/venue-enquiries-schema-drift.md` (F4) | Same business-rule cluster as S3. Also schema-drift fields on that payload. |
| S5 | `artist/band/standup_availability` have no `profile_id` columns | DEBT / **M6-prerequisite** | M4 review §6 (F5) | Needs an M1-style additive column + M3-style backfill before M6 can cut availability writes for those types — or an explicit decision they stay account-keyed. Resolve during soak planning so M6 isn't blocked on arrival. |
| S6 | `applications` has no profile columns; all its joins/authz stay account-keyed | DEBT (architecture boundary) | Booking review (deferred since Fix 2/3) | Not eligible for M6; the Booking architecture review owns it. |
| S7 | Artist self-inserted/self-updated application statuses (interim RLS latitude) | DEBT | Fix 2/Fix 3 migration comments | Booking review. |
| S8 | Any authenticated user can insert notifications into any inbox | DEBT (accepted interim) | `known-issues/notifications-schema-drift.md` | Notifications authorization redesign. |
| S9 | "APPLYING AS: <wrong profile>" for multi-role accounts on Apply flow | BUG (pre-existing, small) | applications-schema-drift doc | Cosmetic-ish; multi-type accounts only. |
| S10 | EnquiryCard type labels at HEAD still say "DJ / PRODUCER" (rebrand lives in uncommitted feature work) | POLISH | uncommitted-work layer | Resolves when the feature work lands; don't fix twice. |
| S11 | React style-shorthand console warning (`background`/`backgroundClip`) on gradient headers | POLISH (console hygiene) | observed throughout M5 verification | Trivial, batch with other polish. |
| S12 | DiscoverScreen duplicate-key warning | POLISH — possibly already resolved by M5's `id` keys | M5 review §7 | Re-check during soak before closing. |
| S13 | Supabase org shows OUTSTANDING INVOICES warning | OPS | flagged 2026-07-11 | Not code. Clear before M6's production work. |
| S14 | The uncommitted feature work itself (~20 files) needs review, verification, and landing as its own change set | DEBT (process) | working tree | Landing it during soak shrinks every future index-staging dance and makes soak findings unambiguous. Recommended early. |

## Soak findings (append as reported)

_(none yet — table format: # · reported · what was seen · investigation summary · class · disposition)_
