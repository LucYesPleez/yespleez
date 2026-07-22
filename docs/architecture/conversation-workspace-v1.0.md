> # ✅ CANONICAL — RATIFIED AND FROZEN
>
> **Ratified 22 Jul 2026.** This document is binding. It is the architectural specification the
> conversation workspace implements.
>
> It contains **no SQL, no schema, no components, no hooks, no services, no RLS, no realtime code**
> in its normative sections. That is deliberate: it specifies the architecture, not its
> implementation. §12 is an explicitly **NON-NORMATIVE** appendix recording an audit of the codebase
> as it stood at ratification, preserved so its findings are not lost — it describes what *is*, never
> what *must be*.
>
> **Rule numbers `W1`–`W31` are frozen** — a stable citation interface. They may never be
> renumbered. They are namespaced to this document and do not refer to rules in
> `communication-v1.0` (`C`/`D`), `architecture-v1.0` (`§`), `identity-v1.1` (`R`/`B`/`D`/`A`) or
> `publication-v1.0` (`P`).
>
> **This Markdown file is the canonical, authoritative artifact.**
>
> Status: **RATIFIED v1.0** — 22 Jul 2026 · frozen. Amendment record at **§14**.
>
> **Amendments** are made by minting a new version (`conversation-workspace-v1.1`), never by editing
> this file.

YesPleez · Architecture Specification

# Conversation Workspace v1.0

The canonical design for everything that surrounds a conversation rather than being one: the layers
above the message stream, the overflow menu, the conversation indexes, and the per-participant state
that organises an inbox.

**Status** CANONICAL — ratified and frozen 22 Jul 2026
**Governed by** Communication v1.0 (frozen) · Messaging Availability v1.0 (frozen) · Identity v1.1 §A5 (frozen)
**Extends** M8 messaging · M9–M13 message kinds
**Scope** Scene · Festival · Operations · future products

---

## Constitutional principles

Three rules are **constitutional**: everything else in this document is a consequence of them. An
implementation that finds one of them inconvenient has found the point at which it must stop and
surface the conflict, not the point at which it may make an exception.

**`W1` · Four systems, never merged.**
The conversation header, live event updates, pinned messages and conversation pinning are four
distinct systems with four different lifecycles and four different owners. They may sit adjacent on
screen. They may never be implemented as one mechanism with a type column, and a feature belonging
to one may never be reached through another.

**`W2` · Indexes are views, never stores.**
Media, Files and Links do not store anything. Each is a filtered projection of messages that already
exist. An asset exists exactly once, in the message that carried it. Any implementation that writes
a row when a file is indexed has created a second source of truth and violated this rule.

**`W3` · The conversation is not an event-management surface.**
Operational data belongs to the event and is edited on the event's own screens. The conversation may
announce that something changed and link to where it lives. It may never embed, expand or edit that
data inline. A messenger that grows an event editor has stopped being a messenger and started being
a worse version of the thing it links to.

---

## §0 — Governance position

This document sits **below** Communication v1.0 and inherits every rule in it. Where the two appear
to conflict, Communication v1.0 wins and the conflict is a defect in this document.

It governs the surfaces *around* a conversation. It does not modify the conversation model, the
context model, the permission model, or the message kind registry — all four remain owned by
Communication v1.0 and its milestones.

---

## §1 — Philosophy

### 1.1 What this exists to solve

A conversation about a gig runs for months. By the week of the show it contains hundreds of
messages, and somewhere inside it are the load-in time, the gate code, the contract, the poster, the
stage plot and four Spotify links.

Every messenger solves this the same way: it doesn't. It offers search and a scrollbar.

**`W4`** A YesPleez conversation is a **workspace**, not a transcript. Its purpose is not only to
carry what was said, but to make what was *shared* retrievable without reading what was said.

### 1.2 The advantage this platform actually has

**`W5`** Messengers understand messages. YesPleez understands **events**. A conversation whose
context is an event knows what the event is, when it is, where it is, and who is on it — and it
knows when those change.

