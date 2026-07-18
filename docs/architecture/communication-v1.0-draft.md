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
> Rule numbers `C1`–`C31` are namespaced to this document and do not refer to rules in
> `architecture-v1.0` (`§`), `identity-v1.1` (`R`/`B`/`D`/`A`) or `publication-v1.0` (`P`).
>
> Status: **DRAFT v1.0 · Revision 4** — 18 Jul 2026 · rule numbers provisional until ratified.
> Full amendment record at **§13**.
>
> **Why this is a revision and not a v1.1.** Under this directory's rules a version is minted when a
> document is **ratified and frozen** — that is what makes `identity-v1.1` a separate file from
> `identity-v1.0`. This document has never been ratified, so there is nothing frozen to amend
> against, and a `v1.1-draft` beside a `v1.0-draft` would leave two live proposals for one
> specification. Revisions accumulate in place until ratification mints v1.0 proper.

YesPleez · Architecture Specification (proposed)

# Communication Architecture v1.0

The canonical design for every human-to-human communication in the YesPleez ecosystem. Defines the
conversation model, its immutable context, the permission philosophy that governs it, notifications
as a layer above it, the voice pipeline, the storage model, and the unresolved questions that must
be answered before implementation.

**Status** DRAFT — not ratified **Governed by** Identity v1.1 §A5 (frozen) **Implements** M8
**Blocked by** M6 · M7 **Scope** Scene · Festival · Operations · Studio · future products

**`C25` governs this document.** Messenger is not the authoritative business record; structured
workflows are. Every retention, deletion and erasure statement below follows from that boundary.

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
| ~~U2 answered~~ | **No longer an implementation prerequisite.** `C25` makes the architectural decision (two retention domains), so §8's remaining questions gate **launch**, not code. This proposes an amendment to v1.1 §A12 and must be ratified as one — `D15`. | §8.5 |

**What this document is bound by and may not reopen:** Identity v1.1 §A5 (conversations belong to
profiles), §A3 (the identity pair), §A4 (`can_act_as` as sole ownership predicate), §A9 (Personal is
inalienable). Where this document appears to disagree with any of them, it is wrong.

---

## §1 — Philosophy

### What communication means inside YesPleez

Every booking in this industry begins as a conversation. A fee gets discussed in a message, a set
time gets moved in a message, a lineup change gets floated in a message. The app currently models
the *outcomes* — applications, invitations, lineup members, set times — and leaves the discussion
that produced them on Instagram DMs and phone screenshots.

> **◆ `C1` The one sentence to remember**
>
> **Communication is infrastructure, not a feature.** Every human-to-human communication in the
> ecosystem flows through one platform, and no product ever builds a second one.

> **◆ `C25` The second sentence, and the boundary that governs everything below**
>
> **Conversations help people discuss opportunities. Workflows record official commitments.**
>
> Messenger is **not** the authoritative business record. Applications, Invitations, Bookings,
> Agreements, and future workflow modules are the source of truth. Messenger supports those
> workflows and never replaces them.
>
> This is a product decision with sweeping architectural consequences — it determines what is
> retained, what may be erased, what may be deleted by whom, and what the platform owes a user who
> asks for their data to be removed. It is the reason §8 is a narrower problem than it first appeared.

> **◆ `C26` Copy, never reference — the rule that makes `C25` structural rather than declarative**
>
> When information crosses from Messenger into a workflow, it is **copied into that workflow's own
> data model**. A workflow object never reads its content back out of a conversation.
>
> **Deleting a message, attachment or voice note must never invalidate an existing workflow object.**
> Workflow objects are **self-contained records**: complete on their own, independent of the
> conversation that preceded them, and unaffected by anything that later happens to it.
>
> Without this rule `C25` is a statement of intent. A Booking that references an erasable message can
> be emptied by the counterparty deleting that message — reintroducing precisely the failure `C25`
> was established to remove. **`C26` is what converts the separation from a claim into a property of
> the system.**

The measure of this platform is therefore not whether a conversation is preserved forever. It is
whether the industry finds this a genuinely good place to talk — fast, beautiful, unhurried — and
whether, when talk turns into commitment, the step into the workflow that records it is short and
obvious. The record lives in the workflow. The conversation is allowed to be a conversation.

> **A caution that belongs with `C25`, not buried in §8**
>
> `C25` describes **how the platform behaves**: official bookings, invitations and agreements are
> created and managed through structured workflows. It is not a statement about the status of
> anything outside the platform, and must not be written or presented as one (`C28`).
>
> In particular, it must never be shown to users as a promise that conversations are private,
> deniable, or unrecoverable. The platform may offer erasure (§8.4); it makes no representation about
> what having said something means.

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
- **Not an ephemeral messenger.** No disappearing messages and no automatic expiry (§7) — but this
  is a storage and trust decision, not a claim that conversations are permanent records (`C25`).
