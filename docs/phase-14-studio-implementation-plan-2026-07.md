# Phase 14.1 — Studio vertical slice · implementation plan

**18 Jul 2026 · implementation plan.** No code written. Architecture is not reopened.

**Goal.** The minimum implementation proving the ratified architecture works end to end:
public source → import → owner resolution → review queue → Ops review → custodial publication →
visible → claim → authority.

---

## 0 · Two governance facts that shape the plan

Flagged rather than assumed, because the brief names both as canonical and the repository does not.

**0.1 · The Publication Model is not ratified.** It is `publication-v1.0-draft.md`, carrying a
refusal banner, with its `Q1` (phased announcement) still unanswered. **Implementation may not cite
a draft** — that has been the rule all the way through, and suspending it here would undo the
discipline that made v1.3 trustworthy.

> **This does not block the slice.** The slice needs *private vs visible*, not the full
> `PRIVATE → LISTED → LINEUP → TIMETABLE` ladder. `events.is_public` already expresses that, and
> Q5's custodial rules are about **who may flip it**, which is orthogonal to how many rungs exist.
>
> **Plan: implement custody against `is_public`.** The ladder lands when the publication model is
> ratified, and nothing in this slice has to change when it does.

**0.2 · The Communication Architecture is also a draft** — and is not needed. Messaging is M8; the
slice contains no messaging. Q1's held notifications are **out of scope** for the slice (§1.3).

---

## 1 · What already exists

Planning against inspection, not assumption. Both repos were read on 18 Jul 2026.

### 1.1 · Studio (`C:\Users\L-c\GigImporter`, local-only git, HEAD `48ff213`)

Substantially more built than the roadmap implied:

| Capability | Module | State |
|---|---|---|
| Fetch public source | `server.js` (Express :4000, Puppeteer `/fetch-page`) | ✅ |
| Entity import | `venue-import.js`, `host-import.js`, `artist-import.js` | ✅ |
| Review queue | `review-queue.html/.js`, `queue-store.js` | ✅ |
| Duplicate detection | `duplicate-detection.js`, `confidence.js` | ✅ |
| Catalog dedupe vs live | `catalog-source.js`, `catalog-provider-yespleez.js` + JSON snapshot | ✅ |
| Profile matching | `profile-picker.js` | ✅ |
| **SQL export** | `review-export-sql.js`, `sql-export-mapping.js` | ✅ **upsert on `external_ref`** |
| Validation | `validation.js` | ✅ |

**Studio never touches Supabase directly.** Its output is generated SQL, run by a human. That is an
existing architectural boundary and this plan does not change it.

### 1.2 · v2 app

| Capability | State |
|---|---|
| `can_act_as()` | ✅ M6a, live |
| Identity pair on applications/follows/notifications | ✅ M6b, live |
| `actingProfile.js` seam | ✅ M6, live |
| Claiming — request | ✅ MVP per §07 C: `ClaimDialog.jsx` generates an evidence email |
| Claiming — verification & attach | ⚠️ Manual (admin, out of app) — matches §07's stated MVP |
| `events.owner_profile_id` | ❌ **Does not exist** |
| Unclaimed marking on public surfaces | ❌ Not built (§09 requires it) |

### 1.3 · Deliberately out of scope

Held notifications (Q1), the publication ladder, messaging, reattribution tooling (Q6),
verification tiers (Q7). All are designed; none are needed to prove the slice.

---

## 2 · The one thing the slice cannot prove yet

> **Authority transfer will not work through the app until v1.3 migration phase 3.**

Claiming sets `profiles.user_id`, so `can_act_as(owner_profile_id)` becomes true — but **every event
policy still resolves `host_id = auth.uid()`**. Phase 3 (dual authority) is what makes claiming
grant event authority, and phase 3 rides with **R3.2, which is deferred pending an observed client
write carrying `from_profile_id`**.

**Two options:**

- **(a) Prove the predicate, defer the policy.** The slice's final milestone verifies
  `can_act_as(owner_profile_id)` returns true post-claim, and that the owner's dashboard resolves the
  event. Authority through RLS lands with phase 3. **Recommended** — it keeps the slice shippable and
  does not force R3.2 early.
- **(b) Land phase 3 for events only, ahead of R3.2.** Larger, and it applies a policy change to a
  live table to satisfy a demo.

**This plan assumes (a)** and states it at the milestone where it bites (M9).

---

## 3 · Implementation roadmap

Ordered by dependency. Each milestone is independently committable and independently revertible.

