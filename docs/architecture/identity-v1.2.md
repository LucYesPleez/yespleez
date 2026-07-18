> # ⚠ CONVENIENCE COPY — NOT AUTHORITATIVE
>
> **The canonical document is [`identity-v1.2.html`](identity-v1.2.html).** This Markdown is a
> mechanically-converted reading copy, for diff-review and GitHub navigation only.
>
> **If this file and `identity-v1.2.html` disagree, `identity-v1.2.html` is correct and this file is wrong.**
> Do not cite this file. Do not edit it by hand — it is regenerated from the HTML by script.
>
> Conversion is lossy by nature. Known losses: SVG diagrams are replaced by placeholders;
> callout semantics (rule / risk / decision / principle) survive only as their text labels;
> the sidebar table of contents is dropped. **No prose, rule number, or table cell was altered.**
>
> Status: RATIFIED v1.2 — 18 Jul 2026 · frozen. Rule numbers are a stable citation interface — never renumber.

YesPleez v2 · Architecture Amendment

# Identity Architecture v1.2

A minimal amendment to Identity Architecture v1.1 under Architecture Specification v1.0 §17. Narrows the blocking scope of `U2` and records the boundary between identity architecture and communication design. It changes nothing else.

**Status**  RATIFIED v1.2 — 18 Jul 2026 · frozen **Amends**  v1.1 (17 Jul 2026) **Change control**  v1.0 §17 **Supersedes**  §A12 `U2` blocking scope (one cell)

## B0 — Scope, and why it is this small

Two changes. Everything else in v1.1 stands exactly as ratified on 17 July 2026.

| # | Change | Where |
| --- | --- | --- |
| **1** | `U2` blocking scope: *"Blocks M8"* becomes *"Blocks public launch. Does not block M8 implementation."* | §A12, one table cell |
| **2** | A new section recording that communication **design** is specified elsewhere, while identity **rules** remain governed here | §A14, new |

Nothing is rewritten, modernised, restructured or clarified in passing. The prose of v1.1 is not improved. **An amendment that tidies while it amends is how paraphrase enters a canonical record.**

> **v1.1 remains canonical**
>
> This is an **amendment, not a replacement**. Identity Architecture v1.1 remains binding in full except for the single cell listed above, and `identity-v1.1.html` is preserved as historical reference so existing citations stay resolvable. **No rule number is renumbered by this amendment.**

## B1 — The bar, and why this clears it

This amendment does not rely on the blocker clause in v1.0 §00, because it reopens no rule.

> **◆ `U2` is a listed open question, and this resolves part of it**
>
> §A12 exists precisely for this: *"Known open questions. Listed so they are decided deliberately rather than by accident of implementation."*
>
> **Deciding an entry in §A12 is the intended lifecycle of that section, not an amendment to the architecture.** v1.1 did exactly this to `U1` — marked it *"closed"*, struck its options, and recorded the resolution — within the same document that introduced it.
>
> This amendment follows the `U1` precedent, with one difference: `U1` was closed outright, whereas `U2` is **narrowed in scope but remains open**. Its question is unchanged and still requires legal input; only what it blocks changes.

### What changed in the world to permit it

A **product decision** by the owner, 18 July 2026: *conversations help people discuss opportunities; workflows record official commitments.* Applications, Invitations, Bookings and Agreements are the authoritative record; Messenger is not.

`U2` asked what happens when *"account deletion leaves authored messages in a profile inbox"*, and it blocked M8 because the answer determined **what messaging must be built to preserve**. Under the product decision that determination is made: messaging preserves communication, workflow objects preserve the record. The schema follows from the decision, not from the legal answer.

**The legal question is unchanged and unanswered.** It has moved in the sequence, not in substance.

