> # ✅ CANONICAL — RATIFIED AND FROZEN
>
> **Ratified 21 Jul 2026.** This document is binding. It specifies the architecture of messaging
> availability — the boundary between public participation and private communication.
>
> It contains **no SQL, no schema, no components, no hooks, no services, no RLS, no realtime code**.
> That is deliberate: it specifies the architecture, not its implementation.
>
> **Rule numbers `MA1`–`MA12` and `DA1`–`DA4` are frozen** — a stable citation interface. They may
> never be renumbered. They are namespaced to this document and do not refer to rules in
> `communication-v1.0` (`C`/`D`), `architecture-v1.0` (`§`), `identity-v1.1`–`v1.3` (`R`/`B`/`D`/`A`)
> or `publication-v1.0` (`P`).
>
> **This Markdown file is the canonical, authoritative artifact.** It was authored in Markdown, so
> the Markdown *is* the authored record. Converting it to HTML would make the derived file
> canonical, inverting the principle the rule protects (see [`README.md`](README.md)).
>
> Status: **RATIFIED v1.0** — 21 Jul 2026 · frozen. Amendment record at **§10**.
>
> **Amendments** are made by minting a new version (`messaging-availability-v1.1`), never by editing
> this file — the same rule that makes `identity-v1.1` a separate file from `identity-v1.0`.

YesPleez · Architecture Specification

# Messaging Availability Constitution v1.0

The canonical design for withdrawing communication without withdrawing participation. Defines what
messaging availability governs, what it may never touch, the identity at which it is enforced, its
effect on workflow conversations, and the decisions deferred to later revisions.

**Status** CANONICAL — ratified and frozen 21 Jul 2026 **Governed by** Communication v1.0 (frozen) ·
Identity v1.1 §A4 (frozen) **Implements** the amendment `D9`/`D12` anticipated
**Scope** Scene · Festival · Operations · Studio · future products

---

## Constitutional principles

Three rules are **constitutional**: they define what this feature is, and everything else in this
document is a consequence of them. A future implementation that finds one of them inconvenient has
found the point at which it must stop and surface the conflict (`architecture-v1.0` §00) — not the
point at which it may make an exception.

| Rule | Principle |
|---|---|
| **`MA1`** | **Messaging availability governs communication only.** It never alters a profile's public visibility or participation anywhere in the ecosystem. |
| **`MA2`** | **Availability is pair-scoped and symmetric.** It closes one channel between two parties. It is not a property of a person, and it is never one-directional. |
| **`MA5`** | **Human communication stops; system communication continues.** The professional record does not depend on two people being willing to speak. |

`MA1` is the mirror of `C32`. `C32` prohibits conversation content from entering the platform's
decision systems; `MA1` prohibits communication state from altering a profile's standing in them.
Together they are one wall with private communication on one side and the public scene on the other,
and neither is permitted to reach across it.

---

## §0 — Governance position

**This document is an amendment in the sense `communication-v1.0` anticipated, not a reopening of
it.** `M8b` records the deferral in the platform's own words:

> *"§2.4's right to remove one's own contribution is deferred with `D9`/`D12`, **not denied; granting
> it later is additive**."*

Availability is the same shape of grant: additive, and expressible entirely within the permission
model `communication-v1.0` §4 already defines. Nothing here alters the conversation model, the
context model, the notification architecture or the voice pipeline.

**What this document is bound by and may not reopen:** Communication v1.0 `C1` (communication is
infrastructure), `C25` (Messenger is not the authoritative record), `C26` (copy, never reference),
`C29` (AI does not enter private conversations), `C32` (conversation content is excluded from
decision systems), §2.2 (access derives from `can_act_as` and nothing else), §4.4 (losing permission
leaves history readable). Identity v1.1 §A3 (the identity pair), §A4 (`can_act_as` as sole ownership
predicate), §A9 (Personal is inalienable). Where this document appears to disagree with any of them,
it is wrong.

**Why this exists now.** `M8h` made cold contact a ratified capability — any authenticated profile
may open a conversation with any other, with no consent step and no recipient lever. That decision
was deliberate and this document does not question it. But a platform that permits consentless
contact and provides no means to end it has shipped only half of a design. **Availability is the
counterweight to `M8h`, and the two belong to the same feature.**

---

