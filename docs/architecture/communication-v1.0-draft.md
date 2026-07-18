> # ⚠ DRAFT — NOT RATIFIED · NOT BINDING
>
> **This document has no authority.** It is the architectural specification M8 will implement, written
> while M6–M8 are paused. It is not permission to begin them.
>
> It contains **no SQL, no schema, no components, no hooks, no services, no RLS, no realtime code**.
> That is a constraint of the phase, not an omission.
>
> Hand-authored Markdown, permitted here only because it is not canonical (see [`README.md`](README.md),
> "Drafts"). **On ratification it is re-authored as `communication-v1.0.html`** and this draft deleted.
>
> Rule numbers `C1`–`C24` are namespaced to this document and do not refer to rules in
> `architecture-v1.0` (`§`), `identity-v1.1` (`R`/`B`/`D`/`A`) or `publication-v1.0` (`P`).
>
> Status: **DRAFT v1.0** — 18 Jul 2026 · rule numbers provisional until ratified.

YesPleez · Architecture Specification (proposed)

# Communication Architecture v1.0

The canonical design for every human-to-human communication in the YesPleez ecosystem. Defines the
conversation model, its immutable context, the permission philosophy that governs it, notifications
as a layer above it, the voice pipeline, the storage model, and the unresolved questions that must
be answered before implementation.

**Status** DRAFT — not ratified **Governed by** Identity v1.1 §A5 (frozen) **Implements** M8
**Blocked by** M6 · M7 · U2 **Scope** Scene · Festival · Operations · Studio · future AI

---

## §0 — Governance position

**This document does not begin M8.** [`CLAUDE.md`](../../CLAUDE.md) states M6, M7 and M8 are paused
and that describing what a milestone *will* do is not permission to start it. Architecture is not
migration work: nothing here creates a table, alters a policy, or ships a line of runtime code.

**Messaging is M8.** Identity v1.1 §A10: *"**M8** contract / messaging — Messaging is built
profile-owned **from day one** (§A5). No retrofit."* That clause is the reason this document exists.
A greenfield system built before its governing model is settled has to be rebuilt; a greenfield
system built after it is settled does not. There is no messaging code in `v2/src` today, and that is
an asset to be spent deliberately.

**Three things must be true before implementation begins:**

| Prerequisite | Why | Where |
|---|---|---|
| **M6 complete** | `can_act_as()` is the authorization seam every permission in §4 assumes. Writing messaging RLS before it exists means adding to the inline-`auth.uid()` debt `CLAUDE.md` forbids growing. | v1.1 §A10 |
| **M7 complete** | Messaging is the densest producer of profile-attributed rows in the product. The validation gate should be closed before it starts writing, not after. | v1.1 §A10 |
| **U2 answered** | *"Erasure vs. business record… **Blocks M8. Legal input required.**"* §8 of this document widens it. | v1.1 §A12 |

**What this document is bound by and may not reopen:** Identity v1.1 §A5 (conversations belong to
profiles), §A3 (the identity pair), §A4 (`can_act_as` as sole ownership predicate), §A9 (Personal is
inalienable). Where this document appears to disagree with any of them, it is wrong.

---

## §1 — Philosophy

### What communication means inside YesPleez

Every booking in this industry is the residue of a conversation. A fee gets agreed in a message, a
set time gets moved in a message, a lineup change gets negotiated in a message. The app currently
models the *outcomes* — applications, invitations, lineup members, set times — and leaves the
conversation that produced them on Instagram DMs and phone screenshots.

> **◆ `C1` The one sentence to remember**
>
> **Communication is infrastructure, not a feature.** Every human-to-human communication in the
> ecosystem flows through one platform, and no product ever builds a second one.

The measure of this platform is not whether it has chat. It is whether, two years after a disputed
booking, the conversation that settled it is still findable, still attributed correctly, and still
attached to the thing it was about.

### Goals

