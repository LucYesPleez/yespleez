# Phase 13.2 · Q1 — Notifications targeting an unclaimed owner

**18 Jul 2026 · design proposal.** Product and architecture design. No implementation, no SQL.
Identity v1.3 canonical and unchanged. Builds on Q5's custodial publication model.

**The question, narrowed by Q5.** Not *"should unclaimed owners receive notifications?"* — Q5 settled
that unclaimed owners are real, visible, and publish through a custodian. The remaining question is:

> **What happens to a notification whose recipient profile exists but whose recipient human does
> not?**

---

## 0 · The model already anticipated this

v1.1 §A7 gives notifications **three independent identities**:

| Identity | Meaning | For an unclaimed owner |
|---|---|---|
| `about_profile_id` | The **subject** — what it concerns | ✅ resolves |
| `to_profile_id` | The **recipient** — which profile it is scoped to | ✅ resolves |
| `user_id` | The **delivery** — which human receives it | ❌ **does not exist** |

§A7 was explicit that *"the profile a notification is **about** may have no owner at all — it is a
third, independent identity."* The unclaimed case is not a gap in the model; **it is the case the
third identity was separated out to handle.** Q1 extends that from *subject* to *recipient*.

**Consequence:** a notification to an unclaimed owner is fully representable. It has a recipient and
no delivery leg. Nothing needs inventing — only deciding what to *do* with it.

---

## 1 · The real question underneath

The notification is downstream of something else. Nobody notifies a venue at random — a notification
exists because **an artist applied**, **someone followed**, **an enquiry was sent**. So Q1 cannot be
answered without answering:

> **May a workflow target an unclaimed owner at all?**

Under Q5, imported events are **discoverable** (`LISTED`/`LINEUP`). An artist browsing Discover finds
a real gig at a real venue and wants to play it. What happens when they press apply?

### The two failure modes, and why the obvious answers pick one each

**Close the workflow — "applications are disabled for this event."** Honest, no silent failure. But
it discards the strongest claim signal the platform will ever generate: *three artists want to play
your venue*. And it makes the imported catalog look broken — a listing you cannot act on.

**Open the workflow silently — application submitted, nobody reads it.** The artist waits weeks for
an answer from a venue that does not know the platform exists. **The platform knew and said
nothing.** This is the K3 silent failure from v1.3, and it is the worst outcome available: it burns
the artist's trust to buy a claim signal.

> **Neither is necessary, and the resolution is the same one Q5 reached: be honest at the point it
> matters.** Permit the action, and tell the sender exactly what will happen to it.

---

## 2 · Recommendation — hold, disclose, deliver on claim

> ### A notification to an unclaimed profile is **created and held**, never suppressed. The sender is told it is being held. It delivers when the profile is claimed, or expires trying.

### `N1` · Held, not suppressed

The notification is written with its recipient (`to_profile_id`) and **no delivery identity**. It is
not sent, and it is not discarded.

Suppression is the wrong default because it destroys the record: the platform would have no way to
answer *"did anyone try to reach this venue before it joined?"* — and that answer is the entire
claim pitch. **A held notification is an asset; a suppressed one is a deleted fact.**

### `N2` · The sender is told, before they act

Anyone acting toward an unclaimed profile sees that it is unclaimed and that their action will be
**held rather than delivered**, at the point of acting — not afterwards, and not in help text.

This is `P-C2` applied to the workflow side. Q5 required the platform to be honest about claim status
where the profile is *displayed*; `N2` requires the same where the profile is *acted upon*. Both
exist to prevent the same misrepresentation: that a business is participating when it has never
heard of the platform.

> The artist then makes an informed choice. Some will apply anyway — a held application costs them
> little and may pay off. Others will not. **Either is fine; being surprised is not.**

### `N3` · Claiming delivers everything held

On claim, held notifications become deliverable to the new owner. Nothing is re-created, nothing
migrates — the same shape as `O-R5`: the notifications were always scoped to that profile, and
claiming supplies the human they were waiting for.

**This is the payoff that makes the whole model worth building.** A venue claims its profile and
finds three applications, twelve followers and two enquiries waiting. That is a far stronger
onboarding moment than an empty dashboard, and it is generated entirely by honesty rather than by
growth-hacking.

### `N4` · Held notifications expire by their own time-sensitivity, not a global clock

A held item expires when it stops being useful — and that differs by kind:

| Kind | Expiry | Why |
|---|---|---|
| **Application** | With the event | An application delivered after the gig is worse than none: it tells the venue about an opportunity they already missed, and tells the artist their message sat unread. |
| **Enquiry** | Date-bound, per the enquiry | Same reasoning — it names a date. |
| **Follow** | Does not expire | Not time-bound. *"Twelve people follow you"* is as true in six months, and is pure claim incentive. |
| **System / moderation** | Per Ops policy | Not owner-directed communication. |

> A global TTL would get this wrong in both directions — expiring follows that stay valuable, and
> retaining applications long past the gig. **Time-sensitivity is a property of the message, not of
> the holding.**

### `N5` · Operations does not receive held notifications