## §1 — Philosophy

### 1.1 The question this answers

The reflexive question is *"how do we let users block each other?"* — and it produces the wrong
architecture, because it imports an answer from products whose shape YesPleez does not share.

On a social network, blocking means mutual disappearance: you leave each other's world. That is
coherent there, because the relationship *is* the visibility. On YesPleez it is incoherent. Two
people who do not wish to speak privately may still be:

- an artist and a venue on the same lineup,
- a promoter and a DJ at the same festival,
- two acts sharing a bill on the same night,
- a performer and a venue whose past bookings are public professional history.

Making one of them disappear from the other's view would falsify the public record of a scene that
exists independently of whether two of its members are on speaking terms.

So the question is not *"how do we block people?"* It is:

> **What is the boundary between public participation and private communication?**

The answer this document ratifies: **they are separate systems, and only the second one is
negotiable between two parties.**

### 1.2 Goals

Give any user an immediate, unilateral means of ending unwanted private contact · preserve the
professional record and the public scene completely · avoid creating a retaliation moment · keep the
professional workflow functioning between parties who will not speak · remain compatible with future
moderation without becoming it.

### 1.3 Non-goals

Punishment · moderation · reporting · suspension · content review · hiding profiles · altering
discovery, ranking or analytics · any effect visible to a third party.

### 1.4 Design principles

**One channel, not one person.** Availability describes the state of a link between two parties, not
a property of either of them. A profile is never "blocked"; a channel is closed.

**Withdrawal is not judgement.** A user who ends contact is not accusing anyone. The system must not
require them to, and must not signal that they have.

**The public record is not a party to the dispute.** Nothing a third party can see may change.

---

## §2 — What availability governs

### 2.1 The rule

When messaging is made unavailable between two parties, then **as between those two parties, and
only as between those two parties**:

- neither may initiate a new conversation with the other,
- neither may send a human message into any existing conversation with the other,
- both retain full read access to all existing conversation history (§5),
- system messages continue to flow in both directions (§4).

> **`MA2` Pair-scoped and symmetric**
>
> Availability is a property of a **pair**, never of a profile or a person. A party with messaging
> unavailable to one counterparty is entirely unaffected in every other conversation on the
> platform.
>
> It is **symmetric**: the channel closes in both directions. Asymmetric availability — where the
> party who withdrew may still send while the other may not answer — is a megaphone, not a boundary,
> and is more harmful than the situation it replaces.
>
> A specification that says "the affected profile cannot send new messages", unqualified, has
> described a **platform suspension** and violated `MA1`. Every statement of effect in this document
> is pair-scoped, and any future statement that is not is a drafting error.

### 2.2 What it must never touch

`MA1` is absolute. Messaging availability has **no effect whatsoever** on:

| Surface | |
|---|---|
| Discover · Search | Both parties remain fully discoverable to each other and to everyone else. |
| Public profiles | Remain visible, complete and unchanged. |
| Events · Set times · Festival lineups | Both parties appear normally, including on the same bill. |
| Venue pages | Unchanged. |
| Public applications and history | The professional record is untouched. |
| Analytics | No signal is emitted. Availability is not a ranking input, in either direction (`C32`). |
| Notifications about public activity | Follows, announcements and public events are unaffected. |
| Any third party's experience | Nothing observable changes for anyone who is not one of the two parties. |

> **`MA3` No inference from availability**
>
> Availability state may not be read by any recommendation, ranking, matching, moderation or
> analytics system, and may not be surfaced to any third party in any form — including as an
> aggregate, a score, or a signal that two profiles "do not work together".
>
> This follows from `C32` by symmetry: if conversation *content* may not inform platform decisions,
> the *fact of a withdrawn conversation* may not either. It is the most private thing the system
> knows about a relationship.

### 2.3 Who may set it

Either party, unilaterally, without stating a reason, without notifying the other, and with
immediate effect. Either party may re-enable it — the same act that closed the channel reopens it.

No approval, no waiting period, no counterparty consent. A boundary that requires permission is not
a boundary.

---

## §3 — Enforcement identity

### 3.1 The problem

Identity v1.1 makes a human the owner of many profiles. A user who withdraws contact is withdrawing
from a **person**, but the interface they are looking at shows a **profile** — an artist, a venue,
a promoter.