That is the difference the workspace exists to exploit. A participant should never learn that doors
moved by reading a message someone remembered to send.

### 1.3 Non-goals

**`W6`** The workspace is **not**:

- a personal asset library — that is a future milestone and is out of scope (`W27`)
- a storage system of any kind (`W2`)
- an event editor (`W3`)
- app settings, account settings or profile management

---

## §2 — The three layers above the stream

**`W7`** Above every conversation sit three independent layers, in this order:

```
┌───────────────────────────────────┐
│  Conversation Header              │  permanent · about the conversation
├───────────────────────────────────┤
│  Live Event Updates               │  temporary · system-generated
├───────────────────────────────────┤
│  Pinned Messages                  │  persistent · participant-chosen
├───────────────────────────────────┤
│                                   │
│  Conversation                     │
│                                   │
└───────────────────────────────────┘
```

Each has a different lifecycle, and the lifecycle is what distinguishes them:

| layer | created by | ends when | in history? |
|---|---|---|---|
| Header | the conversation's existence | never | no |
| Live Event Update | the system, on a change | dismissed, or no longer relevant | no |
| Pinned Message | a participant, deliberately | unpinned | **yes** — it is a message |

**`W8`** A layer that is empty occupies no space. The stream begins immediately below the last
layer that has content.

**`W9`** No layer may reorder, absorb or conditionally replace another. If all three have content,
all three are shown.

---

## §3 — Conversation Header

**`W10`** The header is **permanent** and describes the conversation itself. It is not part of
message history and cannot be dismissed.

Its content is drawn from the conversation's context (Communication v1.0 §2.3 — `context_type` and
`context_id`). What it shows depends on what kind of thing caused the conversation.

For an event context, the header may carry:

- event name
- event date
- venue
- participant count
- the reader's own role in the event
- event status

**`W11`** The header renders from data the conversation already carries or can resolve from one
reference. It may not fan out into several workflow tables to draw a header — Communication v1.0
§2.7 established mirroring metadata onto the conversation precisely so a list renders without that,
and the header inherits the same constraint.

**`W12`** The header is **read-only**. Tapping any part of it navigates to the object it describes;
nothing in it is editable in place (`W3`).

---

## §4 — Live Event Updates

### 4.1 What they are

**`W13`** A Live Event Update is a **system-generated, temporary notice** that something about the
event has changed in a way that affects the people in this conversation.

They are **not** chat messages. They are **not** pinned messages. They do not appear in history,
they are not attributable to a sender, and they cannot be replied to.

Examples of changes that warrant one:

- set times updated
- soundcheck moved
- doors changed
- venue changed
- capacity changed
- artist added or removed
- event cancelled or postponed

### 4.2 Shape

An update states **what changed**, **what it means for the reader**, and **where to go**:

```
🎫 Event Update
Set times have changed.

Your set:
8:30pm

View Set Times →
```

**`W14`** The action on an update **navigates**. It never expands, never loads operational data into
the conversation, and never opens an editor (`W3`). The update provides awareness and a shortcut;
the destination provides the detail.

**`W15`** An update is **personalised where the change is personal**. "Set times have changed" is
information; "your set: 8:30pm" is the reason the reader cares. Where the system can resolve the
reader's own stake in a change, it states it.

### 4.3 Lifecycle

**`W16`** An update ends by one of three routes, decided per update type:

1. **dismissal** — the reader acknowledges it
2. **irrelevance** — the change it announces is superseded, or the event has passed
3. **supersession** — a newer update about the same field replaces it rather than stacking beside it

Updates do not accumulate indefinitely. A conversation showing six stale banners has failed.

### 4.4 Delivery

**`W17`** Live Event Updates are delivered by the **notification system**, not by a mechanism of
their own. The banner is a *view* over notifications already addressed to the reader whose subject
is this conversation's context — it is not a second store, and it obeys `W2`.

This is a consequence of `W2` rather than a convenience: a dedicated banner store would need its own
delivery, its own realtime, its own access rules and its own read state, all of which the
notification layer already owns (Communication v1.0 §7).