- **Not an administrative surface.** A user in a conversation is talking, not filing. Workflow
  prompts never interrupt (§9.5). If Messenger starts to feel like paperwork, it has failed at the
  thing it exists to do.
- **Not a conversation-analysis engine, and not an AI product.** The platform does not read message
  content to infer intent, and no AI participates in, analyses or assists private conversations
  (`C27`, `C29`). Messenger is simply a messaging platform.
- **Not a replacement for notifications.** Notifications are a delivery layer above messaging (§5),
  not a kind of message.

### Design principles

| # | Principle |
|---|---|
| **`C6`** | **Workflow creates conversation.** The permission to start a conversation is the permission to perform the act that starts it — never a separate messaging permission. |
| **`C7`** | **Context is immutable; status is not.** What a conversation is *about* never changes. What is *happening* to that subject changes constantly. |
| **`C8`** | **The profile converses; the human writes.** Participants are profiles. Authorship is a user. Read state is per-human (§2.5) — this falls out of multi-owner profiles and is the most commonly-missed consequence of §A5. |
| **`C9`** | **Workflow objects are never deleted quietly; conversations may be.** A workflow object is a shared commitment and no party destroys it unilaterally. A conversation is communication — a participant may remove their own contribution, subject to §8. The two halves of this rule were one rule before `C25`, and collapsing them again is the error §8 exists to prevent. |
| **`C26`** | **Copy, never reference.** Stated in full above. Workflow objects are self-contained; conversation deletion can never invalidate one. |
| **`C27`** | **Assistance reads structure, never content.** Workflow assistance derives from platform state — conversation context, participant roles, linked event, existing workflow status — and never from interpreting what people said. §9.4. |

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

There is no single "owner". A conversation is **jointly held** by its participant profiles — joint
in the sense that neither party can remove the other's contribution or erase the thread from the
counterparty's view.

**A participant may remove their own contribution.** Under `C25` a conversation is not the
authoritative record, so unilateral removal of one's own messages and media does not destroy a
business record — the record is the workflow object, and anything promoted into it was copied
(`C26`), not referenced.

Ownership of **media** rests with the uploader (§7). Ownership of the *thread* is joint. Ownership
of the *record* is neither — it belongs to the workflow object, which is a different thing in a
different retention domain.

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

> **`C12` Terminal subjects close conversations; the system never deletes them on the users' behalf**
>
> A declined application closes its conversation. The **decline itself** is recorded by the
> application workflow object (`C25`), not by the thread — but the platform still does not
> unilaterally destroy a conversation because its subject reached an end state. Participants may
> remove their own contributions (§2.4); the system does not tidy up after them.

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
> 1. **Permissions derive from context** (§4). Mutable context means retroactive permission — a
>    conversation someone was allowed to start becomes one they were not, or vice versa, after the
>    fact.
> 2. **Deep links resolve through context** (§5.5). A mutable target is a broken link with extra
>    steps.
> 3. **Deduplication depends on it** (`C15`). A mutable context breaks the uniqueness key and
>    automatic creation starts producing duplicate threads.
> 4. **Workflow assistance derives from it** (`C27`, §9.4). Structured context is the *only*
>    permitted signal for draft preparation, so it must be trustworthy and stable.
>
> None of these four reasons depends on a conversation being a record. Context immutability is a
> property the *communication* domain needs for its own sake — permissions, links, deduplication and
> assistance all resolve through it — and it holds unchanged under `C25`.

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

Operations staff and Studio system messaging participate **as profiles**, subject to the same rules.
There is no privileged non-conversation message path.

**AI is not among them.** No AI participates in private conversations (`C29`), so there is no AI
participant profile and no path by which one could be added to a thread. Where the ecosystem needs a
non-human sender — a moderation outcome, a catalogue notice — that is a **system profile**, which
sends without reading (§10.4).

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
the upload completes. The message row and the media object are separate concerns: the row carries the
message and its metadata, the object carries the audio. A voice note promoted into a workflow is
copied there (`C26`) and no longer depends on either.

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
| **I2** | **Deletion asymmetry.** Uploader owns the file; both parties were in the conversation. | **Largely resolved by `C25` + `C26`** — deleting media destroys a conversation, not a record. Residual is experiential, not architectural: §8.4, `D12`. |
| **I3** | **Forwarding.** Does a forwarded file duplicate storage or reference the original? | Reference is cheap but makes the original uploader's deletion break a third party's copy. Duplication is honest but charges a forwarder for someone else's file. Unresolved — `D7`. |
| **I4** | **Asymmetric incentive.** Recipients never pay, so heavy senders subsidise the exchange. | Accepted deliberately: the alternative (charging recipients for media they did not choose to receive) is worse, and would make receiving a booking brief a cost. |
| **I5** | **Account deletion cascade.** If media dies with the uploader's account, conversations containing it lose content. | Bounded by `C26`: anything promoted into a workflow survives independently. What is lost is conversation, which `C25` permits. §8.3 `S1`. |