> **Why this amendment does not cite the Communication Architecture as its authority**
>
> The Communication Architecture is a **draft** and carries no authority. A frozen canonical document may not rest a rule on a document that has none — doing so would canonise the draft by citation, without ratification.
>
> This amendment therefore rests on the **product decision of the owner**, recorded in [§B7](#b7) as provenance. The Communication Architecture is referenced only as *where the resulting design is specified*, and §A14 states its status explicitly rather than implying authority it does not have.

## B2 — Change 1 · §A12 U2

One cell. The question column is untouched.

### Current text (v1.1 §A12)

| # | Question | Blocks |
| --- | --- | --- |
| **U2** | **Erasure vs. business record** — account deletion leaves authored messages in a profile inbox (§A5) | Blocks M8. Legal input required. |

### Amended text (v1.2)

| # | Question | Blocks |
| --- | --- | --- |
| **U2** *(narrowed, v1.2)* | **Erasure vs. business record** — account deletion leaves authored messages in a profile inbox (§A5) | **Blocks public launch. Does not block M8 implementation.** Legal input required. Narrowed by the product decision that structured workflows, not messaging, are the authoritative record (§A14). The question is unchanged. |

**The only cell that changes is the third.** Any citation of the substance of `U2` remains accurate.

## B3 — Change 2 · new §A14

Placed after §A13 so no existing section number moves.

> **§A14 — Relationship to the Communication Architecture**
>
> Communication **design** — the conversation model, message semantics, retention domains, and the boundary between messaging and structured workflows — is specified in the **Communication Architecture**, a separate document.
>
> **This document remains the canonical source for identity architecture.** Where the two touch, the identity rules in v1.0 and v1.1 govern and the Communication Architecture implements them. It may not weaken, reinterpret or except any of them; where it appears to, it is wrong.
>
> **Status at the time of this amendment:** the Communication Architecture is a draft and is not canonical. This section records the division of subject matter, which holds regardless of the status of that document. It grants it no authority.
>
> The product decision recorded in [§B7](#b7) — that structured workflows are the authoritative record — is what narrows `U2` (§A12). That decision stands on its own and does not depend on the Communication Architecture being ratified.

## B4 — Justification for every added word

New wording is explained rather than silently introduced.

| Wording | Why it is required |
| --- | --- |
| *"Blocks public launch"* | `U2` must still block **something** — the legal question is real and unanswered. Removing the block entirely would be weakening a guarantee. "Public launch" names the point at which retention and erasure obligations attach in practice. |
| *"Does not block M8 implementation"* | Stated explicitly rather than left as an inference. An implementer must be able to read the answer, not derive it. |
| *"Legal input required"* | **Retained verbatim from v1.1.** Deleting it would weaken the guarantee. |
| *"The question is unchanged"* | Prevents a future reader concluding that narrowing the block also narrowed the question. It does not. |
| *"Narrowed by the product decision that…"* | Records *why* on the row itself. A blocking scope that changed without a stated cause invites re-litigation. |
| §A14 *"remains the canonical source for identity architecture"* | Without it, a later reader could infer that the newer document supersedes the older on shared ground. It does not. |
| §A14 *"where it appears to, it is wrong"* | Mirrors the construction the Communication Architecture already uses about v1.1, making the subordination explicit from both sides. |
| §A14 *"It grants it no authority"* | Prevents this amendment from ratifying a draft by reference — see [§B1](#b1). |

**No other wording is added.** In particular this amendment does not define "public launch", does not characterise any legal position, and does not describe the workflow domain — all of which belong to other documents or to legal review.

## B5 — What does not change

Every guarantee below is untouched and remains binding.

| Guarantee | Where | Status |
| --- | --- | --- |
| Conversations belong to profiles; every message records its human author | §A5 | **Unchanged** |
| The identity pair `(from_profile_id, from_user_id)` | §A3 | **Unchanged** |
| `can_act_as(profile_id)` as the sole ownership predicate | §A4 | **Unchanged** |
| Attribution ≠ authorization | §A4 · §01 | **Unchanged** |
| **Messaging is built profile-owned from day one. No retrofit.** | §A10 (M8) | **Unchanged** |
| Milestone sequencing M6 → M7 → M8 | §A10 | **Unchanged — no amendment required.** v1.1 already sequences M8 after M6 and M7. Messaging remains dependent on both. |
| **Backfill principles** — *"Do not let a backfill silently guess"* | §A10 | **Unchanged** |
| `U4` blocks M6 | §A12 | **Unchanged and still blocking** |
| `U3` transfer policy · `U5` · `U6` | §A12 | **Unchanged** |
| Personal is inalienable; the Personal exception | §A9 | **Unchanged** |
| M5.5 Personal profile census as a precondition for `NOT NULL` | §A10 | **Unchanged and still required** |

> **No guarantee is weakened**
>
> This amendment adds a scoping section and edits one cell in a register of open questions. **It has no reach into any rule.**

## B6 — Consequences

What this amendment does and does not unblock.

| Question | Answer |
| --- | --- |
| **Is `D15` in the Communication Architecture resolved?** | **Yes.** `D15` existed because that document cannot downgrade the blocker of a frozen document by asserting it. Ratifying v1.2 is the proper mechanism, and `D15` is discharged by it. |
| **Does M8 become unblocked?** | **No.** `U2` no longer blocks it, but M6 and M7 remain incomplete and `U4` still blocks M6. The prerequisites of M8 are unchanged. |
| **Does M6 become the next active milestone?** | **Yes**, the owner having ended the soak period and decided `U4` on 18 July 2026. |
| **What remains before messaging implementation?** | M6 complete · M7 complete · M5.5 census confirmed. Separately, the Communication Architecture should be ratified before it is implemented against. |

## B7 — Amendment record

Per v1.0 §17, in the manner of v1.1 §A13.

<table><tbody><tr><td><b>Version</b></td><td>v1.2</td></tr><tr><td><b>Amends</b></td><td>v1.1, ratified 17 Jul 2026, frozen</td></tr><tr><td><b>Ratified</b></td><td>18 Jul 2026 · frozen</td></tr><tr><td><b>Change control</b></td><td>Architecture Specification v1.0 §17</td></tr><tr><td><b>Supersedes</b></td><td>§A12 <code>U2</code> blocking scope (one table cell). Nothing else.</td></tr><tr><td><b>Adds</b></td><td>§A14</td></tr><tr><td><b>Renumbers</b></td><td>Nothing</td></tr><tr><td><b>Provenance</b></td><td>Product decision of the owner, 18 Jul 2026: <em>conversations help people discuss opportunities; workflows record official commitments.</em> Structured workflows — Applications, Invitations, Bookings, Agreements — are the authoritative record; Messenger is not.</td></tr><tr><td><b>Bar</b></td><td>§A12 is a register of open questions and exists to be decided deliberately. Narrowing an entry follows the <code>U1</code> precedent set within v1.1 itself and is not a reopening of any rule.</td></tr><tr><td><b>Guarantees weakened</b></td><td><b>None.</b> See <a class="inline" href="#b5">§B5</a>.</td></tr><tr><td><b>Citation impact</b></td><td>None. Verified 18 Jul 2026: <code>U2</code> is cited nowhere outside <code>docs/architecture</code>. Nothing is renumbered.</td></tr></tbody></table>

> **From v1.2 onward**
>
> Work against v1.0, v1.1 and v1.2 is **implementation only**. They change solely via a further versioned amendment, and solely if implementation uncovers a genuine contradiction or an unrepresentable state. Preference, taste and optimisation do not reopen them.
>
> **If you believe you have found a contradiction: stop and surface it. Do not route around it.**