**`W18`** Dismissing a banner marks the underlying notification read. There is no second concept of
"dismissed" to keep in step with "read".

---

## §5 — Pinned Messages

**`W19`** A pinned message is an **existing message** in this conversation that a participant has
marked as important. Pinning does not copy, move or duplicate it (`W2`) — it is the same message,
in the same place in history, with a flag.

Typical use: gate codes, parking instructions, green room location, production notes, contact
numbers, load-in instructions.

### 5.1 Visibility

**`W20`** Pinning is **conversation-wide, not personal**. A participant pins for everyone. This is
what distinguishes it from every other per-participant flag in the messaging system, and it is
deliberate: the gate code is not more important to one person than another.

### 5.2 Presentation

**`W21`** One pinned message renders as a single banner showing its content:

```
📌 Gate code is 2487
```

More than one renders as the most recent, with an affordance to open the full list:

```
📌 Gate code is 2487                    ▼
```

Opening it lists every pinned message. Selecting any entry performs **Jump to Chat** (`W23`).

### 5.3 Lifecycle

**`W22`** Pinned messages **do not expire**. They persist until manually unpinned. Automatic
unpinning rules may be introduced later for specific message kinds; none exist in v1.

---

## §6 — Jump to Chat

**`W23`** Wherever the workspace surfaces something that came from a message — an index entry, a
pinned message, a search result — the **primary action is Jump to Chat**: navigate to that message,
in place, in the conversation.

Download, open and view are **secondary**.

This is the workspace's central interaction and the reason `W2` holds. An index that downloads by
default is a file browser. An index that jumps preserves *why* something was shared — the messages
around it, who sent it, what was being discussed. That surrounding context is frequently the
information the user actually needed.

**`W24`** A jump must land the message **in view and visibly identified**, so the reader knows which
of the messages on screen they were sent to.

---

## §7 — The Overflow Menu (⋮)

### 7.1 Purpose

**`W25`** The ⋮ menu is the **control centre for the current conversation**. Every item in it acts
on, or navigates within, *this* conversation.

It is not app settings, not profile management, not account management, and not a personal asset
library.

### 7.2 Structure

```
⋮
  Search
  ─────────────
  Media
  Files
  Links
  ─────────────
  Pin Conversation  /  Unpin Conversation
  Conversation Theme
  Mute Notifications
  ─────────────
  Clear Conversation
  Make Unavailable for Messaging
  Report
```

⚠ **The last section's wording is constrained by a frozen document and is not free.** See §7.11.

**`W26`** The menu is **navigation, not functionality**. Every item opens a dedicated screen or
performs one unambiguous action. No item expands into a sub-panel of controls inside the menu
itself. If people open the menu, they already have a goal; the menu's only job is to not make them
hunt.

### 7.3 Search

Searches **this conversation only**. Covers message text, file names, links, and — when they exist —
media captions and voice transcripts.

### 7.4 Media

The conversation's media index: photos, audio and Voiceys at v1; video and GIFs when those kinds
exist.

Per entry: **Jump to Chat** (primary), view, download original, and metadata — sender, date, file
type, size.

Items whose message carries a preserved original display the HD chip inline. **There is no separate
"HD Originals" section**; HD is a filter over Media, never a sibling of it.

### 7.5 Files

Every non-media attachment: PDF, DOCX, XLSX, ZIP, PSD, AI, and so on.

Per entry: **Jump to Chat** (primary), download, metadata.

### 7.6 Links

Every URL shared in the conversation — Spotify, SoundCloud, Instagram, ticket links, websites.

Per entry: open link, **Jump to Chat**, date shared.

### 7.7 Pin Conversation

Pins this conversation to the top of the reader's inbox. The label toggles between **Pin
Conversation** and **Unpin Conversation**.

⚠ **This is inbox organisation and has nothing to do with pinned messages** (`W1`). The two systems
share a word and nothing else:

| | scope | visible to | affects |
|---|---|---|---|
| **Conversation Pin** | one inbox | only the person who set it | ordering of the conversation list |
| **Pinned Message** | one conversation | every participant | what shows above the stream |

### 7.8 Conversation Theme

Applies to this conversation only. Never changes global appearance.

The theme *system* — how themes are owned, chosen, adopted from another profile, or collected — is
**out of scope for this document** and is deferred to its own specification. Only the entry point is
specified here.

### 7.9 Mute Notifications

Mutes notifications for **this conversation only**. It is distinct from the per-category
notification preferences that already exist, which are global to the reader.

⚠ **Check against `DA3` before building.** `messaging-availability-v1.0` defers
"notification-level muting of a person — receiving nothing from someone while remaining reachable by
them", noting it needs a new unit and its own design. Every live conversation is presently pairwise
(`DA1`), so muting *this conversation* is in practice muting *that person*, and this entry risks
delivering a deferred decision through a side door.

The distinction that keeps them separate: this mutes a **thread**, and a reader may share several
threads with one counterparty. That holds today and must be re-examined if it stops holding. See
`Q5`.

### 7.10 Clear Conversation

Removes the conversation's history **from this reader's view**.

**`W27`** Clear is a **watermark, not a deletion.** Messages in this system are immutable
(Communication v1.0), no message may be destroyed by a participant, and the other party's copy is
untouched. Clear records a point in time before which this reader sees nothing.

The confirmation must say what actually happens. Copy that implies deletion is a defect, not a
simplification.

### 7.11 Ending unwanted contact — and why it is not called "Block"

⚠ **This entry's design and its wording are already governed by a frozen document.**
`messaging-availability-v1.0` (ratified 21 Jul 2026) specifies this control in full. This section
does not restate it; it records how it appears here and what the menu may not do.

**`W29` The menu says "Make Unavailable for Messaging", never "Block".**
`MA9` is explicit: the words *"block"*, *"block user"*, *"ban"* and *"remove"* do not appear in the
interface. This is not euphemism — YesPleez has deliberately not built removal, and "Block" would
name a platform action that does not exist while implying a user's public standing had changed when
it has not. A menu item labelled "Block" is a defect against a frozen rule, not a wording preference.

The word is not banished everywhere: `MA9` §6.2 governs the interface only. **Search and help must
answer to "block"** and route to this control, because that is the word a user in distress will
look for.

**`W30` The menu never discloses availability state to the affected party.**
Per `MA9` §6.1, a withdrawn party's refusal must remain indistinguishable from every other reason a
thread cannot be written to — a closed thread, a restricted thread, an ended workflow. That
ambiguity is a **safety property**: a party who cannot tell whether they were withdrawn from has no
clear moment to retaliate. No menu state, label, timing difference or error may leak it.

**`W31` This control and Report are never presented as one act.**
`MA12` requires that withdrawing availability never be presented as reporting, never create a
moderation record, and never be counted as a signal of wrongdoing. Adjacency in a menu is
acceptable; a combined "Block and Report" action, a shared confirmation, or copy implying one
implies the other is not.

### 7.12 Report

Reporting is deferred as `DA2` in `messaging-availability-v1.0` (and `D17` in Communication v1.0) —
**deferred meaning not denied**. It is compatible with what is ratified and may ship at any time,
provided it is a separate act with its own interface and its own record (`W31`).

The menu reserves its position. Nothing else about it is specified here.

### 7.13 Availability (future)

⚠ **Ambiguous term — resolve before implementing.** "Availability" names two unrelated things in
this product:

1. **Messaging availability** — whether a person accepts messages at all. Already ratified in
   `messaging-availability-v1.0`; its control is §7.11 above.
2. **Booking availability** — a counterpart's calendar of free dates, the shared
   availability-calendar work.

A menu entry called "Availability" would be read as the second by artists and promoters and as the
first by anyone who had just used §7.11. See `Q4`.

---

## §8 — Out of scope

