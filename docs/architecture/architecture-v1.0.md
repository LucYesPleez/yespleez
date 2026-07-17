> # ⚠ CONVENIENCE COPY — NOT AUTHORITATIVE
>
> **The canonical document is [`architecture-v1.0.html`](architecture-v1.0.html).** This Markdown is a
> mechanically-converted reading copy, for diff-review and GitHub navigation only.
>
> **If this file and `architecture-v1.0.html` disagree, `architecture-v1.0.html` is correct and this file is wrong.**
> Do not cite this file. Do not edit it by hand — it is regenerated from the HTML by script.
>
> Conversion is lossy by nature. Known losses: SVG diagrams are replaced by placeholders;
> callout semantics (rule / risk / decision / principle) survive only as their text labels;
> the sidebar table of contents is dropped. **No prose, rule number, or table cell was altered.**
>
> Status: CANONICAL v1.0 — 10 Jul 2026 · frozen. Rule numbers are a stable citation interface — never renumber.

YesPleez v2 · Architecture Specification

# YesPleez v2  
Architecture Specification v1.0

The single source of truth for the YesPleez v2 architecture: how profiles exist before ownership, how claiming attaches an owner without moving anything, and the engineering plan that migrates the live application to this architecture before beta.

**Status**  CANONICAL v1.0 — 10 Jul 2026 **Change control**  Amendments only — see §17 **Scope**  YesPleez v2 app · Studio dependencies documented in §15

## 00 — Reading this document

What this specification is, the products it governs, and the architecture it assumes.

This is the **frozen source of truth** for the Unclaimed Profile and Claiming systems, and for the identity migration that precedes beta. From v1.0 onward, work against this document is **implementation only**. Architectural change is considered solely if implementation uncovers a genuine blocker — preference or optimisation does not reopen it.

