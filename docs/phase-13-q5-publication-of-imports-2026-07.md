# Phase 13.1 · Q5 — Publication of imported events

**18 Jul 2026 · design proposal.** Product and architecture design. No implementation, no SQL.
Identity v1.3 is canonical and unchanged by anything here.

**The question.** Who may publish an imported event before its owner has claimed the profile?

---

## 0 · Reframing, before the options

The options are usually argued as *"may we publish private information about a business that never
joined?"* That framing is wrong, and getting it wrong distorts every option that follows.

**A gig listing is already public.** Studio imports what is on a poster, an Instagram post, a venue's
own website, a ticketing page. YesPleez is not disclosing a private fact; it is **aggregating a
public one**, which is what gig guides, listings papers, Songkick and Bandsintown have always done.

**But two things are genuinely at stake, and they are different from each other:**

| | Publishing the **event** | Presenting the **owner** |
|---|---|---|
| What it does | Repeats a public listing | Creates a profile that can look like participation |
| Industry norm | Universal and expected | Not a norm — this is ours to get right |
| Risk if wrong | Stale or inaccurate listing | A business appears to have joined a platform it has never heard of |

Every option below is really answering the second column. **The first is not seriously contested**,
and treating it as if it were is what makes Option A look safer than it is.

---

## 1 · The options assessed

### Option A — imported events remain `PRIVATE` until claimed

**It fails, and it fails structurally rather than marginally.**

An unclaimed owner cannot advance the stage — `can_act_as()` is false by design (v1.3 `O-R4`,
§A9) — so a `PRIVATE` import stays `PRIVATE` until somebody claims. But:

> **The claim incentive comes *from* visibility.** A venue claims its profile because it can see
> its nights on YesPleez and wants control of them. Under A there is nothing to see. Nobody claims,
> so nothing publishes, so nobody claims.

Option A is not a cautious version of the product. It is **a different product** — a private seeding
tool whose catalog activates only through outreach the platform would have to do by hand, venue by
venue. That may be a legitimate business, but it is not the one Studio was scoped to enable, and it
should be chosen deliberately if chosen at all.

*Assessed:* discovery ✗ · Studio workflow ✗ · claiming workflow ✗ (removes its own trigger) ·
trust ✓ · moderation ✓ · complexity ✓.

### Option B — Studio publishes automatically

Discovery works and the catalog is real. Two objections, one weak and one decisive.

**The weak objection: "we published a business's information without consent."** Per §0, the listing
was already public. This is weaker than it sounds.

**The decisive objection: nobody is accountable for what went out.** Publication would be a
side-effect of an import job. There is no actor to name in an audit, no one to answer a venue's
"who put this here", and no gate between a bad scrape and the public. Under the publication model,
**publication is an act** — someone decides content is ready. Option B makes it a consequence of
a cron run.

It also makes Studio a publisher in its own right, which the publication model's §P8 forbids.

*Assessed:* discovery ✓ · Studio workflow ✓ · auditability ✗ · moderation ✗ · trust ✗ ·
T&S ✗ · P8 ✗.

### Option C — Operations holds publication authority until claim

**Correct in shape.** It keeps `O-R6` intact (the owner exists throughout), makes publication an act
by an accountable party, and hands authority to the owner the moment they claim.

**But C as stated is silent on the thing that actually matters** — how the *unclaimed owner* is
presented while Ops is publishing on its behalf, and what recourse the real owner has when they
arrive. Those silences are where the trust problem lives, and they are what §2 adds.

---

## 2 · Recommendation — Custodial publication

> ### Operations publishes imported events **as custodian**, never as owner. Custody ends the instant the profile is claimed.

Option C, with five constraints that make it honest rather than merely workable — two of them added after review: `P-C5` separates publication from ingestion, and `P-C6` stops custody becoming permanent by default.

### `P-C1` · Publication authority and ownership authority are different questions

Ownership authority (`can_act_as`, v1.3) answers *who may manage this event*. **Publication
authority** answers *who may advance its visibility*. Normally the same profile answers both.

