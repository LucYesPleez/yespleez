> # ⚠ DRAFT — NOT RATIFIED · NOT BINDING
>
> **This document has no authority.** It is a proposal for a future architecture specification,
> written to be ratified later — not a record of a decision already taken. Nothing here governs
> current code, and no implementation may cite it.
>
> It is hand-authored Markdown, which every other file in this directory is forbidden to be. That
> is deliberate and temporary: the canonical documents here are frozen HTML artifacts, and this is
> not canonical yet. **On ratification it must be re-authored as `publication-v1.0.html`** and this
> draft deleted, per the directory rules in [`README.md`](README.md).
>
> Status: **DRAFT v1.0** — 18 Jul 2026 · open for amendment · rule numbers provisional until ratified.

YesPleez · Architecture Specification (proposed)

# Publication Model v1.0

Establishes **visibility** as a first-class axis of the system, independent of attribution and
authorization; defines a single ordered publication ladder as the sole source of truth for what any
audience may see; and forbids surfaces from deciding visibility for themselves.

**Status** DRAFT — not ratified **Extends** Architecture v1.0 · Identity v1.1 **Change control** v1.0 §17
**Scope** Ecosystem-wide — Scene, Festival, Operations, Studio, and any future product

---

## P0 — Status & scope

This document proposes the **canonical publication model for the entire YesPleez ecosystem**. It is
written once, to be implemented once, and to be the single source of truth for content visibility
across every product.

It does **not** amend Identity v1.1. It sits alongside it and adds a third axis (§P1). No rule in
v1.0 or v1.1 is weakened, superseded, or reopened by this document.

**Origin.** Proposed 18 Jul 2026 following a beta simplification of Host Controls (11C.7), which
surfaced the failure in §P2. The owner's recommendation — stage the reveal as Event → Artists →
Set Times, mirroring how festivals, venues and promoters actually announce — is the substance of
this document. §P4 generalises it; §P5 is the constraint that makes it real rather than cosmetic.

**Decided since drafting.** Phased announcement (§P13 `Q1`) was answered **yes** on 18 Jul 2026 and
is now §P4.4 — participants publish individually, `LINEUP` is a permission gate rather than a
broadcast. This is the only substantive change to the model since it was first written down.

**Not decided here.** §P13 lists what remains open. One question blocks ratification — **what the
canonical publication object is** (`Q1`). The invariant that constrains any answer to it is fixed
(§P5.3); the answer itself is deliberately left to implementation. `Q2`–`Q4` can be settled as the
work proceeds.

---

## P1 — The founding principle

> **◆ The one sentence to remember**
>
> **Visibility is a property of the content, not of the surface rendering it.**
>
> A screen asks *"what may this viewer see?"* and is answered. A screen never decides.

Identity v1.1 established that **attribution** (who an action appears to come from) and
**authorization** (who may perform it) are different concepts that must never share a column, a
check, or a source of truth.

**Visibility is a third such concept**, and it has been sharing columns with both. It answers a
different question from either:

| Axis | Question | Source of truth |
|---|---|---|
| Attribution | Who does this appear to come from? | `(from_profile_id, from_user_id)` — v1.1 §A3 |
| Authorization | Who may perform this action? | `can_act_as(profile_id)` — v1.1 §A4 |
| **Publication** | **Who may see this content?** | **`publication` — this document** |

The three are independent. A profile may be authorized to act, attributed as the actor, and still
have produced content nobody may yet see.

---

## P2 — The blocker test

Following v1.0 §00, a specification is justified by what implementation cannot express, not by
preference. Three findings, all live in `v2/` on 18 Jul 2026.

> **`C1` The public event page exposes intermediate booking state**
>
> [`EventScreen.jsx:1284`](../../v2/src/screens/EventScreen.jsx) renders a slot's artist name to the
> public only when the claim is `confirmed`, and renders the literal string **`PENDING`** otherwise.
>
> A punter therefore learns that a specific slot is *mid-negotiation with someone*. That is
> commercially sensitive information about an unfinished deal, published by default, with no control
> over it. The host cannot suppress it; there is no setting that governs it.
>
> This is not a rendering bug. There is no concept in the system of *"this booking is not yet
> announceable"* — only of *"this booking is not yet accepted"*, which the page then leaks.