Custody is **publication only** (`P-C1`). A custodian may publish a venue's event; a custodian may
**not** read an artist's application to that venue, or answer on its behalf.

This boundary matters more than it looks. Once Ops can read held communications, custody stops being
"we made a public listing visible" and becomes "we are operating this business's inbox" — which is
the drift `P-C1` was written to prevent, arriving through a different door.

**Held notifications are visible to Operations only as counts, never as content**, and only where
needed to administer expiry and claim outreach.

### `N6` · No cold outreach is manufactured from held items

Held notifications must not be repurposed into unsolicited contact — the platform emailing a venue
*"three artists want to play at yours, sign up to see"* using contact details scraped during import.

That converts an honest holding pattern into a growth tactic, and it is precisely the behaviour that
would make `P-C2`'s claim invitation read as a pretext. **The claim invitation is on the profile,
where the venue will find it.** Whether the platform may contact venues directly is a separate
question with its own consent requirements, and it must not be answered by accident here.

---

## 3 · Per-workflow behaviour

| Workflow | Permitted toward an unclaimed owner? | Notification |
|---|---|---|
| **Follow** | ✅ Yes | Held indefinitely. Delivered on claim. |
| **Application** | ✅ Yes, with `N2` disclosure | Held until the event passes. Delivered on claim. |
| **Enquiry** | ✅ Yes, with `N2` disclosure | Held until its date passes. |
| **Direct message** | ❌ **No** | Communication draft `C17` — no route to an unclaimed profile, and no conversation exists to hold. Unchanged by this document. |
| **Invitation from the owner** | ❌ Not applicable | Requires acting *as* the profile; `can_act_as` is false. |
| **System / moderation** | ✅ Ops-directed | Not owner communication (`N5`). |

**Messaging stays closed and that is deliberate.** A conversation is a two-party relationship (§A5);
holding one half of it for months would be a worse experience than refusing it. Applications and
follows are one-directional acts with a natural holding shape. **This is the line between an act you
can leave for someone and a conversation you cannot have alone.**

---

## 4 · Lifecycle

```
   Artist acts on an imported event
                 │
                 ▼
        Recipient unclaimed?
          ┌──────┴──────┐
       no │             │ yes
          ▼             ▼
     Delivered     N2: sender told it will be held
     normally             │
                          ▼
                 Notification CREATED
                 to_profile_id ✓  delivery ✗          ← N1
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
  Profile Claimed    Expiry reached    Opt-out (Q5 P-C3)
        │            (N4, by kind)           │
        ▼                 │                  ▼
  Delivered to        Discarded          Discarded
  new owner (N3)      (sender not        with the
  — no migration       re-notified)      withdrawal
```

**The invariant matches Q5's.** A held notification always resolves — by delivery, by expiry, or by
withdrawal. **Nothing is held forever, and nothing is silently dropped at the moment of creation.**

---

## 5 · Amendments required

**Communication architecture (draft)** — `C17`'s no-cold-DM rule is unchanged and reaffirmed:
messaging remains closed to unclaimed profiles. Add a note that *workflow-generated notifications*
are a different class and are held per `N1`–`N6`.

**Publication model (draft)** — no change. Q1 concerns delivery, not visibility.

**Identity v1.0–v1.3** — **no change.** §A7's three identities already model a recipient without a
delivery leg; Q1 decides behaviour, not structure.

---

## 6 · Risks

| # | Risk | Mitigation |
|---|---|---|
| **N-R1** | **The held pile becomes a growth lever** — pressure to email venues about waiting applications. | `N6`. Worth stating in the terms as well as the architecture, because this pressure will be commercial rather than technical. |
| **N-R2** | **An artist applies, is told it is held, and still feels misled** when nothing comes of it. | `N2` disclosure must be at the point of acting and in plain language. Consider showing the artist the held state in their own applications list, rather than a status implying it was received. |
| **N-R3** | **A claim delivers a flood** — a venue claims and receives 200 notifications at once. | Deliver as a **summarised onboarding state** rather than 200 individual items. The content is already grouped by kind and profile. |
| **N-R4** | **Ops sees content it should not** while administering expiry. | `N5` — counts, never content. This must be enforced, not merely intended, since the administrative need is real. |
| **N-R5** | **Wrongful claimant receives held communications** — including applications naming artists and their fees. | This is `Q7` again, and Q1 raises its stakes exactly as Q5 did: a bad claim now yields not just a catalog but a correspondence history. **Flagged for `Q7`, not solved here.** |

---

## 7 · Recommendation

**Adopt hold-and-disclose** — `N1`–`N6`.

The decision that carries the rest is `N2`. Holding without disclosure is the silent failure that
makes the platform complicit; disclosure turns the same mechanic into an informed choice, and costs
nothing but honesty at the moment of acting.

**Suppression should be rejected** because it destroys the record that makes claiming attractive, and
**silent holding should be rejected** because it spends the artist's trust to buy the venue's
attention.

**`Q7` has now been raised twice.** Q5 gave a wrongful claimant a published catalog; Q1 gives them a
correspondence history. Neither document solves it, and both make it more consequential. It should
be the next question after `Q6`, and it should not be allowed to slip behind Studio implementation.
