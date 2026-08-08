# YesPleez Festival — UX v1 (FROZEN)

**Ratified by the owner across nine design stages, 2026-08-07.**
**Status: FROZEN. Design phase closed. Build phase open.**

This is the consolidated record of the design phase. It supersedes nothing about
architecture — the domain model was settled before this began and is not reopened
here. Reasoning for each decision lives in the memory files named in brackets;
this document is what you build from.

> ⛔ **Do not redesign anything in here without evidence.** A genuine
> contradiction discovered during implementation is evidence. A preference is not.

---

## 1. The organising questions

Every room answers exactly one question. Learned once, then never thought about
again.

| | |
|---|---|
| **Home** | What needs my attention? |
| **Event** | What are we publishing? |
| **Applications** | Who should we choose? |
| **People** | Who is ready? |
| **Timeline** | When does everything happen? |
| **Comms** | Who needs to know? |
| **Settings** | Who can do what? |

⚠ **SEVEN QUESTIONS, SIX DESTINATIONS.** Timeline is an **Event tab**, not a
sidebar destination. Having a distinct question does not earn a room. The
graduation test: *it becomes a destination the day it is the organiser's primary
operational surface — where they spend the festival weekend — and not before.*

**Sidebar (desktop):** Home · Applications · People · Event · Comms · Settings
**Bottom nav (mobile), five:** Home · Applications · People · Comms · More

⛔ A room that cannot state its question in one line does not belong.

---

## 2. Cross-cutting laws

These apply everywhere and several are platform-wide, not Festival-only.

### 2.1 Derived state
*If a state can be computed from facts, computing it is the only way it cannot
lie.* Stored derived state is a second source of truth, and a second source of
truth drifts.

- Participation status ← the append-only transition log
- Home priorities ← the underlying facts
- Editor completion ← required/recommended checks
- People readiness ← per-participant-type checks. ⛔ **Nobody ever marks a person
  Ready.**

**One permitted exception:** caching a derived value is allowed *only when the
database enforces it* (trigger). ⛔ Application code may never be the thing that
keeps a derived value true.

**Corollary — explain, never assert.** A derived state must always be able to say
why. `Ready when: Volunteer department assigned.`

### 2.2 Queries over maintained lists
Membership is derived too. A comms audience is a query over participation, never
a hand-kept recipient list. A broadcast resolves to a **snapshot at send time**,
recorded in its archive.

### 2.3 One irreversible action, one guard
The product has exactly two irreversible acts: **Release** (decisions reach
applicants) and **Send**. The confirmation lives there and nowhere else, stating
what is about to happen in full. ⛔ Confirming ordinary actions trains people to
click through warnings — precisely what you don't want at the two moments that
reach real people.

### 2.4 Navigation is stable
Destinations never appear or disappear. *A recommendation with nothing to say
should be silent; navigation is a MAP, and a map that redraws itself teaches
nothing.* Use an empty state instead.

### 2.5 Block only on required
- **Required** — without it the thing cannot function.
- **Recommended** — it works, just worse.

⛔ Never block on recommended. Three-state completion everywhere: `✔` complete ·
`⚠` recommended missing (with the reason) · `✖` required missing. Every review
item **deep-links to the field**, cursor placed.

### 2.6 Mobile is scoped by the SIZE of the edit
*Desktop is the primary configuration surface; mobile supports lightweight edits
and operational decisions.* The test: **does this edit require holding the whole
thing in your head?** Fixing a typo, changing a close date, closing applications
early — mobile. Thirty departments — desktop. ⛔ Mobile is not read-only.

### 2.7 One UI
⛔ There is no "small festival mode". Three applicants produce three rows in the
same engine, without pagination. Volume changes what is *present*, never what the
product *is*.

### 2.8 Absent ≠ unknown ≠ withheld
An unset optional field renders as **nothing** on a public surface — never a
placeholder apologising for itself, never "Coming soon".

---

## 3. Home

**Attention-driven, not phase-driven.** The organiser does not think in phases;
they think *what needs me now?* Phase is one input, attention is the output.

### Card anatomy — all three, always
```
SIGNAL   12 applicants waiting
REASON   Oldest submitted 19 days ago.
ACTION   Review Applications
```
⛔ Never a bare number — that is a reporting dashboard. The action is what makes
it operational.

**Exactly one destination per card**, and it lands on the **filtered view**, not
the room. ⛔ `Open Event`. ✅ `Finish Categories` · `Publish Decisions`.