> **`C2` Visibility is decided independently by each surface**
>
> There is no shared predicate. Each screen re-derives visibility from raw rows with its own filter:
>
> - [`EventScreen.jsx:225`](../../v2/src/screens/EventScreen.jsx) gates the timetable on
>   `config.host_controls_config.showTimesPublicly`.
> - [`EventScreen.jsx:393`](../../v2/src/screens/EventScreen.jsx) counts filled slots with
>   `status !== 'declined'` — a **different** rule from the one rendering the slots, so the public
>   reads *"5 of 5 slots filled"* above a list showing three names and two `PENDING`s.
> - [`MySceneScreen.jsx:413`](../../v2/src/screens/MySceneScreen.jsx) reads `lineup_members` with
>   only `status != 'removed'` — no confirmation check and no publication check of any kind.
> - [`ProfileScreen.jsx:112`](../../v2/src/screens/ProfileScreen.jsx) surfaces an artist's gigs on
>   their public profile, so an unannounced booking can leak from the **participant's** side while
>   the host still considers the lineup unpublished.
>
> Four surfaces, four rules, no agreement. Adding a fifth surface adds a fifth rule. This is the
> exact failure mode v1.0 §03 diagnosed for identity — *"one column never again does both jobs"* —
> recurring on a different axis.

> **`C3` Client-side gating is not publication**
>
> Every gate listed in C2 is a JSX conditional over rows the client has already fetched. The
> withheld content is in the network response. A host told *"nobody sees this until you announce"*
> is being told something the system does not enforce.
>
> Until publication is enforced where the data is served, "unpublished" means *not rendered*, which
> is not a promise the product can make to a promoter holding a headliner announcement.

> **Verdict**
>
> C1 is unrepresentable state — the system cannot describe an unannounceable booking. C2 is an
> absent source of truth. C3 is a promise the architecture cannot keep. All three clear §00's bar.
> **The rest of this document is the minimum coherent resolution.**

---

## P3 — Audiences

Publication is evaluated against a viewer's **relationship to the content**, not their account, role,
or profile type. Exactly three relationships exist:

| Audience | Definition |
|---|---|
| **Owner** | May act on the content per `can_act_as` (v1.1 §A4). The host of an event; the venue for its own listing. |
| **Participant** | Named in the content as a settled party. A booked artist on the lineup. |
| **Public** | Everyone else, signed in or not. |

Audiences are **nested**: every Owner is also a Participant for visibility purposes, and every
Participant is also Public. A viewer is evaluated at their highest relationship.

**Owner visibility is total and is not governed by this document.** An owner always sees their own
unpublished content. Publication governs the two audiences the owner is revealing content *to*.

---

## P4 — The ladder

Content is published by advancing it through **ordered stages**. Stages are cumulative: each reveals
everything the previous stage revealed, plus one thing more.

| # | Stage | Reveals |
|---|---|---|
| 0 | `PRIVATE` | Nothing. Owner only. |
| 1 | `LISTED` | The entity exists — page, name, date, venue, description, artwork. No participants. |
| 2 | `LINEUP` | **Permission to publish participants.** Named participants, no times, no order — but *which* participants is the host's decision, not an automatic consequence (§P4.4). |
| 3 | `TIMETABLE` | The full running order — who, when, how long, in sequence. |

> **`P4.1` The ladder is monotonic and may not be skipped**
>
> Stage *n* implies every stage below it. `TIMETABLE` without `LINEUP` is a timetable of unnamed
> slots; `LINEUP` without `LISTED` is a lineup for an event the viewer cannot see. Neither state is
> meaningful and neither may be representable.
>
> An implementation offering independent per-stage switches will eventually produce an invalid
> combination. **The stage is one ordered value, not a set of booleans.**

> **`P4.2` Two stages, one ladder**
>
> Each entity carries a stage **per audience**: `participant_stage` and `public_stage`.
>
> This is what lets an owner reveal the running order to their booked artists while the public still
> sees only the event — the single most requested behaviour in the beta, and the reason "Show Set
> Times to Artists" and "Publish Set Times" are separate controls today.

> **`P4.3` The invariant**
>
> **`participant_stage ≥ public_stage`, always.**
>
> A participant may never see less than the public sees. Any write that would violate this is
> rejected, not clamped silently — a host lowering the participant stage below the public stage has
> asked for something incoherent and must be told so.

