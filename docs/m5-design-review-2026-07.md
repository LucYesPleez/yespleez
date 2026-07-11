# M5 Design Review — Read Cutover + Legacy Redirects

**Status:** COMPLETE. Approved 2026-07-11 with one refinement (retain `?type=` on canonical URLs until at least M8); implemented per `docs/m5-implementation-plan-2026-07.md` and verified — every V0–V15 criterion passed, see `docs/m5-verification-evidence-2026-07.md`. Commits `7a4dbdf`, `c78f8ee`, `a2b7817` + evidence. M5.1 (display-join parity) remains open as its own future change set.

Re-derived 2026-07-11 from the current repository (including the uncommitted working tree), the migration SQL history (`…000000`–`…000005`), the approved M0–M4 documents, and live-schema facts established during M4. Where this review's scope differs from the original plan's implied breadth, the difference is stated and justified (§0.2) — per the instruction to shrink M5 if the repository supports it.

**Spec authority (verbatim, §12 phase 5):** "Objective: profile.id becomes the identity the app presents — routing, all link generation, ProfileScreen single query, Discover (which is also what makes unclaimed profiles discoverable at all). Ships the shared profile-resolution module: one platform-wide resolution path. Legacy user-id URLs fall through to a permanent redirect shim. Prerequisites: M3 + M4. Risk: graceful — a missed call site emits a legacy URL that still redirects. **Done when: no code path generates a user-id profile URL; legacy URLs redirect correctly for multi-type users.**"

---

## 0. Scope, re-derived

### 0.1 What M5 is

M5 changes **what identity the app presents and navigates by**: the `/profile/:id` route param becomes `profiles.id`; every link generator emits `profiles.id` URLs; ProfileScreen resolves by `profiles.id` with a permanent redirect shim for legacy user-id URLs; Discover surfaces (and links) profiles by `profiles.id`, which is what makes unclaimed profiles navigable at all. It is **code-only**: no schema change, no RLS change, no data migration, no change to `resolveProfileId()`.

### 0.2 Scope reduction — three cuts from the plan's implied breadth

The milestone table's phrase "all … public queries on profile.id" reads broader than what the spec's own M5 objective, risk line, and exit criteria require. Re-deriving from the current tree:

1. **Display-data joins are deferred out of M5** into a separate follow-up read pass ("M5.1 — display-join parity", §7). The codebase has ~10 sites that resolve a legacy FK to a `profiles` row purely to *display* it (EventScreen lineup/application cards, VenueDashboard applicant cards, ArtistDashboard venue names, the three dashboards' following lists, MyScene's followed-profiles map). None of them generates a URL semantics problem, none breaks before M8 (the legacy columns they join on exist until contract), and every one keeps producing identical output throughout M5–M7. Cutting them over is mechanical (`*_profile_id` join with per-row legacy fallback) but touches many files for zero observable change — bundling them into M5 would triple its diff while adding nothing to the exit criteria. They must land before M8, not before M6.
2. **Account-scoped reads are permanently out** (not deferred — never in scope). Everything keyed on the session's own `auth.uid()` — dashboards' own-profile/own-rows fetches, own applications/enquiries/availability, notifications, follow rows as *follower*, `events.host_id` management reads — is the spec's "self-scoped reads" carve-out and the attribution split's "auth stays account-based". Full classification in §1.
3. **`applications` display joins cannot cut over at all** — the table has no `*_profile_id` columns (outside the M1 five-table set; deferred to the Booking architecture review). Its `artist_id` account-keyed join survives M8 unchanged. Not an M5 gap; a recorded architectural boundary.

What stays *in* M5, beyond the obvious: **ProfileScreen's unclaimed-state UI re-key** (§2.1, step D). M3 documented that the promoted-unclaimed profile renders without its UNCLAIMED badge/claim CTA because that UI is gated on "which table answered" (`isPlaceholder`), and deferred the fix "for its own separate task." M5 *is* that task: dropping the placeholder fallback makes `isPlaceholder` permanently false, so without the re-key the entire claim UI (committed in `a717738`) becomes dead code. Re-keying it to `claim_status`/`user_id IS NULL` is not new scope — it is the only way M5 doesn't silently delete an existing feature.

