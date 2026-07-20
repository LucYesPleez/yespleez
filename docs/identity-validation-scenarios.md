# Identity Architecture — validation scenarios

**Status:** living. Re-run at M6, M7 and M8, and after any change to attribution or authorization.
**Validates:** Identity Architecture v1.1 (`docs/architecture/identity-v1.1.html`) — canonical, frozen.
**Not dated in the filename** deliberately: unlike the design reviews and verification evidence in `docs/`, this is not a snapshot of a moment. It is a suite that must survive into M7 and M8 and stay runnable.

---

## What a validation scenario is — and is not

A validation scenario is a **canonical use case that proves the architecture is correct**, expressed as something a real person does. It is not a bug report.

The distinction matters because it changes what gets fixed. A bug says *"this button is broken."* A validation scenario says *"the product must support this, here is what the architecture says must be true while it happens, and here is how we will know."* A bug closes. **A scenario is re-run forever.**

These live outside the soak backlog on purpose. The backlog counts defects; **this counts capabilities.** A scenario failing is not one more line in a triage table — it is the architecture not yet being implemented.

**These are also the milestone acceptance criteria.** M6 is not done when `from_profile_id` exists.

This is a **living validation suite, executed at M6, M7 and M8**. Individual scenarios are validated when the capability they verify exists. **A milestone's acceptance requires every scenario whose required capability exists at that milestone to pass.** Any scenario whose required capability does not yet exist **must appear in the Validation Deferral Register below, together with the capability it awaits**. A scenario may not be treated as deferred without that record.

### The suite

| | Scenario | Accounts | `can_act_as()` | Isolates |
|---|---|---|---|---|
| **IA-01** | Self-owned profile interaction | one | true for **both** profiles | **Attribution** |
| **IA-02** | Independent Venue → Independent Artist | two | true one way, **false** across the boundary | **Authorization** |

**IA-01 and IA-02 are a matched pair and must be run together.** Each pins one axis so the other is the only thing that can carry the behaviour. Alone, either can be passed by an implementation that has not actually separated them.

### Validation Deferral Register

Every scenario whose required capability does not yet exist. **A scenario absent from this register is expected to pass at the current milestone.** The register shrinks as capabilities land — an entry is removed by validating the scenario, never by deleting the row.

| Scenario | Step | Required capability | Validated at |
|---|---|---|---|
| **IA-01** | 4 · Negotiate | in-app messaging | M8 |
| **IA-01** | 7 · Switching does not rewrite history | Active Profile Context | when it lands |
| **IA-01** | 8 · Active profile is not load-bearing | Active Profile Context | when it lands |
| **IA-02** | 2 · Negotiate → book *(negotiate half only; book is validated at M6)* | in-app messaging | M8 |
| **IA-02** | 5 · B's active profile is inert | Active Profile Context | when it lands |
| **IA-02** | 6 · Attribution survives switching | Active Profile Context | when it lands |

**Not deferrals.** `R3.2` (IA-01 step 6, IA-02 step 3) is an M6 deliverable, so those steps are *not yet passing* rather than deferred — an ordinary in-milestone state. Likewise IA-02 requires two accounts, which is a **dataset** prerequisite, not a missing capability; it does not belong here.

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

### Acceptance criteria — executed at M6, M7 and M8, each as its capability lands

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
| **Control** | **IA-02** — without it, IA-01 passing means less than it appears to |

---

## IA-02 — Independent Venue → Independent Artist

> **User A owns a Venue profile. User B owns an Artist profile. A can act only as their own Venue; B only as their own Artist. An invitation from A's Venue to B's Artist is attributed to the Venue profile, and `can_act_as()` prevents either user from acting as the other's profiles.**

### The scenario

Elbows Rest (User A) invites Lucious (User B) to play. Two people, two accounts, two profiles.

### Why this is fundamental

**This is the market.** IA-01 is the special case; IA-02 is what the platform is *for* — a venue booking an act it does not own. If IA-02 does not hold, YesPleez does not work.

It is also where authorization is load-bearing for real. In IA-01 nothing could be denied. Here, **denial is half the requirement**: A must not act as Lucious, and B must not act as Elbows Rest.

### Why IA-02 is IA-01's control

The two scenarios pin opposite axes, and **neither proves the architecture alone**:

| | `can_act_as()` | What it isolates | What it catches |
|---|---|---|---|
| **IA-01** | true for **both** profiles | **Attribution** — nothing else can carry the behaviour | Attribution entangled with authorization |
| **IA-02** | true one way, **false** across the boundary | **Authorization** — the seam must actually deny | An implementation that authorizes by *account* and looks correct |