**For an unclaimed owner they diverge, and only temporarily:** ownership sits — correctly and
unusably — with the unclaimed profile, while publication authority sits with Operations **as
custodian**. Nothing about v1.3 changes; `can_act_as(owner_profile_id)` remains false and remains
the sole test of *ownership* authority.

> **This is not a loophole in `O-R1`.** The active profile still determines nothing. Custodial
> authority is a stored, auditable grant held by Operations for a defined period, not a client-side
> selection, and it governs visibility rather than management. An Ops custodian **cannot edit,
> cancel, or accept applications on** an imported event — custody is publication only.

### `P-C2` · An unclaimed owner must be visibly unclaimed, everywhere

Wherever an imported event or its owner appears publicly, the profile is **marked unclaimed** and
carries a claim invitation.

This is the clause that resolves §0's second column. The platform may say *"this event is happening
at The Chippo"* — a public fact. It may **not** imply *"The Chippo is on YesPleez"* — which would be
false, and is the actual reputational risk. The unclaimed marker converts a potential
misrepresentation into the product's own acquisition funnel.

### `P-C3` · Claiming grants immediate retraction, and non-claiming grants opt-out

**On claim**, the owner receives full publication authority *including the ability to unpublish
immediately*. Custody ends; nothing is negotiated.

**Without claiming**, a business may request removal through a route that **does not require signing
up.** Requiring someone to join a platform in order to leave it is a dark pattern, and building the
catalog on one would poison the relationship with exactly the venues Studio exists to reach.

> Together these make custodial publication **provisional**: the platform publishes on a reasonable
> presumption, and the moment the real party appears — by claiming or by objecting — the presumption
> yields. That is what makes it defensible rather than presumptuous.

### `P-C4` · Imports publish to `LINEUP` at most, never `TIMETABLE`

Under the publication ladder, an import may reach `LISTED` (the event exists) and `LINEUP` (the
announced bill) — both of which are on the poster Studio read.

**`TIMETABLE` is never custodially published.** Set times are typically unannounced, frequently
change, and are the stage an owner most obviously wants control of. Studio will rarely have them and
must not publish them if it does.

### `P-C5` · Publication is policy-gated, and Studio is not the editor

**Studio must never publish because it imported.** An event is published because it satisfies a
stated **publication policy**, and because a custodian then authorises it. Import is ingestion; it
carries no editorial weight.

A candidate is **eligible** for custodial publication when it:

- derives from a **public source** — a poster, a venue site, a ticketing page, a public post;
- **passes review** by a human custodian;
- is **not a duplicate** of an existing event, imported or owner-created;
- has **not been withdrawn** by a prior objection or opt-out (`P-C3`);
- **satisfies moderation** standards.

> **Eligibility is necessary, never sufficient.** A policy that publishes automatically on passing is
> **Option B with extra steps** — the accountability objection returns in full, because no person
> decided anything. The policy decides what *may* be published; the custodian decides that it *is*.
>
> This is also what keeps Studio an **ingestion tool rather than an editor**. Studio proposes;
> Operations publishes. Collapsing those two makes Studio a publisher, which is exactly what §P8
> exists to prevent — and the distinction will be quietly eroded by convenience unless it is written
> down as a rule rather than a habit.

---

### `P-C6` · Custody is time-boxed, never indefinite

**Custodial publication expires.** Without an expiry, "temporary custody" becomes permanent
ownership by default — and it does so silently, which is the failure mode nobody notices until
unwinding it is expensive.

Three mechanisms, addressing different halves of the problem:

| Mechanism | Applies to | Why |
|---|---|---|
| **Natural expiry** | The event | A custodially published event passes its own date and becomes archive. Custody over a past event is meaningless and should lapse rather than persist. |
| **Source revalidation** | Future events | If the public source that justified publication disappears — listing pulled, page dead, event cancelled at source — the justification is gone and the event returns to `PRIVATE`. Publication rested on that source under `P-C5`. |
| **Profile review horizon** | The owner profile | A profile that has carried custodial publications for a defined period **without ever being claimed** is reviewed: still trading? still accurate? still worth publishing? Either revalidated or retired. |

