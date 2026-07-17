# Identity Architecture — validation scenarios

**Status:** living. Re-run at M6, M7 and M8, and after any change to attribution or authorization.
**Validates:** Identity Architecture v1.1 (`docs/architecture/identity-v1.1.html`) — canonical, frozen.
**Not dated in the filename** deliberately: unlike the design reviews and verification evidence in `docs/`, this is not a snapshot of a moment. It is a suite that must survive into M7 and M8 and stay runnable.

---

## What a validation scenario is — and is not

A validation scenario is a **canonical use case that proves the architecture is correct**, expressed as something a real person does. It is not a bug report.

The distinction matters because it changes what gets fixed. A bug says *"this button is broken."* A validation scenario says *"the product must support this, here is what the architecture says must be true while it happens, and here is how we will know."* A bug closes. **A scenario is re-run forever.**

These live outside the soak backlog on purpose. The backlog counts defects; **this counts capabilities.** A scenario failing is not one more line in a triage table — it is the architecture not yet being implemented.

**They are also the M6 acceptance criteria.** M6 is not done when `from_profile_id` exists. M6 is done when these pass.

---

## IA-01 — Self-owned profile interaction

> **A user who owns both a Venue profile and an Artist profile must be able to discover their Artist profile, enquire, invite, negotiate and book — exactly as if they were two independent parties — while maintaining correct attribution through `from_profile_id` and correct authorization through `can_act_as()`.**

### The scenario

Elbows Rest (Venue) wants to ask Lucious (DJ / Prod.) to play. One person owns both.

The app must treat this as **Elbows Rest asking Lucious**. Two profiles. Two actors. One human, who is irrelevant to the question being asked.

### Why this is fundamental, not an edge case

One person routinely owns a venue, a DJ name, a festival, a photography business and a record label. **Those businesses interact constantly** — the venue books the DJ, the label promotes the festival, the photographer shoots the venue's night. That is not an exotic corner of the scene; for the underground it is the *normal* shape of a career.

**If the app blocks those interactions because they share a login, the architecture has not been implemented.** A profile that cannot transact with its sibling is not an entity — it is a filter over an account.

This is precisely what v1.1 exists to make possible. §A3's identity pair, R2's separation, R3's seam: all of it is machinery for saying *"who is acting"* independently of *"who is allowed"*. IA-01 is the smallest case that requires every part of it at once.

### Why IA-01 is the right first scenario — it isolates attribution

**In IA-01, `can_act_as()` is true for both profiles.** You own Elbows Rest; you own Lucious. Authorization cannot fail in either direction, and cannot distinguish them.

That is exactly what makes it valuable: **every remaining question is an attribution question.** With the authorization axis pinned true, nothing else can carry the behaviour. If the enquiry arrives correctly attributed to Elbows Rest, attribution is genuinely independent of authorization. If it doesn't, the two are still entangled — no matter what the schema says.

