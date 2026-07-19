# Phase 16 — Studio Owner Resolution: handoff brief

**19 Jul 2026.** Written at the close of Phase 15 (unclaimed marking), for a fresh session.

This is a **starting brief, not a plan**. It records verified state, cites the ratified requirements,
and names the questions that must be settled before code is written. The receiving session should
audit before implementing — every fact below carries the date it was checked, and facts rot.

---

## 1 · What this phase is

Studio (the Gig Importer) must resolve **exactly one accountable owner** for every event before it is
imported, creating an unclaimed profile where necessary, and **holding a listing for review rather
than importing it ownerless**.

This is identity v1.3 `O-R6`, already ratified. Implementation only.

**Why this is next, ahead of R5 (venue linkage).** Owner resolution decides what identity imported
content carries; every downstream surface consumes that decision. R5's design *depends on* it —
`events.venue_profile_id` is the column R5 would wire through, and how Studio populates it at import
determines what R5 is plumbing. Building R5 first risks designing around today's publishing
behaviour rather than the final one.

---

## 2 · Where the work happens

| | |
|---|---|
| **Studio repo** | `C:\Users\L-c\GigImporter` — Express `server.js` (:4000, Puppeteer `/fetch-page`) + a v3 HTML app |
| **App repo** | `C:\Users\L-c\Documents\YesPleez App\YesPleez Scene App\YesPleez`, branch `v2-react`, live app in `v2/` |
| **Studio git** | **Intentionally local-only.** No remote, by decision. Do not suggest GitHub/remotes unless the request is explicitly about backup, multi-device, onboarding or hosting. |
| **App git** | Has a remote (`origin`, GitHub). **Always ask before pushing** — the owner watches the live site. |

**Studio's working tree was dirty as of 19 Jul 2026**: `M review-export.js`, untracked `.claude/`,
`test.txt`. HEAD was `48ff213`. Establish what that uncommitted change is before building on it.

### Studio's architecture is frozen

Governance charter: the Queue Model, workspace, persistence, export and Core are **production
infrastructure**. Future work is **feature-only**. If a feature needs an infrastructure change,
**stop and surface it** — no workarounds, no parallel state. Owner resolution is a feature; the queue
and export paths it touches are infrastructure.

`docs/studio-core.md` and `docs/review-queue.md` live in the Studio repo. Read both.

---

## 3 · Verified state, 19 Jul 2026

Probed live via read-only REST. Re-verify; do not trust this table blind.

| Fact | Value |
|---|---|
| `events.owner_profile_id` | **present**, 24 / 24 populated |
| `events.venue_profile_id` | 9 of 24 populated (15 honestly `NULL`) |
| `profiles.claim_status` | present — 36 `claimed`, 1 `unclaimed` |
| `profiles.created_via` | present, **all NULL** |
| `owner_profile_id` in Studio source | **absent** — not yet implemented anywhere |

M14a–M14e are complete and pushed. Phase 15 is complete and tagged
`phase-15-unclaimed-marking-complete`.

### ⚠ Blocker found: the export migration has never been applied

`GigImporter/sql-export-mapping.js` whitelists columns it attributes to
`supabase/migrations/20260714000000_studio_sql_export_columns.sql`, and its own header states that
migration *"must be applied before generated SQL referencing those columns will run."*

**It has not been applied.** Probed 19 Jul 2026 — every column it adds is absent:

```
events.external_ref       ABSENT
profiles.external_ref     ABSENT
profiles.phone            ABSENT
profiles.accessibility    ABSENT
profiles.country          ABSENT
profiles.links            ABSENT
```

This was already recorded as `D5` in `docs/live-schema-audit-2026-07.md` (17 Jul) and is **still
true**. Any Studio-generated SQL emitting those columns will fail against the live database. Resolve
this before, not during, the export milestone.

---

## 4 · Ratified requirements — cite, do not re-derive

Read these in `docs/architecture/`. The `.html` files are authoritative; the `.md` beside them are
mechanically-converted reading copies — never cite one.