> **Two products**
>
> **YesPleez** (the public app) and **YesPleez Studio** (internal ops: importer, staging, promotion pipeline) are separate products. This specification governs the app. Studio obligations that the app depends on are documented as a cross-product contract in [§15](#s15) — they are dependencies, not app workstreams.

### Assumed architecture (not redesigned here)

-   Booking architecture based on `lineup_members` and `performances`.
-   Communal profile architecture — **Venue is the canonical profile**; Artist, Band, Host and Stand-up inherit from it.
-   Public profile navigation complete; profile QA complete.

## 01 — Product philosophy

Every decision below derives from these principles. They are constraints, not aspirations.

> **◆ Profiles are entities, not accounts**
>
> A profile represents a real-world act, venue or promoter. It can exist with no user attached. An account is something a person *brings* to a profile by claiming it.

> **◆ One profile per real-world entity — not per name**
>
> Entity uniqueness, not name uniqueness. Two different acts may legitimately share a name (disambiguated by type and location); the same act must never have two profiles. Duplicates are **prevented at creation** — during import, signup and booking — rather than repaired later.

> **◆ Claiming attaches — it never recreates, and never merges**
>
> Claiming binds ownership to an *existing* profile. It must never duplicate, replace, migrate or rebuild anything. Merging is a separate, **admin-only recovery mechanism** users should never encounter. If a claim ever appears to need a merge, the failure happened upstream in prevention.

> **◆ Commercial opportunity over social engagement**
>
> YesPleez records the history and future of the live scene; it does not rank the people in it. Follower counts are private infrastructure, not a scoreboard.

> **◆ Discovery favours relevance and emerging acts**
>
> Unclaimed profiles are first-class citizens of discovery. Being unclaimed must never bury an act.

> **◆ Conversations belong to accounts; commercial records belong to profiles**
>
> Message threads are personal and stay with the humans who wrote them. Booking interest, performance history and follows attach to the profile and survive any change of ownership.

## 02 — The Unclaimed Profile

Precise definition, purpose, and the boundary of what data may and may not exist before ownership.

### Definition

An **Unclaimed Profile** is a fully-formed communal profile row — in the one canonical `profiles` table — that has **no owner**: `owner_user_id` is NULL and `claim_status` is unclaimed. It is publicly visible and navigable at its permanent `profile.id` URL, and accumulates real relationships (performances, follows, booking interest) while no one owns it.

### Why it exists

-   **The scene predates the platform.** Acts, venues and promoters have histories before they sign up.
-   **Lineups need every act.** A performance links to all its performers via `lineup_members`.
-   **Value accrues before ownership** — and becomes the reason someone claims.

### What data belongs to an Unclaimed Profile

| Category | Belongs to the profile |
| --- | --- |
| Identity | Name, type, location/region, genre / sound, public socials, imported bio |
| Provenance | Source of the record, import date, "imported & unverified" marker |
| Performances | `lineup_members` rows linking it to past & upcoming `performances` |
| Subscriptions | `follows` pointing at the profile |
| Commercial | `booking_interest` expressed against the profile |
| Presentation | Generic, type-specific placeholder imagery (never a real likeness) |

### What must never exist until claim

-   **Account/identity data** — credentials, verified contact channels, personal contact details.
-   **Private workspaces** — dashboard state, availability calendar, settings, drafts.
-   **Conversations** — threads, DMs, enquiry replies. Interest can be *received*; it cannot be *answered*.
-   **Owner-authored edits** — any change presented as coming from the act itself.
-   **Financial data** — fees, payout details, agreements.

### How it differs from a claimed profile

| Dimension | Unclaimed | Claimed |
| --- | --- | --- |
| Owner | NULL | `owner_user_id` |
| Status | unclaimed | claimed |
| Editable | No | By owner |
| Receives follows / interest | Yes | Yes |
| Responds to interest | No | Yes |
| Avatar | Generic placeholder | Owner-supplied |
| Badge | UNCLAIMED | None / verified |

> **Same row, different state**
>
> An unclaimed and a claimed profile are the **same record in the same table**, distinguished only by state. Claiming flips the state; the row never moves. This makes "nothing migrates" literally true.

## 03 — Data model & ownership

The resolved architecture: one canonical table, permanent public identity, ownership as a nullable attribute.

### The profile record (claiming fields)

**Schema — profiles · one canonical table (Venue-canonical design)**

- `id` — The permanent public identity. Minted once, never changes, survives claiming. All routing and relationships key on it.
- `type` — venue · artist · band · host · standup
- `owner_user_id` — NULL = unclaimed. Set once, on claim. The single source of truth for ownership. One user may own multiple typed profiles.
- `claim_status` — unclaimed · claim_pending · claimed · locked
- `created_via` — import · manual · user_signup — provenance of the record
- `source_*` — Where an imported record came from (provenance display & correction)
- `claimed_at / claimed_via` — Attach timestamp and verification channel; NULL until claim
- `onboarding_seen_at` — Gate for the one-time "While you were away" screen (§08)

### Relationships point at the profile, not the owner

| Relation | Points at | Exists pre-claim? |
| --- | --- | --- |
| `lineup_members` | profile.id | Yes — links to performances |
| `follows` | profile.id | Yes — private subscriptions |
| `booking_interest` | profile.id | Yes — accrues, held |
| `messages` | user accounts | No — conversations belong to accounts |
| `availability` | profile.id (owner-written) | No — owner-scoped |

### The attach operation

> **Attach = one atomic update**
>
> On approved claim, within one transaction, on the existing row: set `owner_user_id`, set `claim_status = claimed`, stamp `claimed_at` / `claimed_via`. Nothing else is written. Idempotent, auditable, and **ownership-reversible** — a wrongful attach is undone by clearing the same fields. (Owner-authored *content* created after claim is not reversed; only ownership is.)

### The events attribution split

`events.host_id` historically served two roles. They are now separate concerns: **authorisation** (who may manage the event) remains account-based; **public attribution** (which venue/host profile the event belongs to) is profile-based via `venue_profile_id`. One column never again does both jobs.

### Identity stability & the single exception

> **Merge is the only identity-changing event**
>
> A `profile.id` is permanent — except when an admin merge retires a duplicate into a survivor. Retired ids are **tombstoned with a permanent redirect** (`duplicate_of`); they never 404. Merges re-point and de-duplicate `follows`, `lineup_members` and `booking_interest` atomically. Prevention ([§14](#s14)) exists so this mechanism is rarely, ideally never, exercised.

## 04 — Public behaviour

Exactly what any user may do on an Unclaimed Profile, and what is disabled until an owner exists.

✓ Allowed to everyone

-   **View** the full public profile
-   **Share** — permanent canonical link
-   **Follow** the profile Private subscription — §05
-   **View performances** linked via lineup
-   **View upcoming gigs**
-   **View past gigs**
-   **Express booking interest** §06
-   **Invite the act to join** Shareable claim link

✕ Disabled until claimed

-   **Messaging** the profile No owner to receive
-   **Editing** any field
-   **Dashboard** access
-   **Profile management** / settings
-   **Availability** management
-   **Responding** to booking interest
-   **Uploading** real avatar / media
-   **Any owner-scoped** capability

### Invite the act to join

-   Inviting produces a **shareable claim link** the inviter delivers through their own channel.
-   It may flag the profile for team outreach — but outreach proceeds only through a channel the act has publicly published, or not at all.
-   Invites are de-duplicated and rate-limited, and never surface as a public popularity signal.

## 05 — Follows

Followers follow the profile, not the owner. Counts and lists are never public. Follows exist purely to deliver notifications.

-   A follow targets `profile.id` — it survives claiming untouched.
-   **Follower counts are never displayed publicly.** Not on profiles, not in discovery, not in search.
-   **Follower lists are never displayed publicly**, and never shown to the owner as identities.
-   A follow is a **private notification subscription** to future public activity involving the profile.

> **C1 · Notifications must not assume an owner**
>
> Pre-claim public activity (e.g. a newly imported gig) must notify followers. The pipeline keys off **public-activity events on the profile**, never owner actions.

> **C2 · Enumeration must be impossible**
>
> Users can read only *their own* follow rows. No endpoint may answer "who follows X." Enforced at the data layer, not the UI.

> **C3 · Follows de-duplicate across a merge**
>
> On the rare admin merge, follows re-point to the survivor and de-duplicate — one user, one follow, one notification.

## 06 — Booking interest

Expressed before a profile is claimed, held against it, and available to the owner the instant they claim.

### Data model

**Schema — booking\_interest**

- `id` — Interest record
- `target_profile_id` — The act being approached. Claimed or not.
- `from_profile_id` — The promoter / venue expressing interest (a claimed profile)
- `from_user_id` — Sender account, for auth & notification
- `status` — pending · seen · responded · withdrawn · expired
- `note` — Optional short message (fee range, vibe, ask)
- `event_id / proposed_date` — Optional link to a specific slot
- `created_at` — Held from here until claim, then surfaced

### Workflow

1

#### Promoter views the unclaimed profile

Sees performances and gigs; sees **Express Interest** alongside the UNCLAIMED badge.

2

#### Lightweight interest form

Optional date/event, optional note. A signal, not a contract.

3

#### Stored against `target_profile_id`

Sender sees: *"Interest sent — held until this act joins YesPleez."* Not public.

4

#### Interest accumulates while unclaimed

Multiple promoters may express interest independently; none can see each other's.

5

#### On claim — instantly available

The booking inbox is populated the moment ownership attaches. **Nothing transfers**; it was always there.

6

#### Owner responds

Messaging unlocks on claim. Sender notified; status → responded.

> **⚠ Privacy of held interest**
>
> Interest sent pre-claim becomes visible to *whoever claims*. Verification rigor is the gate protecting third-party promoters' commercial intentions. Consider withholding sender identity until the owner responds, or a stronger verification tier specifically for the booking inbox.

## 07 — Claiming lifecycle

From discovery to a fully-unlocked profile. Nothing migrates; nothing transfers. Ownership unlocks what was already attached.

A

#### Discovery

Search, an event lineup, a shared link, an invite, the discovery feed — or **search-first signup** ([§14](#s14)), the claim system's front door.

B

#### Viewing an unclaimed profile

UNCLAIMED badge, generic type-avatar, performances and gigs visible. Prompt: *"Is this you? Claim this profile."*

C

#### Claim request

Authenticated user initiates. Captured: claimant, target profile, asserted relationship, evidence. Status → claim\_pending. *(MVP: manual via email / Instagram. Future: in-product verification behind the same entry point.)* The claimant's account works immediately as a punter while the claim is pending.

D

#### Verification

Manual admin review now; automated tiers later. Outcomes: approve → attach; reject → return to unclaimed with a reason; **needs-info** → hold. The unlock gate for all held private data.

E

#### Ownership attached

The single atomic update from [§03](#s3). One row. Ownership-reversible.

F

#### Capabilities unlocked

Edit, dashboard, availability, messaging, booking inbox — gated purely on `owner_user_id`. No data is created; access is granted.

G

#### "While you were away" onboarding

First authenticated view reveals the value that accrued while unclaimed. [§08](#s8).

> **The invariant**
>
> At no point in A→G is a profile duplicated, copied, or moved. The profile discovered in step A is the same record the owner controls in step G — plus three fields.

## 08 — While you were away

The first-run experience after claiming. Its single job: prove claiming was worth it — commercial value first.

Shown once, gated by `onboarding_seen_at`. Ordered deliberately per [§01](#s1):

| Reveal | Content | Priority |
| --- | --- | --- |
| **Booking enquiries waiting** | Count + previews, CTA into the inbox | Highest |
| **Promoters who expressed interest** | Held `booking_interest`, now actionable | High |
| **Upcoming performances** | Already linked via lineup | Medium |
| **Past performances** | Timeline — the history was already yours | Medium |
| **Followers already subscribed** | Aggregate count, one-time, private — open decision [P2](#s16) | Low |
| **Your public profile is live** | Link to view it as the public sees it | Context |

> **Tone**
>
> *"Work was waiting for you"*, never *"look how popular you are."* If nothing commercial is waiting, lead with linked performances and the live public profile — never an empty follower stat.

## 09 — Ethics

The system creates public records about real people before they consent. That obligates a higher standard.

| Principle | Requirement |
| --- | --- |
| **Transparency** | Unclaimed profiles are clearly labelled and state they were compiled from public information. Never imply the act joined or endorsed YesPleez. |
| **Accuracy** | Imported data is marked *imported & unverified* — a best-effort record, not fact asserted by the act. |
| **User control** | The real entity can request correction or removal **without creating an account**. Claiming is never the price of control over your own listing. |
| **Removal & deletion** | One mechanism: suppress from public view + blocklist against re-import. Event history keeps unlinked billing text — that belongs to the event. The blocklist gates the importer only; it never blocks voluntary signup. |
| **Correction requests** | Lightweight, no-account channel. Corrections logged with provenance. |
| **Public-info only** | Only public, factual, scene-relevant data is imported. No private or personal data, ever. |
| **Generic avatars** | Before claim, only generic type-specific imagery. Never a photograph or likeness without rights. |
| **No misleading representation** | No fabricated activity, no "verified" styling pre-claim, no impersonation. |

> **⚠ Must ship with, not after, public unclaimed profiles**
>
> The no-account correction/removal channel, visible provenance ("where did this come from?"), claim/interest rate-limiting, a defined retention policy, and verification strong enough to protect held booking interest.

## 10 — Edge cases

Defined behaviour for what will occur in production.

| Case | Behaviour |
| --- | --- |
| **Duplicate claim attempts** | Requests queue against one profile; soft-lock while a review is active; at most one attach can ever succeed. Losing claimant notified with a reason. |
| **Incorrect imported info** | Pre-claim: no-account correction channel. Post-claim: owner edits directly. Corrections logged; performance links corrected at the event, never silently deleted. |
| **Removal / deletion** | Unified mechanism — suppress + blocklist (see [§09](#s9)). Applies equally to pre-claim removal requests and post-claim owner deletion, so deleted acts are never resurrected by the next import. |
| **Abandoned claims** | claim\_pending with no progress auto-expires (window: open decision [P6](#s16)), returning the profile to unclaimed and releasing the soft-lock. |
| **Duplicate profiles** | **Prevented at creation** — import dedup, search-first signup, booking disambiguation ([§14](#s14)). When prevention fails: admin-only merge with atomic re-point + de-dupe and a permanent tombstone redirect. Users never see merge machinery. |
| **Ownership disputes** | Competing legitimate claims escalate to human review; capabilities freeze; audit trail kept. Attach is ownership-reversible, so reassignment loses no data. Conversations stay with the accounts that wrote them; commercial records stay with the profile. |
| **Same name, different entities** | Both profiles are legitimate. Disambiguated everywhere names collide — search, signup matching, lineup pickers — by type, location and recent activity. |

## 11 — Locked decisions

Resolved 10 Jul 2026. These are no longer open to debate; implementation builds against them.

-   One canonical profile per real-world entity.
-   `profiles.id` is the permanent public identity.
-   Ownership is represented by `owner_user_id` (nullable).
-   Claiming attaches ownership and never performs a merge.
-   Merging is an admin-only recovery mechanism.
-   `placeholder_profiles` becomes importer staging only (Studio-owned) and is never a public identity.
-   Duplicate prevention occurs during import, signup and booking.
-   Identity resolution is a platform-wide concern — one shared resolution path, not per-screen logic.
-   Conversations belong to accounts.
-   Commercial records belong to profiles.
-   The identity migration happens **before beta**.

> **Retired risks**
>
> R1 (placeholder table vs unified model) — resolved by the unified model. R2 (importer write-safety) — transferred to the Studio contract, [§15](#s15). Remaining engineering risks live inside the migration plan phases where they apply.

## 12 — Identity migration plan

Expand → dual-write → backfill → cut over reads → cut over writes → validate → contract. Every phase leaves the app deployable; every phase before the contract is reversible.

### Milestones

| Milestone | Meaning |
| --- | --- |
| M0 | Preflight complete — RLS inventory, data census, feature freeze in force |
| M1 | Schema expanded — additive columns live, zero behaviour change |
| M2 | Dual-write live — no legacy-only relationship rows appearing |
| M3 | Data parity — backfill + placeholder promotion complete and signed off |
| M4 | RLS migrated — owner-based policies pass the multi-account matrix |
| M5 | Reads canonical — all routing, URLs and public queries on `profile.id`; legacy redirects live |
| M6 | Writes canonical — booking, enquiries, availability operate on profile ids |
| M7 | **Architecture Validation Gate passed** ([§13](#s13)) |
| M8 | Legacy identity retired — dual-writes removed, legacy columns and policies gone |

### Phases

0

#### Preflight — inventory, census, freeze → M0

**Objective:** know exactly what exists. RLS policy inventory from the dashboard (invisible from code); follows-table ambiguity census; orphan-row census; verified restorable backup. **Freeze:** no new tables keyed on user id as public identity; **messaging is not built until the identity migration is complete and validated**.

**Done when:** inventory committed, ambiguity counts + resolution rules documented, restore rehearsed.

1

#### Schema expansion (additive only) → M1

**Objective:** every new column exists; nothing reads it yet. `owner_user_id` + claim fields on `profiles` (no rename of `user_id` yet); nullable `profile_id` columns beside every user-keyed relationship column; `events.venue_profile_id`. **Risk:** minimal — a regretted name is cheap now, expensive after backfill.

**Done when:** app behaviour byte-identical. **Never combined with backfill.**

2

#### Dual-write deployment → M2

**Objective:** every write path populates both keys, giving the backfill a fixed finish line. Introduces the *resolve-my-profile* pattern that becomes the template for the write cutover. **Prerequisite:** M1. **Risk:** a missed write site — caught by the parity audit.

**Done when:** organic use produces zero legacy-only rows. **Never combined with the backfill.**

3

#### Backfill, placeholder promotion, parity audit → M3

**Objective:** every historical row gets its profile id; every live placeholder becomes an ownerless `profiles` row **preserving its UUID** — healing the mixed keyspace with no re-pointing and no broken URLs. Ambiguous follows resolved by rule cascade (entity-name match → performer preference → manual queue); orphans parked and flagged, never guessed. **Prerequisites:** M2 + signed-off resolution rules.

**Done when:** parity report shows zero unresolved nulls outside the documented orphan list; promoted profiles reachable at unchanged URLs.

4

#### RLS migration → M4

**Objective:** ownership authorisation flows through `owner_user_id`. Additive-permissive: new owner-based policies land beside old ones; old ones are removed only at contract. **Risk:** the security phase — too-broad leaks, too-narrow silently hides data. **Validation:** written multi-account matrix including the C2 guarantee (no follower enumeration).

**Done when:** matrix passes on all accounts. **Never combined with any app-code change.**

5

#### Read-path cutover + legacy redirects → M5

**Objective:** `profile.id` becomes the identity the app presents — routing, all link generation, ProfileScreen single query, Discover (which is also what makes unclaimed profiles discoverable at all). Ships the shared profile-resolution module: one platform-wide resolution path. Legacy user-id URLs fall through to a permanent redirect shim. **Prerequisites:** M3 + M4. **Risk:** graceful — a missed call site emits a legacy URL that still redirects.

**Done when:** no code path generates a user-id profile URL; legacy URLs redirect correctly for multi-type users.

6

#### Write-path cutover → M6

**Objective:** booking, enquiries, availability and notification payloads operate on profile ids; the events attribution split completes (auth stays account-based, attribution becomes profile-based). **Prerequisite:** M5, soaked in real use — reads and writes are never cut in the same change. **Risk:** the deepest behavioural change; acting identity must come only from the shared resolution module.

**Done when:** full booking E2E as a multi-type user passes; no relationship query filters by auth user id except self-scoped reads.

✓

#### Architecture Validation Gate → M7

The formal checkpoint of [§13](#s13). **The contract phase may not begin until every gate item passes.**

7

#### Contract — retire the legacy identity → M8

**Objective:** remove dual-writes, drop/rename legacy columns, remove superseded policies, delete dead code. The redirect shim stays — permanent infrastructure. **Prerequisites:** M7 passed + fresh verified backup taken immediately before. **Risk:** destructive; a usage sweep for every legacy column must return only the shim before this phase may start.

**Done when:** one identity keyspace exists and "nothing migrates on claim" is literally true in production. **Always its own isolated change — combined with nothing, ever.**

### Milestone dependencies

-   **Messaging** begins only after the identity migration is complete and validated (M7 passed, M8 done) — it gets identity for free by waiting, and inherits a migration if it doesn't.
-   **The Identity Resolution system** ([§14](#s14)) begins after M8.
-   **Studio's ongoing promotion pipeline** ([§15](#s15)) feeds public profiles only after M8; the one-time promotion of existing placeholders is app-side work inside M3.
-   **Beta** requires M8 plus the ethics ship-with items of [§09](#s9).

> **Hard separation rules**
>
> Schema expansion and backfill: never one change. Dual-write code and backfill: never one change. RLS: always isolated from app code. Read cutover and write cutover: separate, with soak between. Contract: always alone, always preceded by its own backup.

## 13 — Architecture Validation Gate

The formal checkpoint between the write cutover (M6) and the removal of the legacy identity (M8). All five must pass; any failure blocks the contract phase until fixed and the gate is re-run in full.

> **`G1` Routing**
>
> All public routing uses `profile.id`. No code path generates a user-id profile URL. Verified by sweep and by click-through of every navigation source.

> **`G2` Booking**
>
> Booking flows work end-to-end: create event → apply → shortlist → offer → accept → lineup → notification with working deep-link — executed as a multi-type user, the hardest identity case.

> **`G3` Claiming**
>
> Claiming behaves correctly: unclaimed profile renders with claim entry point; claim\_pending shows the held state; admin attach unlocks capabilities on the same row; attach is demonstrably ownership-reversible.

> **`G4` Identity sweep**
>
> No remaining public identity references use `user_id`. A codebase sweep for legacy identity patterns returns only self-scoped reads (own dashboard, notification recipient) and the redirect shim.

> **`G5` Legacy redirects**
>
> Legacy redirects work correctly: user-id URLs land on the right typed profile (multi-type users included); placeholder-era URLs resolve; redirected URLs are canonical.

## 14 — Identity Resolution system

The user-facing half of "one profile per entity" — the system that makes duplicates nearly impossible to create and identity unambiguous everywhere it's encountered. Begins after M8.

This is not a UX polish phase. It is the platform's **identity resolution** surface: the mechanisms through which people find, claim, and distinguish entities. Its components:

### Search-first signup

The first step of artist/venue/host onboarding is a **search, not a form**. Exact match → *"We found an existing profile for VOIDLING. Is this you?"* → \[Claim existing\] / \[This isn't me\]. Near matches surface as warnings before creation. "This isn't me" always remains available — same-name different-entity is legitimate — and proceeds to a disambiguated create.

### Claim discovery

Every surface that can put an act in front of its owner routes to the same claim entry point: signup matching, the profile's "Is this you?" prompt, shareable invite links, and event-lineup encounters. The entry point is stable — the manual contact flow behind it is later replaced by automated verification without the surrounding UI changing.

### Booking & lineup disambiguation

Anywhere a promoter or venue selects an act — lineup pickers, invite sheets, search — colliding names are disambiguated by type, location and recent activity. Two indistinguishable results is the defined failure state; two distinguishable ones is correct behaviour.

### Duplicate prevention

The signup and booking surfaces above, plus Studio's import dedup ([§15](#s15)), form the three-front prevention line from the locked decisions. Creating an exact duplicate of an existing entity must require deliberately clicking through a warning; doing it accidentally must be near-impossible.

### Entity disambiguation

The presentation rules that make "one profile per entity" legible: disambiguators wherever names collide, provenance on imported profiles, and the UNCLAIMED badge — so a user always knows *which* entity they're looking at and what the platform does and doesn't assert about it.

> **Validation**
>
> Signup as an act with an existing unclaimed profile lands on the claim path; signup with a colliding-but-different name proceeds via "this isn't me"; lineup pickers distinguish same-named acts; the claim entry point reaches claim\_pending end-to-end.

## 15 — Studio dependencies

YesPleez Studio is a separate product. The importer, staging pipeline, promotion pipeline and importer lockdown are Studio workstreams. This section records only the contract the app depends on.

### The cross-product contract

| # | Studio guarantees | The app assumes |
| --- | --- | --- |
| S1 | Staging (`placeholder_profiles`, demoted) is **never publicly navigable**; nothing outside staging references a staging row. | Every public profile lives in `profiles`; the app never queries staging. |
| S2 | Promotion into `profiles` creates ownerless rows with **stable UUIDs**; dedup against existing profiles and the blocklist runs before promotion. | New unclaimed profiles simply appear with permanent ids; lineups link only promoted profiles ("billed name" text fallback for unresolved acts). |
| S3 | The importer runs as a **restricted database role** — not a policy-bypassing service key — structurally unable to write `owner_user_id` / `claim_status` or update any claimed row. May insert referencing rows (lineups) that point at claimed profiles; may never mutate them. | Claimed profile data can only change through owner or admin action. Owners can reject imported lineup links. |
| S4 | The removal/deletion **blocklist is honoured** on every import run. | Removed and deleted acts stay removed; the blocklist never gates voluntary signup. |
| S5 | Import provenance (`source_*`) is populated on every promoted row. | Ethics §09 provenance display has data to show. |

### Sequencing

-   Studio pipeline work may proceed in parallel with the app migration, but promotion into public profiles begins only after M8.
-   The one-time promotion of *existing* placeholder rows is app-side migration work inside M3 — not a Studio deliverable.
-   S3's negative test (importer credentials attempting to update a claimed row and failing at the database) is part of Studio's definition of done, and the app team witnesses it before relying on S3.

## 16 — Open product decisions

Non-architectural. None block the migration; each must be resolved before the feature it gates ships.

> **`P1` Consent posture**
>
> Opt-out (list by default, honour removal) or opt-in? Working assumption opt-out; must be defensible for your regions before beta. Gates: public unclaimed profiles at scale.

> **`P2` One-time private follower count**
>
> May the owner see an aggregate count once in "While you were away"? Gates: §08 build.

> **`P3` Who may express interest**
>
> Any user, or claimed host/venue profiles only? Gates: §06 build.

> **`P4` Verification standard**
>
> Evidence threshold for attach — and whether the booking inbox needs a stronger tier. Gates: automated claiming; interim manual flow proceeds.

> **`P5` Duplicate-claim resolution rule**
>
> First-valid-wins, evidence-weighted, or always-manual? Gates: claim review procedure doc.

> **`P6` Abandoned-claim expiry window**
>
> How long may claim\_pending sit before auto-expiry? Gates: §07 stage D build.

> **`P7` Retention policy**
>
> What is kept, suppressed or purged on removal, and for how long? Gates: beta (ethics ship-with list).

## 17 — Versioning & amendments

How this document changes from here — and how it doesn't.

> **This is the single source of truth for YesPleez v2**
>
> This document is the authoritative architecture reference for the YesPleez v2 application. The public app and **YesPleez Studio** both treat it as canonical wherever their responsibilities intersect (see §15 for the Studio contract). Implementation must conform to it.

### The rule

-   **No silent rewrites.** This document is not continually edited in place. Once frozen, its content is stable.
-   **Amendments, not replacement.** Architectural evolution happens through versioned amendments — v1.1, v1.2, and so on — each scoped to the specific change and its rationale.
-   **The bar for reopening is a genuine blocker.** Implementation uncovering a fact that makes the locked architecture unworkable — not a preference, not an optimisation, not a nicer pattern discovered mid-build.
-   **History is preserved.** When an amendment supersedes part of this document, the prior version is kept as historical reference, not deleted. A reader should always be able to see what changed and why.
-   **Product decisions (§16) are not architecture.** Resolving P1–P7 does not require an amendment — those are scoped, expected updates as each gating feature ships, and are tracked as edits within the current version.

### Amendment record

| Version | Date | Change |
| --- | --- | --- |
| **v1.0** | 10 Jul 2026 | Initial freeze. Unified profile architecture, identity migration plan (M0–M8), Architecture Validation Gate, Identity Resolution system, Studio contract. |

### We are leaving the architecture phase

From this point, the project's focus is **disciplined implementation against this specification**, beginning with M0. Architecture is not revisited casually — only amended, deliberately, when the ground truth demands it.