**⛔ NOT DISMISSIBLE.** Dismissal is a second state that drifts: dismiss
*applications close tomorrow*, and tomorrow Home is empty while applications
still close today. An item disappears only when the underlying fact changes.

### The priority ladder
Engine order. ⛔ The word "ladder" never reaches the UI — the user sees
**Priorities**.

1. **Broken** — applications open with no category open · event public with no
   dates · a category open nobody is eligible for. Highest because it fails
   *silently*: nothing arrives and the organiser reads it as a quiet week.
2. **Decided but not released** — applicants read "In review" while the decision
   sits unsent. A promise already broken, so it outranks volume.
3. **Deadline-bound** — closes in 3 days · starts in 5 with departments unfilled.
4. **Waiting on you** — undecided, ordered by AGE of the oldest, not by count.
5. **Waiting on them** — accepted but unconfirmed. ⚠ **Deliberate hole** until
   participation ships. ⛔ Do not fake it from application status.
6. **Nothing needs you** — the calm state, said plainly.

⭐ **Home must be able to say nothing needs you.** A dashboard that cannot report
calm will manufacture urgency.

### Phase — derived, with optional override
`Draft → Applications Open → Event Upcoming → Event Live → Completed`, from event
dates + application state + now. **Phase filters which priorities are eligible; it
never orders them.**

⚠ During **Event Live**, Home should say the weekend belongs to Operations rather
than pretend to be useful.

**Mobile IS this screen.** Desktop shows the same items in the same order, numbers
in a column beside rather than above. ⛔ If desktop ever shows an item mobile
doesn't, the ladder has been compromised.

---

## 4. Event

An editor is a **workspace, not a wizard**. *A wizard optimises the first 15
minutes; a workspace optimises the next 200 edits.* All sections permanently
visible, fixed order, always. ⛔ No Next buttons, no step counter.

### Six sections, in the organiser's words
```
1  The event              name · what it is · poster
2  When and where         build · festival · pack-down · location
3  Who you're looking for categories → departments nested inside Volunteers
4  What applicants see    preview of the real page · the link
5  Review                 required vs recommended, each item deep-linked
6  Go live                two switches
```

- **Departments live inside Volunteers**, not as a sibling card. A music-only
  organiser never meets the concept.
- **Preview is a numbered section, not a topbar button.** People do not fear
  pressing Publish; they fear *"what am I about to show everyone?"* Preview turns
  publication from hope into verification.
- ⭐⭐ **Preview MUST render Scene's real public page**, never a Portal copy.
  There is only ever one public representation of an event. If preview differs
  from what a punter sees, organisers stop trusting it. The dependency on a repo
  this one cannot edit is healthy and deliberate — the alternative is maintaining
  two public renderers forever.
- ⭐ **"Go live" is TWO SWITCHES**, not one Publish button: *publicly visible* and
  *taking applications* are independent facts that move in either order.
  Flattening them removes capability — an unlisted event open by link is how the
  beta runs today.
- ⛔ **No staging / draft-changes layer.** That is the Publication Model's job.
  Autosave, and say permanently when the event is public that changes are live
  immediately.

**Creation is a separate, smaller decision:** duplicate last year or start fresh.
Duplicate carries categories and departments, deliberately drops dates.

**Stages and Shifts are NOT created here** — see §6.

---

## 5. Applications

### ⭐⭐ Review ≠ Selection — two different cognitive tasks

| | The question | The surface |
|---|---|---|
| **Review** | "What do I think about this applicant?" | one at a time, keyboard, a firehose |
| **Selection** | "Which COMBINATION produces the best line-up?" | the shortlist, against a Target |

Nobody reviews 600 applications — they make passes. A table optimised for triage
is bad at "choose twelve of these forty". **One room, two modes over the same
set.** ⛔ Never two rooms, never two data layers.

**Review mode is keyboard-first** — email triage, not spreadsheet management:
`J` down · `K` up · `S` shortlist · `A` accept · `X` reject · `Enter` details ·
`N` **internal note** (organisers constantly leave themselves reminders on a first
pass; a note is neither a message nor a decision).

⭐ **Review context survives the whole session.** Open Music / Pending /
Availability = Friday, review 120 people, and every action returns to exactly
that. ⛔ Never reset a filter, ⛔ never jump back to page one. That continuity *is*
what makes keyboard review fast.