**`O-R6`** — every event has exactly one accountable owner. No ownerless event exists. Studio
resolves an owner before import, creating an unclaimed profile where necessary, and holds a listing
for review rather than importing it ownerless. Subsystems ask *who owns this event*, never *does this
event have an owner*.

**`O-R4`** — `owner_profile_id` is authority, exactly one, never null, **any profile type**.
`venue_profile_id` is *location*. `host_id` is *authorship*. Three concepts, three columns. **There
is no `host_profile_id`.**

**`O-R1`** — the active profile determines nothing. `can_act_as()` remains the sole authorization
mechanism.

**Phase 13 `Q5`** (`docs/phase-13-q5-publication-of-imports-2026-07.md`) — custodial publication.
`P-C1` custodial audit record; `P-C2` unclaimed marking (**done — Phase 15**); `P-C5` publication is
a separate policy-gated act from import.

**Phase 13 `Q1`** — notifications for unclaimed owners are **held**, then delivered on claim.

**Phase 13 `Q6`** + **erratum `E2`** — `owner_profile_id` is *stable in normal operation and
correctable by exception*. Reattribution is not transfer. Correction is audited, atomic, never leaves
the event ownerless, and post-claim requires consent or adjudication.

**Erratum `E3`** — the operative correction: **`venue_profile_id` must not be used as an ownership
signal** on unrepaired data. M14d/M14e repaired the existing rows; the *reasoning* still binds any
new fallback logic (see Q1 below).

**§09 Ethics** (`architecture-v1.0`) — public-info only; generic avatars pre-claim; imported data
marked *imported & unverified*; no "verified" styling pre-claim; **never imply the act joined or
endorsed YesPleez**; removal blocklist honoured on every import run.

**§15 `S1`–`S5`** — Studio dependencies. Notably `S3`: the importer runs as a **restricted database
role**, structurally unable to write `owner_user_id` / `claim_status` or mutate any claimed row.
`S5`: import provenance (`source_*`) populated on every promoted row.

---

## 5 · Questions to settle before writing code

These are **implementation questions within the frozen architecture**, not invitations to redesign.
Surface them to the owner rather than deciding unilaterally.

**Q1 · Is "else the venue" a sound owner fallback?**
`docs/phase-14-studio-implementation-plan-2026-07.md` §M5 sketches *promoter if identifiable, else
venue profile, else hold*. `O-R6` itself says *resolve, create an unclaimed profile where necessary,
else hold* — it does not name a venue fallback.

The tension is real and has already caused one incident. M14c's dry run **withdrew** exactly this
fallback for backfill, because 23 of 24 events would have been assigned to a venue that does not host
them — asserting a commercial relationship that does not exist (erratum `E3`).

A venue-run night genuinely *is* venue-owned, so the fallback is legitimate **in that case**. The
question is how Studio distinguishes "the venue runs this night" from "we know the venue but not the
promoter." Getting this wrong reintroduces `E3` at import scale.

**Q2 · What does "create an unclaimed profile where necessary" mean operationally?**
Which profile type is minted for an unidentified promoter — `host`? Under what confidence threshold?
Dedup against the live catalog and the removal blocklist must run **before** promotion (`S2`, `S4`).

**Q3 · Does the restricted-role constraint (`S3`) hold today?**
Studio currently generates SQL for manual application rather than writing directly. Confirm what
actually executes the export and under which role, before assuming `S3` is satisfied.

**Q4 · `created_via` is present but universally NULL.**
`S5` requires provenance on every promoted row, and §09's transparency clause depends on it. Phase 15
recorded this as `R10` — unimplemented. Owner resolution is the natural place to start populating it,
but confirm scope rather than assuming.

---

## 6 · Suggested shape

From `docs/phase-14-studio-implementation-plan-2026-07.md` §4, which remains the reference plan:

| # | Milestone | Repo |
|---|---|---|
| M5 | Owner resolution at import (`O-R6`) — **new** `GigImporter/owner-resolution.js`; changes to `review-queue.js`, `queue-store.js` | Studio |
| M6 | SQL export emits `owner_profile_id` — `sql-export-mapping.js` whitelist, `review-export-sql.js`; also emit `is_public = false` | Studio |
| M7 | Publication as a separate custodial act (`P-C5`) — **new** `custodial-publish.js` | Studio |
| M8 | Custodial audit record (`P-C1`, `T6`) | both |
| M9 | End-to-end proof: import → publish → claim → authority | both |

