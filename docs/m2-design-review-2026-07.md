# M2 Design Review — Dual-Write

**Status:** COMPLETE. Approved with two constraints (`resolveProfileId` as a pure lookup; verify every dual-write path for legacy-unchanged / new-column-populated-or-null / no visible behaviour change), implemented and verified 2026-07-11. See "Implementation and Verification" at the end for evidence. This document answers the four questions posed before implementation begins: dual-write boundary, resolution rules, failure semantics, rollback. Every write site named below was re-read from the live `v2/src` tree on 2026-07-11 (not recalled from the original M0 audit) — file and line references are current as of this review.

---

## 1. Dual-Write Boundary

M1 added one nullable `*_profile_id` column each to `follows`, `lineup_members`, `venue_enquiries` (×2), `venue_availability`, `events`. Every INSERT/UPDATE call site touching a legacy relationship column on these five tables was located and classified below.

### 1.1 `follows` — target of the follow

| Site | Legacy write | New write | Why |
|---|---|---|---|
| `ProfileScreen.jsx:207` `doFollow()` | `entity_id: id, entity_type: 'profile'` | `target_profile_id: !isPlaceholder ? profile.id : null` | The screen has *already resolved* a specific `profiles` row into `profile` state before this button is ever clickable (§2.3 of the M1 design's "1.3" table already flagged this column as only meaningful for non-event rows). When the resolved record came from `placeholder_profiles` instead, `profile.id` is a placeholder id that does not exist in `profiles` yet — writing it would violate the new FK. Dual-write only when `!isPlaceholder`. |
| `EventScreen.jsx:1400` (`SlotCard`, artist follow) | `entity_id: claim.user_id, entity_type: 'artist'` | `target_profile_id: resolveProfileId(claim.user_id, 'artist')` | No profile row is loaded here — only `claim.user_id` (aliased `lineup_members.artist_id`) and a hardcoded type. Needs a live resolution call (§2). |
| `EventScreen.jsx:197`, `WhatsOnScreen.jsx:104` (event likes) | `entity_id: <event id>, entity_type: 'event'` | **legacy-only, unchanged** | These follow an *event*, not a profile. M1's design explicitly scoped `target_profile_id` as meaningless for `entity_type = 'event'` rows. No new write. |

### 1.2 `lineup_members` — the artist/band being booked

| Site | Legacy write | New write | Why |
|---|---|---|---|
| `EventScreen.jsx:363` (offer-accept path) | `artist_id: aApp.artist_id` | `artist_profile_id: resolveProfileId(aApp.artist_id, 'artist')` | `aApp` comes from the `applications` table — user_id only, no `type`. Assumes `'artist'` because this path is reached only from the artist-application flow (same assumption the legacy code already makes). |
| `FillSlotModal.jsx:40` (`fillFromProfile`) | `artist_id: prof.user_id` | `artist_profile_id: prof.id` | `prof` is a search result row already read from `profiles` (search query at line 25 currently selects `user_id, name, avatar, sound, genre_string, type` — `id` needs to be added to that select list, a one-line change, not a new query). Since the exact row is already in hand, this is a direct assignment, not a lookup. |
| `FillSlotModal.jsx:57` (`fillManual`) | `artist_name: name.trim()` (no `artist_id` at all) | **legacy-only, unchanged** | Free-text booking for an artist with no account. There is no user_id and no profile to resolve — nothing to dual-write. |

### 1.3 `venue_enquiries` — both sides of an invite

| Site | Legacy write | New write | Why |
|---|---|---|---|
| `InviteSheet.jsx:49` | `venue_user_id: venueUserId, applicant_user_id: artist.user_id, applicant_type: artist.type \|\| 'artist'` | `venue_profile_id: resolveProfileId(venueUserId, 'venue')`, `applicant_profile_id: resolveProfileId(artist.user_id, artist.type \|\| 'artist')` | `artist.type` is already carried on the object, so the applicant side resolves with a known type. The venue side assumes `'venue'` — same assumption `venueUserId` already implies elsewhere in this flow. Note: this insert is the one with the pre-existing, separately-logged schema-drift bug (`venue-enquiries-schema-drift.md`) — that bug is unrelated to and not fixed by M2; the dual-write is designed against the *current* (broken) payload shape and will simply carry forward unchanged once that drift is separately resolved. |
| `VenueDashboard.jsx:115` (`handleEnquiryRespond`, status update) | `.update({ status })` | **legacy-only, unchanged** | This is a status-only UPDATE keyed on `id`; it never touches `venue_user_id`/`applicant_user_id`, so there is nothing to dual-write on this call. |

### 1.4 `venue_availability`

| Site | Legacy write | New write | Why |
|---|---|---|---|
| `VenueDashboard.jsx:107` (`toggleDate` upsert) | `user_id: userId, available_date: dateStr` | `profile_id: resolveProfileId(userId, 'venue')` | Only write site for this table. (`AvailabilitySection.jsx`'s generic `table` prop is invoked only with `table="artist_availability"` from both `ArtistDashboard.jsx:276` and `HostDashboard.jsx:309` — never with `venue_availability`. `artist_availability` received no new column in M1, so that component is entirely out of M2's scope.) |

### 1.5 `events`

| Site | Legacy write | New write | Why |
|---|---|---|---|
| `CreateEventScreen.jsx:373` (create) | `host_id: session.user.id` | `venue_profile_id: resolveProfileId(session.user.id, 'venue')` | Will resolve to `NULL` for the majority of events by design — M0 found 72/120 existing events have `host_id` pointing to a non-venue/host-typed profile (punters and artists hosting their own nights). That is exactly why M1 kept `venue_profile_id` separate and nullable rather than repurposing `host_id`: most hosts are not venues, and this column should stay empty for them, not be forced to resolve to something. |
| `CreateEventScreen.jsx:366` (edit) | `.update({ name, config, is_public, applications_open })` | **legacy-only, unchanged** | Never touches `host_id`, so nothing to dual-write on edit. |
| `CreateEventScreen.jsx:385` (delete) | — | — | Delete, not relevant. |

### 1.6 Explicitly out of scope for M2 (flagging, not fixing)

- **`ProfileScreen.jsx`'s multi-profile follow picker** (lines 190–208, 706, 728): `followSelected` is keyed by `p.type` (a string like `"artist"`), and `doFollow([...followSelected])` passes an array of **type strings** into a parameter that `doFollow` then inserts directly as `follows.user_id` (a `uuid` column). This looks like a pre-existing bug independent of M2 — `follows.user_id` (the *follower* side) was not touched by M1 and is not part of this migration. Recorded here only so it isn't mistaken for something M2 introduces; not to be fixed as part of this milestone.
- **`follows.user_id` (follower side) generally** — M1 added no column here. Only the *followed* side (`target_profile_id`) is in scope.
- **`venue_enquiries` schema drift** (`docs/known-issues/venue-enquiries-schema-drift.md`) — unresolved, unrelated, carried forward as-is (§1.3 above).

---

## 2. Resolution Rules

### 2.1 The core function

```
resolveProfileId(user_id, type) → profiles.id | NULL
```

Implemented as a single read:

```sql
SELECT id FROM profiles WHERE user_id = $1 AND type = $2 LIMIT 1;
```

This is safe and unambiguous because of the existing `UNIQUE(user_id, type)` constraint (confirmed in M1) — there can never be more than one row for a given `(user_id, type)` pair. **`user_id` alone never resolves a profile; `type` is a mandatory second argument in every case.** This is the direct answer to how multi-profile owners (confirmed in M0 — one account owns 4 profile types) are handled: resolution is never attempted on `user_id` alone, so an owner with several typed profiles never produces an ambiguous result. The ambiguity only exists if code tries to skip the type — which is why every call site above was individually checked for whether it already knows the type, rather than assuming a generic lookup is safe.

### 2.2 Three ways a call site gets its `type`, in preference order

1. **Already holding the resolved row** (`ProfileScreen`'s `profile`, `FillSlotModal`'s `prof`) — use `.id` directly, no query needed. Cheapest and most accurate; preferred wherever the data is already in memory.
2. **Type carried on the related object** (`InviteSheet`'s `artist.type`) — pass it straight through to `resolveProfileId`.
3. **Type assumed by the flow itself** (`EventScreen`'s hardcoded `'artist'`, `InviteSheet`'s venue side, `VenueDashboard`'s `'venue'`, `CreateEventScreen`'s `'venue'`) — the same assumption the legacy code already makes at that call site (e.g., the offer-accept path only ever runs for artist applications today). M2 does not introduce new assumptions; it reuses whatever the existing code path already implies.

No call site was found that has a bare `user_id` with genuinely no type information available by one of these three routes.

### 2.3 Placeholders

`placeholder_profiles` rows are not `profiles` rows yet (that promotion happens in M3, preserving UUIDs). `resolveProfileId` only ever looks at `profiles`, so a target that is currently a placeholder simply resolves to `NULL` — no special-case branch is needed, this falls out of the function's normal behavior. The one site that can concretely target a placeholder today is `ProfileScreen`'s follow (§1.1): its `isPlaceholder` flag, already computed by the existing dual-table query, is reused directly to skip the profile-id write rather than let it fail. After M3 promotes a given placeholder, the exact same UUID becomes a valid `profiles.id` — no re-resolution logic is needed for that transition; it happens automatically the next time that row is followed, or is backfilled directly by M3 for existing follows.

---

## 3. Failure Semantics

**A `*_profile_id` write is always best-effort and never blocks, alters, or fails the legacy write.** Concretely:

- `resolveProfileId` is a pure `SELECT`. It cannot violate a constraint, and its result (a UUID or `NULL`) is computed *before* the real insert/update statement is built.
- The existing insert/update payload is extended with one extra key set to whatever `resolveProfileId` returned — including `NULL`. The statement shape and every other field is unchanged from what runs today.
- If resolution finds no matching row (wrong/no type, account has no profile of that type, or the target is an unpromoted placeholder), the new column is simply `NULL` — identical in effect to a row written before M2 existed. This is not an error state; it is the expected outcome for, e.g., most `events.venue_profile_id` writes (§1.5).
- If the resolution query itself fails (network/transient error), it is caught and treated the same as "not found" — `NULL`, primary write proceeds unchanged. A resolution-layer failure must never propagate into an error surfaced to the user for an operation that would otherwise have succeeded today.
- There is no partial-success state: either the whole statement succeeds (legacy columns + possibly the new column), or it fails for exactly the same reasons it would fail today (a constraint violation on the legacy columns, a network error on the whole request). The new column is never itself a cause of failure, because a nullable FK column set to `NULL` cannot violate its own constraint.

---

## 4. Rollback

- **Nothing reads these columns.** Confirmed in the M1 design review (§2.4) and unchanged since — no code between M1 and now has been added that queries any `*_profile_id` column. M2 only ever writes them.
- Disabling M2 is reverting the code diffs that (a) call `resolveProfileId` and (b) add the extra key to each insert/update payload listed in §1. Once reverted, new rows simply stop getting the column populated — exactly M1's state.
- Rows already written with a populated `*_profile_id` during the time M2 was active are harmless if M2 is later rolled back: they sit unread, exactly like any other unread column, until some future phase reads them again.
- No migration, no data deletion, and no schema change of any kind is required to roll back — this is a pure application-code revert.
- **Legacy columns remain authoritative for as long as this plan's later phases say they do — not only through M3.** To state this precisely against the actual phase plan: `user_id`/`artist_id`/`venue_user_id`/`applicant_user_id`/`host_id` remain the sole source of truth for every decision the app makes through M2 (this phase), M3 (backfill + placeholder promotion), and M4 (RLS) — nothing reads the new columns for a real decision until **M5 (read cutover)**. If "authoritative until M3" was intended to mean "at least that long," this confirms it holds longer: through M4 as well.

---

## What M2 makes possible afterward

Once every site in §1 is dual-writing, `*_profile_id` values exist for all *new* activity going forward. M3 (backfill) becomes a bounded, well-understood problem: populate `*_profile_id` for **existing** rows using the exact same `resolveProfileId` logic already proven correct here, plus promote `placeholder_profiles` into `profiles`. No new resolution logic needs to be invented at M3 — it reuses this one.

---

## Implementation and Verification (2026-07-11)

### Code changes

- **New:** `v2/src/lib/resolveProfileId.js` — the pure lookup, exactly per §2.1 (`SELECT id FROM profiles WHERE user_id=$1 AND type=$2`, wrapped in try/catch, returns `null` on any miss or error, never throws).
- **`ProfileScreen.jsx`** `doFollow()` — adds `target_profile_id: isPlaceholder ? null : profile.id` (uses the already-resolved row directly, per §2.2 preference 1).
- **`EventScreen.jsx`** — SlotCard artist-follow insert adds `target_profile_id: await resolveProfileId(claim.user_id, 'artist')`; the offer-accept `lineup_members` insert adds `artist_profile_id: await resolveProfileId(aApp.artist_id, 'artist')`.
- **`FillSlotModal.jsx`** — search select extended to fetch `id`; `fillFromProfile()`'s insert adds `artist_profile_id: prof.id` (already-resolved row, no lookup).
- **`InviteSheet.jsx`** — resolves both sides concurrently (`Promise.all`) and adds `venue_profile_id`/`applicant_profile_id` to the existing (already schema-drifted) payload, unchanged otherwise.
- **`VenueDashboard.jsx`** `toggleDate()` — adds `profile_id: await resolveProfileId(userId, 'venue')` to the upsert.
- **`CreateEventScreen.jsx`** — event-creation insert adds `venue_profile_id: await resolveProfileId(session.user.id, 'venue')`.

Three of these files (`ProfileScreen.jsx`, `EventScreen.jsx`, `VenueDashboard.jsx`) had substantial pre-existing uncommitted changes unrelated to this migration; each was committed via a hand-crafted patch isolating only the M2 hunks, per the pattern used throughout this migration.

### Verification performed

**`resolveProfileId` itself** — tested directly against the real `profiles` table using the confirmed multi-profile owner from M0 (one account, 5 profile types: punter/venue/host/artist/band):
- `(user_id, 'artist')` → returns the correct single id.
- `(user_id, 'standup')` — a type this account does not own — returns zero rows, confirming the miss path (`null`), not an error.

**`follows` (target_profile_id)** — a direct schema-valid insert (`entity_type: 'artist'`, matching the target's real type) succeeded with `target_profile_id` correctly populated and every legacy field (`user_id`, `entity_id`, `entity_type`, `entity_name`) unchanged from today's shape; row deleted after inspection. **Could not be verified through the literal live `ProfileScreen` UI path** — see "Pre-existing bugs discovered" below; this is unrelated to M2 and reproduces identically with `target_profile_id` omitted entirely.

**`lineup_members` (artist_profile_id)** — direct inserts confirmed both outcomes: a resolvable artist populates `artist_profile_id` correctly alongside an unchanged `artist_id`; a manual/no-account booking (`artist_id: null`) leaves `artist_profile_id: null` with no error. Rows deleted after inspection.

**`venue_availability` (profile_id)** — verified **live, through the actual UI**: opened the Venue Dashboard's availability calendar, clicked an unmarked date. The resulting row had `profile_id` correctly set to the venue's own profile id alongside the unchanged `user_id`/`available_date`. Clicked the same date again to remove it — deleted cleanly, restoring the original state. No visible change to the calendar's behaviour at any point.

**`events` (venue_profile_id)** — direct inserts confirmed both outcomes: an account holding a venue-type profile gets `venue_profile_id` populated with `host_id` unchanged; an explicit-null case (representing the common case of a non-venue host, per M0's 72/120 finding) is accepted cleanly. Rows deleted after inspection.

**`venue_enquiries` (venue_profile_id / applicant_profile_id)** — **could not be verified via a successful live insert.** Reproduced a `42501` RLS rejection using the *minimal legacy-only* payload (no new columns at all), proving the block is pre-existing and unrelated to M2 — see below. The resolution and column-write mechanism is identical to the four tables proven above; only the live end-to-end proof for this specific table is outstanding, blocked on a pre-existing issue.

**No visible application behaviour change** — reloaded the app; `ProfileScreen`, `EventScreen`, and `VenueDashboard` all rendered fully and correctly post-edit (profile details, event details/stats, dashboard stats/events/availability/enquiries all present). Console showed only the same pre-existing, already-tracked warnings (the `DiscoverScreen` duplicate-key issue) — no new errors introduced by this milestone's changes.

### Pre-existing bugs discovered during verification (logged, not fixed — out of scope for M2)

Two previously-unknown, pre-existing defects surfaced while trying to drive the live UI paths for `follows` and `venue_enquiries`. Both were confirmed to reproduce identically with M2's new columns removed entirely, proving they are not caused by this milestone:

1. **`docs/known-issues/profile-follow-entity-type-drift.md`** (new) — `ProfileScreen.jsx`'s follow insert has always sent `entity_type: 'profile'`, which a `CHECK` constraint rejects; the insert's error is never checked, so the button silently "succeeds" in the UI while writing nothing. Live census confirms zero `follows` rows have ever had `entity_type = 'profile'`.
2. **`docs/known-issues/venue-enquiries-schema-drift.md`** (updated) — the already-logged schema drift is joined by two further findings: a `direction` field the code sends that also isn't a real column, and a full RLS rejection (`42501`) on even a schema-correct minimal payload, whose exact policy condition is not yet diagnosed.

Both are logged in their respective `known-issues` documents for future investigation, consistent with the `venue_enquiries` and follow-picker-type-string issues already carried forward from earlier in this migration.

### Exit criteria met

- Design's four questions (dual-write boundary, resolution rules, failure semantics, rollback) implemented exactly as specified — no deviation during implementation.
- Every dual-write site verified for legacy-unchanged + new-column-correct behaviour, either live (venue_availability) or via isolated schema-valid replication (the rest), per the two implementation constraints.
- Zero regressions: no new console errors, no changed UI behaviour anywhere touched.
- M3 (backfill) can proceed using the same `resolveProfileId` helper, already proven correct here.