### The inspector is the product advantage
**Review is per-application; knowledge is per-person.**
```
Sarah
Volunteered at Northern Skies 2024
Worked Earth Frequency 2025
First application for Music
```
No form builder can do this. ⛔ **Only history this organiser legitimately owns** —
a cross-festival dossier is a different product and must not be built by accident.

### Lifecycle
```
Applied → Shortlisted → Accepted | Waitlisted | Rejected
                            ↓
                          People
```
⭐ **Waitlist belongs to Applications.** *People is: who is actually part of this
event? Waitlisted people are not — they're still applicants.* The boundary is
**Accepted**, not decided, so participation never begins for a waitlisted person.

### Target, ⛔ not "Capacity"
Optional, per category. **Guidance, never validation** — "capacity" implies
enforcement. Accepting 14 against a Target of 12 simply reads `Selected 14 / 12`.

### Decisions
Reversible. **Release is the one-way act and the only guard** — "Release 38
decisions in Music?" states count and category.

Filters/search/sort/paging are **arguments to a query**, never operations on a
handed-over array. The filter that differentiates: **has history with us**.
Messaging composes from the panel; the thread lives in Comms.

---

## 6. People

> **Is everyone who is part of this event ready to participate?**
> ⛔ Not who's coming, not who applied, not who was rejected.

**Strictly post-acceptance.** No application-status filters, no decision controls,
no bulk accept/reject.

**The row is a participation record, not an application** — which is why the
owner, staff, the directly-invited headliner and manually-added crew appear at
all. People is the first screen that would be *wrong* without participation.

### Status and readiness are TWO COLUMNS
| **Status** (from the record) | Accepted · Confirmed · Withdrawn |
|---|---|
| **Readiness** (derived checks) | what is missing, right now |

⛔ Fusing them makes both unreadable: a confirmed person can be unready; an
unconfirmed one can have every field.

### ⭐ Add Person is the PRIMARY action — it defines the room
*Not because it's common. Because it defines the room.* Every path creates
participation: accepted application · manual add · festival owner · invited
artist. ⛔ Without manual add, participation is still secretly dependent on
applications.

### ⭐ One row per person, many roles
```
Lucious    🎧 Performer  🙋 Volunteer     Confirmed
           ⚠ Volunteer shift not assigned
           ✔ Performance confirmed
```
⛔ Never one row per role — two rows makes the organiser ask "have I already dealt
with this person?", and they get chased twice.

### Readiness
Derived, never stored. Its **own inspector**, listing every check and a plain
**"Ready when: …"**. Each participant type contributes its own checks, never its
own interface. Two distinct assignment facts: **departmented** (usually from the
application) vs **rostered onto a shift** (organiser work not yet done) — the
second is the one that gets missed.

**Default view is the WORK, not the roster:** everyone with a gap, grouped by
category and department. ⛔ People must never become a second priority feed — Home
says *that* something needs attention; People is where it is resolved.

**Waiting on them:** show the wait honestly ("accepted 12 days ago, no response"),
one action — nudge, which is a message and goes through Comms. ⚠ The copy must not
read as a rebuke.

**Withdrawal → replacement is a cross-room handoff:** People states the gap in
event terms ("Music is one short"); the action **Open waitlist** lands in
Applications, filtered.

### ⭐⭐ Constitutional boundary — People vs Operations
| **People** — *"CAN this person participate?"* | Confirmed · Assigned · Ready · Missing information |
|---|---|
| **Operations** — *"IS this person participating right now?"* | Checked in · On site · On shift · Stage active · Incident · Checked out |

Preparation vs live execution. **Nothing overlaps. The boundary is the gate.**

---

## 7. Timeline (an Event tab)

### ⭐ It is an EVENT TIMELINE, ⛔ not a performance timetable
Architect it with **entry types** from the start, exposing only what exists:
performances · workshops · comedy · talks → later volunteer shifts · vendor setup ·
sound checks · gate opening · pack-down.

**The chain is closed and nothing may skip it:**
```
Applications → People → Timeline → Operations
```

**The timeline CONSUMES People, never creates them.** Schedule against
**accepted** (timetables get built before everyone replies), but ⭐ **the timeline
inherits readiness** — a slot held by an unconfirmed performer renders
differently. It answers *"is Saturday night actually ready?"*, not just *"who
plays?"*

**Stages are created here**, not in the Event Editor — a stage has no meaning
until performances exist.