**Reuse, do not reinvent:** `profile-picker.js`, `duplicate-detection.js`, `confidence.js`,
`catalog-source.js`. Studio dedupes against live data via a JSON snapshot — re-run v2's
`export-studio-catalog.mjs` to refresh it (`catalog-export.json` is gitignored).

---

## 7 · The lesson worth carrying from Phase 15

Almost nothing in M15 required new infrastructure. Nearly every fix was **preserving canonical
identity instead of reducing it to primitives**. Three separate surfaces had already fetched the
right `profiles` row and then flattened it into an avatar and a link target — and two of them ended
up with a `user_id` key that actually held `lineup_members.artist_id`. That is worse than not having
the field, because it type-checks and reads correctly while being wrong.

Exactly **one** query in the entire phase needed a column added.

**Applied here: resolve to an entity, pass the entity.** `owner-resolution.js` will be tempting to
write as returning a bare `owner_profile_id` string. Return the resolved profile — with its type,
claim state and provenance — and let callers take what they need. The erosion starts one caller at a
time.

---

## 8 · Verification standard

Phase 14 and 15 both held this line, and it repeatedly caught real defects:

- **Measure, don't assume.** M15 found a layout regression (+28px, variable with content) that a
  visual check would have missed, and disproved an assumed one by comparing against baseline.
- **Probe live before trusting a document.** M14c's dry run withdrew a migration that would have
  asserted 23 false relationships. This brief found an unapplied migration the same way.
- **Distinguish observed from inferred.** Where a case cannot be reached in live data, say so. M15
  used temporary local stubs marked `// TEMP-VERIFY-*`, reverted before commit and grep-confirmed.
- **Attribute defects honestly.** When a console error appeared during M15, it was reproduced with
  the change stashed *before* being reported as pre-existing.
- **Small commits, one review question each.** Nine in M15; each independently revertible.
- `v2` has **no test framework** — `oxlint` and `vite build` only. Verification means driving the
  running app. Note the app uses **`HashRouter`**: routes are `#/profile/<id>`, not `/profile/<id>`.

---

## 9 · Inherited open items

Not part of this phase, but they touch the same pipeline. Do not silently absorb them.

| Item | Where |
|---|---|
| **`R5`** — event venues are denormalised `config.venue` strings; **no clickable venue link exists anywhere in the app**. Unmarkable, and the surface an import hits hardest. Plausibly gates publication. | `docs/m15-verification-evidence-2026-07.md` |
| **`R10`** — §09 provenance unimplemented; `created_via` / `source_*` NULL and unreferenced in the client | same |
| **`R3`** — `EventScreen.jsx:1474` gates Follow / socials / VIEW PROFILE on `claim?.user_id`, so an unclaimed act is marked but has no affordances | same |
| **`FillSlotModal.jsx:38`** — `.eq('artist_id', null)` never matches, so dedup fails and repeat fills duplicate `lineup_members`. Bites once hosts add published unclaimed profiles to lineups. | same |
| **React keys on account identity** — `user_id` collides for multi-profile accounts; proven live, partially fixed, remainder tracked as its own task | same |
| **`M5.5`** — Personal profile census; **`U2`** — blocks public launch, needs legal input | `CLAUDE.md` |

---

## 10 · First actions for the receiving session

1. Read `CLAUDE.md` (app repo) and `docs/studio-core.md` + `docs/review-queue.md` (Studio repo).
2. Read `identity-v1.3.html` and `phase-13-q5-publication-of-imports-2026-07.md` — the two that bind
   this phase most directly.
3. Establish what the uncommitted `review-export.js` change is, and whether HEAD `48ff213` is the
   intended baseline.
4. Re-probe the live schema; confirm §3 still holds.
5. Settle Q1–Q4 with the owner **before** writing `owner-resolution.js`.