If availability were keyed to the profile, the same human returns immediately under a different hat:
made unavailable as *Garyy · Artist*, and *Garyy · Personal* is in the inbox a moment later. The
boundary would be polite, visible, and useless in precisely the case it exists for.

### 3.2 The rule

> **`MA4` The interface names a profile; enforcement resolves to the human**
>
> The user acts on the profile in front of them, because that is the entity they recognise and the
> only one they can see. **Enforcement resolves that profile to its owning human server-side** and
> closes the channel between the two humans, across every profile either of them holds.
>
> The resolution happens inside elevated predicates that already read the profile→owner relationship
> to answer `can_act_as`. **No part of the linkage is exposed to either user**, in the interface or
> in any response: the boundary is enforced at the identity the architecture knows, and displayed at
> the identity the user knows. §A3's separation of attribution from audit identity is preserved
> exactly.
>
> **Unclaimed profiles have no owning human.** For those, availability falls back to the profile id
> itself. This is correct rather than a compromise: an unclaimed profile is not yet a person, and
> when it is claimed, `MA4`'s human resolution applies from that moment forward.

### 3.3 Delegation

Where a human can act as a profile owned by someone else (a manager acting for an artist),
availability is evaluated against **the human performing the act** — the concrete session identity —
not against every human who could act as that profile.

The reason is that availability is about people, not permissions. A manager who was never party to
the withdrawal is not the person being avoided, and closing the channel to them would extend a
personal boundary into a professional relationship it was never aimed at. Correspondingly, a human
who has had a channel closed cannot reopen it by acting through a profile they administer.

---

## §4 — Workflow conversations

### 4.1 The decision

> **`MA5` Human communication stops everywhere; system communication continues**
>
> Availability applies to **every** conversation between the pair, including workflow conversations
> — applications, bookings, invitations, events, venues.
>
> Human-authored messages are refused in all of them. **Messages authored by the platform through a
> system profile (`C29`, §4.5) continue to flow in both directions, in every affected conversation.**
>
> Both parties therefore continue to receive the professional facts — set time changed, deposit
> received, application withdrawn, booking cancelled — while neither can speak to the other.

### 4.2 Why, in full

Two options were weighed. **Option A** (ratified above): availability affects every thread, system
messages continue. **Option B**: availability affects direct conversations only; workflow
conversations remain fully writable because a professional relationship exists.

The decisive arguments are not elegance — the options were tested against the scenarios this domain
actually produces:

**The motivating case does not discriminate.** For harassment by a stranger, no workflow exists and
the two options behave identically. Any preference formed by thinking about cold contact alone is
formed on a case where the choice is irrelevant.

**Option A protects better where protection matters most.** The severe case is not a stranger; it is
abuse *inside* a professional relationship — a counterparty who turns hostile in a booking thread,
where money, dependency and fear of losing the work are all present. Under Option B that thread
stays writable *because* the booking exists, leaving the boundary open exactly where the power
imbalance is worst and the victim is least able to walk away.

**Option B has a laundering hole by definition.** If workflow conversations are always writable, then
initiating a workflow *manufactures* a writable channel. A party with messaging unavailable applies
to the other's event and is handed a fresh line of contact. Applications and bookings become the
vector the withdrawal just closed. This is not an implementation gap that can be patched; it is what
Option B *is*, and every patch converges on Option A.

**The professional cost is bounded by the system-message channel.** Option A's objection is that
closing workflow threads breaks coordination. `MA5` answers it: the structured facts still arrive.
The gig does not fall apart because two people stopped speaking.

### 4.3 The accepted cost

> **`MA6` Unstructured coordination is knowingly sacrificed**
>
> Information with no structured representation — *"parking's round the back tonight, gate code
> 4471"* — **cannot cross the platform** between parties with messaging unavailable. This is a real
> operational cost and it is **accepted deliberately, not overlooked**.
>
> It is accepted because the alternative is worse. A boundary that starves a user of information they
> professionally need is a boundary they will drop under pressure — and a withdrawal reversed under
> duress is more harmful than none, because it teaches the user the protection is conditional on
> their willingness to absorb professional damage.
>
> The party who withdrew did so knowing the engagement exists. Gigs have managers, promoters,
> production contacts and phones. Where two parties to a professional engagement can exchange no
> information by any channel whatsoever, the failure is not in the messaging system.
>
> **This clause exists so the cost is found in this document rather than discovered in support
> tickets.** It is a trade, and naming it as one is what makes this a constitution rather than a
> preference.