**And it is a trap for a naive implementation.** Because `can_act_as()` passes both ways, an implementation that *conflates* the two axes can still appear to pass IA-01 while being wrong for two unrelated humans. **IA-01 therefore needs a control** — the same flow between two different accounts, where authorization must fail in one direction. Without the control, IA-01 passing proves less than it looks like it does. *(Recommended, not yet specified; owner's call.)*

### What the architecture requires

| Axis | Rule | Required value |
|---|---|---|
| Attribution | **R1**, **R6.1** | `from_profile_id` = **Elbows Rest**, stamped at the write |
| The human | **R1** | `from_user_id` = the account — for audit and delivery, never displayed as the actor |
| Authorization | **R2**, **R3**, **R3.2** | `can_act_as(Elbows Rest)` → true, evaluated server-side, through the seam only |
| Active profile | **R6** | sets attribution and a label. **Nothing else.** A tampered value must not change who may act |
| Target | — | Lucious, as an ordinary counterparty. **The target's ownership is irrelevant to the actor's rights** |

The last row is the one today's code gets wrong.

### What happens today — the button does not exist

[`ProfileScreen.jsx:177`](../v2/src/screens/ProfileScreen.jsx#L177), inside the effect that builds the venue context:

```js
if (profile.user_id === session.user.id) return;   // your own profile
```

Lucious's `user_id` **is** your `user_id` — every profile an account owns shares one. The effect returns early, `venueCtx` is never set, and **CHECK AVAILABILITY & ENQUIRE never renders**. There is no path from Elbows Rest to Lucious. Not a broken path — an absent one.

**The guard is not stupid; it is pre-architecture.** In a one-profile-per-person world, "don't offer to enquire to yourself" is correct, and `profile.user_id === session.user.id` is exactly how you say it. The world changed underneath it. It is an **account-level fact answering a profile-level question** — the precise confusion v1.1 was ratified to end.

The profile-level form of the same intent is:

```js
if (profile.id === activeProfile.id) return;   // this IS the profile I'm acting as
```

Which the app cannot express today, **because there is no active profile.** IA-01 is therefore blocked on the Active Profile Context work (`active-profile-ux-review-2026-07.md`), not merely on M6's columns. You cannot ask "am I this profile?" until the app knows which profile you are.

### The irony that matters most

**RLS would allow the self-invite. The UI prevents it.**

Backlog **S4** records that venue-initiated invites can never insert: `venue_enquiries`' sole INSERT policy demands `auth.uid() = applicant_user_id`, and `InviteSheet` sets the applicant to the *artist*. But when the artist is your own profile, `applicant_user_id` **is** you — the policy passes.

**The one case the database permits is the one case the interface forbids.**

That inverts the usual diagnosis. The blocker is not the schema, not RLS, not the frozen architecture. **It is a UI assumption written before profiles were entities.** The architecture is ahead of the app — which is the strongest evidence available that v1.1 is right, and that the remaining work is implementation.

*(This is a live-schema fact, not a design claim: verified 2026-07-17, `live-schema-audit-2026-07.md`. Independently, the invite would still fail on schema drift — `InviteSheet.jsx:68-89` writes `applicant_name`, `event_id`, `event_name`, `message`, `proposed_date`, `proposed_time`, `proposed_fee`, `direction`, **none of which exist live**. Two unrelated faults on one path; fixing either alone changes nothing.)*

### Acceptance criteria — verify after M6

Each step performed **as Elbows Rest**, against **Lucious**, from one account.

| # | Step | Passes when |
|---|---|---|
| **1** | **Discover** — find Lucious in search/discovery while acting as Elbows Rest | Lucious appears as an ordinary result. Not hidden, not badged "you", not special-cased |
| **2** | **Enquire** — Elbows Rest → Lucious | Row written. `from_profile_id` = Elbows Rest. `from_user_id` = the account. `can_act_as(Elbows Rest)` true. Lucious appears as target, **not** as sender |
| **3** | **Invite** — Elbows Rest invites Lucious to an event | Same attribution. The invite is **from a venue**, not from a person |
| **4** | **Negotiate** — messages both ways | Each message attributed to its profile; each records its human author. The thread reads as **two parties** |
| **5** | **Book** — Lucious lands on the bill | `lineup_members` names both the profile and the human. The public lineup shows **Lucious**, never the account |
| **6** | **Attribution is not forgeable** *(R3.2)* | Posting `from_profile_id` = a profile you do **not** own is rejected **server-side**. Passing for your own profiles must not depend on the client having filtered the picker |
| **7** | **Switching does not rewrite history** *(R6, R6.1)* | Switch to Lucious after sending: the sent enquiry **still reads from Elbows Rest**. Attribution was stamped at the write |
| **8** | **The active profile is not load-bearing** *(R2)* | Tamper with the stored active profile → **only labels change**. No new capability, anywhere |

**Steps 6–8 are the ones that fail quietly.** 1–5 are visible in the UI; 6–8 are only true or false in the database, and a demo will not reveal them.

### Status

| | |
|---|---|
| **Today (pre-M6)** | **Fails at step 1–2.** The affordance does not render (`ProfileScreen.jsx:177`). Not scheduled — M6 is paused. |
| **Blocked on** | Active Profile Context (the app must know which profile is asking) **and** M6 (`from_profile_id` must exist to be stamped) |
| **Not a backlog item** | Deliberately. This is a capability the architecture promises, not a defect against current behaviour |
| **Needs** | A two-account control scenario, so IA-01 passing means what it appears to mean |

---

## Adding scenarios

A validation scenario earns its place by being a **use case the architecture exists to make possible**, where getting it wrong would mean the architecture is not implemented. Not every bug is a scenario; most are just bugs.

Number them `IA-nn`, never renumber (they get cited), and give each one: the scenario in a sentence, why it is fundamental, what the architecture requires per rule, what happens today, and acceptance criteria that can fail in the database rather than only on screen.