### 0.3 One pre-implementation verification item (V0)

`DiscoverScreen` filters `.neq('is_live', false)`. Under PostgREST/SQL semantics, rows with `is_live IS NULL` fail that filter and are invisible in Discover. The M3 promotion insert did not set `is_live`, so whether the promoted unclaimed profile currently appears in Discover depends on the column's default (unknown from the repo; a live check was attempted but the dashboard tab hung — carried as V0 in §5). **Either outcome is handled by the same M5 change** (§2.2): the filter becomes explicitly "live or unstated" (`is_live IS NULL OR is_live = true` semantics), which is behaviour-preserving for every currently-visible row and makes NULL-flagged rows (including any future promoted profiles) visible by default.

---

## 1. Read Cutover Inventory

Every read path in `v2/src` that touches a legacy identity column, classified. "Legacy field" = what it reads today; "replacement" = what it reads/emits after M5 (or why it doesn't change).

### 1.1 IN M5 — routing and link generation (the "no user-id URLs" exit criterion)

| # | File / function | Legacy field used | Replacement | Kind | Risk |
|---|---|---|---|---|---|
| L1 | `App.jsx:129` route `/profile/:id` | `:id` = account `user_id` (with M3's id-fallback) | `:id` = `profiles.id` canonical; legacy values handled by shim | routing | High (semantic pivot — everything below hangs off it) |
| L2 | `components/PortraitCard.jsx:21` default click | `p.user_id` → URL | `p.id` → URL (callers' selects must include `id`); fallback `p.user_id` URL → shim | direct | Medium (shared: Discover grid + MyScene discover strip) |
| L3 | `components/ProfileCard.jsx:34` click | `item.user_id` → URL | `item.id` → URL | direct | Medium (Discover search results) |
| L4 | `screens/ApplicationsScreen.jsx:126` card click | `app.artist_id` → URL | applicant profile's `id` (the profile map at :37–39 already fetches the row; add `id` to its select) | join-derived | Low |
| L5 | `components/EnquiryCard.jsx:268` click | `enq.applicant_user_id` → URL | `enq.applicant_profile_id` (carried on the enquiry row) ?? fetched profile's `id` (line 87 fetches `*`, already has it); fallback legacy URL → shim | direct | Low |
| L6 | `screens/EventScreen.jsx:1459` SlotCard click | `claim.user_id` (= `lineup_members.artist_id`) → URL | `lineup_members.artist_profile_id` (add to the :56 select) ?? fallback legacy URL → shim | direct | Medium (NULL `artist_profile_id` rows exist by design — fallback is load-bearing) |
| L7 | `screens/MySceneScreen.jsx:814` dayArtists click | `a.user_id` → URL | `a.id` (the :390 avatar/profile fetch adds `id`) ?? fallback legacy URL | join-derived | Low |
| L8 | `components/DashboardHeader.jsx:23` "view profile" | `userId` prop → URL | own profile row's `id` (every dashboard already fetches its own `profiles` row with `*`) | direct | Low (self-link) |
| L9 | `screens/ArtistDashboard.jsx:66`, `screens/PerformerDashboard.jsx:12,24` `profilePath(id)` | builds `/profile/<user_id>?type=` | builds `/profile/<profile.id>` (type param no longer needed for canonical ids; harmless if kept) | direct | Low (self-links) |

Exit-criterion sweep: after L1–L9, a repo-wide grep for `/profile/${` must show every interpolation sourced from a `profiles.id` (or an explicit documented legacy-fallback branch). That grep is the "no code path generates a user-id profile URL" check.

### 1.2 IN M5 — ProfileScreen resolution + downstream reads + redirect shim

| # | File / function | Legacy field used | Replacement | Kind | Risk |
|---|---|---|---|---|---|
| P1 | `ProfileScreen.jsx:72` step-1 lookup | `profiles.user_id = :id` (first), `id` fallback second | **Inverted**: `profiles.id = :id` first (canonical); `user_id = :id` second = legacy hit → **redirect** (§2.1) | direct | High |
| P2 | `ProfileScreen.jsx:100–117` placeholder fallback | `placeholder_profiles.id = :id` | **Removed** (§2.1 step C) — the only `placeholder_profiles` read in the app | direct | Low (zero unpromoted rows exist) |
| P3 | `ProfileScreen.jsx:86` venue events | `events.host_id = :id` | `events.venue_profile_id = profile.id` (the attribution split's read side; 24/24 parity verified in M3, maintained by M2 dual-writes) | direct | Medium |
| P4 | `ProfileScreen.jsx:89,110` performer gigs | `lineup_members.artist_id = :id` | compatibility read: `artist_id = profile.user_id` **OR** `artist_profile_id = profile.id` (user_id leg skipped when NULL) | direct | Medium |
| P5 | `ProfileScreen.jsx:510` availability sheet | `venue_availability.user_id = :id` | `venue_availability.profile_id = profile.id` (25/25 backfilled; dual-written since M2) | direct | Low (non-owners get 0 rows regardless — F2, unchanged) |
| P6 | `ProfileScreen.jsx:511` availability events overlay | `events.host_id = :id` | `events.venue_profile_id = profile.id` (same as P3) | direct | Low |
| P7 | `ProfileScreen.jsx:143,195–232` follow state / doFollow / unfollow keying | `entity_id = :id` (route param) | **source change, not column change**: key on `profile.user_id` for claimed targets (byte-identical values to today) and `profile.id` for unclaimed targets; state read checks `target_profile_id = profile.id` OR the legacy `entity_id` value | direct | **High** (see §2.1 step E — the one place route-semantics change forces touching write *derivation*) |
| P8 | `ProfileScreen.jsx:162–177` sendEnquiry venue keying | `venue_user_id: :id` (route param) | `venue_user_id: profile.user_id` (same value today; correct NULL for unclaimed venues), `venue_profile_id: profile.id` (already dual-written post-F1) | direct | Low |

### 1.3 DEFERRED to M5.1 (display-join parity — before M8, not before M6)

All joins of the shape "legacy FK list → `profiles` by `user_id` for card display." Identical output today and until M8; each gains a `*_profile_id`-primary / legacy-fallback join in M5.1:

| # | File | Legacy join | Future key |
|---|---|---|---|
| J1 | `EventScreen.jsx:85` slot socials | `artist_id`s → `profiles.user_id` | `artist_profile_id` → `profiles.id` |
| J2 | `EventScreen.jsx:108–111` memberProfiles | same | same (fallback critical: `artist_profile_id` legitimately NULL on some rows) |
| J3 | `EventScreen.jsx:156–158` appProfiles | `applications.artist_id` → `profiles.user_id` | **no profile column exists** — stays account-joined until the Booking review (permanent boundary, §0.2.3) |
| J4 | `ApplicationsScreen.jsx:37–39` applicant profiles | same as J3 | same as J3 |
| J5 | `VenueDashboard.jsx:63–70` applicantProfileMap | `applicant_user_id` (+type key) → `profiles.user_id` | `applicant_profile_id` → `profiles.id` |
| J6 | `ArtistDashboard.jsx:139–146` offer venue names | `venue_user_id` → `profiles.user_id` | `venue_profile_id` → `profiles.id` |
| J7 | `MySceneScreen.jsx:128,138–150,195` followProfiles + avatars | `follows.entity_id` → `profiles.user_id` | `follows.target_profile_id` → `profiles.id` (5/5 backfilled; dual-written) |
| J8 | `ArtistDashboard.jsx:158–162`, `HostDashboard.jsx:171–175`, `VenueDashboard.jsx:150–154` following lists | same as J7 | same as J7 |
| J9 | `HostDashboard.jsx:96–99,122–125` application/lineup artist joins | `artist_id` → `profiles.user_id` | J3-style for applications; `artist_profile_id` for lineup |

### 1.4 PERMANENTLY OUT — account-scoped reads (spec carve-outs; no change in any milestone)

- Own-profile fetches: `ArtistDashboard.jsx:91`, `HostDashboard.jsx:53`, `VenueDashboard.jsx:54`, `ArtistProfileScreen.jsx:138`, `BandProfileScreen.jsx:105`, `HostProfileScreen.jsx:120`, `StandupProfileScreen.jsx:94`, `VenueProfileScreen.jsx:105`, `ProfileEditScreen.jsx:35`, `IndustryScreen.jsx:24`, `App.jsx:71`, `RoleSelectorScreen.jsx:122`, `IndustryPanel.jsx:14`, `MySceneScreen.jsx:118`, `EventScreen.jsx:1112`, `ProfileScreen.jsx:150–153,201–208` (enquiry/follow pickers listing own profiles).
- Own-rows reads: applications (`ArtistDashboard.jsx:92`, `MySceneScreen.jsx:116`, `EventScreen.jsx:1106`, `notifActions.js:12,34`), lineup (`ArtistDashboard.jsx:93`, `MySceneScreen.jsx:119`), enquiries as applicant (`ArtistDashboard.jsx:115–118,137–138`), venue availability manage (`VenueDashboard.jsx:55,106`, `AvailabilitySection.jsx:22,32` — artist/band/standup tables), notifications (`App.jsx:69`, `NotificationsScreen.jsx:19`, `NotifPanel.jsx:22`), personal events (`MySceneScreen.jsx:120`).
- Follower-side follow reads/writes keyed on `session.user.id`: `ProfileScreen.jsx:143,195`, `EventScreen.jsx:134,194,1234,1399,1403` (the *entity* value for SlotCard follows is `claim.user_id`, consistent with that site's own write key — untouched until M6/M8), `WhatsOnScreen.jsx:90–104` (event likes), `MySceneScreen.jsx:115`.
- Event management via `events.host_id = auth.uid()`: `HostDashboard.jsx:55,90,116`, `VenueDashboard.jsx:58`, `MySceneScreen.jsx:117` — the attribution split's permanent auth column.

This classification is exhaustive against a full-tree grep for `user_id` / `host_id` / `artist_id` / `venue_user_id` / `applicant_user_id` / `entity_id` in query builders and for `/profile/` in navigation (2026-07-11, current working tree including uncommitted feature work).

---

## 2. Cutover Strategy (per screen/feature)

### 2.1 ProfileScreen — the resolver and the shim

**Current behaviour:** `/profile/:id` treats `:id` as an account id: `profiles.user_id = :id` (with type-precedence filters), falling back to `profiles.id = :id` (M3 compatibility), falling back to `placeholder_profiles.id = :id`. Downstream events/availability reads key on the raw `:id` as if it were an account id. The unclaimed badge/claim CTA render only on the placeholder branch.

**Proposed (the shared resolution module, consumed only by ProfileScreen for now):**
- **A — canonical first:** `profiles.id = :id` (with the same type-precedence filters applied). Hit → render. This is today's step 1b promoted to step 1; for every URL the app *itself* generates post-M5, this is the only query that runs — the spec's "ProfileScreen single query".
- **B — legacy shim:** miss → `profiles.user_id = :id` with the *byte-identical* filter/precedence chain used today (`?type=` respected; `prefer=performer` respected; `neq punter` default). Hit → `navigate(/profile/<found.id> + preserved params, { replace: true })`. Permanent infrastructure, never removed (spec). The multi-type guarantee holds because the precedence chain is unchanged: a legacy URL resolves to exactly the profile today's screen would have shown, then redirects to that row's id.
- **C — placeholder fallback removed.** Zero unpromoted `placeholder_profiles` rows exist (M3 promoted the only one; its id now resolves at step A). Post-M5, staging rows are not publicly navigable — which is spec §15 S1's stated end-state, arriving early with zero current-data impact. This deletes the app's only `placeholder_profiles` read.
- **D — unclaimed UI re-key:** the badge/CTA/hero-fallback blocks currently gated on `isPlaceholder` re-key to the loaded row's state (`user_id IS NULL` / `claim_status !== 'claimed'`). Result: the promoted unclaimed profile — which today renders indistinguishable from claimed (M3's accepted gap) — correctly shows UNCLAIMED + "Is this you?" ClaimDialog. This is the only intentional visual change in M5.
- **Downstream reads** (P3–P6): venue events by `venue_profile_id = profile.id`; performer gigs by `artist_id = profile.user_id OR artist_profile_id = profile.id` (compatibility read, user_id leg omitted when NULL); availability by `profile_id = profile.id`. For every profile reachable today these return provably identical sets (M3's zero-mismatch parity + M2/F1 dual-writes keep the columns in lockstep). For unclaimed profiles they return *more* than today (their Studio-linked gigs become visible instead of always-empty) — intended, spec §2's whole point.
- **E — follow/enquiry keying** (P7–P8): these two write paths derive identity values *from the route param*, so the param's semantic change forces re-derivation — from the loaded `profile` row instead. For claimed targets the derived values are byte-identical to today (`profile.user_id` = today's `:id`), so no write-shape or keyspace change occurs. For unclaimed targets, `entity_id` gets `profile.id` (the pre-existing Step-A mixed-keyspace convention `target_profile_id` was built to heal; the row also carries `target_profile_id = profile.id`, which is the column that matters from M5 on) — this un-breaks Follow on unclaimed profiles at the data layer, though the button's overall success remains subject to the pre-existing `entity_type: 'profile'` CHECK bug (logged, explicitly not fixed here). The follow-*state* read checks `target_profile_id = profile.id` OR the legacy `entity_id` value, so pre-M5 follow rows still light the button. **This is not write cutover:** the columns written are unchanged; only the source of the values moves from the URL to the resolved row.

**Compatibility reads required:** yes, two, both temporary until M8: the P4 two-leg gig read, and the P7 two-leg follow-state read. The B-step shim is permanent by design, not a compatibility read.

### 2.2 DiscoverScreen — id in the payload, unclaimed included

**Current:** both queries select `user_id, name, type, …` **without `id`**; cards render via `PortraitCard`/`ProfileCard`, whose click handlers navigate to `/profile/<user_id>`. Consequences today: (a) all discover navigation runs on legacy URLs; (b) an unclaimed profile — `user_id` NULL — would navigate to `/profile/undefined` if it appeared; (c) per V0, it may not even appear (the `.neq('is_live', false)` NULL trap).

**Proposed:** add `id` (and `user_id`, kept for nothing but the transitional fallback) to both selects; the `is_live` filter becomes "not explicitly false" (NULL passes); cards navigate by `id`. Key stability: React keys switch from `user_id` (which is NULL for unclaimed — already a latent duplicate-key source, and DiscoverScreen has a known duplicate-key console warning) to `id`, which is always present and unique.

**Why behaviour is unchanged** for everything visible today: same rows (every currently-visible row has `is_live` not-false and still passes), same cards, same destination *screens* — the URL value changes but resolves to the same profile via step A. New behaviour, intended: unclaimed profiles become discoverable and navigable — the spec's headline for this milestone.

### 2.3 Shared cards — PortraitCard, ProfileCard

Default click handlers prefer `p.id`/`item.id`, falling back to the legacy `user_id` URL when `id` is absent (a caller not yet migrated) — the spec's graceful-degradation: a missed call site emits a legacy URL that still redirects. React keys move to `id ?? user_id`.

### 2.4 MySceneScreen — discover strip + dayArtists links (L7)

The `:390` profile fetch adds `id`; the `:814` click prefers `a.id`. The followed-profiles map (J7) is deferred to M5.1 — its display output is identical either way; only its *link* targets… it has no links today (following list is display-only in MyScene). No other change.

### 2.5 ApplicationsScreen / EnquiryCard / EventScreen SlotCard (L4–L6)

Each already has (or trivially gains) the applicant/artist profile row or the relationship row's `*_profile_id`; clicks emit `/profile/<profile.id>`. SlotCard's select adds `artist_profile_id`; rows where it is NULL (legitimately: pre-M2 offer-accepts, type-mismatch resolutions) fall back to the legacy URL → shim. Free-text lineup entries have no id of either kind and stay non-clickable (unchanged).

### 2.6 Dashboards' self-links (L8–L9)

`DashboardHeader`, `ArtistDashboard`/`PerformerDashboard` `profilePath` — swap the `userId` argument for the already-loaded own-profile row's `id`. Same destination profile, canonical URL. The `?type=` param becomes redundant on canonical URLs (an id names exactly one row) but is harmless; recommend dropping it at these sites for cleanliness.

### 2.7 Where legacy redirects are required, exactly, and why

One place: **ProfileScreen's step B**, covering every `/profile/<user_id>` URL that still arrives after M5: old bookmarks/shares (URLs are public, immortal, and were user-id-keyed for the app's whole life), any un-migrated or future call site that falls back to a legacy URL (L2/L5/L6/L7's fallback branches), and third-party links. No other route in the app embeds an identity (`/event/:id` keys on event ids; notification payloads carry account ids but no notification click-through navigates to a profile — verified by the link-generation sweep). The shim lives in the resolver, not in routing config, because disambiguating a multi-type legacy URL requires the same type-precedence query logic the screen already owns.

---

## 3. Compatibility Analysis

Per row/profile class, for each M5 read path:

- **Claimed profiles** — Step A finds them by id (canonical URLs); step B finds them by user_id and redirects (legacy URLs), with `?type=`/precedence reproducing today's disambiguation exactly. P3–P6 return provably identical sets (M3 parity + dual-write lockstep: every `venue_profile_id`/`artist_profile_id`/`profile_id` was verified to point at the same account the legacy FK names). P7/P8 derive byte-identical values to today's. **Nothing changes.**
- **Promoted-but-unclaimed profiles** — Step A finds them by id (they were reachable only via M3's fallback before; now they're first-class). Step B can never match them (`user_id` NULL matches no legacy URL — correct: no legacy URL for them ever existed). They gain: UNCLAIMED badge + claim CTA (D), lineup history via P4's profile-id leg, Discover presence + navigation (2.2). They correctly still confer no authorisation (M4's state-4 proof) and no owner-scoped features (F2's RLS posture unchanged).
- **Legacy rows** (relationship rows with NULL `*_profile_id`: free-text lineup entries, pre-M2 unresolved rows) — P4's `artist_id` leg still finds rows for claimed profiles; L6's fallback still links them via legacy URL; free-text rows stay non-clickable. **No row becomes less reachable than today.**
- **Placeholder rows** (`placeholder_profiles`) — post-M5, not navigable (fallback removed). Current impact: zero rows (the one row was promoted; its id resolves via `profiles`). Future unpromoted imports are Studio-internal until promotion — the spec's S1 boundary. Anything *linking* to a placeholder id would 404 — and nothing does (the app's only placeholder read is the one being deleted).
- **Multi-profile owners** — canonical URLs are unambiguous by construction (one id, one row) — this is the migration's core payoff. Legacy URLs disambiguate exactly as today (`?type=` honoured; default precedence unchanged) and then pin the result to an id via redirect, so a *shared* redirect result is stable forever after. The confirmed 5-type account and the punter+venue account are both named verification cases (§5).

---

## 4. Failure Semantics

| Failure | What is shown | Legacy fallback? | Screen errors? | NULL acceptable? |
|---|---|---|---|---|
| `:id` matches nothing in step A **or** B | "Profile not found." — today's exact copy and code path | B *is* the fallback; after both miss there is deliberately no third | No — the existing null-profile render | Yes — terminal not-found is correct |
| `:id` is an unpromoted placeholder id | "Profile not found." (changed from today's placeholder render; zero such ids exist or are linked anywhere) | None, by design (S1) | No | Yes |
| Legacy URL, `?type=` names a type the account lacks | Same as today: filter finds nothing at B → "Profile not found." (unchanged behaviour, inherited) | n/a | No | Yes |
| `profile.user_id` NULL (unclaimed) in P4/P7/P8 derivations | user_id legs are skipped; profile-id legs carry the query alone | The skip *is* the handling | No | Yes — expected state, not an error |
| Link site lacks a profile id (`artist_profile_id` NULL, un-migrated caller) | Click emits legacy `/profile/<user_id>` → shim redirects → correct profile | Yes — the shim, permanently | No | Yes — the spec's graceful path |
| Link site lacks both ids (free-text lineup) | Not clickable (unchanged) | n/a | No | Yes |
| `venue_availability` row with NULL `profile_id` under P5 | Invisible in the sheet | None (clean cut; zero such rows exist — verification query in §5) | No | Yes, given the zero count; the sheet is also already empty for all non-owners (F2, unchanged) |
| Discover row with NULL `id` | Cannot occur (`profiles.id` is NOT NULL PK); guard falls back to legacy URL anyway | Yes | No | n/a |
| Redirect loop risk | Impossible: B redirects only to a value that just resolved at A's own query shape; A hits on the next mount | n/a | n/a | n/a |

---

## 5. Verification Matrix

**V0 (pre-implementation, read-only):** confirm `profiles.is_live` distribution (`GROUP BY is_live`) and whether the promoted profile currently appears in Discover; confirm `venue_availability` has zero NULL-`profile_id` rows; confirm `placeholder_profiles` still has zero unpromoted-eligible rows. All three shape only wording/fallbacks, not the design.

**Manual verification (all must pass before M5 is committed).** Fixtures: the 5-type account M, Bellingen (punter+venue) V, a single-type artist A, the promoted unclaimed profile U (`86c431ff…`).

| # | Check | Before | Expected after |
|---|---|---|---|
| V1 | Canonical URL for each type: `/profile/<id>` for one artist, band, standup, host, venue profile | renders via M3 fallback (second query) | renders via first query; identical content; network tab shows **one** profiles lookup, by `id` |
| V2 | `/profile/<U.id>` | renders, but *without* badge/CTA, no gigs | renders **with** UNCLAIMED badge + "Is this you?" CTA (ClaimDialog opens); gigs linked via `artist_profile_id` appear (today: none exist — confirm section renders empty without error) |
| V3 | Legacy URL `/profile/<M.user_id>?type=artist` (and `?type=venue`, `?type=host`) | renders that typed profile | **redirects** to `/profile/<that profile's id>`, renders identically; URL bar shows canonical id |
| V4 | Legacy URL `/profile/<M.user_id>` with no type | renders first non-punter per precedence | redirects to the *same* profile's id (precedence unchanged), then renders |
| V5 | Legacy URL `/profile/<V.user_id>` (punter+venue account) | renders venue (punter excluded) | redirects to venue profile id |
| V6 | Discover: default grid + a search | cards navigate to `/profile/<user_id>` | cards navigate to `/profile/<id>` directly (no redirect hop in network/history); U appears in results and its card opens V2's page |
| V7 | Venue profile events + CHECK AVAILABILITY sheet (as owner) | events via `host_id`; dates via `user_id` | identical event list via `venue_profile_id`; identical dates via `profile_id` (owner session; non-owner emptiness is F2, unchanged) |
| V8 | Artist profile gigs (A, claimed) | via `artist_id = user_id` | identical list via the two-leg read |
| V9 | Follow/unfollow on A's profile (claimed target) | button toggles; row written with `entity_id = user_id` | identical, including the written values (inspect the follows row: same `entity_id`, same `target_profile_id`); state persists across reload via the two-leg state read; pre-M5 follow rows still show FOLLOWING |
| V10 | Follow on U (unclaimed target) | button present; insert fails silently (entity_type bug) | button present; row derivation uses `entity_id = U.id`, `target_profile_id = U.id`; insert still fails on the pre-existing entity_type CHECK (bug unchanged, explicitly out of scope) — verify no *new* error surfaces |
| V11 | Enquiry flow from A viewing V's venue profile (canonical URL) | writes `venue_user_id = route id` | writes `venue_user_id = V.user_id` (identical value), `venue_profile_id = V venue id`; row lands correctly |
| V12 | ApplicationsScreen card click; EnquiryCard click; EventScreen slot click; MyScene dayArtist click | navigate to `/profile/<user_id>` | navigate to `/profile/<profile.id>`; a NULL-`artist_profile_id` slot falls back to legacy URL and still lands via redirect |
| V13 | Dashboard "view profile" buttons (all five dashboard types) | legacy self-URL | canonical self-URL, same page |
| V14 | Unpromoted-placeholder URL (mint a fake uuid) | "Profile not found." today too (no such row) | "Profile not found." — and confirm no `placeholder_profiles` query fires (network tab) |
| V15 | Regression sweep: console clean of *new* errors on every touched screen; `grep -r "/profile/\${" v2/src` shows only id-sourced or documented-fallback interpolations; event-like buttons (WhatsOn/EventScreen) untouched and working | — | pass |

**Expected database reads after M5** (network-tab assertions): canonical profile hit = 1 `profiles?id=eq.…` + downstream reads keyed on `venue_profile_id`/`artist_profile_id`/`profile_id`/`user_id`-leg as designed; legacy hit = the same plus one preceding `profiles?user_id=eq.…` and a client redirect; zero `placeholder_profiles` requests anywhere.

---

## 6. Rollback

- **Code-only:** yes, entirely. M5 is a git revert of its commit(s). No schema, no RLS, no data migration, nothing to un-run in the database.
- **Database dependency:** none created. M5 *reads* columns that already exist (M1) and are already populated (M2/M3/F1); reverting simply stops reading them. The values M5's touched write-derivations produce for claimed targets are byte-identical to pre-M5, so rows written while M5 was live are indistinguishable from rows written before it — with one benign exception: follows created *on unclaimed profiles* while M5 was live carry `entity_id = profile.id`. Post-rollback code handles those URLs and rows correctly anyway, because the M3 id-fallback (which rollback restores) resolves profile-id routes, and the state read keyed on the route id matches those rows' `entity_id`.
- **The safety net is already deployed:** M3's id-fallback means canonical `/profile/<id>` URLs *minted during M5* keep resolving after a rollback. Rolling back does not strand any URL M5 put into the world.
- **Rollback stops being trivial at M6.** M6's write cutover consumes the shared resolution module and the canonical-id assumption M5 establishes; once M6 lands, reverting M5 means reverting M6 first (they're separate changes by the hard rules, so this stays *possible*, just no longer one revert). Secondary erosion, not a cliff: the longer M5 is live, the more canonical URLs exist in the wild — all covered by the M3 fallback after rollback, so this shifts UX (extra lookup path) rather than correctness. Hard floor, as always: M8.

---

## 7. Explicitly out of scope — documented separately, not smuggled in

- **M5.1 — display-join parity** (§1.3, J1–J2, J5–J9): its own read-only change set after M5 soaks; required before M8; J3/J4 excluded permanently pending the Booking review.
- **F2/F3/F4** (enquiry-feature RLS gaps, applicant-side updates, InviteSheet block): all unchanged by M5; V7 explicitly re-asserts F2's current emptiness for non-owners.
- **The `entity_type: 'profile'` follow CHECK bug**: unchanged (V10 proves M5 doesn't mask or worsen it). Fixing it remains its own task — note that post-M5 its natural fix (write the target's real type from the loaded profile row) becomes one line, but it is not taken here.
- **F5** (per-type availability tables lack `profile_id`): unaffected by M5 (those tables' reads are all self-scoped); still blocks M6/M8 as recorded.
- **DiscoverScreen duplicate-key console warning**: likely resolved as a side effect of keying by `id`, but not chased beyond that.
- **No new business rules**: unclaimed-profile visibility (badge, gigs, discoverability) is spec §2/§4/§7 behaviour arriving with its designed milestone, not a new rule.

## Open decisions for approval

1. **The M5 / M5.1 split** (§0.2.1) — approve deferring display-join parity, or fold J1–J2/J5–J9 into M5 for a single larger read milestone.
2. **Placeholder-fallback removal** (§2.1 C) — approve retiring public placeholder navigability now (zero current impact), or keep the fallback until M8 out of caution.
3. **Unclaimed UI re-key** (§2.1 D) — approve as part of M5 (recommended: without it, the claim feature becomes dead code), or defer and accept that M5 ships with the claim UI unreachable.
4. **Self-link `?type=` params** (§2.6) — drop or keep on canonical URLs (cosmetic).