---

## §8 — Business records · U2 reassessed

### 8.1 The existing question

v1.1 §A12 `U2`: *"**Erasure vs. business record** — account deletion leaves authored messages in a
profile inbox (§A5). **Blocks M8. Legal input required.**"*

### 8.2 The widening, and its substantial retraction

> **`C23` The scenario that reopened `U2`, and why the architecture now absorbs it**
>
> **The scenario.** An artist frees storage by deleting a voice message that discussed their fee. No
> account deletion, no unusual action — routine housekeeping.
>
> **Why it is no longer an architectural contradiction.** Under `C25` the fee is recorded in the
> Booking workflow object, and under `C26` that object holds its own copy of anything promoted into
> it. The deletion removes conversation content. The workflow object is untouched and remains
> complete on its own.
>
> **What remains.** A user may believe a conversation was the arrangement when the workflow says
> otherwise. That is a product and communication problem — addressed by making the step into the
> workflow short and obvious (§9) — not a defect in the data model.

> **`C28` The architecture defines platform behaviour, not legal status**
>
> **Official YesPleez bookings, invitations and agreements are created and managed through structured
> workflows.** That is the whole of what this document asserts.
>
> It defines what **YesPleez recognises** as an official action. It does not define — and must not be
> written as though it defines — what any court, tribunal or regulator may treat as evidence. That
> question is outside the scope of an architecture specification, and characterising it here would
> put a guess where advice belongs (§8.5).
>
> One product obligation does follow, because it is about platform behaviour rather than legal
> effect:
>
> **Never present conversations to users as private, deniable, or unrecoverable.** The platform may
> offer erasure of conversation content (§8.4). It may not imply anything about the consequences of
> having said something.

### 8.3 The full scenario set

Each is a distinct question, not a restatement:

| # | Scenario | Question |
|---|---|---|
| **S1** | Account deletion | Do authored messages persist, attributed to a departed human? **Narrowed by `C25`** — persistence is now a communication-continuity question, not a record-preservation one. |
| **S2** | Media deletion for storage | **Largely resolved by `C25` + `C26`.** Deletes a conversation, not a record. Residual: the counterparty's *experience* of losing shared history. |
| **S3** | Storage cleanup at downgrade | **Resolved.** No conversation media is a business record, so cleanup cannot destroy one. |
| **S4** | Profile deletion | Open. A profile is deleted while its **workflow objects** are another party's records — the workflow retention domain, not the thread, is what matters. |
| **S5** | Profile transfer | Open, unchanged. An inbox changes hands with the profile (`C10`, v1.1 `U3`) — arguably **sharper** now, since an inherited inbox is private communication rather than business record. |
| **S6** | Dispute evidence | Open. A party requests conversation history as evidence. Is there an export? `C28` means this is asked whatever the platform's position on authority. |
| **S7** | Erasure request | **Substantially eased.** Conversations are erasable; workflow objects are retained. The remaining question is whether workflow objects containing personal information can be retained against an erasure request. |

### 8.4 The retention split — decided by `C25`

The five structural options an earlier draft listed here were attempts to decide *which
conversations are records*. `C25` answers the question they were all working around, and the
architecture follows from it directly:

| Domain | Contents | Retention | Erasure |
|---|---|---|---|
| **Workflow** | Applications, Invitations, Bookings, Agreements, and content promoted into them (`C26`) | Retained as business records | Constrained — see §8.5 Q2 |
| **Communication** | Conversations, messages, voice, media | Retained until a participant removes it; no expiry (§7) | Offered to participants for their own contributions |

This is cleaner than the earlier "retention class by conversation context" sketch, because the split
is by **object type** rather than by a property of the thread. A conversation never has to be
classified; it is never the record.

**Two options survive as open sub-questions**, both now scoped to the communication domain only:

- **Tombstone vs. full removal.** When a participant deletes a message, does the counterparty see
  *"message removed"* or does it vanish? A silent vanish rewrites the other party's experience of a
  conversation they were in. Recorded as `D12`.