The third is the one that matters, because it is the only one that catches **accumulation**. The
first two clear individual events; a venue that never claims will otherwise sit behind an endlessly
refreshing stream of custodially published nights, none individually stale, collectively amounting
to a business the platform publishes indefinitely without consent.

> **The exact durations are a product decision, not an architectural one** — but *having* a horizon
> is architectural, because it is the difference between custody and de facto ownership.

---

## 3 · Lifecycle of an imported event

```
                    Public Source
                          │
                          ▼
                    Studio Import                 ← ingestion only (P-C5)
                          │
                          ▼
                  Publication Policy              ← eligibility, not permission
                   ┌──────┴──────┐
              fails│             │passes
                   ▼             ▼
              Held / Review   Ops authorises      ← the act (P-C1)
                                 │
                                 ▼
                  Custodial Publication (Ops)     ← LISTED / LINEUP only (P-C4)
                   owner shown UNCLAIMED (P-C2)
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
    Opt-out                Profile Claimed          Custody Expires
  (no account              (can_act_as true)        (P-C6: stale source,
   required, P-C3)               │                   past date, or
        │                        ▼                   review horizon)
        │                  Custody Ends              │
        │                  (no migration, O-R5)      │
        ▼                        │                   ▼
    → PRIVATE                    ▼               → PRIVATE
                        Owner Controls Event
                        (full ladder, may
                         retract — P-C3)
```

**Read the three branches as one claim:** custodial publication always ends. It ends by consent
(claim), by objection (opt-out), or by time (`P-C6`). There is no path in which it simply continues.



| Stage | Publication state | Who is authorised | Notes |
|---|---|---|---|
| **1 · Ingested** | `PRIVATE` | Ops (review only) | Owner resolved per `O-R6` — if none can be, the listing is **held, not imported**. |
| **2 · In review** | `PRIVATE` | Ops | Human moderation. Nothing public. Bad data dies here. |
| **3 · Custodially published** | `LISTED` → `LINEUP` | **Ops as custodian** (`P-C1`) | Discoverable. Owner shown unclaimed with a claim invitation (`P-C2`). |
| **4 · Claim initiated** | unchanged | Ops · claimant verifying | Publication state does not move during verification. |
| **5 · Claimed** | unchanged, now owner-controlled | **Owner** — `can_act_as` now true | **Custody ends automatically.** No migration, no state change, no re-publication (v1.3 `O-R5`). |
| **6 · Owner in control** | owner's choice | Owner | May advance to `TIMETABLE`, or retract entirely (`P-C3`). |
| **—** · Objection without claim | → `PRIVATE` | Ops, on request | Opt-out route (`P-C3`). |

**Stage 5 is the payoff and it is deliberately boring.** Nothing happens to the data. `can_act_as`
flips, custody lapses, and the owner has authority over content that has been theirs the whole time.
That is `O-R5` working exactly as ratified.

---

## 4 · Publication state transitions

```
                 ┌─────────── Ops review ───────────┐
   import ──▶ PRIVATE ──▶ LISTED ──▶ LINEUP ──▶ (TIMETABLE: owner only)
                  ▲          │          │
                  └──────────┴──────────┘
                     retract: Ops (pre-claim) or owner (post-claim)
```

- **Forward transitions pre-claim:** Ops only, to `LINEUP` maximum (`P-C4`).
- **Forward transitions post-claim:** owner only, full ladder.
- **Backward transitions:** Ops pre-claim; owner post-claim; Ops at any time on an opt-out request.
- **Claim itself moves nothing.** It changes *who may move it*.

---

## 5 · Required amendments to the Publication Model

The publication model is a **draft**, so these are revisions to an unratified document — no
canonical text is disturbed.