**`W28`** The following are future systems. They are **not** part of the conversation workspace and
must not be reached through it:

- My Uploads
- Personal Asset Library
- Profile Media
- Storage Management
- Collections and Reusable Creator Assets
- Video uploads, transcoding, and media optimisation *(frozen by owner decision, 22 Jul 2026 —
  deferred to a post-launch Media System milestone)*

The conversation menu remains focused solely on navigating and managing the current conversation.

---

## §9 — Relationships

### 9.1 Conversations and events

A conversation's link to an event is its **context** (Communication v1.0 §2.3): a `context_type` and
a `context_id`, polymorphic by necessity because the referent lives in a different table per type.

That context is **immutable** (§3.2 there). The header therefore describes something that cannot
change identity underneath it — which is exactly what makes a permanent header safe.

### 9.2 Events and updates

An event change produces a notification. A notification addressed to a reader, whose subject is a
conversation's context, produces a banner in that conversation (`W17`).

The event does not know about conversations. The conversation does not watch the event. The
notification layer is the only thing that spans them, which is what keeps the two independently
changeable.

### 9.3 What is genuinely new

Of everything in this document, exactly one piece of infrastructure does not exist in any form: a
record of **what changed on an event, and when**. Every other feature specified here is a view, a
flag, or a projection over data that already exists.

---

## §10 — Implementation order

Ratified 22 Jul 2026. Later stages depend on earlier ones; the order is not a preference.

1. **Conversation Header** — unblocked; uses existing context
2. **Media / Files / Links + Jump to Chat** — unblocked; views only
3. **State migration batch** — Conversation Pin, Pinned Messages, Mute, Clear
4. **Event Change Log** — the only new infrastructure (§9.3)
5. **Live Event Updates** — depends on 1 and 4

Block, Report, Conversation Theme and Availability are **not** in this sequence. Each needs its own
specification first.

---

## §11 — Open questions

**`Q1` · Is per-participant conversation state keyed by profile or by user?**
The existing precedent is split: participation is keyed by **profile**, read state by **user**. Pin,
mute and clear must pick one deliberately. The inbox is profile-scoped, which argues for profile; a
pin is a personal preference of a human, which argues for user. **Unresolved — must be decided
before stage 3.**

**`Q2` · What granularity does the event change log record?**
Per-field, per-save, or per-semantic-event. This determines whether "set times have changed" can be
distinguished from "the event was edited". **Unresolved — must be decided before stage 4.**

**`Q3` · Which update types dismiss, which supersede, and which expire?** (`W16`)
**Unresolved — may be decided per type during stage 5.**

**`Q4` · What does a menu entry called "Availability" mean?** (§7.13)
Messaging availability is ratified; booking availability is a different feature. Both are plausible
readings of one word in one menu. **Unresolved — must be decided before either ships in the menu.**

**`Q5` · Is per-conversation mute distinct enough from `DA3`?** (§7.9)
Pairwise conversations make thread-mute and person-mute nearly the same act today. **Unresolved —
must be decided before stage 3.**

---

## §12 — Implementation notes *(NON-NORMATIVE)*

> ⚠ **This section is a snapshot of the codebase as audited on 22 Jul 2026, not a specification.**
> It exists so the audit's findings survive the session that produced them. It describes what *is*.
> Where it disagrees with reality, reality is right and this section is stale.

### 12.1 The event link already exists

`conversations` carries `context_type` and `context_id`, added in the messaging foundation migration
and documented there as C15/§2.3. A conversation caused by an event already references it. **No new
column is required for the header.**

### 12.2 `subject_state` is the precedent for header data

The same table carries `subject_state`, mirrored onto the conversation explicitly so "a conversation
list renders without joining five workflow tables". Header fields that would otherwise require a
join should follow that established pattern rather than inventing a new one (`W11`).

### 12.3 Notifications are live and are the delivery mechanism

The notification system is applied and verified in production: preferences, claim delivery and held
expiry all exist. It has RLS, per-category preferences and a `messages` category. Live Event Updates
should ride it (`W17`) rather than introduce a parallel path.

