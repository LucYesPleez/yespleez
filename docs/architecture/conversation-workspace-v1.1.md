> # ✅ CANONICAL — RATIFIED AND FROZEN
>
> **Ratified 22 Jul 2026.** This document is binding. It **amends** `conversation-workspace-v1.0`,
> which was ratified earlier the same day.
>
> **`conversation-workspace-v1.0` remains in force in full except where this document amends it.**
> Rules `W1`–`W31` are unchanged and still cited by their original numbers. This document adds
> `W32`–`W38` and supersedes §7.2, §7.9, §7.11, §7.12 and §7.13 of v1.0.
>
> It contains **no SQL, no schema, no components, no hooks, no services, no RLS, no realtime code**.
>
> **Rule numbers `W32`–`W38` are frozen.** They may never be renumbered. They are namespaced to the
> `conversation-workspace` series and do not refer to rules in `communication-v1.0` (`C`/`D`),
> `messaging-availability-v1.0` (`MA`/`DA`), `architecture-v1.0` (`§`), `identity-v1.1`
> (`R`/`B`/`D`/`A`) or `publication-v1.0` (`P`).
>
> Status: **RATIFIED v1.1** — 22 Jul 2026 · frozen. Amendment record at **§7**.
>
> **Amendments** are made by minting a new version (`conversation-workspace-v1.2`), never by editing
> this file.

YesPleez · Architecture Specification

# Conversation Workspace v1.1 — Messaging Availability UI

**Status** CANONICAL — ratified and frozen 22 Jul 2026
**Amends** `conversation-workspace-v1.0` §7.2, §7.9, §7.11, §7.12, §7.13
**Governed by** Communication v1.0 (frozen) · **Messaging Availability v1.0 (frozen)** ·
Identity v1.1 §A5 (frozen)

---

## §0 — Why this amendment exists

v1.0 specified the menu item that ends unwanted contact as **"Make Unavailable for Messaging"**,
after the originally proposed label "Block" was found to violate `MA9`.

That resolved the wording and left the shape wrong. A destructive-looking verb sitting beside
*Report* in a menu's final section still frames the act as a sanction, which `MA12` forbids in
substance as well as in words. The act is not a punishment, not moderation, and not reporting — it
is **a messaging permission**.

This amendment therefore moves it out of the menu's final section entirely and gives it a home
alongside other messaging preferences, where its nature is evident from where it lives.

---

## §1 — The revised menu

**`W32`** The conversation overflow menu is:

```
⋮
  Search
  ─────────────
  Media
  Files
  Links
  ─────────────
  Messaging          >
  Conversation Theme
  ─────────────
  Report User
```

This supersedes v1.0 §7.2.

**`W33`** *Messaging* is a **navigation entry**, not an action. It opens a screen. Nothing about
availability is toggled from the menu itself — consistent with `W26`, and important here because an
irreversible-looking switch inside a popup menu invites mis-taps on the one control where a mis-tap
is most costly.

`Search`, `Media`, `Files`, `Links` and `Conversation Theme` are unchanged from v1.0 §7.3–§7.8.

---

## §2 — The Messaging screen

**`W34`** Selecting *Messaging* opens:

```
Messaging
────────────────────

  Allow Messaging          [ ON ]

────────────────────
```

One control at v1.1. The screen exists as a **container for messaging preferences**, and the
availability toggle is simply the first one to arrive.

When **ON** — messaging behaves normally.
When **OFF** — messaging between these two profiles becomes unavailable, governed entirely by
`messaging-availability-v1.0`. This document defines no behaviour of its own; it defines a door.

---

## §3 — The toggle reflects your own setting, never the pair's state

> ⚠ **This is the single most important rule in this document, and the easiest to implement
> wrongly.**

`MA2` makes availability a property of a **pair**, and symmetric: when it is off, neither party may
write to the other. A naive implementation therefore renders the toggle from the pair's computed
state — which is the obvious reading of "the channel is closed", and which **breaks a ratified
safety guarantee**.