### 4.4 The clause that keeps `MA5` from collapsing

> **`MA7` System messages carry structured state only**
>
> A system message represents a **state change in a platform object**. It may carry identifiers,
> statuses, times, amounts and the platform's own generated wording. It may **never** carry free
> text authored by a participant — no notes, no comments, no annotations, no "message to the artist"
> field, no exceptions, in any conversation, whether or not availability is in effect.
>
> Without this clause `MA5` is defeated in a day: a hostile party edits a booking repeatedly to
> deliver notes through the system channel, and Option A has silently become Option B with extra
> steps. **`MA7` is what makes `MA5` enforceable**, and any future workflow feature that wants a
> free-text field delivered into a conversation is in conflict with this document (§10).

---

## §5 — History

> **`MA8` History remains readable to both parties, permanently**
>
> Withdrawing availability closes the channel forward. It does not remove, hide, redact or restrict
> anything already said, for either party.
>
> This follows §4.4 of `communication-v1.0`, whose `restricted` state is defined as history-readable
> with writing refused — availability produces the same shape of state by a different route.
>
> The reason is professional rather than sentimental. These conversations contain agreed fees,
> arrival times, load-in details, rider terms, accommodation and parking arrangements. Under `C25`
> the workflow is the authoritative record, but the conversation is frequently the only place the
> *reasoning* exists. Removing it because two people later stopped speaking would destroy business
> records that both parties may legitimately need months afterwards — including, especially, in the
> event of a dispute between them.

---

## §6 — Language

> **`MA9` The product describes availability, never removal**
>
> User-facing language is **"make unavailable for messaging" · "messaging unavailable" · "allow
> messaging again"**. The words **"block"**, "block user", "ban" and "remove" do not appear in the
> interface.
>
> This is not euphemism. The language must describe what the system actually does, and the system
> does not remove anyone from anything (`MA1`). "Block" would describe a platform action YesPleez
> has deliberately not built, and would tell users their public standing has changed when it has
> not.

### 6.1 Ambiguity as a safety property

The refusal state a withdrawn party encounters is **indistinguishable from every other reason a
conversation cannot be written to** — a `closed` thread, a `restricted` thread, a workflow that has
ended. `communication-v1.0` §4.4 already produces such states for reasons that have nothing to do
with any person.

That ambiguity is deliberate and worth preserving. A party who cannot determine whether they were
withdrawn from or whether the thread simply closed has no clear moment to retaliate against. This is
the failure mode of explicit blocking on other platforms, and the architecture avoids it for free.

**The system must never disclose availability state to the affected party**, by message, error code,
timing difference or any other channel.

### 6.2 The word users will search for

`MA9` governs the interface. It does **not** govern search, help content or support vocabulary. A
user in distress will look for the word **"block"**, because that is the word every other product
taught them. Help and in-app search must answer to it and route to the availability control. A safety
feature nobody can find is not a safety feature.

---

## §7 — Enforcement model

> **`MA10` Availability is evaluated dynamically, never stored as conversation state**
>
> Availability is a question asked at the moment of an act — *is communication currently available
> between these two parties?* — and answered against the current availability record.
>
> It **must not** be implemented by mutating conversation status. Setting conversations to
> `restricted` on withdrawal and reverting them on restoration would place the same fact in two
> stores, requiring them to agree forever, across conversations that do not exist yet at the moment
> of withdrawal.
>
> Restoring availability is therefore the removal of a single fact, after which every affected
> conversation resumes with no further action.
>
> `conversations.status` remains reserved for workflow and operational lifecycle (§2.6, §4.4) and is
> never written by this feature.

### 7.1 Where the question is asked

Availability is consulted at exactly **two** points, both of which already exist as the platform's
authority on who may communicate:

| Point | Prevents |
|---|---|
| **Conversation initiation** | A new conversation being opened between the pair. The check must precede the idempotent lookup that returns an existing conversation — otherwise a withdrawn party is refused a *new* conversation and handed an *existing* one. |
| **The write predicate** | Human messages entering any existing conversation between the pair. Without this, withdrawal would prevent only new conversations while every established one stayed open. |

