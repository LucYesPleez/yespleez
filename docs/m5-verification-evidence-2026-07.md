# M5 Verification Evidence — Read Cutover + Legacy Redirects

**Status:** COMPLETE — all verification criteria pass; M5 accepted 2026-07-11 (well, by the clock, into the early hours of the 12th for the authenticated pass). Commits `7a4dbdf`, `c78f8ee`, `a2b7817` + this evidence commit, branch `v2-react`.

Verification environments: guest checks on an isolated dev server (port 5199); authenticated checks driven live in the signed-in test account **M** (`lucious.aus@gmail.com`, 5 profiles: punter "Luc", venue "Elbows Rest" `424c551e…`, host "YesPleez" `4bdb2004…`, artist "Lucious" `1995780d…`, band "Dusky Waters" `acb77a8a…`) on the primary dev server (port 5173), both serving the same working tree against the production database. No production rows were created, modified, or deleted by this verification (the one write attempted — V10 — is blocked by a pre-existing constraint by design of the test).

---

## V0 — pre-flight (read-only, live)

| Check | Result | Consequence |
|---|---|---|
| V0a `is_live` distribution | all 25 profiles `is_live = true`, including the unclaimed row (`86c431ff…` Test DJ) | Discover filter change is a provable no-op on current data; retained as NULL-future-proofing. The "explicit false" pause condition did not arise. |
| V0b `venue_availability` NULL `profile_id` | 0 by construction (M3 25/25 + M4 count match + write-path analysis); **confirmed empirically in V7**: `profile_id`-keyed read returns exactly the same 25 rows as the legacy read | Clean cut to `profile_id` proceeds — verified |
| V0c unpromoted placeholders | 0 (1 placeholder visible via policy; its id exists in `profiles`) | Fallback retirement has zero data impact |

## V1–V6, V14 — guest checks (isolated server, port 5199)