> **`P4.4` Participants are published individually — DECIDED 18 Jul 2026**
>
> **`LINEUP` is a gate, not a broadcast.** Reaching it permits the entity to publish participants;
> it does not publish them. Each participant carries **its own publication flag**, and the host
> advances them on whatever schedule their announcement strategy requires.
>
> This is not a convenience. Staged announcement is standard industry practice and it is the primary
> marketing instrument of the events this platform exists to serve:
>
> ```
> Bass Heavy Festival
>   First announcement    Pendulum · Netsky · Dimension
>   Second announcement   K Motionz · Friction · …
>   Final lineup          everyone else
> ```
>
> **Two publication gates, both required.** A participant is public only when the entity is at
> `LINEUP` or above **and** that participant is individually published. Neither alone suffices.
>
> **One mechanism covers both industry patterns.** Announcement waves are arbitrary subsets over
> time; stage-by-stage reveal (*"Stage A announced, Stage B next week"*) is a subset selected by a
> structural attribute. Both are *"publish these participants now"*. Waves and stage-grouping must
> **not** become two mechanisms — a wave is a selection the host made, not a first-class object the
> model needs to know about.
>
> **Consequence for `TIMETABLE`.** A published running order may contain slots whose participant is
> not yet published. Those slots render as **`TBA`** — and `TBA` is not a violation of §P6.1,
> because it discloses a settled fact the host chose to disclose (*the slot exists and is filled*),
> not an unsettled process (*this slot is mid-negotiation*). The distinction is the host's intent,
> and it is the whole difference between a teaser and a leak. See §P6.4.

---

## P5 — Publication is enforced at the source

> **`P5.1` The rule**
>
> **Unpublished content is not served.** Publication is enforced in RLS and in every server-side
> read path. Client-side conditionals are presentation; they are never the mechanism.
>
> A surface may render less than it is served. A surface may never be the only thing preventing a
> viewer from seeing withheld content.

This is the clause that distinguishes this model from what exists. Everything else here can be built
as client filtering and would look correct in every screenshot while promising something false.

> **`P5.2` One predicate**
>
> A single shared predicate answers every visibility question in every product:
>
> ```
> visible_at(entity, viewer) → stage        -- the highest stage this viewer may see
> ```
>
> Surfaces call it. Surfaces do not reimplement it. A surface that needs a rule the predicate cannot
> express has found a gap in this document — **stop and surface it** (v1.0 §00), do not add a local
> filter.

> **`P5.3` One canonical publication decision**
>
> **There is exactly one publication decision per unit of content, and every consumer evaluates it
> identically.** RLS, API, Scene, Festival, Studio, Operations, sharing and search all resolve the
> same decision to the same answer for the same viewer.
>
> This is the invariant. **What the unit of publication *is* — participant, performance, lineup
> entry, announcement, or something not yet proposed — is deliberately left open** (§P13 `Q1`), and
> so is where it is stored. Those are modelling and implementation choices this document does not
> make.
>
> The distinction is load-bearing. Fixing the storage location early would constrain implementations
> for no architectural gain; fixing the *number of decisions* at one is the entire point of the
> document. An implementation may choose any unit it can defend. It may not produce two decisions
> that a consumer must reconcile, or a decision one consumer can reach and another cannot.

---

## P6 — Publication reveals settled facts only

> **`P6.1` The rule**
>
> **A stage reveals settled facts, never process.** No audience below Owner is shown that something
> is pending, offered, negotiating, shortlisted, declined, or withdrawn.
>
> An unsettled participant is **absent** from a published projection. Not greyed out, not labelled
> `PENDING`, not represented by a placeholder that betrays a slot is under negotiation. Absent.

This resolves C1. `PENDING` does not become better-worded; it ceases to exist below the Owner
audience.

> **`P6.2` Derived values obey the same rule**
>
> Counts, totals, percentages, progress bars, search indexes, share-card metadata, calendar exports
> and notification copy are **computed from the published projection**, never from raw rows.
>
> "5 of 5 slots filled" above three names and two `PENDING`s (C2) is this rule being broken. A
> derived value computed from data the viewer may not see leaks that data by arithmetic.

