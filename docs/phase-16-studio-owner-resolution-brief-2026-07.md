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

**Q1 · Is "else the venue" a sound owner fallback?** — **SETTLED 19 Jul 2026, see §11.4.**
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
**SETTLED 19 Jul 2026 — see §11.7.** Mint an unclaimed `host` only when a promoter name was
*observed*; hold otherwise. Never mint a nameless placeholder.

**Q3 · Does the restricted-role constraint (`S3`) hold today?** — **RESOLVED 19 Jul 2026, see §11.**
Answered by reading the export path rather than by discussion. Short answer: **no.** `S3` is not
satisfied and there is no restricted role anywhere in the pipeline.

**Q4 · `created_via` is present but universally NULL.**
`S5` requires provenance on every promoted row, and §09's transparency clause depends on it. Phase 15
recorded this as `R10` — unimplemented. Owner resolution is the natural place to start populating it,
but confirm scope rather than assuming. **Refined 19 Jul 2026 — see §11.3: the generator already
emits `created_via`; it has simply never been executed.**

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
3. ~~Establish what the uncommitted `review-export.js` change is, and whether HEAD `48ff213` is the
   intended baseline.~~ **Done 19 Jul 2026 — see §11.5. `48ff213` is a sound baseline.**
4. Re-probe the live schema; confirm §3 still holds.
5. ~~Settle Q1–Q4 with the owner **before** writing `owner-resolution.js`.~~
   **All four settled 19 Jul 2026 — Q1 §11.4, Q2 §11.7, Q3 §11.1, Q4 §11.3. Cleared to start M5;
   build to §11.7 (resolution order) and §11.8 (return shape).**

---

## 11 · Addendum, 19 Jul 2026 — resolutions from a second audit

Written after the brief was committed and pushed. Everything here is **observed**, with the file and
line that shows it; inferences are labelled as such.

### 11.1 · Q3 resolved: `S3` is not satisfied, and no restricted role exists

`review-export-sql.js:5-6` and `review-queue.html:1041-1042` both state it plainly, and the code
agrees: **Studio never writes to Supabase.** It serializes a `DO $$ … $$` block that an operator
pastes into the **Supabase SQL Editor** and runs by hand.

That editor session executes as a **privileged** role — not a restricted importer role. So `S3`'s
guarantee ("structurally unable to write `owner_user_id` / `claim_status` or mutate any claimed row")
is **not enforced by the database at all.** What actually constrains the import is the column
whitelist in `sql-export-mapping.js` plus a human reading the SQL before running it. That is a
**conventional** control, not a structural one.

Two observations that make the gap concrete rather than theoretical:

- `review-export-sql.js:95` emits `claim_status: 'unclaimed'` — a column `S3` says the importer must
  be *unable* to write. Benign in intent (it is Phase 15 unclaimed marking) but it demonstrates that
  nothing prevents the write.
- `sql-export-mapping.js:39` whitelists `claim_status`, `claimed_at`, `claimed_via`.
  **`owner_user_id` is correctly absent** from the whitelist.

**Owner's ruling, 19 Jul 2026 — `S3` is marked DEVIATED, not complete.**

| | |
|---|---|
| **Current state** | Procedural protection — exporter whitelist + manual review |
| **Desired state** | Structural protection — a restricted role the database enforces |
| **Decision** | Acceptable for M5 **if explicitly recorded**, not silently assumed |

The requirement is *"Studio is structurally unable to write protected ownership fields."* The
implementation is *"Studio generates SQL, a human reviews it, then executes it as a privileged
role."* Those are different guarantees. That `claim_status: 'unclaimed'` is already emitted proves
Studio **can** write ownership-related fields whenever the exporter allows it. Not unsafe today; not
what `S3` says. **This does not block M5** — owner resolution is a Studio-side decision independent
of the role model.

### 11.2 · New finding: the export publishes on import, contradicting `P-C5`

`review-export-sql.js:137` emits **`is_public: true`** on every new event. `P-C5` and §6 M6 both
require the opposite — publication is a separate, policy-gated act from import.

