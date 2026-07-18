# Phase 13.3 · Q7 — Claim verification under increased stakes

**18 Jul 2026 · architectural risk assessment.** No implementation. Identity v1.3 unchanged by
anything here.

**The question.** Identity v1.3, Q5 and Q1 together mean a successful claim may immediately grant a
published catalog, held applications, held notifications, future workflow authority and subsequent
communications. **Does v1.0 §07's claim verification remain sufficient?**

---

## 0 · A correction to Q5, before assessing anything

Reading §07 properly meant reading §09 alongside it, and §09 — **Ethics**, ratified in v1.0 — already
contains most of what Q5 presented as new:

| Q5 proposed | v1.0 §09 already requires |
|---|---|
| `P-C2` unclaimed owners visibly unclaimed | *"Unclaimed profiles are clearly labelled and state they were compiled from public information. **Never imply the act joined or endorsed YesPleez.**"* |
| `P-C3` removal without an account | *"The real entity can request correction or removal **without creating an account**. Claiming is never the price of control over your own listing."* |
| `P-C5` public-source criterion | *"Only public, factual, scene-relevant data is imported. No private or personal data, ever."* |

**These were restatements, not proposals.** Q5 is not wrong — independent convergence on ratified
principles is reassuring — but I should have read §09 before writing it, and Q5 should be corrected
to cite §09 rather than to appear to invent it. §09 also adds constraints Q5 missed: imported data
marked *imported & unverified*, generic avatars only pre-claim, no "verified" styling pre-claim, and
a blocklist that gates re-import after removal.

§09 also carries a shipping condition Q5 did not surface: **"Must ship with, not after, public
unclaimed profiles."**

---

## 1 · What §07 actually provides

The shorthand — *"attach is three fields, atomic, ownership-reversible"* — undersells it. §07's
lifecycle is A→G, and three stages matter here:

| Stage | What it does |
|---|---|
| **C · Claim request** | Captures **claimant, target profile, asserted relationship, and evidence**. Status → `claim_pending`. The claimant's account works as a punter meanwhile. |
| **D · Verification** | Manual admin review now, **automated tiers later**. Approve → attach; reject → return to unclaimed with a reason; needs-info → hold. Described as **"the unlock gate for all held private data."** |
| **E · Ownership attached** | The atomic update. Ownership-reversible. |

> **§07 anticipated accrual.** Stage D is called the unlock gate *for held private data*, and §08
> — "While you were away" — exists solely to reveal *"the value that accrued while unclaimed"*, with
> **booking enquiries waiting** listed as its highest-priority reveal.
>
> Q5 and Q1 did not introduce the idea that a claim unlocks accumulated value. **They increased its
> quantity.** The structure was always there.

---

## 2 · What actually changed

Not the shape of the risk — its **magnitude**, and one property of the safety net.

### 2.1 · Magnitude

v1.1 deferred this when a profile held listing data and little else. It now holds a published
catalog, applications naming artists and fees, follower relationships, and correspondence history.
The gate is unchanged; what sits behind it is an order of magnitude more valuable.

### 2.2 · The asymmetry — and this is the finding

> **◆ Reversibility restores control. It cannot restore confidentiality.**
>
> §07 makes attach ownership-reversible, and that was a sufficient safety net when a wrongful claim
> yielded a profile page. It is no longer sufficient alone, because **a wrongful claimant who has
> read an artist's application cannot be made to un-read it.** Reversal returns authority; the
> disclosure has already happened.

This is why the ordering instinct — **prevention before correction** — is right, and it is more than
a preference. Reversal and prevention are not interchangeable controls: one is complete, the other
is not. As the held content grows, the incomplete control carries proportionally less of the load,
and prevention must carry the remainder.

---

## 3 · Assessment — is §07 sufficient?

**Structurally: yes.** §07 already provides evidence capture, a human verification gate explicitly
scoped to held private data, an atomic reversible attach, and a rejection path with reasons. There
is no missing *stage*. Nothing in Q5 or Q1 requires a step §07 does not have.

**Operationally: no.** §07 specifies *that* verification happens, not *how much*. It applies one
standard — "manual admin review" — to every claim, whether the profile holds nothing or holds a
year's catalog and thirty applications. **A single bar cannot be proportionate to a range of stakes
that Q5 and Q1 have just widened considerably.**

The gap is therefore **calibration, not construction**. And §07 anticipated even that: *"Manual admin
review now; **automated tiers later**."* Tiering is inside §07's envelope, not outside it.

---

## 4 · Does Identity require amendment?

**No — and the alternative should be explicitly rejected rather than left open.**

There are two ways to reduce wrongful-claim harm:

**(a) Make the gate proportionate.** Verification effort scales with what the profile holds. The
unlock stays atomic. §07 stage D absorbs this; no canonical text changes.

**(b) Make the unlock partial.** A claim grants publication control immediately, correspondence
after further verification.