| # | Milestone | Repo | Depends on |
|---|---|---|---|
| **M1** | `events.owner_profile_id` — additive schema | v2 | — |
| **M2** | v2 stamps owner on event creation | v2 | M1 |
| **M3** | Backfill existing events | v2 | M1, M2 |
| **M4** | Unclaimed marking on public surfaces (§09) | v2 | — (parallel) |
| **M5** | Studio owner resolution at import (`O-R6`) | Studio | — (parallel) |
| **M6** | SQL export emits `owner_profile_id` | Studio | M1, M5 |
| **M7** | Publication as a separate custodial act (`P-C5`) | Studio | M6 |
| **M8** | Custodial audit record (`P-C1`, `T6`) | v2 + Studio | M7 |
| **M9** | End-to-end proof: import → publish → claim → authority | both | all |

**M4 and M5 parallelise** with the M1–M3 chain. Everything else is strictly sequential.

---

## 4 · File-level plan

### M1 · `events.owner_profile_id`

**New** — `v2/supabase/migrations/20260719000000_m14a_owner_profile_id.sql`
Additive only: nullable `uuid` referencing `profiles(id)`, `ON DELETE NO ACTION`, plus an index.
No column altered — v1.3 §O4 verified `host_id` is already nullable. Nothing reads it yet.

### M2 · Stamp owner on creation

**Change** — `v2/src/lib/actingProfile.js`
Add `resolveOwnerProfileId(userId)` beside the existing performer resolver. Owner-eligible types are
`host` and `venue`. Same `{profileId} | {ambiguous}` contract as `resolvePerformerProfileId`, so the
picker pattern is reused rather than reinvented. **This is the seam doing exactly the job it was
built for** — R6 replaces its body later without touching callers.

**Change** — `v2/src/screens/CreateEventScreen.jsx`
`handleSave()` stamps `owner_profile_id`. Where ambiguous, reuse the chip picker already built for
applications rather than adding a second pattern.

### M3 · Backfill

**New** — `v2/supabase/migrations/20260719000001_m14b_owner_backfill.sql`
Data only. `U4` rule — infer where the account owns exactly one owner-eligible profile. **The venue
fallback (v1.3 §O8) is offered as a decision, not applied silently.** Verification query in the
header; expected `24 / 24 / 0`.

### M4 · Unclaimed marking

**Change** — `v2/src/screens/ProfileScreen.jsx`, `v2/src/screens/EventScreen.jsx`,
`v2/src/components/ProfileCard.jsx`, `v2/src/components/PortraitCard.jsx`, `EventCard.jsx`

**New** — `v2/src/components/UnclaimedBadge.jsx`
One component, consumed everywhere a profile surfaces. §09 requires *"clearly labelled … never imply
the act joined or endorsed YesPleez"*, and a badge implemented five times will diverge — the
`BADGE_STYLES` lesson from this repo's own history.

**Reuse** — `ClaimDialog.jsx` (already built), `profiles.claim_status` (already populated).

### M5 · Studio owner resolution

**New** — `GigImporter/owner-resolution.js`
Resolves exactly one owner per `O-R6`: promoter profile if identifiable, else venue profile, else
**hold for review — never import ownerless.**

**Change** — `GigImporter/review-queue.js`
Surfaces resolved owner; blocks export of any event without one. **Change** —
`GigImporter/queue-store.js` to persist it.

**Reuse** — `profile-picker.js`, `duplicate-detection.js`, `confidence.js`, `catalog-source.js`.

### M6 · SQL export

**Change** — `GigImporter/sql-export-mapping.js`
Add `owner_profile_id` to the `events` whitelist. That file is explicit that
*"review-export-sql.js must never emit a column name that isn't in REAL_COLUMNS"* — so M1 must be
applied first, and the whitelist comment updated to cite the M1 migration exactly as it cites
`20260714000000`.

**Change** — `GigImporter/review-export-sql.js`
Emit `owner_profile_id`; **emit `is_public = false`**. Export is ingestion; publication is M7.

### M7 · Publication as a custodial act

**Change** — `GigImporter/review-queue.js`, `review-queue.html`
Split **approve** (eligibility, `P-C5`) from **publish** (the custodial act, `P-C1`). Approved
events are exportable but not public; publishing is a separate deliberate action producing its own
statement.

**New** — `GigImporter/custodial-publish.js`
Generates the publication statement, and only for events an owner-resolution and review has passed.

> **`P-C5` is the whole point of this milestone.** Approve-then-publish as one button is Option B
> with extra steps. The separation must exist in the tool, not only in the document.

### M8 · Audit