- **`C2` Conversations exist without being created.** A user who applies to a gig has started a
  conversation whether or not they thought about it. Manual creation is the exception, not the path.
- **`C3` Every conversation permanently knows why it exists.** Context is captured at creation and
  never changes (§3).
- **`C4` One platform, every product.** Scene, Festival, Operations and Studio consume the same
  services. A product-specific messaging path is a defect.
- **`C5` Attribution is honest.** Every message records both the profile it comes from and the human
  who wrote it (v1.1 §A3). Neither is optional and neither substitutes for the other.

### Non-goals

Stated so they are not designed for by accident:

- **Not a social network.** No open discovery of users to message. Reachability derives from
  workflow (§4), never from search.
- **Not a general chat product.** No servers, channels, threads-within-threads, or reactions-as-a-
  feature-surface. The unit is a conversation about a thing.
- **Not a transcription or AI-enhancement platform.** Explicitly excluded from voice (§6).
- **Not an ephemeral messenger.** No disappearing messages, no automatic expiry (§7). The premise is
  the opposite: these are records.
- **Not a replacement for notifications.** Notifications are a delivery layer above messaging (§5),
  not a kind of message.

### Design principles

| # | Principle |
|---|---|
| **`C6`** | **Workflow creates conversation.** The permission to start a conversation is the permission to perform the act that starts it — never a separate messaging permission. |
| **`C7`** | **Context is immutable; status is not.** What a conversation is *about* never changes. What is *happening* to that subject changes constantly. |
| **`C8`** | **The profile converses; the human writes.** Participants are profiles. Authorship is a user. Read state is per-human (§2.5) — this falls out of multi-owner profiles and is the most commonly-missed consequence of §A5. |
| **`C9`** | **Nothing is deleted quietly.** A conversation is a shared record. Unilateral destruction of shared history is a legal question (§8), not a UX affordance. |

---

## §2 — Conversation model

### 2.1 Conversation

A **conversation** is a durable, ordered sequence of messages between a fixed set of profiles, about
a fixed subject.

Fixed set and fixed subject are both deliberate. A conversation whose participants can change is an
audit problem; a conversation whose subject can change is §3's problem. Where a genuinely new set or
subject is needed, a **new conversation** is created and related to the old one — never mutated.

### 2.2 Participants

**Participants are profiles**, per v1.1 §A5. Not accounts, not users.

- A conversation between an artist and a venue is `artist_profile ↔ venue_profile`, regardless of
  which human is at the keyboard.
- Personal conversation uses the Personal profile (v1.1 §A9), which is inalienable — so personal
  chat is structurally protected without needing a second messaging system.
- **Access derives from `can_act_as`** (v1.1 §A4) and nothing else. Whoever can act as a participant
  profile can read and write the conversation. This is the whole permission story at the read layer;
  §4 governs only *initiation*.

> **`C10` Membership follows the profile, not the person**
>
> A venue changes hands. The new owner can act as the venue profile and therefore inherits its
> inbox — including negotiations conducted by the previous owner.
>
> This is correct under §A5 (*"a record of the business that conducted it"*) and alarming under any
> reasonable reading of privacy. v1.1 §A12 `U3` defers transfer policy because *"transfer is not a
> v1 operation"*. **Messaging makes it a v1 operation in practice**, because the inbox is the most
> sensitive thing a profile owns. Recorded in §10 as `D3`.

### 2.3 Context — ownership of "why"

Every conversation carries an immutable **context**: a type plus a reference to the object that
caused it (§3). This is the conversation's reason for existing, and it is the anchor for deep links,
permissions, retention class, and search.

### 2.4 Ownership

There is no single "owner". A conversation is **jointly held** by its participant profiles. This is
deliberate and is the root of §8: no participant may unilaterally destroy what is also another
party's record.

Ownership of **media** within a conversation is different and does rest with one party — the
uploader (§7). Ownership of the *record* and ownership of the *file* are separate, and conflating
them is the error §8 exists to prevent.