**5.1 · `P8` needs a precision, not an exception.** It currently says Operations must never
re-publish. Its intent is that **Ops may not publish content an owner has withheld** — and that
intent is correct and must survive. But imported content was never withheld: there was no owner in a
position to withhold it. The clause should distinguish:

> Operations may never publish content whose owner has chosen not to. Content with an unclaimed
> owner has had no such choice made, and is governed by custodial publication instead.

Without that precision, custodial publication reads as a violation of `P8` rather than a case `P8`
never contemplated.

**5.2 · Add custodial publication as a named concept**, with `P-C1`–`P-C6` as its rules: the
divergence of publication and ownership authority, the unclaimed-owner disclosure requirement, the
retraction and opt-out guarantees, and the `LINEUP` ceiling.

**5.3 · The `Q1` phased-announcement question is unaffected.** Per-participant publication and
custodial publication are orthogonal — one is about *which* participants are announced, the other
about *who may announce*.

**No amendment to Identity v1.3, v1.2, v1.1 or v1.0 is required.** Custody governs visibility;
ownership is untouched.

---

## 6 · Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **A venue objects publicly** — "you listed us without asking". The reputational damage lands on the platform, not the import job. | `P-C2` makes the unclaimed status visible so the claim was never implied; `P-C3` makes removal available without signing up; and Ops review (stage 2) means a human saw it. Worth preparing the response *before* the first objection, not during it. |
| **R2** | **Stale or wrong data goes public** under the platform's name, attributed to a business that cannot correct it. | Stage 2 review; and an unclaimed event's visible "claim this to correct it" doubles as the correction path. Consider an age cap on custodially published events. |
| **R3** | **Custody becomes permanent in practice** — nobody claims, and Ops-published events accumulate with no accountable owner. | **Addressed by `P-C6`:** natural expiry per event, source revalidation for future events, and a profile-level review horizon that catches accumulation. This is v1.3's `K4` with a mechanism attached. Durations remain a product decision; *having* a horizon does not. |
| **R4** | **Ops publication authority is abused or over-scoped** — it becomes a general "Ops can publish anything" power. | `P-C1` scopes custody to *publication only*, on *unclaimed owners only*, and every custodial act is attributable to a person. It must never extend to editing or to claimed profiles. |
| **R5** | **A wrongful claimant inherits a published catalog.** Custody ending on claim means a bad claim gains publication control immediately. | This is v1.3 `Q7`, and Q5 makes it sharper rather than solving it. **Flagged for Phase 13's `Q7`, deliberately not addressed here.** |
| **R6** | **Artists named on imported lineups** did not consent either — `P-C2` addresses the owner, not the bill. | Lineup names come from public posters, but the same unclaimed-marker logic should apply to imported artist profiles. Worth confirming during Studio import design. |

---

## 7 · Recommendation

**Adopt custodial publication** — Option C with `P-C1`–`P-C6`.

**Option A should be rejected on product grounds**, and it is worth being explicit about why: it is
not the cautious choice, it is a different product. It removes the visibility that motivates
claiming, so the catalog never activates.

**Option B should be rejected on accountability grounds.** The consent objection is weaker than it
first appears — these are public listings — but "no human decided to publish this" is not a position
the platform can hold when a venue asks who did.

**Custody works because it is honest about its own provisionality.** The platform publishes a public
fact, says plainly that the business has not joined, hands over control the instant they arrive, and
takes the listing down if asked. Every one of those is a promise the architecture can keep:
ownership was never in doubt (`O-R6`), authority transfer requires no migration (`O-R5`), and
`can_act_as` stays the sole test of ownership throughout (`O-R1`).

**Decide `R3`'s review horizon before Studio ships.** Custody with no expiry is how a temporary
arrangement becomes permanent by default — and that is the failure mode most likely to be noticed
only after it is expensive to unwind.

**`Q7` is now load-bearing for this design.** `R5` shows Q5 raises the stakes of a wrongful claim
rather than lowering them. That does not block adopting custodial publication, but the two should be
decided in the same phase and not in the opposite order.