> **`P6.3` Participant-side surfaces are bound by the owner's stage**
>
> A participant's own surfaces — their profile, their calendar, their feed — may show **their own**
> booking at any time. That is their fact to hold.
>
> They may not show it **to the public** ahead of the owner's `public_stage`. An artist's public
> profile listing a gig the host has not announced is the same leak as the event page listing it,
> arriving by a different route (C2, `ProfileScreen.jsx:112`).
>
> Under §P4.4 this binds to the artist's **own** publication flag, not merely the entity stage. An
> unannounced headliner's profile must not reveal the booking while the first wave is out — that is
> precisely the announcement the host is holding.

> **`P6.4` Withheld and unannounced are different disclosures**
>
> §P6.1 forbids showing process. It does not forbid a host from deliberately disclosing that
> something exists without saying what it is.
>
> | Rendering | Means | Permitted below Owner |
> |---|---|---|
> | *(absent)* | Unsettled — offered, pending, negotiating, declined | **Never** (§P6.1) |
> | `TBA` | Settled and deliberately unannounced (§P4.4) | Yes, at `TIMETABLE` |
> | `PENDING` | Leaks that a specific slot is mid-deal | **Never** — this string does not exist below Owner |
>
> The test is whether the host **chose** the disclosure. `TBA` is chosen. `PENDING` was never
> anyone's decision — it is an internal status escaping to a screen (C1).

> **`P6.5` Deliberate aggregates are a disclosure, not a derivation**
>
> §P6.2 forbids values *derived* from unpublished rows. It does not forbid a host from publishing an
> aggregate on purpose — *"50+ artists across 3 stages"* alongside three announced names is standard
> festival marketing, and it is the host's fact to disclose.
>
> The distinction is authorship. An aggregate the host set is content. An aggregate the system
> computed over rows the viewer may not see is a leak with arithmetic in front of it — which is what
> *"5 of 5 slots filled"* above two `PENDING`s already is.

---

## P7 — Defaults and migration

> **`P7.1` Absent means published**
>
> Existing rows carry no stage. **Absence is read as fully published**, mapped from current
> behaviour. Any other default silently un-publishes live content on deploy: events whose lineups
> the public can see today would go dark, and neither the host nor the audience would be told why.

The mapping from current state is exact and lossless — no host has to re-announce anything:

| Current state | `public_stage` | `participant_stage` |
|---|---|---|
| `is_public = false` | `PRIVATE` | per below |
| `is_public = true`, `showTimesPublicly` false | `LINEUP` | per below |
| `is_public = true`, `showTimesPublicly` true | `TIMETABLE` | `TIMETABLE` |
| — | — | `privateSetTimes` false → `TIMETABLE`, else `LINEUP` |

> **`P7.2` The migration is behaviour-preserving by construction**
>
> On the day this ships, every existing event is visible to exactly the audiences that could see it
> the day before. The new capability — holding a lineup back at `LISTED` — is available only to
> events whose owner chooses it.
>
> New entities default to `PRIVATE`. The default for *new* content and the default for *migrated*
> content are different values, deliberately, and an implementation that unifies them is wrong.

---

## P8 — Application across the ecosystem

The model is defined once and consumed everywhere. Products do not re-implement it and do not
extend it locally.

| Product | Application |
|---|---|
| **Scene** | Events, lineups, set times. The reference implementation. |
| **Festival** | Multi-stage lineups and crew rosters. Inherits the ladder unchanged; wave announcements and stage-by-stage reveal are both expressed by §P4.4 participant publication, with no Festival-specific mechanism. |
| **Operations** | Internal tooling operates at Owner visibility by definition. **It must never re-publish**: any export, feed or artifact leaving Ops carries the source entity's stage with it. |
| **Studio** | Consumes a catalog export of live data. That export is a **published projection** — it may contain only what `public_stage` permits, or Studio becomes a route around P5. |
| **Future** | Any product surfacing YesPleez content calls the P5.2 predicate. This is the acceptance test for "is it on the platform". |

---

## P9 — Relationship to Identity v1.1

Publication does not touch attribution or authorization, and must not be implemented in terms of
either.

- **Not authorization.** `can_act_as` answers whether a viewer may *act*. It never answers whether
  they may *see*. An implementation that gates visibility on an ownership check has conflated two
  axes, which is the precise fault v1.1 §A4 exists to prevent.