### 2.5 Read state and unread counts

> **`C11` Read state is per-human, per-conversation. Unread counts are never per-profile.**
>
> Two managers can act as the same venue profile. If read state lived on the profile, one manager
> opening a booking negotiation would mark it read for the other, who would never see it.
>
> This is a direct consequence of §A5 and it is invisible until a profile has two owners — which is
> exactly when it is most expensive to discover. **Read state is keyed `(conversation, user)`.**
>
> Distinct from read state, and useful: *"someone on your team replied"* is a **profile-level**
> signal about authorship, not a read receipt. Badge counts shown to a human are always that human's.

### 2.6 Lifecycle and status

Conversations do not end. They go **quiet**.

| State | Meaning |
|---|---|
| `active` | Normal. |
| `archived` | Hidden from a *single participant's* list. Per-participant, never global. |
| `closed` | The subject reached a terminal state (event passed, application declined). Read-only by default, re-openable by a participant. |
| `restricted` | A participant lost the relationship that permitted writing (§4.4). History remains readable; new messages are refused. |

> **`C12` Terminal subjects do not delete conversations**
>
> A declined application still produced a conversation, and that conversation is the record of the
> decline. It closes; it does not disappear. This is the same principle as §P6.1 in the publication
> model — the system does not rewrite what happened — applied to a different axis.

### 2.7 Metadata

Per conversation: context (immutable), participant set, created-at, last-message-at, per-participant
archive state, status, and a **subject state** mirror (§3.3) for list rendering without joins.

Deliberately **not** metadata: title, colour, custom labels. A conversation is identified by its
context and participants. Naming is a social-chat affordance that invites conversations to drift
from their subject.

### 2.8 How conversations relate to existing workflows

| Existing workflow | Creates | Notes |
|---|---|---|
| Application submitted | `application` conversation | Artist profile ↔ host profile. |
| Invitation sent | `invitation` conversation | Host profile ↔ artist profile. |
| Booking confirmed | **nothing new** | The originating conversation continues (§3.3). |
| Venue enquiry | `venue` conversation | `venue_enquiries` already carries the identity pair (v1.1 §A3) — the closest thing to this model that ships today. |
| Booking interest | `booking` conversation | §06's `note` field is a message in all but name; v1.1 §B1 already identified this. |
| Event discussion | `event` conversation | Multi-party; host plus booked lineup. |

---

## §3 — Context model

### 3.1 The contexts

| Context | Subject | Participants | Product |
|---|---|---|---|
| `application` | An application to play | Applicant ↔ host | Scene |
| `invitation` | An invitation to play | Host ↔ invitee | Scene |
| `booking` | An engagement | Booked party ↔ booker | Scene |
| `event` | An event | Host + lineup (multi-party) | Scene |
| `venue` | A venue relationship | Venue ↔ counterparty | Scene |
| `general` | No workflow subject | Two profiles | Scene |
| `festival` | A festival, stage, or crew assignment | Varies | Festival (future) |
| `operations` | An internal or moderation matter | Staff ↔ subject profile | Operations (future) |

The set is **extensible by amendment only**. A product that needs a context not listed here has
found a gap in this document (§10 `D8`), not licence to add a string.

### 3.2 Why context is immutable

> **`C13` Context is captured at creation and never changes**
>
> Four independent reasons, any one of which is sufficient:
>
> 1. **The conversation is evidence of the context.** A thread that began as an application and can
>    later claim to have been something else is worthless as a record.
> 2. **Permissions derive from context** (§4). Mutable context means retroactive permission — a
>    conversation someone was allowed to start becomes one they were not, or vice versa, after the
>    fact.
> 3. **Deep links resolve through context** (§5.5). A mutable target is a broken link with extra
>    steps.
> 4. **Retention class derives from context** (§8.4). Whether a conversation is a business record
>    cannot be a property the parties can edit.

