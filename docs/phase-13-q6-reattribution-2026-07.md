# Phase 13.4 · Q6 — Correcting a mis-attributed event

**18 Jul 2026 · design proposal.** No implementation. Identity v1.0–v1.3 unchanged by anything here.

**The question.** An event was imported against the wrong owner profile. How is that corrected?

---

## 0 · A text tension in ratified v1.3, surfaced not routed around

v1.3 §O3 describes `owner_profile_id` as *"Persisted on the row, **written once at creation**."*
Everything below proposes writing it a second time.

**Is that a contradiction?** Read in context, no. The phrase sits in a table row headed *"Where it
lives"*, contrasting a stored column with §A4's rejected client-held active profile. Its job is to
say *not re-evaluated per session*. It is describing **provenance and persistence, not
immutability**.

**But the words as frozen do say "written once",** and an implementer reading only that line would
reasonably conclude correction is forbidden. That is worth recording rather than resolving by
confident reading.

> **Recommended governance: an `errata.md` entry, not a v1.4.**
>
> This matches how `E1` was handled — the frozen text stays, the erratum records what it means, and
> operative documents cite the erratum. The directory's rule 3 is explicit: *"Errors are recorded,
> not fixed."*
>
> **Proposed `E2`:** *v1.3 §O3's "written once at creation" describes persistence as against
> client-held state, not immutability. `owner_profile_id` is correctable under the reattribution
> rules; correction is an audited, exceptional operation and never a routine write.*

If the owner prefers, this is instead the trigger for a v1.4 — but a versioned amendment to clarify
one parenthetical phrase seems disproportionate against the precedent set by `E1`.

---

## 1 · Q6 is three questions, and only one is transfer

The framing *"ownership transfer after an attribution error"* bundles three operations with very
different risk. Separating them is most of the answer.

| | Situation | What is really happening |
|---|---|---|
| **Case 1** | Event mis-imported; **neither profile claimed** | Ops correcting its own import before anyone relies on it |
| **Case 2** | Event mis-attributed; **current owner has claimed**, and disputes losing it | A genuine ownership **dispute** |
| **Case 3** | Event mis-attributed; **current owner agrees** it belongs elsewhere | Consented **reattribution** |

**Only Case 2 is contested**, and it is a dispute rather than a mechanism. Cases 1 and 3 are
routine — one is data correction, the other is two parties agreeing.

---

## 2 · Why `U3` does not govern this

v1.1 §A12 `U3` defers *transfer policy — inbox handling when ownership changes hands*. It is
frequently cited as blocking Q6. **It does not, because it is about a different object.**

| | `U3` — profile transfer | Q6 — event reattribution |
|---|---|---|
| **What moves** | A **profile** changes owner-*human* | An **event** changes owner-*profile* |
| **Column touched** | `profiles.user_id` | `events.owner_profile_id` |
| **What v1.0 said** | §03: `owner_user_id` is *"set once, on claim"* | §03 says nothing — the column did not exist |
| **Who is affected** | Everything the profile owns, and its entire inbox | One event |

`U3` asks *"a venue changed hands — what happens to its conversations?"* Q6 asks *"this gig was
filed under the wrong business."* Answering Q6 requires nothing from `U3`, and **`U3` remains
deferred**, untouched.

> That distinction is not a technicality. Conflating them would either block a routine import
> correction behind an unrelated deferred question, or drag profile transfer forward without the
> analysis it needs.

---

## 3 · Rules

### `T1` · Reattribution is an exception, never a workflow

Correcting an owner is an **audited exceptional operation**. It is not exposed as a routine "change
owner" control, because a column that can be casually rewritten stops being an anchor — every
downstream assumption in v1.3 rests on ownership being stable in normal operation.

### `T2` · Pre-claim correction is Ops data correction (Case 1)

Where **neither** the current nor the proposed owner is claimed, reattribution is Operations
correcting an import. No human's authority changes, because no human had any.

This is the overwhelmingly common case — mis-attribution is an import-quality problem, and import
quality is worst before anyone is watching. It should be **cheap and routine for Ops**, gated only
by the audit requirement (`T6`).

### `T3` · Post-claim reattribution requires consent or adjudication (Cases 2 and 3)

Once an owner has claimed, reattribution **takes authority from someone who legitimately holds it**.
Two paths and no third:

- **Consent (Case 3)** — the current owner agrees. Recorded, then executed.
- **Adjudication (Case 2)** — Operations decides a dispute, using the same evidence standard as a
  contested claim (Q7 §5). Reattribution away from a claimed owner without their consent is
  **materially the same act as reversing a claim**, and should meet the same bar.

> **A wrongful reattribution is a wrongful claim by another route.** If it were easier than
> contesting a claim, it would become the way to attack one.

### `T4` · Everything scoped to the event moves with it

Applications, event follows, held notifications and lineup relationships were **about the event**,
not about its owner. They travel.

The alternative — stranding applications against a profile that no longer owns the gig — would leave
artists having applied to nobody, which is the silent failure Q1 exists to prevent.

### `T5` · Publication travels, and may return to custody

The publication state moves with the event. **If the new owner is unclaimed, custodial publication
resumes** under Q5 `P-C1` — the event is published, nobody can manage it, Ops holds custody.

That reads oddly and is correct: publication authority follows ownership, and ownership is now an
unclaimed profile. Nothing special-cases it.

### `T6` · Reattribution is audited, reversible, and never silent

Recorded: who, when, from which profile, to which profile, on what basis. Reversible on the same
terms as a claim.

**Both parties are notified** — the losing owner because authority left their profile, the gaining
owner because it arrived. An ownership change nobody is told about is indistinguishable from a
defect.

### `T7` · `O-R6` holds throughout

Reattribution is atomic. The event has exactly one owner before, exactly one after, and **at no
point none** (v1.3 `O-R6`). There is no intermediate ownerless state, even transiently.

---

## 4 · What does *not* move — and it is the same asymmetry as Q7

> **Reattribution restores authority. It cannot restore confidentiality.**

If a claimed owner has already read applications naming artists and their fees, moving the event
elsewhere does not un-read them. This is Q7 §2.2 recurring, and it has the same consequence:
**prevention beats correction**, so `T3`'s bar exists precisely because the correction is
incomplete.

It follows that Case 2 disputes should be **rare by design**. The place to prevent them is Studio's
import-time owner resolution (v1.3 `O-R6`) — holding an ambiguous listing for review rather than
guessing an owner and correcting later. **A held listing costs one review; a wrong owner costs a
dispute, a disclosure and a reattribution.**

---

## 5 · Risks

| # | Risk | Note |
|---|---|---|
| **T-R1** | **Reattribution becomes routine** and ownership stops being a stable anchor. | `T1`. Exposed as an Ops exception, never a user-facing control. |
| **T-R2** | **Reattribution used as an attack** — take a contested event by requesting a move rather than contesting the claim. | `T3` sets the same evidence bar as a contested claim, closing the cheaper route. |
| **T-R3** | **Disclosure already occurred** before correction (§4). | Unrecoverable. Mitigated by preventing the error at import (`O-R6`), and by telling affected parties per `T6`. |
| **T-R4** | **Stranded artifacts** if `T4` is implemented partially — applications following but held notifications not, or vice versa. | Specify the set once, in one place, rather than per artifact type. |
| **T-R5** | **The `E2` erratum is missed** and an implementer refuses reattribution on the strength of "written once at creation". | Record `E2` before Studio implementation, and cite it from `CLAUDE.md`. |

---

## 6 · Recommendation

1. **`U3` remains deferred.** Q6 does not touch it (§2). Profile transfer is still not a v1
   operation.
2. **No Identity v1.4.** The only tension is the §O3 phrase, and it resolves as an erratum.
3. **Record `errata.md` `E2`** per §0, before Studio implementation.
4. **Adopt `T1`–`T7`** as the reattribution rules, to sit with the Claim Verification Policy (Q7 §5)
   rather than in the architecture — same reasoning as Q7: **Identity defines what authority is;
   policy defines the evidence and process for changing who holds it.**
5. **Treat Case 2 as a failure to prevent, not a feature to build.** Import-time owner resolution is
   where mis-attribution is cheap to fix; every case that reaches dispute represents a review that
   did not happen.

> **Phase 13's four questions are answered and none required an amendment.** Q5 and Q1 produced
> policy; Q7 produced policy; Q6 produces policy and one erratum. The architecture ratified this
> morning has absorbed publication of unowned content, held communications, claim-value escalation
> and ownership correction **without a single rule changing** — which is the strongest evidence
> available that v1.3 was specified at the right level.