- **Export.** Whether participants can export a conversation, and in what form, is now a product
  feature rather than a legal necessity — but `C28` means someone will ask for it under pressure.
  Recorded as `D14`.

### 8.5 Where legal advice is required

**I am not able to answer any of these and this document must not be read as advice.** `C25` and
`C28` rewrote this list: the questions concern **workflow objects**, the things YesPleez recognises
as official actions, rather than conversations. The architecture describes platform behaviour; these
questions ask what obligations attach to that behaviour, which is a matter for legal review and not
for this document to characterise.

1. Does a **Booking or Agreement workflow object** constitute a business record attracting retention
   obligations, for how long, and in which of the jurisdictions where hosts and venues operate?
2. Under **Australian Privacy Principle 11.2** (destruction when no longer needed), may workflow
   objects containing a departed user's personal information be retained against an erasure request,
   on the counterparty's retention interest?
3. If any user is in the **EU/UK**, how do GDPR Art. 17 and its Art. 17(3) exemptions apply to the
   two domains differently — erasable conversations versus retained workflow objects?
4. Is YesPleez **controller, processor, or joint controller** for each domain? The answer may differ
   between them, and determines who must answer an erasure request at all.
5. The platform's behaviour is that official bookings, invitations and agreements are created and
   managed through structured workflows (`C28`). **How should that behaviour be described in the
   terms and in the product**, accurately and without implying more or less than it does?
6. If a participant requests conversation history — for a dispute or otherwise — **what should an
   export contain**, and does the platform have any obligation to provide one?

> **Severity, revised.** v1.1 §A12 records `U2` as *"Blocks M8. Legal input required."* Under `C25`
> the **architectural** decision is made — two retention domains, conversations erasable, workflow
> objects retained — so schema and implementation are no longer waiting on a lawyer.
>
> **`D1` is therefore downgraded from a hard blocker on M8 to a hard blocker on launch.** Questions
> 1–5 must be answered before the product is offered publicly, because they determine the terms, the
> privacy policy, and the erasure flow. They no longer gate writing the code.
>
> **This is a proposed amendment to v1.1 §A12 `U2` and must be ratified as such** — this document
> cannot downgrade a frozen document's blocker by asserting it. Recorded as `D15`.

---

## §9 — Messenger, workflow, and assistance

The mechanics of `C25`: how a conversation becomes a commitment without Messenger becoming
paperwork.

### 9.1 What Messenger is for

Casual conversation, voice notes, photos, videos, music, files, event chat, planning, memes. The
industry currently does all of this on Instagram and WhatsApp, on phones, in threads that have
nothing to do with the gig they concern.

The proposition is not "abandon your messaging app". It is that the people, the events and the
workflows are already here, so the conversation may as well be too. **Messenger is a consequence of
the ecosystem, not the destination.** Nothing in this architecture should be justified by a goal of
displacing another messenger.

### 9.2 What workflows are for

Applications, Invitations, Bookings, Agreements, and later Contracts, Payments and Operations
workflows. These are the authoritative record (`C25`). They are deliberate, reviewed and confirmed
by a human. Nothing enters this domain by inference.

### 9.3 Crossing the boundary

> **`C26` restated — promotion is a copy**
>
> When content moves from conversation to workflow — a fee, a note, a rider, a voice message
> attached to a booking — it is **copied into the workflow's retention domain**. The workflow holds
> its own durable copy and does not reference the message.
>
> Without this, `C25` is a claim rather than a guarantee: a workflow that references an erasable
> message can be hollowed out by the counterparty deleting it, which is precisely the failure
> `C25` was invoked to remove.
>
> **Consequence for media (§7):** a promoted file exists in two domains and is charged once, to the
> uploader. Whether promotion re-charges storage, and to whom, is `D13`.
>
> **Consequence for erasure:** a user who erases a conversation does not thereby erase what they
> promoted into a booking. This must be stated at the point of erasure, or the erasure control is
> misleading.

### 9.4 Assisted preparation — structure, not content