**Currently masked, not safe.** The same statement also sets `status: 'draft'`, and Discover requires
both (`DiscoverScreen.jsx:54-55`, `131-132`: `.eq('status','live')` *and*
`.or('is_public.eq.true,is_public.is.null')`). So imported events do not surface in Discover today —
but only because of `status`. The moment a custodial publish flips `status` to `live`, the row is
public with no separate gate, because `is_public` was already set true at import. M6's
`is_public = false` is the fix and should land **with** M6, not after.

**Not verified:** whether `EventScreen.jsx` renders a `draft` event on a direct `#/event/<id>` link.
If it does, §09's pre-claim ethics clauses apply sooner than this section assumes. Check during M7.

### 11.3 · Q4 refined: `created_via` is implemented, never executed

`review-export-sql.js:96` already emits `created_via: 'studio_import'`, and `:100` sets
`source = { studio_local_id: … }`. The live column is universally NULL because **no row has ever been
created through this path** — consistent with the §3 blocker (the migration it depends on has never
been applied). R10 is therefore *"written but never exercised,"* not *"unstarted."* Scope for this
phase is smaller than the brief implied: verify on first real export rather than build.

### 11.4 · Q1 settled: provenance proposes, a human decides

Ratified by the owner, 19 Jul 2026. The governing distinction is that **evidence of venue ownership**
and **absence of evidence for another owner** are not equivalent — conflating them is what `E3` cost.

Resolution order:

1. Promoter identified → assign promoter.
2. Else, if the source is the **venue's own channel** and no promoter is identified → **propose** the
   venue in the Inspector, with provenance visible.
3. Venue ownership is **never** assigned without explicit reviewer confirmation. Not at any score.
4. Else `O-R6` unchanged — create an unclaimed profile, or hold.

Provenance is an **input to moderation**, not an ownership rule. `E3` cannot recur through an
automatic path because no automatic path to venue ownership exists.