### ⭐⭐ Shift is the schedulable unit
> *A volunteer shift without a time isn't a shift. It's an assignment.*

```
Volunteer → Department → Shift → Assignment
```
⛔ **Not** department-with-times. Department stays **organisational** and loses
nothing. Buys: multiple shifts per department · morning/evening crews ·
overlapping shifts · different supervisors · shift capacity · shift notes.

⭐ **Same creation rule as stages, applied twice:** departments are organisational
and created in the Event Editor; **shifts are scheduled and created in the
Timeline.**

⭐ Shift capacity should read identically to category Target (`6 / 8`) so an
organiser learns it once.

### Clash detection
```
✖  Same person in two places at once
✖  Two acts overlapping on one stage
⚠  No changeover gap
⚠  Two headliners opposite each other
```
Only `✖` blocks publication; `⚠` is stated and overridable.

⭐⭐ **The cross-category clash is the first feature that genuinely feels like
YesPleez** — a DJ set at 11pm against a volunteer shift at 11pm. No spreadsheet
catches it because the data lives in separate places. It exists *only* because
People is one row per person and participation is a single model.

**Set length defaults from the application.** **Inspector on the grid** — the
third consistent use after Applications and People: grid stays clean, detail in
the panel. **Publication is independent and phased** — unannounced acts render
**TBA**, never PENDING.

**Desktop** builds the grid (stages across, time down, drag and resize).
**Mobile** views plus three small edits — push a set back 15 minutes, swap two
acts, mark one cancelled.

---

## 8. Comms

> **Communication is choosing an AUDIENCE. Everything else derives.**

```
Audience → Communication Type → Compose → Preview → Send
```

**Audiences are queries, never lists.** Audience determines **who receives it** and
**whether it is public**: a broadcast to Followers is a public announcement on the
festival profile; the same act to Accepted Volunteers is private.

### Communication Type decides reply behaviour — ⛔ not audience
A one-person message can be a notification; a volunteer-wide message can be a
discussion. The organiser says which. The type list is deliberately tiny:

| **Conversation** | replies expected · inbox · threaded · bell only for its participants |
|---|---|
| **Broadcast** | replies disabled OR fanned out · archive · notification · public/private from audience |

### ⛔⛔ A broadcast NEVER has a shared reply thread. Ever.
If replies are enabled they become **independent private conversations** —
festival ↔ that one person, nobody else sees it.

### Preview states everything before Send
```
Audience       Accepted Volunteers
Recipients     412
Visibility     Private
Replies        Disabled
Notification   Will be sent
```
⭐ Audience is chosen **first** and stays visible while composing. ⛔ Never a `To:`
field that can be fat-fingered into everyone. Preview shows the resolved **list**,
not just the count.

**Every communication carries a Purpose** — `general · reminder · decision ·
update · emergency`. For the system, not the user: notification preferences,
priority handling, search and analytics later, without parsing message text.

⛔ **Standing audiences (welcome-on-acceptance, shift reminders) are AUTOMATION**,
a different subsystem that will reuse the same audience model. Comms v1 is human
communication only.

⭐ Inbound needs a conversation view. The Portal's "do not build a conversation
view" rule was scoped to the **applications inspector**, where a thread would
hijack a review surface. Comms is where a conversation legitimately lives.

---

## 9. Settings & Permissions

Settings is thin. **Permissions is the substance.**

### ⭐⭐ Permissions are SCOPE × CAPABILITY; roles are PRESETS over it
```
Volunteer Coordinator  =  {volunteer}      ×  {view, assign, message}
Music Coordinator      =  {music}          ×  {review, decide, schedule, message}
```
⛔ A hardcoded role list means adding Bar Manager, Gate Lead and Site Manager
forever, and no festival's structure quite fits.

**Capabilities, grouped by subsystem and irreversible risk — ⛔ never
alphabetically**, because the grouping teaches the mental model:
```
Applications     View · Decide · Release
People           View · Assign · Message
Event            Edit · Publish
Administration   Team · Permissions · Billing
```

- ⭐⭐ **Release is its own capability, separate from Decide** — the one-way door
  made organisational: a coordinator decides all day; only certain people send
  outcomes to real applicants.
- ⭐ **Publish is separate from Edit**, same reasoning.
- ⭐ **Scope limits which rows exist for you**, ⛔ never which buttons render —
  RLS, never a UI filter.