> **`C27` restated — assistance is driven entirely by structured platform events**
>
> Workflow drafts are prepared from **platform structure only**. The triggering signals are events,
> not utterances:
>
> - an application is submitted
> - an invitation is accepted
> - a booking workflow is started
> - a venue connects with an artist
> - an event relationship already exists
>
> and the fields are populated from what the platform already holds — the conversation's immutable
> context (§3), participant roles, the linked event with its date, venue and slots, and existing
> workflow state.
>
> **Message content is never analysed.** Not for money, dates, times, set lengths, equipment, travel,
> or any other keyword. Under `C29` there is no mechanism by which it could be.
>
> **The accuracy argument:** those words dominate ordinary conversation between musicians. "How much
> was your new pedal" is not a fee negotiation. Content inference in this domain has a false-positive
> rate that would make the feature actively annoying, and every false positive lands as an
> interruption.
>
> **The privacy argument, which matters more:** a user who believes their conversations are being
> read by the platform behaves differently in them. The value of Messenger is that it feels like
> talking. Ambient content analysis destroys that whatever its accuracy, and it cannot be undone by
> a settings toggle — once users believe it is happening, they never fully stop believing it.
>
> Structured context is both the more reliable signal and the one that requires reading nothing.

> **◆ `C29` Private conversations belong to the participants. AI does not enter them.**
>
> **This is an ecosystem principle**, binding on Scene, Festival, Operations, Studio and every future
> product.
>
> **The platform does not analyse, interpret, participate in, or provide AI assistance within private
> conversations.** There is no feature by which AI reads private messages to generate suggestions,
> infer bookings, summarise conversations, or otherwise take part in communication. Not ambiently,
> not on request, not by invitation, not with consent.
>
> **This is a deliberate product decision, not a technical limitation.** It is stated as an absolute
> because a rule with a permitted exception is a rule with a doorway, and every subsequent proposal
> arrives as a reason to use the doorway. There is no doorway.
>
> Workflow assistance comes from structured platform events (`C27`, §9.4) — an application submitted,
> an invitation accepted, a booking started, a venue connected with an artist, an event relationship
> that already exists. That is where the platform's intelligence lives: **in the structure, not in
> the conversation.**

> **What `C29` does not govern**
>
> **Governance is a separate platform responsibility and is outside the Communication Architecture
> entirely**: human moderation, abuse reporting, legal compliance, and investigation of
> user-reported conversations.
>
> `C29` is a rule about AI functionality. It neither permits nor forbids governance functions,
> because an architecture specification is the wrong instrument for deciding them. They are owned by
> operational and legal policy (§10.2).

> **Why this is architecture and not policy:** a policy can be revised quietly by a later team under
> product pressure. A rule stated here, cited by implementations, and enforced by the absence of any
> read path from conversation content into any interpretive system is considerably harder to reverse
> by accident. The absence of the capability is the enforcement.

### 9.5 Drafts and non-interruption

> **`C30` Drafts are private, single-party, and never submitted**
>
> A prepared draft is visible only to the party it was prepared for, is fully editable, notifies no
> counterparty, and has no status in any workflow until a human opens it, reviews it and confirms.
>
> A draft is **not** a record and must never appear to be one. The counterparty must not be able to
> learn that a draft exists — a "they're preparing a booking" signal would leak negotiating posture.

> **`C31` Assistance never interrupts a conversation**
>
> No modal, no inline "Create Booking" prompt, no interstitial. Assistance surfaces **where the work
> lives** — a quiet `1 Draft` indicator in Bookings — and at most a passive, dismissible line in the
> conversation noting that details are ready elsewhere.
>
> The test: a user who ignores every piece of assistance forever must experience Messenger as a
> clean messaging app, not as a nagging one.

Draft fields may include artist, host, venue, event, date, time, fee, accommodation and notes —
every one editable, none authoritative until confirmed.

### 9.6 Calibration is a beta question

The correct *level* of assistance is not knowable from architecture. It is set by foundational users
during beta, and the implementation stays adaptable until real feedback exists. What is fixed here
is the **shape** — structured signals only, private drafts, no interruption. What is open is the
**volume**, recorded as `D16`.

---

## §10 — Future compatibility

The test for each product is: does it require a *new mechanism*, or only new values in existing ones?

### 10.1 Festival

Adds the `festival` context and multi-party conversations at larger scale (stage crews, artist
liaison, production). Crew members are profiles; a stage is a subject like any other. **No new
mechanism.** The one thing to verify at Festival design time is whether a conversation's fixed
participant set (§2.1) is workable for a crew whose membership genuinely changes across a build —
that is the most likely source of a v1.1 amendment request.

### 10.2 Operations

Internal and moderation conversations via `operations` context, staff acting as system profiles.
**Constraint inherited from the publication model:** Operations sees everything and must never
re-publish (`publication-v1.0-draft` §P8). An Ops conversation quoting withheld content does not
make that content published.