### 3.3 Immutable context, progressing subject

The brief requires *"Booking confirmed → existing conversation continues"*, and §C13 requires context
never to change. These are only in tension if context and subject state are the same field. They are
not.

> **`C14` Context records the origin; subject state records the present**
>
> **Context** is the workflow act that caused the conversation: *this thread exists because an
> application was submitted on 3 March*. That is a historical fact and is never rewritten.
>
> **Subject state** is what has since become of it: `applied → shortlisted → booked → performed`,
> or `→ declined`. It changes freely.
>
> So an `application` conversation whose subject reaches `booked` **remains an `application`
> conversation**. It does not become a `booking` conversation, because the reason it exists did not
> change. The UI may label it by subject state; the record keeps its origin.
>
> The `booking` context is therefore reserved for engagements that began *as* a booking — a direct
> offer with no prior application or invitation — not for applications that succeeded.

### 3.4 Uniqueness and deduplication

> **`C15` One conversation per `(context_type, context_id, participant set)`**
>
> Two artists applying to the same event produce two `application` conversations with the same
> `context_id` and different participants. One artist applying twice to the same event produces
> **one** conversation. Without this rule, automatic creation (§C2) produces duplicate threads at
> every workflow retry, and the "effortless" premise inverts into inbox noise.

---

## §4 — Permission model

**No RLS here.** This section specifies expected behaviour that RLS will later enforce.

### 4.1 Philosophy

> **`C16` The permission to converse is the permission to act**
>
> A conversation created by a workflow act inherits that act's permission check. If an artist may
> apply to an event, they may hold the conversation that application creates. There is no second
> permission surface for messaging, and no messaging-specific grant to administer.
>
> This is what makes the platform inheritable by products that do not exist yet (§9). Festival does
> not need a messaging permission model; it needs its own workflow permissions, and messaging
> follows.

### 4.2 Reachability — who may initiate

Ordered from most to least permissive; the first matching rule applies:

| Rule | Initiation |
|---|---|
| **Existing relationship** | Any participant may write in a conversation they are already in. Always. |
| **Workflow act** | The act creates the conversation automatically. The act's own permission is the gate. |
| **Booked counterparty** | A host may always reach an artist booked to their event, and vice versa, for the life of that engagement and after. Non-negotiable — this is the operational core of the product. |
| **Solicited contact** | A profile may declare itself reachable (the existing `venue_enquiries` pattern generalised). Cold contact is permitted only where the recipient has opted in. |
| **Everything else** | Refused. |

> **`C17` There is no cold DM**
>
> An artist cannot message an arbitrary host, and a host cannot message an arbitrary artist, absent
> a workflow act or a declared opening. This is a deliberate product boundary, not a limitation to
> be relaxed under pressure: the moment reachability derives from search, the platform acquires a
> spam surface and every host's inbox becomes a liability.

### 4.3 Automatic creation

Automatic where a workflow act names both parties and implies an exchange: application submitted,
invitation sent, enquiry sent, booking offered directly, event lineup confirmed (multi-party event
conversation). Manual only for `general`, and only within §4.2.

### 4.4 Losing permission

When the relationship that permitted a conversation ends — an artist withdraws, an event is
cancelled — the conversation becomes `restricted` (§2.6): **history readable, writing refused**.
It is never deleted, and never silently emptied. §C12.

### 4.5 System and non-human participants

Operations staff, Studio system messaging, and future AI assistants participate **as profiles**,
subject to the same rules. There is no privileged non-conversation message path. An AI that can
message a user is a participant profile whose `can_act_as` is constrained — see §9.4.

---

## §5 — Notification architecture

### 5.1 Position

> **`C18` Notifications are a delivery layer over domain events — not over messages**
>
> A notification is not a kind of message and messaging is not a kind of notification. Notifications
> are generated from **domain events** (an application was submitted, a booking was confirmed, a
> message arrived). "Message received" is one source among many, not the model.
>
> **Never generated in UI components.** A component that constructs a notification has created a
> second notification engine.