⚠ One known defect in that system is **unrelated but relevant to sequencing**: unrestricted INSERT
on notifications is an open security issue and a deployment prerequisite. It should be closed before
anything new depends on notification delivery.

⚠ Also known: the held-expiry function exists but is **never called** — nothing schedules it. Any
design here that assumes a scheduler exists is wrong (see 12.6).

### 12.4 The event change log is the only new infrastructure

No audit table, change log, history table or trigger exists on events. Nothing records that an event
changed, when, or from what. This is the whole of stage 4 and it has no partial implementation to
build on.

### 12.5 State changes need policies, not just columns

The messaging RLS **deliberately grants no UPDATE** on `conversations` or on
`conversation_participants` — both migrations say so explicitly. `archived_at` already exists as a
column with no client write path for exactly this reason.

Consequently every item in stage 3 needs an access decision, not merely a column:

- **Pin Conversation** — new per-participant state; see `Q1`
- **Pinned Messages** — conversation-wide (`W20`), unlike the existing per-profile message state
  table, which is keyed per message per profile and holds only the Yes reaction
- **Mute** — the existing preferences table is keyed per user per category, with a comment noting
  the key would have to grow for a channel dimension; that growth is this work
- **Clear** — a `cleared_at` watermark (`W27`). The per-message state table's own comment already
  names `hidden_at` as deliberate future work, so the intent was anticipated

### 12.6 No scheduler exists

There is no cron, no scheduled job and no Edge Function in this project. Any lifecycle rule that
assumes something runs periodically (`W16` expiry, storage reclamation) must instead be enforced at
**read time**, as the HD original expiry gate is. This is a standing constraint, not a temporary one.

### 12.7 ⚠ `listMessages` is unbounded — verify before stage 2

The conversation loader selects a conversation's messages ordered **ascending with no limit**. If
PostgREST's `max-rows` is configured (commonly 1000), a long conversation would silently return the
**oldest** thousand messages and omit everything recent.

This is a latent defect in messaging today, and stage 2 would inherit it: an index built over
`listMessages` would index the wrong end of a long conversation. **Verify the project's `max-rows`
setting before building the indexes**, and treat pagination as a prerequisite if it is set.

### 12.8 Jump to Chat has no foundation yet

Message bubbles carry no DOM anchor, no ref keyed by message id, and no highlight state. The
conversation has scroll-to-bottom only. `W23`/`W24` therefore require per-message anchoring and a
highlight treatment as part of stage 2 — small, but not free.

### 12.9 Links have no existing support

There is no `link` message kind, no URL detection, and message bodies render as plain text nodes.
The Links index must derive URLs by scanning message bodies on read — which is also the only
approach that covers conversations that already exist (`W2`).

### 12.10 The inbox is ready for a pin flag

The conversation list already sorts client-side with a two-key comparator keyed on archived state,
in two places. A pin flag plugs into both. One of the two relies on the server's ordering remaining
stable underneath it — that assumption should be made explicit when pinning lands.

---

## §13 — Terminology

| term | meaning |
|---|---|
| **Conversation Header** | permanent, non-dismissible information about the conversation |
| **Live Event Update** | temporary, system-generated notice of an event change |
| **Pinned Message** | an existing message flagged as important, visible to all participants |
| **Conversation Pin** | inbox ordering preference, personal to one reader |
| **Index** | a filtered view over messages; Media, Files, Links |
| **Jump to Chat** | navigating to a message in place, in its original position |

---

## §14 — Amendment record

| version | date | change |
|---|---|---|
| v1.0 | 22 Jul 2026 | Ratified. Combines the Conversation Overflow Menu decision and the Conversation Header & Top-of-Chat decision into one specification, with a non-normative audit appendix (§12). During drafting, the proposed menu item **"Block"** was found to conflict with the frozen rule `MA9`; it is specified here as **"Make Unavailable for Messaging"** (§7.11) and the conflict was surfaced rather than resolved by exception. |