> **Governance is outside this architecture**
>
> Human moderation, abuse reporting, legal compliance and the investigation of user-reported
> conversations are **separate platform responsibilities**, owned by operational and legal policy.
> The Communication Architecture does not specify them, permit them, or forbid them.
>
> It records only that such a policy needs to exist before Operations ships, rather than being
> improvised during the first serious incident — noted as `D17` and owned elsewhere.
>
> `C29` remains unaffected by whatever that policy says: it is a rule about **AI functionality**, and
> AI does not read private conversations under any heading, governance included.

### 10.3 Studio

System messaging — moderation outcomes, catalog notices — is a conversation from a system profile,
not a separate notification channel. This is the concrete test of §C4: if Studio needs its own
message table, the architecture failed.

### 10.4 AI and the conversation boundary

> **`C24` AI operates on structure, never on conversation**
>
> Future AI systems in the YesPleez ecosystem work with **structured platform data** — workflows,
> events, lineups, availability, catalogue. They do not read, summarise, interpret or participate in
> private conversations (`C29`).
>
> This bounds what future AI can be, and it does so deliberately. An assistant that helps a host fill
> a lineup from availability and past bookings is squarely inside the boundary. An assistant that
> reads a negotiation and offers to draft the booking is outside it, permanently — that capability is
> not deferred pending safeguards, it is declined.
>
> **Where non-human senders remain legitimate**, the identity model already handles them honestly:
> Studio system messaging and Operations notices are **system profiles** (§4.5), and v1.1 §A3's
> `(from_profile_id, from_user_id)` pair records a message as attributed to that profile and authored
> by no human, rather than faking a human author. The rule that must not bend: **a message is never
> recorded as having been written by a human who did not write it.**
>
> A system profile sending a notice is not AI participating in a conversation. The distinction is
> that it neither reads nor interprets what anyone said.

---

## §11 — Outstanding decisions

Every question this document deliberately leaves open, why, and when it must be answered.

| # | Question | Why unresolved | Must be answered |
|---|---|---|---|
| **`D1`** | **§8.5 Q1–5 — retention and erasure of workflow objects.** Downgraded by `C25`: conversations are erasable, workflow objects are retained, and that split is now an architectural decision rather than a legal one | Requires legal input on terms, privacy policy and erasure flow — but no longer on schema | **Before launch.** No longer blocks M8 implementation |
| ~~`D2`~~ | ~~Retention class by context~~ | **Closed by `C25`.** The split is by object type (workflow vs. communication), not by conversation context — §8.4 | — |
| **`D3`** | Inbox handling on profile transfer (§C10; v1.1 `U3`) | v1.1 deferred it as "not a v1 operation"; messaging makes it one | Before transfer ships, or before M8 if transfer is in scope |
| **`D4`** | Storage allocation mapping — account subscription to profile allocation (§C22) | Product/commercial decision, not architectural | Before storage management is built |
| **`D5`** | Over-quota behaviour on downgrade (I1) | Product decision; architecture only insists it is not auto-deletion | With `D4` |
| **`D6`** | Voice format support matrix (§C21) | Time-sensitive empirical fact; must be measured at implementation, not read from this document | At M8 implementation |
| **`D7`** | Forwarding — duplicate or reference (I3) | Both defensible; interacts with `D1` | Before forwarding ships (may be post-v1) |
| **`D8`** | Context set extension procedure | Whether a new context is an amendment or a configuration change | Before Festival |
| **`D9`** | Message editing and deletion within a live conversation | Not addressed above; interacts with `D1` and with §C9 | Before M8 |
| **`D10`** | Attachment types beyond voice/image/video — documents, contracts, riders | Likely needed by the booking workflow; deliberately out of scope here | Before M8 schema is designed |
| **`D11`** | Which workflow objects exist, and their state models — Agreements in particular | `C25` makes them the record; this document specifies communication, not workflow | Before M8 schema is designed — the boundary needs both sides defined |
| **`D12`** | Deletion visibility — *"message removed"* tombstone, or silent vanish (§8.4) | A silent vanish rewrites the counterparty's experience of a conversation they were in; a tombstone leaks that something was said | Before M8 |
| **`D13`** | Storage accounting on promotion (`C26`) — does a copy into a workflow re-charge the uploader | Interacts with `D4`; the copy is a durability requirement, not a user choice | With `D4` |
| **`D14`** | Conversation export — whether, and in what form | No longer a legal necessity under `C25`, but `C28.1` means it will be asked for | Post-v1 acceptable |
| **`D15`** | **Amendment to v1.1 §A12 `U2`** — downgrading it from "Blocks M8" to "blocks launch" | This document cannot downgrade a frozen document's blocker by asserting it; it requires a versioned amendment | Before M8 begins |
| **`D16`** | Assistance volume — how much draft preparation is helpful before it is intrusive (§9.6) | Not knowable from architecture; set by foundational users | During beta |
| **`D17`** *(out of scope — pointer only)* | **Governance access policy** — what a user report or lawful request grants access to, to whom, for how long, and whether participants are informed | **Not a decision this document makes.** Governance is a separate platform responsibility (§10.2). Recorded here solely so it is not forgotten, since messaging is what creates the need for it | Before Operations ships · owned by operational and legal policy |