`MA9` §6.1 requires that a withdrawn-from party's experience remain **indistinguishable** from every
other reason a thread cannot be written to. A toggle showing OFF that the reader did not set tells
them exactly what happened, and to whom, and gives them a moment to react to. That ambiguity is not
a nicety; it is the property that removes the retaliation trigger explicit blocking creates on other
platforms.

**`W35` The toggle displays the reader's own switch, and only that.**
It is never computed from the pair. If the counterparty has withdrawn and the reader has not, the
reader's toggle reads **ON** and the conversation is simply not writable — the same state a closed
or restricted thread produces.

**`W36` The interface must not explain why a conversation cannot be written to.**
No label, tooltip, error, empty state, disabled reason, response-time difference or analytics event
may distinguish "the counterparty withdrew" from "this thread is closed" from "this workflow ended".
A truthful-sounding message here is a disclosure.

**`W37` Turning the toggle off must state that it closes the channel in both directions.**
`MA2` is symmetric: the reader loses the ability to write as well. Copy implying it only stops the
*other* party from writing describes an asymmetric mute the system does not implement, and would
surprise the reader the first time they tried to send something.

Re-enabling is the same act reversed, available at any time without approval or waiting period
(`MA` §2.3).

---

## §4 — Report User

**`W38`** *Report User* remains a **completely separate action** with its own interface, its own
confirmation and its own record.

Availability and reporting may never share an action, a confirmation flow, a screen or a phrase that
implies one entails the other (`MA12`). A person must be able to end unwanted contact **without
accusing anyone of anything**, and the reverse must also hold: reporting someone must not silently
alter messaging availability.

Reporting itself remains deferred (`DA2` / `D17`) and unspecified. The menu reserves its position.

---

## §5 — Future messaging preferences

The Messaging screen is deliberately shaped to hold more than one row. Anticipated, **none
specified and none to be built now**:

- Allow Messaging *(v1.1 — the only one that exists)*
- Allow Voiceys
- Allow Attachments
- Read Receipts

Each is a genuine architectural decision in its own right. In particular, **Read Receipts would
amend Communication v1.0 §2.5 and the M10 receipt model**, which is ratified and implemented — it is
not a preference that can be added by putting a switch on this screen.

---

## §6 — Questions resolved and raised

**`Q4` — RESOLVED.** v1.0 asked what a menu entry called "Availability" would mean, given the word
names both messaging availability and booking availability. It is resolved by naming this entry
**Messaging**. The word "Availability" is thereby freed for the booking calendar, and should not be
used for this control anywhere in the interface.

**`Q5` — SUPERSEDED BY `Q6`.** v1.0 asked whether per-conversation mute was distinct enough from the
deferred `DA3`. *Mute Notifications* does not appear in the revised menu, so the question is moot
unless mute returns.

**`Q6` · Were *Pin Conversation*, *Mute Notifications* and *Clear Conversation* deliberately
dropped, or merely absent from an amendment focused on availability?**
All three are specified in v1.0 (§7.7, §7.9, §7.10) and constitute **stage 3** of the ratified
implementation order (v1.0 §10). The revised menu in §1 omits all three. This document does not
assume the omission was intentional and does not remove them.

**Unresolved — must be decided before stage 3 begins.** Until it is decided, v1.0 §7.7, §7.9 and
§7.10 remain in force and stage 3 remains as ratified.

---

## §7 — Amendment record

| version | date | change |
|---|---|---|
| v1.0 | 22 Jul 2026 | Ratified. Overflow menu, header layers, indexes; `W1`–`W31`. |
| **v1.1** | **22 Jul 2026** | **This document.** Availability moved from a menu action into a *Messaging* screen (`W32`–`W34`). Specifies that the toggle shows the reader's own switch and never the pair's computed state (`W35`), that the interface must not explain why a thread is unwritable (`W36`), and that withdrawal must be described as symmetric (`W37`). Report User confirmed as wholly separate (`W38`). Resolves `Q4`; raises `Q6`. |