One authority, consulted twice — the same principle by which conversation access derives from
`can_act_as` and nothing else (§2.2). A third definition of "may these two communicate" would drift
from the other two, silently, and in the direction of permitting what should be refused.

> **`MA11` System messages are unaffected by construction**
>
> System messages are written by elevated platform writers rather than by clients, so they do not
> pass through the client write predicate at all. **`MA5`'s carve-out therefore requires no
> carve-out** — the availability check cannot reach system messages even if it were written to.
>
> An implementation that finds itself adding an explicit exception to let system messages through has
> put the check in the wrong place.

### 7.2 Notifications

No change is required to the notification architecture. Enforcement at the write predicate means a
refused message is never written, so no notification is generated and there is nothing to suppress
(§5.2). System messages notify normally, attributed to the system profile as their subject — so the
professional facts reach both parties without either being presented with the other's name.

---

## §8 — Relationship to moderation

Availability is a **user-controlled communication preference**. It is not a moderation action, not a
sanction, and not evidence of anything.

Platform governance actions — report profile, content moderation, account restriction, suspension —
are separate systems with separate authority, separate review and separate consequences. They are
parked as `D17` in `communication-v1.0` and remain outside this document's scope.

> **`MA12` Availability and moderation are never conflated**
>
> Withdrawing availability must never be presented to the user as reporting, must never create a
> moderation record, must never be counted as a signal of wrongdoing, and must never be aggregated
> into any measure of a profile's standing.
>
> A user must be able to end unwanted contact **without accusing anyone of anything** — and without
> the system quietly treating them as having done so. Conversely, a moderation system must never
> assume availability data is a report queue; it is not, and reading it as one would breach `MA3`.

Nothing here prevents a future reporting system. `MA12` requires only that it be a **separate act,
separately chosen**, with its own interface and its own record.

---

## §9 — Deferred

Deferred, in this document's usage, means **not denied**. Each of these is a decision this document
declines to make with the evidence currently available, and each is additive to what is ratified
here.

| | Deferred | Why |
|---|---|---|
| **`DA1`** | **Multi-party availability.** This document governs conversations between **two parties**. | Every live conversation is presently pairwise. A three-party conversation forces a genuine dilemma — refuse the withdrawn party's writes and one participant gains veto power over what a third participant hears; permit them and the boundary leaks through any shared conversation. Both are defensible and neither can be evaluated without real group conversations to observe. Deciding blind would freeze a guess. |
| **`DA2`** | **Reporting and moderation workflow.** | `D17`. Separate authority (§8). A report facility is compatible with this document and may ship at any time. |
| **`DA3`** | **Notification-level muting of a person** — receiving nothing from someone while remaining reachable by them. | A softer instrument than availability, addressing a different need (unwanted volume rather than unwanted contact). The existing preference system operates per category, not per counterparty, so this requires a new unit and its own design. |
| **`DA4`** | **Whether availability survives profile transfer or claim.** | Interacts with claim mechanics that are still settling. Until decided, `MA4`'s unclaimed-profile fallback governs, and a claim moves enforcement to the new owner from the moment of claim. |

---

## §10 — Amendment record and freeze

**v1.0 · 21 Jul 2026 · ratified.** Original ratification. Constitutional rules `MA1`, `MA2`, `MA5`.
Supporting rules `MA3`, `MA4`, `MA6`–`MA12`. Deferrals `DA1`–`DA4`.

Ratified as the counterweight to `M8h`'s consentless cold contact, and as the additive grant `M8b`
anticipated in deferring §2.4 under `D9`/`D12`.

### The freeze

**Treat this as a constitutional freeze. Future changes require identifying a concrete conflict with
the ratified architecture rather than proposing alternative designs.**

A conflict is a case where the specification as written cannot be implemented, produces a
contradiction with a rule it is bound by (§0), or fails a scenario it claims to cover. A preference
for a different structure, a cleaner abstraction, a more familiar convention or a simpler
implementation is **not** a conflict, and is not grounds for amendment.

Where a genuine conflict is found, the correct response is to **stop and surface it** with the
smallest amendment that resolves it — never a redesign, and never a silent exception in the
implementation (`architecture-v1.0` §00).

Amendments mint `messaging-availability-v1.1`. This file is never edited.