### Not decided here, and not architecture

The **Messages tab** position in primary navigation (between Discover and Industry) is a product
decision in v1.0 §16's P-class sense, like the profile switcher (v1.1 §A11). It requires no
amendment. It must obey the existing rule that primary navigation renders on every route.

---

## §12 — What ratification requires

1. **`D15` ratified** — the amendment to v1.1 §A12 `U2`. This document asserts that `C25` downgrades
   a blocker in a frozen document; that assertion has no force until amended properly. **This is the
   first item, ahead of `D1`, because it is the one that unblocks the rest.**
2. **`D3`, `D9`, `D11`, `D12` decided** — they change the model, not just the implementation.
   `D11` in particular: `C25` is only meaningful if the workflow side of the boundary is specified.
3. **M6 and M7 complete** — this document assumes `can_act_as` exists (§0).
4. **`D1` scheduled, not necessarily answered** — legal input gates launch, not implementation.
4. **A conversation-model review against v1.1 §A5** by whoever ratifies, confirming this document
   implements rather than reinterprets it.
5. **Re-authored as `communication-v1.0.html`**, added to the canonical table, this draft deleted
   (README, "Drafts").
6. **Rule numbers frozen.** `C1`–`C24` and `D1`–`D10` become a citation interface on ratification and
   may never be renumbered.

---

## §13 — Amendment record

Per `architecture-v1.0` §17, restated for a document still in draft. Revisions accumulate here until
ratification; on ratification this section becomes the document's provenance.

### Revision 4 — 18 Jul 2026 · AI removed from private conversations

| Field | Value |
|---|---|
| **Requested by** | Owner, 18 Jul 2026 |
| **Nature** | Simplification. Removes a capability the previous three revisions had been carefully constraining. |
| **Bar cleared** | Product decision, explicitly stated as such rather than as a technical limitation. Supersedes all previous discussion of AI participants in private conversations. |

| # | Change |
|---|---|
| **1** | **`C29` rewritten as an absolute.** Private conversations belong to the participants. The platform does not analyse, interpret, participate in, or provide AI assistance within them — not ambiently, not on request, **not by invitation, not with consent**. The "invited, visible AI participant" allowance of Revisions 2–3 is withdrawn entirely. |
| **2** | **`C24` rewritten.** Was *"an AI participant is a profile, and the identity pair already models it"*. AI now operates on **structured platform data only** — workflows, events, lineups, availability, catalogue — and never on conversation content. §10.4 retitled *AI and the conversation boundary*. |
| **3** | **`C27` restated around structured platform events** — application submitted, invitation accepted, booking started, venue connects with artist, existing event relationship — rather than around "structured context" as a category. |
| **4** | **§4.5 corrected.** It listed *"future AI assistants"* among legitimate non-human participants. Removed. Where a non-human sender is genuinely needed (Studio notices, moderation outcomes) it is a **system profile**, which sends without reading. |
| **5** | **Governance moved fully outside the document.** Revision 3 placed governance outside `C29`; Revision 4 places it outside the Communication Architecture entirely. `D17` is retained as a pointer only, explicitly marked as not a decision this document makes. |
| **6** | **Scope line** changed from *"future AI"* to *"future products"*. |

**Why an absolute rather than a constrained permission.** Revisions 2 and 3 permitted an invited,
visible AI participant and spent considerable text policing the boundary. A rule with a permitted
exception is a rule with a doorway, and each future proposal arrives as a reason to use the doorway.
Removing the capability removes the argument. **The absence of any read path from conversation
content into an interpretive system is the enforcement mechanism** — stronger than a rule, because
there is nothing to enforce.

**What did not change:** `C25`, `C26`, `C28`, `C30`, `C31`, and every model section. The workflow
separation and copy-never-reference principles are untouched.

### Revision 3 — 18 Jul 2026 · `C29` scoped to AI

| Field | Value |
|---|---|
| **Requested by** | Owner, 18 Jul 2026 — confirming Revision 2, and narrowing `C29` |
| **Nature** | Scoping. Narrows one rule; changes nothing else. |
| **Bar cleared** | Corrective. Revision 2 wrote `C29` as a prohibition on all automated reading of conversations *including* safety and moderation, which made an architectural rule adjudicate governance functions it has no standing to decide. |