### 5.2 Sources and categories

| Category | Examples |
|---|---|
| Application | submitted · accepted · declined |
| Invitation | received · accepted · declined |
| Booking | confirmed · cancelled · changed |
| Event | updated · cancelled · set times published |
| Message | received · mention |
| Reminder | upcoming event · unanswered invitation |
| Operations | moderation outcome (future) |

### 5.3 Routing

Notifications carry the three identities v1.1 §A7 already specifies — **subject** (what it is
about), **recipient** (which profile it concerns), **delivery** (which human receives it). Routing
resolves recipient profile → the humans who can act as it, then applies each human's preferences.

Consequence of §C11: a notification to a two-owner profile is delivered to **both** humans, and read
by one does not clear it for the other.

### 5.4 Preferences

Configurable per **(category × channel)**, channels being `push`, `in_app`, and `email` (future).
The matrix is the extension point: a new category or a new channel adds a row or a column, never a
new preferences system. Defaults are specified per category at implementation; the architecture
requires only that every category have an explicit default rather than inheriting one.

### 5.5 Deep links

> **`C19` Every notification carries a canonical target reference and resolves directly to it**
>
> A reference is `(type, id)` — not a URL. Routing maps reference to route at delivery time, so a
> route change does not strand historical notifications.
>
> **Never route through Home.** A notification that cannot resolve its target shows an explanatory
> state at the destination; it does not silently dump the user at the top of the app.
>
> Profile targets resolve through the existing canonical-URL shim (`lib/profileResolution.js`,
> M5.1) — deep links must not reintroduce legacy `user_id` URLs.

### 5.6 Badges

One counting rule, four surfaces: app icon, navigation bar, inbox, individual conversation. All
derive from the same per-human unread state (§C11), so they cannot disagree. Synchronisation across
devices is a property of that state being server-held, not of the badge logic.

---

## §6 — Voice messaging

Voice is a **first-class communication method**, not an attachment. Target: comparable to Apple
Messages and Telegram; audibly better than Messenger, Instagram and WhatsApp.

### 6.1 Recording philosophy — why those apps sound bad

> **`C20` The dominant quality factor is capture processing, not codec**
>
> Messenger, Instagram and WhatsApp sound poor primarily because their capture path is tuned for
> *telephony*: aggressive automatic gain control, noise suppression, and effective bandwidth often
> at or below 16 kHz. That processing is correct for a noisy phone call and destructive for a voice
> message — it pumps, it swallows room tone, and it mangles anything musical in the background.
>
> A browser's `getUserMedia` defaults to exactly that processing. **Disabling echo cancellation,
> noise suppression and auto gain control for voice-message capture, and recording full-band at
> 48 kHz mono, is the single largest quality decision in this document** — larger than the codec
> choice below.
>
> It is recorded here as architecture rather than implementation detail precisely because it looks
> like a detail and will otherwise be defaulted away.

Consequence to accept deliberately: without noise suppression, a noisy environment sounds noisy.
That is the correct trade for this product — the users are in venues, and the room is often the
point.

### 6.2 Codec recommendation

**Opus, 48 kHz, mono, VBR ~32–48 kbps.** This is the Telegram configuration and it decisively beats
the narrowband-AAC/AMR-style pipelines of the comparison set at a fraction of the bitrate.

The brief asks for *"AAC-LC or Opus, whichever provides the best cross-platform consistency"*. The
honest answer is that neither is universally consistent for **recording**: Chromium and Firefox
produce Opus in WebM/Ogg; Safari's recorder produces AAC in MP4 and its Opus support has been
uneven. Playback support is broader than recording support on both sides but is not guaranteed
symmetric.