| # | Check | URL before → after | Expected | Observed | Pass |
|---|---|---|---|---|---|
| V1 | Canonical claimed artist (Pokki) | `#/profile/af7dfe1e…?type=artist` → unchanged | renders, **no redirect**, single id-keyed lookup | renders Pokki, URL unchanged | ✅ |
| V2 | Unclaimed profile canonical | `#/profile/86c431ff…?type=artist` → unchanged | renders **with UNCLAIMED badge + "Is this you?" claim CTA** (ClaimDialog entry) | badge + CTA render; DJ/PROMOTER label; generic-imagery hero path in effect | ✅ |
| V3 | Legacy multi-type URL with type | `#/profile/94a88288…?type=venue` → `#/profile/424c551e…?type=venue` | redirect to the typed profile's canonical id | exactly that (Elbows Rest renders) | ✅ |
| V4/V5 | Legacy URL, no type, punter+venue account | `#/profile/daa848f2…` → `#/profile/4e77c0ae…?type=venue` | redirect excluding punter per unchanged precedence, `?type=` appended by profileUrl | exactly that (Bellingen renders) | ✅ |
| V6 | Discover | `#/discover` → card click → `#/profile/86c431ff…?type=artist` | Test DJ present in grid; card navigates **directly** to canonical URL (no legacy hop); destination shows badge | exactly that | ✅ |
| V14 | Unknown id | `#/profile/00000000-…-00000000dead` | "Profile not found."; **zero `placeholder_profiles` requests** | exactly that (the app's only placeholder read was deleted in `7a4dbdf`) | ✅ |

## V7–V13 — authenticated checks (signed-in account M, port 5173)

| # | Check | URL before → after | Expected | Observed | Pass |
|---|---|---|---|---|---|
| V13a | Artist dashboard view-profile | `#/industry/artist` → `#/profile/1995780d…?type=artist` | canonical self-URL | exact match | ✅ |
| V13b | Venue dashboard view-profile | `#/industry/venue` → `#/profile/424c551e…?type=venue` | canonical self-URL | exact match | ✅ |
| V13c | Host dashboard view-profile | `#/industry/host` → `#/profile/4bdb2004…?type=host` | canonical self-URL | exact match | ✅ |
| V9 | Follow **state-read** on canonical URL | `#/profile/af7dfe1e…?type=artist` (no redirect) | pre-M5 follow row (keyed `entity_id = user_id`) lights "✓ FOLLOWING" via the two-leg state read | FOLLOWING shown on Pokki's canonical page | ✅ |
| V10 | Follow attempt on unclaimed profile | `#/profile/86c431ff…?type=artist` (no redirect) | no crash, no new error; **no row written** (insert blocked by the pre-existing `entity_type` CHECK bug); multi-profile account opens the follow picker rather than immediate insert (unchanged pre-M5 behaviour) | + FOLLOW present on the badged page; click opened the picker (account owns 5 profiles); `follows` row count for this target: **0**; page fully functional afterwards | ✅ |
| V7 | Venue availability read parity (owner) | `#/profile/424c551e…?type=venue` (no redirect) | `profile_id`-keyed read ≡ legacy `user_id`-keyed read; sheet opens | **25 = 25** rows, identical; CHECK AVAILABILITY sheet opened without error (the sheet's day cells don't carry literal "AVAILABLE" text, so the UI assertion is "sheet opens + data-layer parity") | ✅ |
| V8 | Artist gigs two-leg read parity | `#/profile/0a45f3a1…?type=artist` (no redirect) | two-leg (`artist_profile_id` OR `artist_id`) event set ≡ legacy set; gigs render | **1 = 1** event (identical id set); Daddy Longlegs page renders gig section | ✅ |
| V12a | EventScreen slot → artist profile | `#/event/257038af…` → slot expand → VIEW PROFILE → `#/profile/0a45f3a1…?prefer=performer` | canonical id via `lineup_members.artist_profile_id` | exact match, page renders; the SlotCard's own follow-state (untouched, `claim.user_id`-keyed) correctly showed "✓ FOLLOWING" — regression bonus | ✅ |
| V12b | ApplicationsScreen card → applicant profile | `#/event/55512cb8…/applications` (TENTATIVE tab) → `#/profile/745450e8…?type=artist` | canonical id from the applicant profile map | exact match (BVP renders) | ✅ |

### V9 rationale (as directed)

Follow **state-read** is the correct behavioural verification for M5 because follow **creation** is currently blocked by the separately tracked `entity_type` CHECK bug (`docs/known-issues/profile-follow-entity-type-drift.md`) — the ProfileScreen insert has never succeeded for any account, before or after M5, so a write-then-read check would measure the bug, not the migration. The meaningful M5 assertion — that an existing pre-M5 follow row (keyed on the legacy `entity_id = user_id` keyspace) resolves and displays correctly through the **canonical profile URL** via the new two-leg state read — was verified and passes.

### V11 rationale (as directed)

The live enquiry-send test is **intentionally omitted** because it would create a real production `venue_enquiries` row that cannot be cleanly removed (the table has no DELETE policy on either identity system — M4 §1.2 — and the realistic target is the first venue client's live venue). It is not required for M5 acceptance because:
- **the write derivation was code-reviewed**: `sendEnquiry` now sources `venue_user_id` from `profile.user_id` and `venue_profile_id` from `profile.id` on the loaded row — for every claimed venue these are byte-identical to the pre-M5 route-derived values;
- **the dual-write path was verified in M2** (and the F1 fix extended it to this exact call site, with the pre-M4 residual check finding zero legacy-only rows);
- **the RLS behaviour was verified by M4's B5 matrix cell** (a fully dual-written applicant self-enquiry inserts successfully under both policy sets);
- therefore **no additional production write is required for M5 acceptance**.

## V15 — regression sweep

- Exit-criterion grep (`/profile/` across `v2/src`): every interpolation is `profileUrl()` output, a canonical-id-first expression, or an explicitly-commented legacy fallback branch; plus the route definition and comments. **No unconditional user-id URL generator remains.** Dead `profilePath` config (defined, never consumed) was deleted rather than migrated.
- Console: the only error in the entire authenticated session is the pre-existing React style-shorthand warning (`background`/`backgroundClip` on gradient headers), which predates M5. Zero M5-attributable errors. The intermediate `isPlaceholder` HMR errors seen mid-edit resolved with the completed edit set (verified by hard reload before the guest pass).
- Event-like buttons (WhatsOn/EventScreen hearts, `entity_type='event'` follows) untouched and unexercised by any M5 hunk.
- MyScene note: the dayArtists profile links are part of the *uncommitted in-flight feature work* (not present at HEAD) — no M5 hunk was needed; the working-tree feature was adjusted to emit canonical URLs so it lands migration-clean.

## Expected database reads (asserted via the checks above)

Canonical profile hit: one `profiles?id=eq.…` lookup (no `user_id` query, no `placeholder_profiles` query), then `events?venue_profile_id=eq.…` (venue) / `lineup_members` two-leg OR (performer) / `venue_availability?profile_id=eq.…` (availability sheet). Legacy hit: the same preceded by one `profiles?user_id=eq.…` and a replace-navigation. Verified behaviourally by V1 (no redirect on canonical), V3/V4/V5 (redirect on legacy), V14 (no placeholder query), V7/V8 (new-key reads returning correct data).

## Scope confirmation

M5 shipped exactly the approved scope: no schema change, no RLS change, no change to `resolveProfileId()`, no data migration, M5.1's display joins untouched (J1–J2, J5–J9 still legacy-joined, output-identical), F2/F3/F4/F5 and the follow `entity_type` bug all untouched. The `?type=` parameter is retained on canonical URLs per the approved refinement.
