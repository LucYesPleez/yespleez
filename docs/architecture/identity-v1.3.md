> # ⚠ CONVENIENCE COPY — NOT AUTHORITATIVE
>
> **The canonical document is [`identity-v1.3.html`](identity-v1.3.html).** This Markdown is a
> mechanically-converted reading copy, for diff-review and GitHub navigation only.
>
> **If this file and `identity-v1.3.html` disagree, `identity-v1.3.html` is correct and this file is wrong.**
> Do not cite this file. Do not edit it by hand — it is regenerated from the HTML by script.
>
> Conversion is lossy by nature. Known losses: SVG diagrams are replaced by placeholders;
> callout semantics (rule / risk / decision / principle) survive only as their text labels;
> the sidebar table of contents is dropped. **No prose, rule number, or table cell was altered.**
>
> Status: RATIFIED v1.3 — 18 Jul 2026 · frozen. Rule numbers are a stable citation interface — never renumber.

YesPleez v2 · Architecture Amendment

# Identity Architecture v1.3

Ownership that survives claiming. Establishes that objects belong to profiles rather than accounts, gives events a neutral `owner_profile_id`, and makes claiming grant authority without any ownership migration.

**Status**  RATIFIED v1.3 — 18 Jul 2026 · frozen **Amends**  Architecture v1.0 §03 (event authorization basis) **Change control**  v1.0 §17 **Bar**  v1.0 §00 — unrepresentable state

## O0 — What this amendment claims, and what it does not

Nothing below corrects anything above it.

**This amendment does not claim that any existing architecture is mistaken.** Specifically:

-   **v1.0 §03 is correct.** It deliberately chose account-based authorization for events — *"authorisation (who may manage the event) remains account-based; public attribution … is profile-based via `venue_profile_id`."* That was a decision, not an oversight.
-   **v1.1 §A3 is correct.** Its audit records that `events` carries the pair *"in a differently-named form (`host_id` + `venue_profile_id`) as a result of §03's split."* That accurately described the live schema then, and still did at ratification.
-   **v1.1 §A4 is correct**, including its rejection of *"the active profile determines ownership of everything."* [§O3](#o3) shows this amendment is not that formulation.

This amendment exists because **a capability the platform now requires cannot be expressed** under the previous model — not because that model was built wrong.

## O1 — The bar

v1.0 §00 permits change solely on a genuine blocker; v1.1 §A1 sharpened that to a contradiction or an unrepresentable state. This rests on the second, and on nothing else.

> **◆ The unrepresentable state**
>
> **The architecture cannot express ownership that survives claiming.**
>
> It cannot record, of an event, that *whoever later claims this profile will hold authority over it* — because authority is bound to an account identifier, and at the moment of creation there is no account to name.

### What the blocker is not

Two adjacent statements are **not** the blocker, and stating them would overclaim:

-   **Not** "an event cannot exist without an account." It can. `events.host_id` is nullable, so a row with no human creator inserts today.
-   **Not** "an unclaimed profile cannot be referenced." It can. `venue_profile_id` already points at profiles regardless of claim status.

The gap sits entirely in **authority**. An event created with `host_id = NULL` is representable and permanently **inert**: every policy resolves `host_id = auth.uid()`, `NULL` matches nobody, and claiming the venue changes nothing because no policy consults `venue_profile_id`. The row exists; the relation that would later grant authority has nowhere to live.

> **Why this is a blocker rather than an inconvenience**
>
> The only way to deliver the capability under the previous model is to write ownership **after** the claim — ownership migration, performed at the moment the system learns who the owner is.
>
> That is precisely the operation that must not be required, and the project measured its cost before ratifying this. `U4` had to decide how to re-derive senders for twelve historical applications; for two of them **the answer was not recoverable at any price**, because the row never contained it. Ownership assigned retroactively has the same failure mode, on a catalog rather than a dozen rows, and with a worse consequence: an application with a null sender is an imperfect record, while an event with a null owner is **a live object nobody can manage**.

## O2 — Why §03's decision was right, and what changed

A new requirement, not a latent error.

§03 addressed a real fault: `events.host_id` was serving two roles at once. Its fix — split the column, keep authorization account-based, make public attribution profile-based via `venue_profile_id` — was correct for the system it governed.

**In that system, every event had a human at creation.** Events were created in the app by a signed-in host. There was no path by which an event could exist before its owner did, so binding authority to the creating account lost nothing and gained a check that was simple, obvious and cheap.

**Studio introduces the first events that exist before their owner.** An imported listing is attributed to a venue or promoter that has never signed up and may never do so. This is new information about the world the architecture must model, not a defect discovered in how it modelled the old one.

## O3 — Reconciliation with §A4

v1.1 §A4 rejects "the active profile determines ownership of everything". That rejection is correct and this amendment does not contradict it.

|  | §A4 rejects | v1.3 establishes |
| --- | --- | --- |
| **What decides authority** | The **active profile** — R6 UX state | A **stored column** — `owner_profile_id` |
| **Where it lives** | Client-held, per-session, changes on a switcher | Persisted on the row, written once at creation |
| **Trust** | Untrusted by definition (v1.1 R6) | A database fact, subject to R3.2 at write time |
| **Read at check time** | Yes — the check would consult a client selection | **No.** The check consults the row and `can_act_as` |

> **◆ O-R1 The active profile determines nothing**
>
> `can_act_as(profile_id)` remains the **sole** authorization mechanism (v1.1 §A4, R3). The active profile is not an input to it, is never consulted by a policy, and cannot influence who may manage an event.
>
> **The distinguishing test:** switching the active profile changes *nothing* about who can manage any event. If a proposed implementation fails that test, it is the formulation §A4 rejects and it must be refused.

> **◆ O-R2 §03's principle is preserved, not reversed**
>
> §03's rule is *"one column never again does both jobs."* This amendment keeps three columns doing three distinct jobs — see [O-R4](#o5).
>
> What changes is *which kind of identity the authorization column holds*, not how many jobs a column does. §03 separated authorization from attribution; this keeps them separated and moves only the former onto a stable identifier.

## O4 — Verified facts

Established against the live database, 18 Jul 2026, before ratification.

| Fact | Value | Consequence |
| --- | --- | --- |
| `events.host_id` nullable | **YES**, no default | No column alteration needed. A row with no human creator is already insertable — which is why §O1's blocker is about *authority*, not existence. `O-R6` forbids an event with no **owner**; a different column and a different claim. |
| `events.venue_profile_id` nullable | **YES**, no default | Location is genuinely optional — warehouses, parks, house shows. Confirms it cannot serve as the ownership column even though every row at ratification populated it. |
| Events with `venue_profile_id` populated | **24 of 24** | **No venue backfill required.** |
| `owner_profile_id` exists | **No** | The single column this amendment adds. |
| Authority resolved via | `host_id = auth.uid()` | Confirmed in the `applications` policies. The policy surface this eventually moves to `can_act_as`. |

## O5 — The amendment

Four rules. One column.

> **◆ O-R3 Objects belong to profiles**
>
> **Users authenticate. Profiles participate. Objects belong to profiles.**
>
> An object's owner is a **profile reference**, held on the object and stable across claiming. The account appears as authorship, delivery, dedup and authentication — never as ownership.
>
> **Every object also records the human who acted, and that record is never consulted for permission.** Ownership moves to the profile; authorship stays with the human. Dropping the second clause would trade one loss for another: accountability for who actually did this.

> **◆ O-R4 Applied to events — authority, location and authorship are three concepts**
>
> `events` gains **`owner_profile_id`**: the profile with authority, and the sole input to authorization. **Never null. Any profile type.**
>
> | Column | Concept | Cardinality | Null |
> | --- | --- | --- | --- |
> | `owner_profile_id` | **Authority** — who is accountable and may manage it | Exactly one | **Never** |
> | `venue_profile_id` | **Location** — where it happens | At most one | Yes — warehouses, parks, house shows |
> | `host_id` | **Authorship** — which human created the row | At most one | Yes — imports have none |
>
> **The owner column is deliberately neutral.** A venue-type owner is a venue running its own night; a host-type owner is a promoter presenting one; a festival-type owner is a festival programming its own bill. **The owner's `type` already tells the application how to present it** — no further column is needed to say what the owner already implies.
>
> **No `host_profile_id` is introduced.** Naming the authority column for one participant role would assert that every event has a host, which is false for venue-run nights, false for imports where the promoter is unknown, and false for Festival. A column whose name misdescribes a third of its rows compounds: every query, policy and screen written against it inherits the wrong model.
>
> **Owner equal to venue is normal, not degenerate.** A venue running its own night carries the same profile id in both columns because the same profile answers two different questions. Nothing needs to detect or special-case it.

> **◆ O-R5 Claiming grants authority without ownership migration**
>
> Claiming sets `user_id` on the profile (v1.0 §07 — attach is three fields, atomic). `can_act_as(owner_profile_id)` becomes true in the same instant, and every object already attributed to that profile becomes manageable — **whatever type that profile is.** A claimed venue gains its imported nights; a claimed promoter gains theirs. One mechanism, no type branch.
>
> **No row is rewritten.** This is not an optimisation of migration; it is the absence of migration, and it is the whole point of the amendment.

> **◆ O-R6 Every event has exactly one accountable owner**
>
> An event **must** resolve to exactly one owner profile. There is no ownerless event — at import or anywhere else.
>
> **For imports specifically:** Studio resolves an owner — creating an unclaimed profile where necessary — *before* import. If it can identify neither a responsible party nor a venue, the listing is **held for manual review, not imported.**
>
> This is not a Studio policy that the architecture happens to permit; it is the invariant that makes the rest of the model work. Every downstream system — RLS, editing, notifications, messaging, analytics, auditing, claiming — may rely on the owner being present without a null branch. Subsystems ask *who owns this event*, never *does this event have an owner*.

### Scope

**`events` only.** Per v1.1 §A3's audit and M6's work, every other profile-actionable table already carries a profile reference. `events` was the last object whose *authority* was account-based, which is what keeps this amendment to one column.

Unchanged and deliberately so: `profiles.user_id` (the claim link — definitionally an account), and every `*_user_id` delivery, dedup or authorship column. `venue_profile_id` is **not** an ownership field and is unaffected: it answers *where*, and it keeps answering only that.

## O6 — Assessment

Why a neutral owner, and what it costs elsewhere.

**1 · Should `host_id` become `owner_profile_id`?** No — **add alongside**. Renaming would destroy the record of which human created an event, and `O-R2` requires one column per job. Since `host_id` is nullable already, adding is purely additive.

**2 · Why neutral rather than role-named?** Because authority and role are different questions, and one column answering both is the fault §03 named. Today's owners are venues and promoters; tomorrow's may include festivals, organisations or community groups. **Under a neutral owner none of those require an amendment** — a new profile type is simply another possible owner, and the type field already carries the presentation difference.

**3 · Conflicts with RLS or workflow?** No conflict; a **scheduled change**. Moving authority to `can_act_as(owner_profile_id)` is the same operation R3.2 performs on `applications` and `follows`, so they land together rather than rewriting event policies twice. One real workflow consequence, not a conflict: an event owned by an unclaimed profile has no human behind it — no notification delivery identity (§A7 delivery is a user), no messaging route, and applications arriving for nobody to read. Recorded as [Phase 13](#o10) inputs.

**4 · Consistent with v1.2?** Yes. §A14 untouched; `can_act_as` remains sole authority; §A9's Personal exception (an account with no entity) is the mirror of what this permits (an entity with no account) — both directions were always in the model.

**5 · Does it simplify what follows?**

| Area | Effect |
| --- | --- |
| **Studio import** | Decisive — imports reference an identifier stable from creation, and the importer never decides what *kind* of thing the owner is. No placeholder accounts, no system user, no post-claim fixup. |
| **Claiming** | A no-op for ownership (`O-R5`), for any owner type. |
| **Messaging / notifications** | "The event's owner" is one lookup with no type branch. |
| **Analytics** | `owner_profile_id` plus the owner's type makes **venue-run versus promoter-run** a first-class dimension. A role-named column could answer that only by heuristic. |
| **Extensibility** | The decisive one. A new participant type becomes another owner without touching this amendment. |

## O7 — Documents affected

| Document | Change |
| --- | --- |
| **Architecture v1.0 §03** | The **authorization basis** clause for events is superseded. §03's separation principle is preserved (`O-R2`); only the identity kind of the authority column changes. |
| **Identity v1.1 §A3** | **No change.** Its audit remains accurate as a description of the pre-v1.3 schema. |
| **Identity v1.1 §A4** | **No change.** §O3 reconciles rather than amends. |
| **Identity v1.2** | **No change.** |
| **Publication model** (draft) §P8 | An imported event starts `PRIVATE`; "imported" must never imply "listed". Consistent; the authority question is a Phase 13 input. |
| **Communication architecture** (draft) | An unclaimed owner has no delivery identity — Phase 13 input. |

## O7b — Governance impact

**What kind of change this is.** The first amendment to supersede a clause of Architecture v1.0 on grounds other than an internal contradiction. v1.1 superseded §01, §03 and §05 because v1.0 contradicted itself (§A1's `B1`, `B2`). This supersedes §03's *authorization basis* because a new requirement cannot be expressed — §00's other limb.

> **The precedent is narrow and must stay narrow**
>
> A new product capability justifies amendment **only when the capability is unrepresentable**, never when it is merely awkward. Anything less reopens the architecture on preference, which §00 exists to prevent.

**Canonical set becomes four.** v1.0 + v1.1 + v1.2 + v1.3, each binding except where a later one names a clause.

**Citation interface.** v1.3 uses prefix `O` (`O-R1`–`O-R6`, §O0–§O11), unused elsewhere, so no existing citation is ambiguated. Nothing is renumbered anywhere.

## O8 — Migration · conceptual

Four phases. No new milestone.

**Phase 1 · Additive.** `owner_profile_id` added, nullable at the schema level. Nothing reads it. **No column is altered.** Phase 1 also cuts over writes: event creation stamps the owner from the acting profile via the M6 seam, so no event created after phase 1 needs backfilling.

**Phase 2 · Backfill.** Derive from `host_id` under `U4`'s rule — infer where the account owns exactly one eligible profile.

> **U4 cannot be reused wholesale**
>
> For an application, a null sender is an inert historical record. **For an event, a null owner is a live object nobody can manage**, and `O-R6` forbids one existing at all. Ambiguous events must be *resolved*, never left null.
>
> **A fallback exists that a role-named column could not have offered.** Where a creator cannot be resolved, `venue_profile_id` is a defensible owner: the venue demonstrably hosted the event, and under a neutral column that is simply a venue-type owner. It must be **offered as a decision, not applied silently** — assigning ownership to a venue that did not consider itself the organiser is a claim about the world, not a data repair.

**Phase 3 · Dual authority.** Policies accept `can_act_as(owner_profile_id)` **or** `host_id = auth.uid()`. This is M4's additive-permissive pattern, which v1.1 §A10 endorses because it makes cutover reversible. **Rides with R3.2.**

**Phase 4 · Contract.** The legacy arm is dropped at M8, leaving `can_act_as` as sole authority. **No new milestone and no new debt** — the transitional arm is removed by a milestone that already exists, and it has a named end from the outset.

## O9 — Risks

Ordered by cost, not likelihood.

| # | Risk | Mitigation |
| --- | --- | --- |
| **K1** | **A live event becomes unmanageable** — phase 4 drops the legacy arm before every event has an owner. Worse than a failed import: it hits existing users doing nothing wrong. | Phase 4 gates on a census — zero events with a null owner — exactly as M5.5 did. Never the other order. |
| **K2** | **Ambiguous backfill.** An account owning two eligible profiles has no recorded answer. Unlike `U4`, a null here *is* K1. | Resolve rather than null. Census the scale before writing the backfill. |
| **K3** | **Notifications and applications with no recipient.** The bad failure is silent: an artist applies, sees success, nobody ever reads it. | Phase 13 `Q1`. Make the artist-facing state honest either way. |
| **K4** | **Orphaned imports** accumulate against profiles nobody claims. | Product/Ops question; may imply a review queue or expiry. |
| **K5** | **Two authority paths during transition** (phases 3–4). Deliberate and bounded, but it is the state §03 warns about. | Removed at M8, a milestone that already exists. |
| **K6** | **This is read as reopening §A4.** | §O3 precedes the amendment and states the distinguishing test explicitly. |

## O10 — Phase 13 inputs

Consequences of this amendment, deliberately not resolved during ratification.

**Product decisions** — these do not reopen identity.

| # | Question |
| --- | --- |
| **Q1** | **Notification behaviour for unclaimed owners.** An unclaimed owner has no delivery identity (§A7 delivery is a user). Notifications, applications and messages addressed to such an event — held until claim, or suppressed? |
| **Q5** | **Publication authority for imported events before claim.** Imports start `PRIVATE` and `can_act_as` is false for an unclaimed owner, so nobody can advance the stage. A catalog nobody can see defeats the purpose of importing one. |

**Potential architectural follow-ups** — these may require an Identity v1.4. Their purpose during Phase 13 is to *determine whether* one is required, not to answer them.

| # | Question |
| --- | --- |
| **Q6** | **Ownership transfer.** Correcting a mis-attributed import is transfer, which v1.1 §A12 `U3` defers as "not a v1 operation". Sharper under a neutral owner: correction may cross profile *types*, so any answer must permit re-pointing to a different type, not only a different profile. **Determine whether `U3` remains deferred or requires reopening identity.** |
| **Q7** | **Claim verification.** Claiming now grants authority over a catalog rather than an empty profile, so a wrongful claim yields immediate control of every imported event attributed to that profile. Claims are reversible per §07, but the exposure window is materially larger than the model was designed against. **Determine whether verification requires strengthening.** |

> **Also outstanding — an observation gap, not a design gap**
>
> **R3.2 remains pending end-to-end verification of real client writes carrying `from_profile_id`.** The resolver is proven for every account and the write sites are cut over, but no write from the deployed client has yet been observed carrying attribution.
>
> This did not block ratification and does not block Phase 13 design. It blocks *applying* the restrictive policy, because a policy that rejects writes lacking a valid owned profile must not be applied against an unverified cutover.

## O11 — Ratification record

Per v1.0 §17, in the manner of v1.1 §A13 and v1.2 §B7.

<table><tbody><tr><td><b>Version</b></td><td>v1.3</td></tr><tr><td><b>Amends</b></td><td>Architecture v1.0 §03 — event authorization basis</td></tr><tr><td><b>Ratified</b></td><td>18 Jul 2026 · frozen</td></tr><tr><td><b>Change control</b></td><td>Architecture Specification v1.0 §17</td></tr><tr><td><b>Bar</b></td><td>§00 — unrepresentable state (<a class="inline" href="#o1">§O1</a>)</td></tr><tr><td><b>Supersedes</b></td><td>v1.0 §03's event authorization basis. Nothing else.</td></tr><tr><td><b>Adds</b></td><td><code>O-R1</code>–<code>O-R6</code>; <code>events.owner_profile_id</code> as a specification</td></tr><tr><td><b>Renumbers</b></td><td>Nothing</td></tr><tr><td><b>Guarantees weakened</b></td><td><b>None.</b> §A5, §A3, §A4, §A9, §A10's "no retrofit" and the backfill principles all stand.</td></tr><tr><td><b>Drafting history</b></td><td>Proposed 18 Jul; rewritten the same day after its original justification (an asserted discrepancy with §A3) was disproven; amended again after a design review replaced <code>host_profile_id</code> with a neutral <code>owner_profile_id</code>. Both corrections preceded ratification.</td></tr></tbody></table>

> **From v1.3 onward**
>
> Work against v1.0, v1.1, v1.2 and v1.3 is **implementation only**. They change solely via a further versioned amendment, and solely if implementation uncovers a genuine contradiction or an unrepresentable state. Preference, taste and optimisation do not reopen them.
>
> **If you believe you have found a contradiction: stop and surface it. Do not route around it.**