| # | Change |
|---|---|
| **1** | **`C29` reframed around AI visibility and user consent.** It prohibits undisclosed or ambient AI analysis of private conversations, and requires any AI participant to be explicit and visible to the participants. The distinguishing test is visibility. |
| **2** | **Governance functions placed explicitly outside `C29`'s scope** — human moderation, legal compliance, and investigation of user-reported conversations. These are functions of operating a platform, governed by operational and legal policy, and an architecture specification is the wrong instrument for permitting or forbidding them. |
| **3** | **§10.2 rewritten.** Revision 2 framed Operations as the place `C29` "would be tested" and asserted that no automated safety scanning was permitted. Both removed. The section now records only that governance access needs its own policy, and that being out of `C29`'s scope means human and legal process is out of scope — not that an automated system may read conversations under a governance heading. |
| **4** | **`D17` reframed** from "moderation access boundary under `C29`" to **governance access policy**, including the intersection question of whether a governance function may use AI assistance — left to be decided deliberately and disclosed. |

**What did not change:** `C25`, `C26`, `C27`, `C28`, `C30`, `C31`, and every model section. Revision 2
stands in full except for the `C29` scope and the two passages that followed from it.

### Revision 2 — 18 Jul 2026 · Messenger & Workflow Separation

| Field | Value |
|---|---|
| **Requested by** | Owner — "Messaging Philosophy & Workflow Handoffs", then "Communication Architecture — Philosophy Clarification", 18 Jul 2026 |
| **Nature** | Foundational. Reverses the assumption Revision 1 was built on. |
| **Bar cleared** | `architecture-v1.0` §00 — this is not preference. Revision 1 modelled conversations as business records, which made `D1` a hard blocker on M8 and produced a storage model in contradiction with itself (`C23`). The clarification resolves both. |

**What changed:**

| # | Change |
|---|---|
| **1** | **`C25` Messenger is not the authoritative business record.** Structured workflows — Applications, Invitations, Bookings, Agreements, and future modules — record official actions. Messenger facilitates communication. Two domains, different responsibilities. |
| **2** | **`C26` Copy, never reference** — promoted to a founding rule (§1). Information crossing into a workflow is copied into that workflow's own data model. Workflow objects are self-contained; deleting a message, attachment or voice note can never invalidate one. |
| **3** | **`C27` Assistance reads structure, never content.** Draft preparation derives from conversation context, participant roles, linked events and workflow state — never from interpreting what people said. |
| **4** | **`C28` rewritten to remove legal assertion.** Revision 2a stated that the platform "asserts the unformalised half did not count" and characterised discoverability. Both removed. The document now states only what YesPleez recognises as an official action and leaves legal characterisation to §8.5. |
| **5** | **`C29` strengthened to an ecosystem principle.** No hidden ambient analysis of private conversations, anywhere in the ecosystem, for any purpose. Any AI participant is explicit, visible and invited. Binds Operations (§10.2). |
| **6** | **`C30`/`C31` drafts and non-interruption.** Drafts are private, single-party, never auto-submitted, invisible to the counterparty. Assistance never interrupts a conversation. |
| **7** | **§8 reassessed.** Retention splits by object type — workflow retained, communication erasable — replacing Revision 1's "retention class by conversation context". `D2` closed. |
| **8** | **`D1` downgraded** from blocking M8 to blocking launch, and **`D15` added**: this downgrade is a proposed amendment to `identity-v1.1` §A12 `U2` and has no force until ratified as one. |
| **9** | **New §9** (Messenger, workflow and assistance). Former §9–§11 renumbered §10–§12. **No rule numbers were renumbered.** |
| **10** | **`D11`–`D14`, `D16`, `D17` added.** Principally `D11` — the workflow side of the `C25` boundary is not specified by this document and must be before M8 schema work. |

**What did not change:** the conversation model (§2), context model (§3), permission model (§4),
notification architecture (§5) and voice pipeline (§6) are unaffected. `C25` governs what a
conversation *is for*, not how it works.

**Standing constraint.** This revision does not begin M8, does not alter M6–M8, and contains no
implementation. Identity v1.1 §A5, §A3, §A4 and §A9 remain binding and unreopened.

### Revision 1 — 18 Jul 2026 · Initial draft

Phase 11A. The specification M8 will implement, written while M6–M8 remain paused. Superseded in its
treatment of business records by Revision 2; unchanged elsewhere.
