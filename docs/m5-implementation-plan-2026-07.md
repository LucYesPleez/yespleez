# M5 Implementation Plan — Read Cutover + Legacy Redirects

**Status:** EXECUTED 2026-07-11 as approved. One deviation discovered mid-execution and documented in the commit/evidence: MyScene's dayArtists links (L7) needed no HEAD hunk — that navigation is part of the in-flight uncommitted feature work, adjusted in the working tree instead. Dead `profilePath` config was deleted rather than migrated. V0 results and the full verification record: `docs/m5-verification-evidence-2026-07.md`.

**Approval decisions incorporated:**
1. M5 / M5.1 split — this plan covers M5 only; display-join parity (J1–J2, J5–J9) is a separate later change set.
2. Placeholder data-source fallback retired (ProfileScreen's `placeholder_profiles` read deleted).
3. Claim UI re-keyed from `isPlaceholder` to `claim_status`.
4. ProfileScreen's follow/enquiry write values re-derived from the loaded profile row, not the route param.
5. Discover `is_live` pre-flight performed before implementation (§0).
6. **Refinement: `?type=` is retained on canonical profile URLs.** Specified in §1.

---

## 0. Pre-flight (V0) — run immediately before Step 1, read-only

Three queries against the live database (SQL editor). The first run was attempted during the design review but the dashboard hung; results must be captured before implementation begins.

```sql
-- V0a: is_live distribution (Discover visibility semantics)
SELECT coalesce(is_live::text, 'NULL') AS is_live, count(*),
       count(*) FILTER (WHERE user_id IS NULL) AS unclaimed_rows
FROM profiles GROUP BY 1 ORDER BY 1;

-- V0b: venue_availability rows a profile_id-keyed read would miss
SELECT count(*) FROM venue_availability WHERE profile_id IS NULL;

-- V0c: unpromoted placeholder rows (impact of retiring the fallback)
SELECT count(*) FROM placeholder_profiles pp
WHERE pp.merged_to IS NULL AND pp.is_duplicate = false
  AND pp.blocklisted = false AND pp.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = pp.id);
```

**Decision table:**

| Result | Consequence for the plan |
|---|---|
| V0a: unclaimed row has `is_live = true` | Discover filter change is still made (future-proofing NULLs) but is provably a no-op today — note in evidence. |
| V0a: unclaimed row has `is_live` NULL/false | Confirms the design's suspicion: the unclaimed profile is invisible in Discover today, and Step 3's filter change is what makes it appear. If **false** (not NULL): pause — someone explicitly flagged it not-live; surface to owner before making it discoverable (the filter change deliberately does not resurrect explicit `false`). |
| V0b = 0 (expected) | P5's clean cut to `profile_id` proceeds. |
| V0b > 0 | Those rows would vanish from the owner's ProfileScreen availability sheet. Do not silently accept: re-run the idempotent M3 `venue_availability` backfill statement first (data repair, its own micro-commit), then re-check = 0. |
| V0c = 0 (expected) | Fallback retirement has zero data impact — proceed. |
| V0c > 0 | New Studio imports exist. Retirement still proceeds (approved; spec S1), but list the affected ids in the completion doc so Studio knows they are not publicly navigable until promotion. |

---

## 1. The `?type=` refinement, specified

- **`profileUrl()` always emits the type**: `/profile/<profiles.id>?type=<profiles.type>` whenever the type is known (it always is — every link site holds a profile row or a typed relationship). Deep links stay deterministic and self-describing during the migration.
- **The resolver applies `?type=` as a filter on both lookup steps** (canonical and legacy), exactly as the screen filters today. Consequences, accepted and documented: a canonical id with a *mismatched* `?type=` yields "Profile not found." — identical to today's legacy-URL semantics, deterministic, and debuggable (the failure names its cause in the URL).
- **No M5 code depends on the param's presence**: a bare `/profile/<id>` resolves fine (id is unique). The param is disambiguation for *legacy* URLs and determinism/debuggability for canonical ones.
- Removal is reconsidered after M8 only.

---

## 2. The shared resolution module (new file, `v2/src/lib/profileResolution.js`)

Two exports, no state, no schema/RLS/`resolveProfileId()` involvement:

- **`profileUrl(profile)`** → `` `/profile/${profile.id}?type=${profile.type}` `` (omits the param only if `type` is somehow absent). Every migrated link site calls this instead of hand-building URLs — the mechanical guarantee behind "no code path generates a user-id profile URL."
- **`resolveProfileRoute(routeId, { typeFilter, preferPerformer })`** → `{ profile, isLegacyHit }`:
  1. Query `profiles` by `id = routeId` with the same precedence chain ProfileScreen uses today (`typeFilter` → else `preferPerformer` exclusion → else `neq punter`), `limit(1)`. Hit → `{ profile, isLegacyHit: false }`.
  2. Miss → same query shape by `user_id = routeId`. Hit → `{ profile, isLegacyHit: true }` (caller redirects).
  3. Miss → `{ profile: null }`.
  The precedence chain is extracted from ProfileScreen (it already exists as `applyTypeFilter`) — moved, not modified, so legacy disambiguation is byte-identical.

Consumers in M5: ProfileScreen (resolver + `profileUrl` for the redirect target); all L2–L9 link sites (`profileUrl` only). Nothing else imports it yet — M6 will.

---

## 3. Ordered steps

Working-tree caution, carried from M2/M3 discipline: the tree still holds unrelated uncommitted feature work. Files needing M5 edits are marked **[dirty]** (M5 hunks must be isolated via hand-crafted patch staging) or **[clean]** (whole-file staging is safe). Verified against `git status` 2026-07-11 post-F1.

### Step 1 — resolution module + ProfileScreen cutover → commit 1

Files: `v2/src/lib/profileResolution.js` (new), `v2/src/screens/ProfileScreen.jsx` **[clean]**.

Changes (design refs in parentheses):
- Replace the three-stage lookup (user_id → id → placeholder) with `resolveProfileRoute` (P1); on `isLegacyHit`, `navigate(profileUrl(profile) + preserved prefer param, { replace: true })` (§2.7 shim); delete the `placeholder_profiles` branch and the `isPlaceholder` plumbing (P2).
- Downstream reads: venue events → `venue_profile_id = profile.id` (P3, P6); performer gigs → two-leg read (P4), shape: `.or(\`artist_profile_id.eq.${profile.id}${profile.user_id ? `,artist_id.eq.${profile.user_id}` : ''}\`)` with event-id dedupe (already deduped via `Set`); availability sheet → `profile_id = profile.id` (P5).
- Write re-derivation (P7/P8): `doFollow`/unfollow/follow-state key on `profile.user_id ?? profile.id` for `entity_id` legs and always `profile.id` for `target_profile_id`; follow-state read shape: `.or(\`target_profile_id.eq.${profile.id},entity_id.eq.${profile.user_id ?? profile.id}\`)` scoped to the session user. `sendEnquiry` venue side: `venue_user_id: profile.user_id` (was route id), `venue_profile_id: profile.id`. Written columns unchanged; only value sources move.
- Claim UI re-key (D): `isPlaceholder` gates → `profile.user_id === null` (with `claim_status === 'pending'` still selecting the "under review" copy); hero-image placeholder fallback keys the same way.
- `writeNotification(profile.user_id …)` already guards on truthiness — unchanged, now correctly skipped for unclaimed targets.

Immediate verification: V1–V5, V7–V11, V14 (design review §5), plus console-clean.

### Step 2 — Discover + shared cards → commit 2

Files: `v2/src/screens/DiscoverScreen.jsx` **[clean]**, `v2/src/components/PortraitCard.jsx` **[dirty]**, `v2/src/components/ProfileCard.jsx` **[dirty]**.

- Both Discover selects add `id`; `.neq('is_live', false)` → `.or('is_live.is.null,is_live.neq.false')` semantics (final PostgREST form settled in implementation; intent: only explicit `false` hides); React keys → `p.id`.
- PortraitCard/ProfileCard default clicks → `profileUrl(p)` when `p.id` present, else today's legacy URL (fallback branch, commented as such); keys → `id ?? user_id`.

Immediate verification: V6; MyScene discover strip still renders (it feeds PortraitCard — its select gains `id` in Step 3; until then the fallback branch covers it, which is itself a live test of the graceful path).

### Step 3 — remaining link sites (L4–L9) → commit 3

Files: `ApplicationsScreen.jsx` **[dirty]**, `EnquiryCard.jsx` **[clean]**, `EventScreen.jsx` **[dirty]**, `MySceneScreen.jsx` **[dirty]**, `DashboardHeader.jsx` **[dirty]**, `ArtistDashboard.jsx` **[dirty]**, `PerformerDashboard.jsx` **[clean]**.

- L4: applicant-profiles select adds `id`; card click → `profileUrl(profile)`.
- L5: click → `profileUrl` on the fetched applicant row (fallback: `enq.applicant_profile_id`-built URL; final fallback legacy).
- L6: lineup select (`EventScreen.jsx:56`) adds `artist_profile_id`; SlotCard click prefers it (URL with `?prefer=performer` preserved — the param still works because the canonical id lookup ignores `prefer` when `type` absent; keep emitting `?type=` when the member profile's type is known, else `prefer=performer` as today for the legacy-fallback branch).
- L7: MyScene `:390` select adds `id`; dayArtists click prefers `a.id`.
- L8/L9: dashboards pass their loaded profile row to `profileUrl` (DashboardHeader takes the row or its id+type as props instead of `userId`).

Immediate verification: V12, V13.

### Step 4 — exit-criterion sweep + full regression + completion → commit 4

- Sweep: `grep -rn "/profile/\${" v2/src` — every hit is either `profileUrl(...)` output or an explicitly-commented legacy-fallback branch. This is the spec's "done when" made mechanical.
- Full matrix V1–V15 re-run end-to-end on the dev server (guest + authenticated sessions), network-tab read assertions per §5 of the design review (one `profiles?id=eq.` on canonical hits; zero `placeholder_profiles` requests anywhere).
- Completion evidence appended to the design review (or `m5-verification-evidence` doc, matching M4's pattern); memory updated.

### Commit plan (4 isolated commits, each verified before the next)

1. `M5: profile resolution module + ProfileScreen canonical cutover, redirect shim, unclaimed UI re-key`
2. `M5: Discover + shared cards navigate by profile id; unclaimed discoverable`
3. `M5: remaining link sites emit canonical profile URLs`
4. `M5: verification evidence and exit-criterion sweep`

Dirty-file isolation: commits 2–3 stage only M5 hunks from [dirty] files via hand-crafted patches (the M2/M3 discipline); the unrelated feature work stays uncommitted and untouched.

---

## 4. Rollback (restated against these steps)

- Any single commit reverts cleanly in reverse order; all four revert to the tagged pre-M5 state (`identity-migration-m4-complete` marks the floor).
- Code-only throughout; no database action exists to undo. Canonical URLs minted while M5 was live remain resolvable after full rollback via M3's id-fallback (restored by the revert). Follows created on unclaimed targets while live (`entity_id = profile.id`) remain readable by the reverted code at those same profile-id routes.
- Non-trivial only once M6 consumes the resolution module.

## 5. Out of scope (unchanged from the approved design)

M5.1 display-join parity; F2/F3/F4/F5; the `entity_type: 'profile'` follow bug (V10 re-verifies it is neither masked nor worsened); DiscoverScreen duplicate-key warning beyond the incidental key fix; anything write-cutover (M6).