- ⭐ **The audience picker is bounded by scope**, which closes Comms' open
  question with no new mechanism.

### ⭐ V1 ships PRESETS ONLY
**Owner · Manager · Coordinator · Viewer.** ⛔ Do not expose the matrix. Each
preset expands into the underlying permission object, so "Custom Role" later just
edits the same object — **no migration**.

### Audit — a trust feature that survives people
Contextual, ⛔ never a navigation destination. Every subsystem answers *"who did
this?"*: `Accepted by Sarah · Released by John · 14 Aug 2:14 PM`. ⭐ **The audit
belongs to the festival and does not disappear when someone leaves the team** —
same shape as the erasure ruling: sever the person, keep the record.

### Safety
⛔ **Always exactly one owner**; the last cannot be removed or demoted.
⛔ Billing and team management never appear in a preset except Owner.

**Team invitation:** invite by email → sign in / create account → role on **the
festival profile, not the event**. ⚠ Crosses the platform/application seam:
identity access is platform, workflow permission is the app's.

**Settings proper:** identity (shared — edits reach every YesPleez surface) ·
contact · branding · defaults for new events · notification preferences **per
person, not per festival**.

⛔ **Integrations and Billing: nothing to design.** No integrations exist and there
is no pricing model; a billing screen for a product with no price invents a
business decision under cover of UI work.

---

## 10. Metrics placement

⛔ **Not "Analytics" and never a destination.** The only test: *which number helps
the user make a decision on this screen?*

| Screen | Numbers |
|---|---|
| **Home** | applications waiting · oldest waiting · days until close · days until event |
| **Applications** | pending · shortlisted · accepted · waitlisted · Target · Selected/Target |
| **People** | ready · awaiting confirmation · missing readiness · departmented/rostered |
| **Timeline** | unfilled slots · scheduled-but-unconfirmed · outstanding ✖ clashes |
| **Event** | public/private · applications open/closed · completion indicators |
| **Festival profile** | followers · event views |

⚠ **Retrospective numbers belong to the Completed phase**, not the working screens
— acceptance rate and average review time are historical and fail the "changes a
decision today" test mid-review, but are genuinely useful when planning next
year's Targets.

⚠ "Public engagement" was listed and needs a definition or should be dropped — it
is the one entry that could become an opaque score.

---

## 11. Deliberately NOT in this design

- **YesPleez Operations** — a separate product with its own organising question,
  *"What is happening right now?"*, and its own Stage 1. Designing it inside
  Festival would pull it back across the People/Operations boundary.
- **An Analytics room** — numbers live where the work is.
- **Integrations, Billing** — nothing to design yet.
- **Standing audiences / automation** — reuses the audience model later.
- **A staging layer for event changes** — the Publication Model owns that.
- **Custom permission matrix** — supported underneath, not exposed in v1.

---

## 12. Open questions

- Readiness checks per participant type: a real body of rules nobody has authored.
- "Missing information" presumes fields the application asked for — an absent
  phone number is only a gap if it was requested.
- Where Stage and Shift live in the schema (design deliberately did not answer).
- Broadcast reply fan-out: 400 threads from one send has no design.
- Scheduled sending (a 6am load-in reminder).
- Who may send, beyond scope: still needs the presets designed.
- Someone leaving the team — their notes, decisions, sent messages.
- One person holding roles at several festivals.
- Changeover time as a stage property; multi-day switching; an act that plays
  twice.
- Handing a roster to whoever runs the gate — the seam into Operations.
- ⚠ `appliesAs` is duplicated across two repos, so the "eligible category"
  required-check could disagree between apps.
- Poster upload needs a storage bucket and a policy.

---

## 13. Build order

⛔ **Do not start with a screen.** Ratified sequencing:

**M1 — Foundation debt.** Backfill migrations for the four festival tables and two
functions already in production; verify a clean rebuild from migrations alone.
⚠ Without this, every new migration compounds schema drift, and five subsystems
end up where a fresh environment does not match production.

**M2 — Participation.** One atomic migration, because it is one subsystem:
`participation` · `participation_transition` · indexes · foreign keys · enums ·
derived-status trigger · append-only trigger · RLS · grants · `SECURITY DEFINER`
functions · tests.

**M3 — Home priority engine.** Only rungs 1 and 2 — *broken configuration* and
*decided but not released*. Both derive from data that already exists, so they
validate the attention pattern with almost no new UI.

Then **People**, then **Timeline**.