> **`C21` Record natively, store the source, never transcode**
>
> "Encode once only" is a fidelity requirement: every re-encode is generational loss. Therefore the
> platform **stores whatever the capturing device produced** — Opus where available, AAC-LC where
> not — records the format alongside the message, and never re-encodes for delivery.
>
> The cost is that playback must handle two formats. That cost is borne by the player, once, and is
> preferable to a transcode pipeline that degrades every message to satisfy a decoder that may not
> even be present.
>
> **This requires verification before implementation** (§10 `D6`): the current recording and playback
> support matrix across target browsers and the WebView versions used by any future native shell.
> The recommendation is durable; the support matrix is not, and must be re-measured rather than
> assumed from this document's date.

### 6.3 Quality goals

Full-band capture (no telephony bandwidth limiting) · no aggressive dynamics processing · single
encode · mono (voice messages are not stereo content and stereo doubles storage for no perceptual
gain) · sensible ceiling on duration to bound storage, value to be set by product.

### 6.4 Waveform

Peaks are computed **at record time on the client** and stored as a small fixed-length array with
the message. The list can then render every waveform instantly without fetching a single audio file.
Computing waveforms at playback time is the common implementation and it is why most apps show a
fake or delayed waveform.

### 6.5 Playback and streaming

Playback speeds 1× · 1.5× · 2×, pitch-preserved. Playback begins before the file is fully
transferred (range requests); the most recent unplayed message in an open conversation may be
prefetched to make the common case instant. Playback position is remembered per message per human —
a two-minute voice message interrupted at 1:10 resumes at 1:10.

### 6.6 Upload pipeline

Record → compute peaks → upload with the message in a pending state → message resolves to sent when
the upload completes. The message row and the media object are separate concerns; the row is
authoritative for the record, the object for the audio.

**Explicitly excluded**, per brief: transcription, AI enhancement, filters, effects.

---

## §7 — Media storage

### 7.1 The model

Text is unlimited and does not consume storage. Only media — voice, images, video, attachments —
consumes it. **The uploader's allocation is charged; the recipient's is never charged.** Allocation
is set by subscription level. No automatic expiry. Users manage their own storage through a
management screen showing total used, breakdown by type, largest conversations, and largest
attachments.

### 7.2 Analysis — what this model creates

The brief asks whether this creates legal or architectural issues. It creates six. Five are
architectural and answerable; the sixth is §8.

> **`C22` Storage is charged to the profile, not the human**
>
> A venue's two managers must not have separate storage pools for the same venue's media, and a
> manager who leaves must not take the venue's files with them. Since subscription is an account-
> level concept and media is a profile-level asset, **the mapping between subscription and
> allocation must be specified explicitly** rather than assumed. Recorded as §10 `D4`.

| # | Issue | Consequence |
|---|---|---|
| **I1** | **Downgrade over quota.** No expiry + reduced allocation = an account instantly over its limit. | Must be specified: block new uploads (recommended), never auto-delete (§C9). Recorded as `D5`. |
| **I2** | **Deletion asymmetry.** Uploader owns the file; both parties own the record. | The whole of §8. |
| **I3** | **Forwarding.** Does a forwarded file duplicate storage or reference the original? | Reference is cheap but makes the original uploader's deletion break a third party's copy. Duplication is honest but charges a forwarder for someone else's file. Unresolved — `D7`. |
| **I4** | **Asymmetric incentive.** Recipients never pay, so heavy senders subsidise the exchange. | Accepted deliberately: the alternative (charging recipients for media they did not choose to receive) is worse, and would make receiving a booking brief a cost. |
| **I5** | **Account deletion cascade.** If media dies with the uploader's account, every conversation containing it loses evidence. | §8. |

---

## §8 — Business records · U2 widened

### 8.1 The existing question

v1.1 §A12 `U2`: *"**Erasure vs. business record** — account deletion leaves authored messages in a
profile inbox (§A5). **Blocks M8. Legal input required.**"*

### 8.2 The widening