**New** — `v2/supabase/migrations/20260719000002_m14c_custodial_audit.sql`
Records custodial acts: event, actor, action, timestamp, basis. `P-C1` requires custodial acts be
attributable to a person; `T6` requires reattribution be audited. **One table serves both.**

**Change** — `GigImporter/custodial-publish.js` to emit the audit row with the publication.

### M9 · End-to-end proof

No production code. A written verification script, executed manually, recorded as evidence in
`docs/` alongside the M-series verification files this repo already keeps.

---

## 5 · Milestone detail

| # | Objective | Completion | Testing |
|---|---|---|---|
| **M1** | Column exists | `information_schema` shows nullable `uuid`, FK present | Query column + `pg_constraint` |
| **M2** | New events carry an owner | Create event in app → `owner_profile_id` non-null | Create as single-profile and multi-profile account; picker appears for the latter |
| **M3** | Every existing event owned | Census `24 / 24 / 0` | Verification query in migration header; plus zero rows where owner's `user_id` ≠ `host_id` |
| **M4** | Unclaimed profiles visibly unclaimed | Badge on every public surface | Visual check on an unclaimed profile from Discover, event page, cards |
| **M5** | No ownerless event reaches export | Queue blocks export without an owner; ambiguous held | Import a listing with no identifiable party → held, not exported |
| **M6** | SQL sets the owner | Generated SQL includes `owner_profile_id`, `is_public = false` | Run generated SQL on a scratch row; confirm columns |
| **M7** | Publication is a distinct act | Approving does not publish | Approve an event → still `is_public = false`; publish → `true` |
| **M8** | Custodial acts attributable | Audit row per publication | Publish → audit row names actor, event, time, basis |
| **M9** | Architecture proven | Claim → `can_act_as(owner)` true → owner sees the event | See §2 — predicate proven, RLS deferred to phase 3 |

---

## 6 · Implementation risks

Implementation only. No ratified decision is reopened.

| # | Risk | Mitigation |
|---|---|---|
| **I1** | **Two repos, no CI between them.** Studio's SQL whitelist can drift from v2's schema, and the failure appears as a runtime SQL error during an import run. | `sql-export-mapping.js` already documents that it must cite the migration that adds each column. M6 extends that discipline rather than inventing one. |
| **I2** | **I cannot verify against the live database.** No service-role key, unauthenticated CLI. Every migration in this plan is owner-run, as M5.5 and M6 were. | Each milestone ships with its verification query. Numbers come back to me before the next milestone starts. |
| **I3** | **M3's backfill is the only destructive-ish step.** An event with a wrong owner is worse than one with none — except `O-R6` forbids none. | Dry-run `SELECT` before the `UPDATE`, exactly as M6c did. Venue fallback offered, never applied silently. |
| **I4** | **M9 cannot fully prove itself** (§2). | Stated at the milestone. Prove the predicate; record the RLS gap as pending phase 3 rather than claiming an end-to-end pass that did not happen. |
| **I5** | **Studio is a frozen architecture** (governance charter, baseline `23a6604`) — feature-only work; infra changes require surfacing. | M5–M7 add modules and extend the queue. If any of them needs a Queue Model or persistence change, **stop and surface it** per the charter. |
| **I6** | **`external_ref` upsert semantics** — re-running an import must not clobber owner or publication state set later. | M6 must exclude `owner_profile_id` and `is_public` from the `ON CONFLICT ... DO UPDATE` set, exactly as the existing exporter already excludes `external_ref`. |

> **I6 is the subtle one.** The existing exporter upserts on `external_ref` and updates every other
> column. If a re-import overwrote `is_public`, a custodially published event would silently
> unpublish on the next scrape — and nobody would notice until a venue asked where their listing
> went.

---

## 7 · Recommendation

**Start with M1 — `events.owner_profile_id`.**

- Everything else depends on it; nothing depends on anything else.
- Purely additive, no column altered, nothing reads it — the safest possible first commit against a
  live database.
- It converts v1.3 from specification into schema, which is the actual boundary between the design
  phase and the build phase.
- It is small enough to review in one sitting and revert without consequence.

**Then M2 and M4 in parallel** — M2 continues the v2 chain, M4 is independent and satisfies a §09
obligation that is already overdue (*"must ship with, not after, public unclaimed profiles"*), and
Studio will begin creating exactly those profiles.

**Before M1, two decisions are needed:**

1. **§0.1** — confirm implementing custody against `is_public`, with the ladder deferred to
   publication-model ratification.
2. **§2** — confirm option (a): prove the predicate at M9, defer RLS to v1.3 phase 3.

Both are sequencing decisions rather than architecture, and neither changes what gets built.