> **(b) requires an Identity v1.4 and should not be adopted.** It contradicts v1.3 `O-R5` —
> *"every object already attributed to that profile becomes manageable in the same instant"* — and
> §07 stage F, which gates capabilities *"purely on `owner_user_id`"*. It would replace one clean
> predicate with a capability matrix, and every future feature would have to ask which tier of
> claimed it is dealing with.
>
> **Harden the door; do not partition the room.** The elegance of the ownership model is that
> claiming is one act with one consequence. Fragmenting that to compensate for a verification
> weakness fixes the wrong layer.

**Therefore: no v1.4 from Q7.** Identity v1.0–v1.3 stand unamended.

---

## 5 · The governance instrument

**A Claim Verification Policy**, operating inside §07 stage D. Operational policy, not architecture —
the same class as the Ops governance policy the communication architecture defers to (`D17`).

It should specify at least:

**5.1 · Proportionate tiers.** Evidence required scales with what the profile holds — nothing,
custodially published events, held applications and correspondence. The tier is a function of
accrued value, which the system can compute rather than an admin having to judge.

**5.2 · Public claim transparency.** A pending claim is **visible on the public profile** —
*"a claim on this profile is under review."*

> This is the cheapest prevention available and it is not currently specified anywhere. The
> legitimate owner is, by definition, the party best placed to notice a false claim on their own
> venue — and under Q5 their profile is already publicly visible with a claim invitation on it.
> **Publishing the pending state turns every person who knows the venue into a check.** It also
> follows directly from §09's transparency principle.

**5.3 · A contest window before attach**, at least for higher tiers. Attach is already gated on
approval; a stated interval between approval and attach gives 5.2 time to work.

**5.4 · Recorded verification tier.** Which tier approved a claim is retained. §09 forbids
*"verified" styling pre-claim*; the corollary is that post-claim trust signals must not overstate a
light-touch approval.

**5.5 · `P6` answered.** v1.0 lists *"how long may `claim_pending` sit before auto-expiry?"* as an
open question gating §07 stage D. It matters more now: **a pending claim parked on a valuable
profile is a squatting surface**, and an indefinite pending state also blocks the legitimate owner.

**5.6 · Reversal procedure that accounts for disclosure.** Given §2.2, reversal should record what
was accessible during wrongful control, so the affected artists and venue can be told. Reversal
cannot undo disclosure; it can at least stop it being silent.

---

## 6 · Risks

| # | Risk | Note |
|---|---|---|
| **Q7-R1** | **Verification burden throttles growth.** Every claim needing manual review does not scale, and the tier that matters most is the slowest. | Proportionality cuts both ways — most claims are low-stakes and can stay light. The cost lands only where the value does. |
| **Q7-R2** | **A wrongful claim succeeds anyway.** No verification is perfect, and §2.2 means the disclosure is unrecoverable. | 5.2 and 5.3 add independent checks that do not depend on admin judgement. 5.6 makes the aftermath honest. |
| **Q7-R3** | **Legitimate owners are turned away** by a bar set too high — the worst commercial outcome, since these are the users Studio exists to convert. | Tier by *accrued value*, not by suspicion. A venue claiming a profile with two events should not face what a 200-event catalog requires. |
| **Q7-R4** | **Public claim transparency (5.2) tips off a squatter** that a profile is contested, or exposes a claimant's identity. | Publish the *fact*, never the claimant. The signal is "under review", not who is reviewing or who asked. |
| **Q7-R5** | **Custodial publication continues during a disputed claim**, so the platform keeps publishing while ownership is contested. | Q5's `P-C1` keeps custody with Ops until attach, so this is already correct — but it should be stated, since the intuition is that a pending claim pauses things. It does not, and should not. |
| **Q7-R6** | **Policy drift** — the verification policy weakens over time under conversion pressure, with no architectural floor to stop it. | The real residual risk of choosing (a) over (b). Mitigated only by keeping the policy explicit, versioned and owned, rather than living in an admin's habits. |

---

## 7 · Recommendation

**§07 is structurally sufficient and operationally under-specified. Calibrate it; do not amend
Identity.**

1. **No Identity v1.4 from Q7.** v1.0–v1.3 stand. Partial unlock is rejected on the grounds in §4.
2. **Write a Claim Verification Policy** under §07 stage D, covering 5.1–5.6.
3. **Adopt public claim transparency (5.2) regardless of tiering.** It is the highest-value,
   lowest-cost prevention available, it is not currently specified anywhere, and it follows from §09
   rather than extending it.
4. **Answer `P6`** — the abandoned-claim expiry window — as part of the same policy. It was already
   an open question gating §07 stage D; Q7 makes it load-bearing.
5. **Correct Q5** to cite §09 for `P-C2`, `P-C3` and `P-C5`, and to incorporate the §09 constraints
   it missed: *imported & unverified* marking, generic avatars pre-claim, no "verified" styling
   pre-claim, and the re-import blocklist.

> **The honest summary is that v1.0 saw this coming.** §07 named stage D the unlock gate for held
> private data, and §09 wrote the ethics of publishing about people before they consent. Q5 and Q1
> did not create a new problem — they made an anticipated one materially larger, and the response
> belongs in policy that v1.0 already reserved space for.