> **`C23` U2 is not confined to account deletion**
>
> §7's storage model makes the same tension reachable by **ordinary user action**, with no account
> deletion involved.
>
> An artist frees up storage by deleting a voice message. That message stated the fee they agreed
> to. The host's record of their own booking has just been altered by the counterparty, unilaterally,
> through a routine housekeeping screen.
>
> Under §A5 that conversation is *"a record of the business that conducted it"*. Under §7 the file
> belongs to whoever uploaded it. **Both are true, and they contradict.** The contradiction is
> reachable on any Tuesday, not only at account closure.

This is the point at which the storage model and the identity model meet, and neither anticipated
the other. It is recorded here rather than resolved.

### 8.3 The full scenario set

Each is a distinct question, not a restatement:

| # | Scenario | Question |
|---|---|---|
| **S1** | Account deletion | Do authored messages persist, attributed to a departed human? (Original U2.) |
| **S2** | Media deletion for storage | May a party remove media that is the counterparty's evidence? (§C23.) |
| **S3** | Storage cleanup at downgrade | If a user must free space, may the system present business-record media as deletable? |
| **S4** | Profile deletion | A profile is deleted while its conversations are another party's records. |
| **S5** | Profile transfer | An inbox changes hands with the profile (§C10, v1.1 `U3`). |
| **S6** | Dispute evidence | A party requests a conversation as evidence. Is there an export? Is it attested? |
| **S7** | Erasure request | A user demands deletion of their contribution to a conversation that is another party's business record. |

### 8.4 Structural options — not recommendations

Sketched so that legal input has something concrete to react to. **None is proposed here.**

- **Retention class by context.** `application`/`booking`/`invitation`/`venue` are business records
  with retention; `general` and personal are freely erasable. Context immutability (§C13) is what
  makes this enforceable — the class cannot be edited after the fact.
- **Tombstone and redact.** Content removed, the fact of the message retained (who, when, that
  something was said). Preserves the shape of the record without the content.
- **Dual copy at send.** Each participant holds an independent copy; deleting yours does not touch
  theirs. Contradicts §7's single-uploader storage charge and doubles media cost.
- **Export before delete.** Erasure permitted only after counterparties are given an export window.
- **Platform-held archive.** Content retained beyond user-visible deletion for a defined period.
  The heaviest option legally — it makes the platform a custodian of data it has told users is gone.

### 8.5 Where legal advice is required

**I am not able to answer any of these and this document must not be read as advice.** The specific
questions to put to a lawyer:

1. Under **Australian Privacy Principle 11.2** (destruction/de-identification when no longer needed),
   does a counterparty's retention interest constitute a lawful reason to retain personal
   information after an erasure request?
2. Does a booking negotiation constitute a **business record** attracting retention obligations, and
   for how long, in the jurisdictions where hosts and venues operate?
3. If any user is in the **EU/UK**, how do GDPR Art. 17 erasure and its Art. 17(3) exemptions apply
   to a jointly-held conversation?
4. Is YesPleez **controller, processor, or joint controller** of conversations between two business
   profiles? This determines who must answer an erasure request at all.
5. May the platform **contractually** establish, in its terms, that business-context conversations
   are jointly-held records neither party may unilaterally destroy — and does that survive an
   erasure request?
6. What must an **evidentiary export** contain to be useful in a dispute?

> **Until questions 1–5 are answered, M8 does not start.** This is v1.1 §A12's existing position,
> restated with a wider scope and a specific question list.

---

## §9 — Future compatibility

The test for each product is: does it require a *new mechanism*, or only new values in existing ones?

### 9.1 Festival

Adds the `festival` context and multi-party conversations at larger scale (stage crews, artist
liaison, production). Crew members are profiles; a stage is a subject like any other. **No new
mechanism.** The one thing to verify at Festival design time is whether a conversation's fixed
participant set (§2.1) is workable for a crew whose membership genuinely changes across a build —
that is the most likely source of a v1.1 amendment request.