- **Not attribution.** A published entity's stage is independent of which profile authored it.
- **Participant status derives from settled attribution.** Determining *who is a Participant* (§P3)
  reads the identity pair on the lineup row. This is the only point of contact between the two
  documents, and it is a read.

---

## P10 — What ratification requires

This draft is not implementable as written. Before it is re-authored as canonical HTML:

1. **The canonical publication object named** (§P13 `Q1`). Phased announcement is decided (§P4.4);
   the unit that carries a publication decision is not. This is a modelling choice, not a storage
   one — every consumer inherits it. `Q2`–`Q4` may be settled during implementation.
2. **A live schema audit.** The stage must live somewhere addressable by RLS. `host_controls_config`
   is a JSON blob inside `events.config`; policies over JSON keys are possible but a column is the
   honest home. This cannot be settled from the repository (cf. `README.md`, "Open questions").
3. **A surface inventory.** C2 lists four leak sites found by inspection, not by audit. The real
   count is unknown until every read of `lineup_members`, `performances` and `applications` is
   enumerated across all products.
4. **Rule numbers frozen.** `P1`–`P13` become a citation interface on ratification and may never be
   renumbered thereafter (README rule 4).

---

## P13 — Open questions · not decided

> **`Q1` Phased announcement — ANSWERED 18 Jul 2026 · yes**
>
> *Resolved into §P4.4. Retained here as the record of the decision, not as an open question.*
>
> **Yes.** Phased announcement is not optional if Festival Edition is part of the ecosystem, and it
> is standard practice across the events this platform serves. `LINEUP` therefore means *permitted
> to publish artists*, not *all artists are now public*; participants carry individual publication.
>
> **What remains open is not where the flag lives. It is:**
>
> > ### **What is the canonical publication object?**
>
> The unit that carries a publication decision could reasonably be the **participant**, the
> **performance**, the **lineup entry**, an **announcement** object, or something not yet proposed.
> Each implies a different granularity, and the choice propagates to every consumer:
>
> | Candidate unit | Grants | Costs |
> |---|---|---|
> | **Participant** | *"This artist is announced for this event."* Simplest; matches how a lineup poster reads. | An artist in two slots is announced for both at once, or not at all. |
> | **Performance / slot** | Per-set granularity — announce a headline set, hold a surprise B2B. | More decisions to hold; a participant's visibility becomes derived, not stated. |
> | **Announcement** | Publication becomes an act with a time and a membership. Answers the wave-trace question for free. | A join table between announcements and whatever they publish; the heaviest option. |
>
> **This interacts with §P4.4.** That clause forbids waves as a *Festival-specific* mechanism. It
> does not forbid an announcement object as the *universal* unit — if every product publishes that
> way, that is one mechanism, not a special case. The two clauses are consistent; an implementation
> should confirm it has read both.
>
> **The invariant is fixed regardless of the answer** (§P5.3): one decision per unit, evaluated
> identically by RLS, API, Scene, Festival, Studio, Operations, sharing and search. The unit is
> negotiable. The count is not.
>
> Two smaller questions ride on the answer and need not be settled first:
>
> - **Whether a wave leaves a trace** — displayable *"announced in wave 2"* history. Free under the
>   announcement unit; a schema addition under the others.
> - **Whether `TBA` slots are counted.** §P6.4 permits `TBA` at `TIMETABLE`; §P6.5 governs
>   aggregates. Whether an unannounced participant's slot contributes to a published count is a
>   product choice with a marketing consequence, not a technical one.
>
> Everything else in §P13 can wait for implementation.

> **`Q2` Does `LINEUP` reveal set lengths?**
>
> "Artists, no times" is unambiguous about clock times. It is silent on duration and on running
> order without clock times — both of which are partial timetable information a host may or may not
> consider announced.

> **`Q3` Are stages reversible?**
>
> Un-publishing is trivial to implement and impossible to enforce: the content is already out. A
> host who retracts a lineup has retracted it from the app, not from screenshots. Whether the
> product offers reversal, and what it promises about it, is a product decision this document should
> record rather than assume.

> **`Q4` Does publication apply beyond events?**
>
> Profiles, venue listings and future content types have visibility needs that may or may not fit
> this ladder. The ladder's stage names are event-shaped. Ratifying it as *the ecosystem model*
> implies either that it generalises or that a second model will appear beside it.