An implementation that conflates the two axes **passes IA-01** — because `can_act_as()` is true both ways, conflation is invisible. It fails IA-02, where the boundary is real. Conversely an implementation that authorizes correctly but attributes to the account passes IA-02's denials while failing IA-01.

**Run them together or neither result means what it looks like.**

### What the architecture requires

| Axis | Rule | Required |
|---|---|---|
| Attribution | **R1**, **R6.1** | `from_profile_id` = **Elbows Rest**, stamped at the write. Not "User A" |
| The human | **R1** | `from_user_id` = **A** — audit and delivery only, never the displayed actor |
| Authorization | **R2**, **R3** | `can_act_as(Elbows Rest)` → **true for A, false for B**, server-side, through the seam only |
| Forgery | **R3.2** | A writing `from_profile_id` = **any profile B owns** → **rejected by the database**, not by the client |
| Active profile | **R2** | B setting their stored active profile to Elbows Rest gains **nothing** |

### What happens today — the mirror image of IA-01

**The affordance renders.** `ProfileScreen.jsx:177`'s guard passes (`profile.user_id !== session.user.id`), so A viewing Lucious *does* get CHECK AVAILABILITY & ENQUIRE.

**And then the write is denied.** Backlog **S4**: `venue_enquiries`' sole INSERT policy is `WITH CHECK (auth.uid() = applicant_user_id)`, and `InviteSheet` sets `applicant_user_id` to the *artist* — B. A's `auth.uid()` is not B, so it fails `42501`, verified PRE and POST M4 (`m4-verification-evidence` B8). Venue-initiated invites *"have never been insertable, by policy design, not by accident."*

So the pair inverts exactly:

| | UI | Database |
|---|---|---|
| **IA-01** (self-owned) | **forbids** | would **permit** |
| **IA-02** (independent) | **offers** | **denies** |

**Both layers are wrong, in opposite directions, for the same reason: each reasons about accounts.** The UI asks "is this profile mine?" and means the account. The policy asks "am I the applicant?" and means the account. Neither can express "which profile is acting" — so one blocks the case it should allow, and the other allows the affordance for a case it will refuse. **That symmetry is the argument for the seam**, better than any statement of it.

*(As in IA-01, schema drift would fail this write independently — `InviteSheet` sends eight columns that do not exist. Three unrelated faults on one path.)*

### Acceptance criteria — executed at M6, M7 and M8, each as its capability lands

As A, acting as Elbows Rest, against B's Lucious.

| # | Step | Passes when |
|---|---|---|
| **1** | Discover / enquire / invite | Row written. `from_profile_id` = Elbows Rest, `from_user_id` = A. **B sees an invitation from a venue, never from a person** |
| **2** | Negotiate → book | Each message attributed to its profile and records its human author. Lucious lands on the bill naming both profile and human |
| **3** | **A cannot forge B's identity** *(R3.2)* | A posting `from_profile_id` = a B-owned profile → **rejected server-side**. Must fail with the client bypassed entirely |
| **4** | **B cannot act as A's Venue** *(R3)* | `can_act_as(Elbows Rest)` is false for B. B cannot send, edit or respond as Elbows Rest |
| **5** | **B's active profile is inert** *(R2)* | B tampering their stored active profile to Elbows Rest → **only labels change**. No capability, anywhere |
| **6** | Attribution survives switching *(R6.1)* | A switching profiles after sending does not re-attribute the sent invitation |

**Steps 3–5 must be exercised with the client bypassed** — a direct authenticated request, not the UI. A picker that hides the option proves nothing; R3.2 is a database property.

### Status

| | |
|---|---|
| **Today (pre-M6)** | **Fails at step 1** — `42501` (S4). The affordance exists; the write has never succeeded |
| **Blocked on** | M6 (`from_profile_id`, `can_act_as()`), and the `venue_enquiries` policy that S4 records |
| **Pairs with** | **IA-01** — run together |

---

## Adding scenarios

A validation scenario earns its place by being a **use case the architecture exists to make possible**, where getting it wrong would mean the architecture is not implemented. Not every bug is a scenario; most are just bugs.

Number them `IA-nn`, never renumber (they get cited), and give each one: the scenario in a sentence, why it is fundamental, what the architecture requires per rule, what happens today, and acceptance criteria that can fail in the database rather than only on screen.