**Implementation note (owner's refinement).** The venue proposal is a **review action / workflow
state**, not a confidence level. Confidence communicates probability; this communicates position in
the review workflow. Keep them in separate modules: scoring stays in `confidence.js`, proposal state
belongs with the queue state in `queue-store.js`. Collapsing them would put a workflow flag inside a
scorer and make the Inspector harder to reason about.

### 11.5 · Baseline confirmed

The uncommitted `review-export.js` change is **comment-only** — 12 added lines, no executable change:
a TODO from the 2026-07-14 SQL-export verification noting that `venue_*` / `host_*` / `festival_*`
prefixed fields pass through `projectEventFields` into `events.config`, proposing a prefix-match
extension to `EVENT_DROP`. It describes itself as non-blocking and *"noise, not incorrect."*
**`48ff213` is a sound baseline for M5.** Commit the note with the eventual prefix-match work or
discard it; either way it does not affect the implementation baseline.

### 11.6 · Incidental: a stray credential in a dead file

`yesPleez-gig-importer-v2_3.html:160-161` holds a Supabase URL and a **publishable** anon key. The
file contains no write calls (`.insert` / `.update` / `.upsert` / `.delete` all absent) and is
referenced by no other file in the repo — it is superseded by the v3 app. Not a live path and not an
`S3` concern. Flagged only so a future audit does not rediscover it as new.

### 11.7 · Q2 settled: only mint entities that correspond to an observed identity

Ratified by the owner, 19 Jul 2026. The governing invariant:

> **Only mint entities that correspond to an observed real-world identity.**
> A *named* promoter is an observation. An *unnamed* promoter is not an observation — it is a
> possibility. Minting a profile for it encodes an assumption into the data model.

This is `11.4`'s principle applied one level up. `11.4` refuses to infer a *relationship* from
absence; this refuses to infer an *entity* from absence. `E3` is the precedent for both.

**Resolution order for `owner-resolution.js`:**

1. Resolve from observed evidence.
2. Match against existing canonical profiles.
3. Apply deduplication / blocklist rules (`S2`, `S4`) — **before** any minting, so existing entities
   are reused wherever possible.
4. If still unresolved:
   - **A promoter name was observed** → mint an unclaimed `host` profile under the observed name.
   - **No promoter name was observed** → **hold for review. Do not create a placeholder entity.**
5. Venue ownership is never inferred automatically — established only by explicit reviewer
   confirmation, with provenance presented as supporting evidence (see `11.4`).

Holding is not a failure state. It is the honest output when the observation is *owner unknown*, and
`O-R6` provides the branch explicitly. A held row still reaches a reviewer, who can confirm venue
ownership or supply the promoter.

**Type note.** There are exactly three profile types — `venue`, `host`, `artist`
(`review-export-sql.js:56`). "Promoter" is `host`. Mind `O-R4` while writing M5: the minted profile's
identity lands on `events.owner_profile_id`; `events.host_id` is a *different* column meaning
authorship. There is no `host_profile_id`.

**Precedent already in the codebase.** `sql-export-mapping.js:60` — a dropped field "never fabricated
a substitute." Same principle, one level up: do not fabricate the entity either.

### 11.8 · Implementation target for `owner-resolution.js`

Per §7, and now explicit. The module returns a **resolution result object**, never a bare UUID:

- the **resolved entity** (the profile, with type, claim state, provenance) — or the **hold state**;
- **provenance** — what source the decision drew on;
- **reasoning** — why this outcome, so a reviewer sees the basis and not just the conclusion;
- **confidence**, where applicable (scoring only — `confidence.js`);
- **workflow outcome** — assigned / proposed / held (queue state only — `queue-store.js`).

Confidence and workflow outcome stay distinct fields backed by distinct modules; see `11.4`.
Downstream code must never have to reconstruct context from an identifier.

---

## 12 · M5 complete — 19 Jul 2026

Studio commit `5008bba` (local-only). `owner-resolution.js` + `test/owner-resolution.test.js`,
21 tests passing under `node:test`, no new dependency. No Core engine modified, no queue-model
change, `eventBlocked()` untouched. Ownerless events block through validation category 1 via
`OWNER_REQUIRED_RULE`, registered through `addEntityRule` — business rule added by configuration,
which is the extension point the frozen architecture intends.

### 12.1 · The principle worth carrying forward

**A recall-oriented engine must not gate a precision-oriented decision.**

`duplicate-detection.js` answers *"could these represent the same entity?"* — deliberately
recall-oriented, because a reviewer confirms every suggestion. `owner-resolution.js` answers *"can I
assign ownership without a human?"* — necessarily precision-oriented, because nothing downstream
catches a wrong answer. Same score, different thresholds.

Measured 19 Jul 2026, the engine scores token-containment as an exact name alias:

```
"Thick Ear"           vs "Thick Ear Records"                -> 100%
"Subsonic Collective" vs "Subsonic Sound System Sydney"     -> 100%
```

Correct for its job. Unsafe as an unattended ownership gate — those are different organisations, and
asserting one owns the other's night is `E3` in a new costume. The resolver therefore requires
**corroboration** before assigning: names equal once normalised, or a non-name signal
(website / socials) matched. Otherwise it downgrades to a proposal. Fixed **consumer-side**; the
engine is untouched. Regression cover: tests `7c` (100% name-only → not assigned), `7d`
(corroborated → assigned), `7e` (exact-name equality is itself corroboration).

**Generalises.** Any future Studio feature that consumes a suggestion engine to take an *unattended*
action inherits this asymmetry. Re-derive the threshold for the decision being made; do not inherit
the engine's.

### 12.2 · Dependency injection is the supported path

`opts.detector` / `opts.scorer` are the **supported** execution path. The `globalThis` fallback in
the IIFE tail is **legacy compatibility** only — Studio's house tail
(`typeof window !== 'undefined' ? window : this`) resolves to `module.exports` under CommonJS, so
cross-module lookup silently returns `null` outside a browser. Other modules still carry the original
pattern and were not touched; the same latent issue applies if they are ever tested under Node. If
Studio moves further toward Node-based testing, injection should become the primary mechanism
everywhere.

### 12.3 · Open from M5

- **`S4` has no provider.** No removal blocklist exists anywhere in Studio. The resolver takes it
  injected, so precedence is correct and testable today, and the missing work is isolated to a
  provider rather than entangled with resolution. `S4` is **not satisfied** in the pipeline.
- **M6 prerequisites, not cleanup.** Both are implementation prerequisites for the export milestone:
  1. **`D5`** — a **correctness** issue. Until the schema and the exporter agree, SQL export cannot
     be considered complete.
  2. **`is_public: true` on import** — an **invariant** issue. The fix is not only
     `is_public = false` at import; **publishing must set both values explicitly as part of the
     publish transition**:
     ```
     import   ->  status = 'draft'   AND  is_public = false
     publish  ->  sets BOTH, explicitly, as one transition
     ```
     Fixing only the import default leaves the same latent coupling pointed the other way. With both
     ends explicit, no future change to publishing logic can expose imported events merely by
     changing `status`, and no change to import defaults can expose them by changing `is_public`.
- **Next integration point: `refs.owner` as a dependency edge**, not a new queue status. The queue
  already understands dependencies; owner resolution becomes another one whose absence manifests
  through validation and whose review state follows the existing proposal/confirmation pattern.
  `§12` of `review-queue.md` sanctions new edge kinds. `held` stays **computed**, never stored.
  This keeps ownership inside the existing model instead of creating a parallel workflow for it.

### 12.4 · Three classes of defect — a review taxonomy

Phases 14–16 surfaced three architecturally distinct kinds of defect, none of which required changing
frozen infrastructure. Keeping them separate in future reviews decides *where a finding goes*:

| Class | Question it fails | Found so far | Remedy belongs in |
|---|---|---|---|
| **Inference** | Is this conclusion supported by the evidence? | `E3`; recall-vs-precision (`12.1`) | **business rules** — a rule or threshold change |
| **Contract** | Does the implementation deliver the guarantee it claims? | `S3` (procedural, not structural); `S4` (no provider) | **infrastructure** — a provider, or a recorded deviation |
| **Invariant** | Does this hold independently of unrelated changes? | `is_public: true`; `D5` | **deployment / schema** — a migration or a transition fix |

The classes have **different remedies**, which is why the distinction earns its keep. Misfiling sends
a finding to the wrong remedy — roughly how `is_public` stayed invisible: it reads as a default-value
nit (cosmetic) when it is actually a coupling between two concepts that must vary independently
(invariant). Classify first, then decide the fix.

---

## 13 · Phase 16 closure — 19 Jul 2026

**Engineering: complete.** M5 (`5008bba`), M6 (`fb2992e`), the boot-wiring fix (`3f06010`),
M6F (`63e52de`), M6G (`895860e`). All Studio-local. 59 tests passing under `node:test`.
Core unchanged, queue semantics unchanged, `eventBlocked()` byte-identical, resolver pure,
no Supabase reads introduced.

**Operations: three items outstanding.** These are deployment and acceptance, not engineering:

1. Apply `supabase/migrations/20260714000000_studio_sql_export_columns.sql` in the Supabase
   SQL Editor. Requires database privileges no part of Studio has, by design (`S3`).
2. Run the verification queries in that migration's footer.
3. Confirm `created_via` persists on the first real export — moving it from *implemented*
   to *operational* (`R10`).

**One temporary policy.** The unconfigured-blocklist override (M6F) is a stopgap: it refuses
by default but permits a recorded operator override, because no blocklist provider exists yet
and a hard refusal would block every import. **Once a real provider is configured the default
becomes strict enforcement** — the `confirm()` is removed and the refusal is unconditional.

### 13.1 · The principle worth carrying forward

> **Unit tests validate implementations. Integration tests validate contracts.**
>
> Every new consumer of an existing subsystem must have at least one regression test that
> exercises the **production call path**, not merely the subsystem's public API.

Phase 16 surfaced **four** defects of identical shape, none catchable by a unit test:

| # | Defect | The contract that went unsatisfied |
|---|---|---|
| 1 | `OWNER_REQUIRED_RULE` never registered | `review-queue.html` never called `registerRules()` |
| 2 | `owner-resolution.js` never loaded on the importer page | resolution silently no-opped; **every** event would have been held |
| 3 | `ctx` was `{}` at the import call site | provenance null, so venue-own-channel could never fire |
| 4 | `opts.blocklist` never passed | the §09 removal check silently never ran |

In each case the module existed, its behaviour was correct, and its tests passed — while the
production caller failed to satisfy the contract. **That is a categorically different failure
mode from a logic bug**, and a green unit suite is structurally incapable of detecting it: a
unit test cannot catch an argument that is never passed, or a script tag that was never added.

This is a **contract defect** in the `12.4` taxonomy, and it is the class most likely to recur
as Studio grows. It generalises well past owner resolution — to analytics, notifications,
messaging, publishing, and any future orchestration layer.

The structural remedy is already in place for this subsystem: `test/m6f-importer-integration.test.js`
asserts the call site itself (script load order, argument shape, recorded provenance), and
`test/m6g-catalog-enrichment.test.js` asserts the evidence assembled *before* the resolver runs.
Any future consumer needs the same treatment from the start.

### 13.2 · What Phase 16 actually produced

Two architectural principles that emerged from implementation rather than design, and outlive it:

- **`12.1`** — a recall-oriented engine must not gate a precision-oriented decision.
- **`13.1`** — unit tests validate implementations; integration tests validate contracts.

Both were discovered by measuring rather than reasoning: one by running the matcher against real
name pairs, the other by opening the running app. Neither would have been found by reading code.

---

## 14 · M7 prerequisite — the app reads `host_id`, never `owner_profile_id`

**Found 19 Jul 2026**, after the first real Studio import landed in production. The event imported
correctly and is invisible on the owner's profile page. Publishing it will not fix that.

### 14.1 · What was observed

The imported event (`external_ref = 'studio:e1'`) persisted exactly as designed:

```
venue_profile_id  4e77c0ae-…   ✓ linked
owner_profile_id  null          ✓ M7 sets it (I6 — platform-owned)
host_id           null          ← and it will ALWAYS be null for an import
status            draft
```

Two screens were expected to show it, and they fail for **different** reasons:

| Screen | Query | Why it's invisible | Fixed by publishing? |
|---|---|---|---|
| Venue (brewery) | `.eq('venue_profile_id', …).in('status', ['live','completed'])` — `ProfileScreen.jsx:91` | `status='draft'` only | **Yes** |
| Host (YesPleez) | `.eq('host_id', ownedProfile.user_id).in('status', …)` — `ProfileScreen.jsx:100` | `host_id` is null and always will be | **No** |

`O-R4` defines `host_id` as **authorship** — which human created the row. An importer has no auth
user, so an imported event has no author, permanently. Matching ownership on `host_id` therefore
cannot ever surface imported content.

### 14.2 · The measurement that matters

```
event queries filtered by host_id …… 7   (ProfileScreen ×2, HostDashboard ×3,
                                          VenueDashboard, MySceneScreen)
places that WRITE owner_profile_id … 1   (CreateEventScreen.jsx:441)
places that READ  owner_profile_id … 0
```

**`owner_profile_id` is write-only across the entire application.** It is set at event creation,
was backfilled by M14c, is now resolved by Studio and carried through export by `refs.owner` — and
nothing has ever read it. The authority column exists and answers nothing.

This is `13.1` again, on the app side of the boundary: the column is correct, the resolution is
correct, the decision now survives export, and the consumer was never updated.

### 14.3 · What M7 must include

Custodial publication is the first thing that will populate `owner_profile_id` on imported rows, so
it is the milestone where reading it stops being inert. **Setting the column is not sufficient — the
surfaces have to ask the new question.**

Minimum for an imported event to be visible to its owner:

```js
// ProfileScreen.jsx:100 — public profile, "events by this profile"
.or(`host_id.eq.${ownedProfile.user_id},owner_profile_id.eq.${ownedProfile.id}`)
```

**Do not blanket-replace all seven sites.** Authorship and authority are different questions and
some callers legitimately want the first:

- **Public profile pages** (`ProfileScreen.jsx:91`, `:100`) — must use **ownership**. This is "what
  does this act/venue put on," and an imported listing belongs there.
- **Dashboards** (`HostDashboard`, `VenueDashboard`, `MySceneScreen`) — decide per screen. "Events I
  created" is authorship; "events I'm accountable for" is ownership. A claimed profile that owns
  imported events probably wants them in its dashboard, which argues for ownership — but that is a
  product call, not a mechanical substitution.

### 14.4 · Related, already recorded

`R3` (`docs/m15-verification-evidence-2026-07.md`) gates Follow / socials / VIEW PROFILE on
`claim?.user_id`, so an unclaimed act is marked but has no affordances. Same root: the app keys
event and profile relationships off **accounts**, while identity v1.3 keys them off **profiles**.
M7 is the natural place to close both, since it is the first milestone whose output is only visible
if the app asks the profile-shaped question.

---

## 15 · M7 — custodial publication, and the `P-C4` deferral

**19 Jul 2026.** Studio commit `1d629ec` (`custodial-publish.js` + 16 tests, 93 total).

### 15.1 · `P-C4` is DEFERRED — deliberately, and on record

**Owner's decision, 19 Jul 2026: scope M7 to today's ratified schema and defer `P-C4`.**

`P-C4` — *"Imports publish to `LISTED` at most, never `TIMETABLE`"* — rests entirely on the
publication ladder defined in `docs/architecture/publication-v1.0-draft.md`. That document opens:

> **⚠ DRAFT — NOT RATIFIED · NOT BINDING**
> This document has no authority… **Nothing here governs current code, and no implementation may
> cite it.**

And the states do not exist: no migration defines `LISTED`, `LINEUP`, `TIMETABLE`, or any visibility
column. The database has `status` and `is_public`.

**`P-C4` is therefore vacuous in this schema rather than skipped.** There is no `TIMETABLE` stage to
over-publish into, and set times are not a publishable stage at all. `status` + `is_public` is the
whole of what publication currently means, so M7 cannot violate a distinction the system does not
draw.

**M7 is implemented against the ratified schema only** — `status`, `is_public`, `owner_profile_id`.
It invents no ladder state and cites no unratified document.

**On ratification of the publication model, M7 must be revisited** so publication targets `LINEUP`
explicitly rather than a binary public flag. Until then the deferral is printed in the header of
**every generated publish artifact**, so an operator running the SQL sees it rather than discovering
it later.

*Why this is recorded here and not only in code:* the deferral previously existed in
`custodial-publish.js`'s header, a commit message, and the generated SQL. None of those is the
document a future session reads first. `P-C5` warns that the Studio/Operations distinction "will be
quietly eroded by convenience unless it is written down as a rule rather than a habit" — the same
applies to a deferral.

### 15.2 · What M7 implements

`P-C5`'s load-bearing property is enforced in the **API's shape**, not in discipline:

- `generate()` throws unless the caller names each event in `authorisedEventIds` — there is no
  "publish all", and it is not expressible.
- It throws again without a named `custodian`.
- A custodian **cannot authorise past a blocker**. The policy decides what *may* be published; the
  custodian decides that it *is*.
- `assess()` reports eligibility and emits **nothing** publishable.

Publication sets three columns as **one transition**: `owner_profile_id` (from `refs.owner`),
`status = 'live'`, `is_public = true`. Import set the latter two to `draft`/`false` and never wrote
the first — custodial publication is one of the platform workflows `I6` names as permitted to.

Emitted SQL is guarded on the owner expression being non-null **and** on `status` still being
`'draft'`, so a retracted or already-published event is never silently re-published.

`assess()` reports criteria it cannot decide as **UNVERIFIABLE** rather than passing them —
`not-a-duplicate`, `not-withdrawn`, `satisfies-moderation` are custodian judgement or need data
Studio does not hold. Reporting an unrun check as met is the unrun-blocklist error again.

### 15.3 · Open — not met by M7, named so their absence is visible

| Item | Status |
|---|---|
| **`P-C1`** custodial audit record | M8 |
| **`P-C6`** time-boxed custody | unassigned — custody does not expire |
| **`P-C3`** retraction / opt-out | unassigned |
| **Durable custodian attribution** | **OPEN DECISION** — see below |

**The custodian is currently recorded only as a comment in the generated SQL.** `generate()` refuses
without one, so the act is attributed at authoring time — but the attribution does not persist.
Once the SQL runs, nothing in the database says who published the event.

Two coherent options, to be decided deliberately rather than opportunistically:

- **Minimal M7** — custodian identity exists only at publication time, durable attribution deferred
  to `P-C1` / M8.
- **Expanded M7** — introduce a minimal persistent publication attribution now, if *"who published
  this?"* is a core operational requirement rather than part of the broader audit trail.

This is architectural: it decides **where platform-owned publication metadata lives**.
`events.config` is import-owned and wrong for a platform act; a proper audit table is M8's job.
Held open as of 19 Jul 2026.