### 9.2 Operations

Internal and moderation conversations via `operations` context, staff acting as system profiles.
**Constraint inherited from the publication model:** Operations sees everything and must never
re-publish (`publication-v1.0-draft` §P8). An Ops conversation quoting withheld content does not
make that content published.

### 9.3 Studio

System messaging — moderation outcomes, catalog notices — is a conversation from a system profile,
not a separate notification channel. This is the concrete test of §C4: if Studio needs its own
message table, the architecture failed.

### 9.4 AI assistants

> **`C24` An AI participant is a profile, and the identity pair already models it**
>
> v1.1 §A3's `(from_profile_id, from_user_id)` pair was designed so attribution and authorship are
> separately recorded. An assistant acting for a host is exactly that shape: **attributed** to the
> assistant's profile (or the host's, if it acts as them), **authored** by the human who invoked it —
> or explicitly authored by no human, which the pair can state rather than fake.
>
> The rule that must not bend: an AI message is never recorded as having been written by a human who
> did not write it. `can_act_as` governs what an assistant may do; the pair governs what the record
> says it did. This is v1.1 §A4's attribution/authorization split doing exactly the job it was
> promoted to a founding principle to do.

---

## §10 — Outstanding decisions

Every question this document deliberately leaves open, why, and when it must be answered.

| # | Question | Why unresolved | Must be answered |
|---|---|---|---|
| **`D1`** | **U2 / §8 — erasure vs. business record**, all seven scenarios | Requires legal input, not architecture | **Before M8 begins.** Hard blocker, per v1.1 §A12 |
| **`D2`** | Retention class by context — which contexts are business records | Downstream of `D1` | With `D1` |
| **`D3`** | Inbox handling on profile transfer (§C10; v1.1 `U3`) | v1.1 deferred it as "not a v1 operation"; messaging makes it one | Before transfer ships, or before M8 if transfer is in scope |
| **`D4`** | Storage allocation mapping — account subscription to profile allocation (§C22) | Product/commercial decision, not architectural | Before storage management is built |
| **`D5`** | Over-quota behaviour on downgrade (I1) | Product decision; architecture only insists it is not auto-deletion | With `D4` |
| **`D6`** | Voice format support matrix (§C21) | Time-sensitive empirical fact; must be measured at implementation, not read from this document | At M8 implementation |
| **`D7`** | Forwarding — duplicate or reference (I3) | Both defensible; interacts with `D1` | Before forwarding ships (may be post-v1) |
| **`D8`** | Context set extension procedure | Whether a new context is an amendment or a configuration change | Before Festival |
| **`D9`** | Message editing and deletion within a live conversation | Not addressed above; interacts with `D1` and with §C9 | Before M8 |
| **`D10`** | Attachment types beyond voice/image/video — documents, contracts, riders | Likely needed by the booking workflow; deliberately out of scope here | Before M8 schema is designed |

### Not decided here, and not architecture

The **Messages tab** position in primary navigation (between Discover and Industry) is a product
decision in v1.0 §16's P-class sense, like the profile switcher (v1.1 §A11). It requires no
amendment. It must obey the existing rule that primary navigation renders on every route.

---

## §11 — What ratification requires

1. **`D1` answered** — legal input on §8.5 questions 1–5. Nothing else on this list matters until it is.
2. **`D2`, `D3`, `D9` decided** — they change the model, not just the implementation.
3. **M6 and M7 complete** — this document assumes `can_act_as` exists (§0).
4. **A conversation-model review against v1.1 §A5** by whoever ratifies, confirming this document
   implements rather than reinterprets it.
5. **Re-authored as `communication-v1.0.html`**, added to the canonical table, this draft deleted
   (README, "Drafts").
6. **Rule numbers frozen.** `C1`–`C24` and `D1`–`D10` become a citation interface on ratification and
   may never be renumbered.
