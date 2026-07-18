# Phase 13 — Studio Design

**Opened 18 Jul 2026**, on ratification of Identity Architecture v1.3.

**This is a design phase, not an implementation phase.** Studio implementation begins when this
design is frozen. Nothing here is built.

---

## Why this phase exists

Identity and ownership are settled. v1.0, v1.1, v1.2 and v1.3 are canonical and frozen, and v1.3
established the invariant Studio depends on:

> **Every event has exactly one accountable owner profile** (`O-R6`), and claiming that profile
> grants authority over everything it owns with no ownership migration (`O-R5`).

The four questions below are **consequences** of that architecture rather than gaps in it. They were
identified during v1.3's drafting and deliberately excluded from ratification.

---

## Scope

### Product decisions — these do not reopen identity

| # | Question |
|---|---|
| **`Q5`** | **Publication authority for imported events before claim.** Studio has imported a valid event: it has an owner profile, a venue, artists and relationships — but the owner has not claimed the profile. **Should the event be visible?** Imports start `PRIVATE` and `can_act_as()` is false for an unclaimed owner, so on today's rules nobody can advance the publication stage. A catalog nobody can see defeats the purpose of importing one. |
| **`Q1`** | **Notification behaviour for unclaimed owners.** An unclaimed owner has no delivery identity — §A7's delivery leg is a *user*, and there is no user. Notifications, applications and messages addressed to such an event have nowhere to go. **Held until claim, or suppressed?** The bad failure here is silent: an artist applies, sees success, and nobody ever reads it. |

**`Q5` is first.** It decides whether the imported catalog is visible at all, which is a question
about what the product *is* rather than how it is built. A "not until claimed" answer makes Studio a
seeding tool; a "visible" answer means publication authority and ownership authority are separable
and that separation must be written into the publication model.

> **One option worth putting on the table for `Q5`:** publication authority for imported content
> sits with Operations *until* the profile is claimed, then transfers to the owner automatically.
> That preserves `O-R6` completely — the owner always exists — and makes the pre-claim exception
> explicit and bounded rather than implicit.

### Potential architectural follow-ups

**Their purpose in this phase is to determine *whether* an Identity v1.4 is required — not to answer
them.** Both touch frozen documents, so neither can be settled inside Studio design.

| # | Question |
|---|---|
| **`Q6`** | **Ownership transfer.** Correcting a mis-attributed import is transfer, and v1.1 §A12 `U3` defers transfer as *"not a v1 operation"*. Import at scale makes mis-attribution likely enough that the deferral may stop holding. Sharper under a neutral owner: correction may cross profile *types* — a venue-owned import turning out to be a promoter's event — so any answer must permit re-pointing to a different type, not only a different profile. **Determine: does `U3` remain deferred, or does it require reopening identity?** |
| **`Q7`** | **Claim verification.** A claim now grants authority over a populated catalog rather than an empty profile, so a wrongful claim yields immediate control of every imported event attributed to that profile. Claims are reversible under v1.0 §07, but the exposure window between claim and reversal is materially larger than the model was designed against. **Determine: does claim verification require strengthening?** |

---

## Explicitly out of scope

- **Studio implementation.** Not until this design is frozen.
- **Answering `Q6` or `Q7` substantively.** Determining whether they need architecture is in scope;
  deciding the architecture is not.
- **M6 changes.** M6 stays exactly as it is.
- **R3.2.** Deferred on an observation gap (below), not on anything Phase 13 decides.

---

## Carried forward — an observation gap, not a design gap

**R3.2 remains pending end-to-end verification of real client writes carrying `from_profile_id`.**

The resolver is proven for every account, all seven write sites are cut over, and the build is
clean — but **no write from the deployed client has yet been observed carrying attribution**. The
restrictive policy must not be applied until one has, because it would reject exactly the writes it
exists to validate.

This does not block Phase 13 design, and it does not block Studio design decisions. It blocks
*applying* one policy. It is recorded here so it is a known open loop rather than a forgotten one —
and it will most likely close on its own once Studio puts real data through the app.

---

## Exit criteria

Phase 13 is complete, and Studio implementation may begin, when:

1. **`Q5` and `Q1` are decided** and written down — including, for `Q5`, any consequence for the
   publication model.
2. **`Q6` and `Q7` are classified** — each either closed as "no architecture required", or raised as
   a v1.4 proposal.
3. **The Studio import contract is specified** against v1.3: how an owner is resolved, what happens
   when it cannot be, and what the review queue does with a held listing (`O-R6`).

Then: freeze the Studio design, and implement against ratified Identity v1.3.
