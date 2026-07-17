> # ⚠ CONVENIENCE COPY — NOT AUTHORITATIVE
>
> **The canonical document is [`identity-v1.1.html`](identity-v1.1.html).** This Markdown is a
> mechanically-converted reading copy, for diff-review and GitHub navigation only.
>
> **If this file and `identity-v1.1.html` disagree, `identity-v1.1.html` is correct and this file is wrong.**
> Do not cite this file. Do not edit it by hand — it is regenerated from the HTML by script.
>
> Conversion is lossy by nature. Known losses: SVG diagrams are replaced by placeholders;
> callout semantics (rule / risk / decision / principle) survive only as their text labels;
> the sidebar table of contents is dropped. **No prose, rule number, or table cell was altered.**
>
> Status: RATIFIED v1.1 — 17 Jul 2026 · frozen. Rule numbers are a stable citation interface — never renumber.

YesPleez v2 · Architecture Amendment

# Identity Architecture v1.1

An amendment to Architecture Specification v1.0 under §17. Establishes the profile as the unit of *attribution* across the application, separates attribution from authorization, and resolves two contradictions v1.0 could not express.

**Status**  RATIFIED v1.1 — 17 Jul 2026 · frozen **Amends**  v1.0 (10 Jul 2026) **Change control**  v1.0 §17 **Supersedes**  §01 (one principle) · §03 (relations) · §05 (sender)

## A0 — Status & scope

What this document is, what it touches, and what remains untouched.

This is an **amendment, not a replacement**. Architecture Specification v1.0 remains canonical in full except for the clauses listed in [§A2](#a2). v1.0 is preserved as historical reference per its own §17.

> **◆ Promoted to a §01 principle · the one sentence to remember**
>
> **Attribution determines who an action appears to come from. Authorization determines who is allowed to perform it.** They are completely different concepts and must never share a column, a check, or a source of truth.
>
> This is bigger than profiles. It governs every table, every policy and every screen in the system — and it is the clause most likely to be violated by a well-meaning implementation.

> **The bar this document had to clear**
>
> v1.0 §00: *"From v1.0 onward, work against this document is **implementation only**. Architectural change is considered solely if implementation uncovers a genuine blocker — preference or optimisation does not reopen it."*
>
> Every change below is therefore justified against that bar in [§A1](#a1), not against preference. Two blockers were uncovered *by implementation*. Everything else in this amendment is a consequence of resolving them.

## A1 — The blocker test

Two findings that v1.0 cannot describe. Neither is a preference; both are the specification failing to model the system it governs.

> **`B1` v1.0 already contradicts itself on conversations**
>
> §01 declares: *"Conversations belong to accounts… Message threads are personal and stay with the humans who wrote them."* §03's relations table restates it: `messages` → **user accounts**.
>
> But §06 gives `booking_interest` a `note` field — *"Optional short message (fee range, vibe, ask)"* — stored against `target_profile_id`. §06's own risk callout concedes: *"Interest sent pre-claim becomes visible to whoever claims."*
>
> That is **a message, from one party to another, owned by a profile, and readable by a stranger who later claims it**. The principle was already violated by the specification's own core commercial table. v1.1 does not weaken the model — it makes it consistent.

> **`B2` An application cannot name its own sender**
>
> `applications.artist_id` holds a **user id**. There is no profile column. An artist who owns three profiles applies to a gig, and **the row cannot record which profile applied**. The information was never captured; it is not recoverable by inference.
>
> v1.0 §03 diagnosed exactly this class of fault for events — *"`events.host_id` historically served two roles… One column never again does both jobs"* — and fixed it for that one table. It was never generalised. The ambiguity remains live in the booking pipeline, which is the precise failure v1.0 exists to prevent.

> **Verdict**
>
> B1 is an internal contradiction. B2 is unrepresentable state in a shipping table. Both clear §00's bar. **The rest of this amendment is the minimum coherent resolution** — not an opportunity to revisit anything else.

## A2 — What changes

The complete diff against v1.0. Anything not in this table is unchanged and remains binding.

| v1.0 ref | Was | Now |
| --- | --- | --- |
| **§01** principle | Conversations belong to accounts | **Conversations belong to profiles.** Every message records its human author. One model, every thread. |
| **§01** new | — (implicit) | **Attribution ≠ authorization** — promoted to a founding principle ([§A4](#a4)) |
| **§01** new | — (undocumented; enforced by `.neq('type','punter')`) | **The Personal exception** — system-generated, inalienable, never discoverable ([§A9](#a9)) |
| **—** runtime | — (unspecified) | **R6 active profile context** — attribution stamped at write time ([§A4b](#a4b)) |
| **§03** relations | `messages` → user accounts | `messages` → `profile.id` (thread) + `author_user_id` (per message) |
| **§03** new | — (no convention) | **The identity pair** `(from_profile_id, from_user_id)` on every profile-actionable table ([§A3](#a3)) |
| **§03** new | Ownership checked inline against `owner_user_id` | **One predicate** — `can_act_as(profile_id)` — the sole ownership test ([§A4](#a4)) |
| **§05** follows | Sender = `user_id` only | Keeps `user_id` (dedup, delivery, C2). **Gains** `from_profile_id` (attribution, roster) ([§A6](#a6)) |
| **—** notifications | `user_id` only | Three identities: subject · recipient · delivery ([§A7](#a7)) |

## A3 — The canonical identity pattern

Not a new model. The generalisation of one v1.0 already proved.

> **[Diagram — not reproducible in Markdown. See the canonical HTML.]**
>
> *The identity model* — One user account owns many profiles via owner_user_id. An action records both from_profile_id, which drives public attribution, and from_user_id, which drives authorization through can_act_as and RLS.

v1.0 §06 solved sender identity correctly for `booking_interest` and then stopped. It carries `from_profile_id` ("the promoter / venue expressing interest") *and* `from_user_id` ("Sender account, for auth & notification"). That pair **is** the identity architecture. v1.1 does not invent an alternative; it makes the existing one universal.

> **`R1` The identity pair**
>
> Every **profile-actionable** row records both:
>
> -   `from_profile_id` — **attribution.** Who the action publicly comes from. The active profile at the time of the action.
> -   `from_user_id` — **the human.** For authorization, audit and notification delivery. Never displayed as the actor.
>
> Neither is sufficient alone. A row with only a user cannot name its sender (`B2` ); a row with only a profile cannot be authorized or audited.

### Scope boundary — not every table takes the pair

"Every actionable table" is too broad and would be wrong. **Account-level actions have no acting profile.** You claim a profile *as a person*, not as a profile — a claim performed "as Elbows Rest" is incoherent. The boundary is explicit:

| Class | Identity | Tables |
| --- | --- | --- |
| **Profile-actionable** | `from_profile_id` + `from_user_id` | `booking_interest` ✓ already, `venue_enquiries` ✓ already, `applications` ✗ missing, `follows` ✗ missing, `messages` (M8), `events` ✓ via §03 split, `lineup_members` ✓ already |
| **Account-actionable** | `user_id` only — **no profile** | claims, signup, sessions, account settings, billing |

> **Finding from the audit**
>
> Three of seven profile-actionable tables already carry the pair. `events` carries it in a differently-named form (`host_id` + `venue_profile_id`) as a result of §03's split. Only `applications` and `follows` are genuinely missing a sender profile — a much smaller surface than "every table".

## A4 — Attribution ≠ authorization

The most important clause in this amendment, and the one most likely to be violated in implementation.

> **`R2` The active profile is UX state, never a permission**
>
> **The active profile determines attribution.** It decides who an action appears to come from — it populates `from_profile_id` and nothing else.
>
> **`owner_user_id`, evaluated server-side, determines authorization.** Always. The active profile lives in client storage and must be treated as an untrusted hint. A tampered value must change nothing but a label.

This is not a new lesson. v1.0 §03 already learned it: *"authorisation (who may manage the event) remains account-based; public attribution … is profile-based via `venue_profile_id`. **One column never again does both jobs.**"* Any formulation resembling *"the active profile determines ownership of everything"* re-conflates precisely what §03 separated, and is rejected.

> **`R3` The ownership seam**
>
> Ownership is tested through **exactly one predicate**, defined once:
>
> -   **The truth:** a Postgres function `can_act_as(profile_id)`, used by **every** RLS policy. v1 body: `owner_user_id = auth.uid()`.
> -   **The mirror:** a client helper of the same name, used *only* to gate UI affordances. It secures nothing.
>
> `owner_user_id = auth.uid()` must never be written inline in a policy. Multi-manager ([§A8](#a8)) then becomes one function body plus one table — not an archaeology expedition across every policy.

> **`R3.2` Attribution must itself be authorized**
>
> `from_profile_id` is **only writable where `can_act_as(from_profile_id)` is true.** Every INSERT policy on a profile-actionable table carries this check.
>
> Without it, attribution is **forgeable**: a client simply posts `from_profile_id = <a venue it does not own>` and the enquiry appears to come from that venue. **Forgeable attribution is worse than none** — it is a signed lie rather than an unsigned gap. This is derivable from `R2`  + `R3` , and is stated explicitly because it is the single attack the architecture exists to prevent, and because "derivable" is not a defence found in a breach report.

> **`R3.1` The signature is frozen**
>
> `can_act_as(profile_id)` is a **frozen interface**. Its name and signature never change; everything calls it; its body evolves. Multi-manager, delegation, roles and time-bounded access are all future changes to *one function body* — never to its callers. Nothing else in this amendment is declared permanent. This is.

> **⚠ The failure mode this prevents**
>
> A JavaScript `canActAs()` alone secures nothing. If the seam exists only in the client, the first person to edit `localStorage` acts as any profile in the system. The predicate must be enforced in the database or it is decoration.

## A4b — Active profile context

The runtime half. Every other clause describes storage; this one describes behaviour, and every screen depends on it.

> **`R6` The active profile context**
>
> The application maintains **exactly one active profile context**. The active profile:
>
> -   **Determines attribution** for newly created actions — it populates `from_profile_id`.
> -   **Scopes** profile-specific navigation, dashboards, inboxes, drafts and management screens.
> -   **Never participates in authorization** (`R2` ).
> -   **May change at any time.** Changing it **never edits existing data** — it affects future writes and current UI context only.

> **`R6.1` Attribution is stamped at the moment of the write**
>
> The active profile is read **when a row is written** — never earlier, never later. An action in composition has no attribution, because it has not happened yet. A row already written is stamped permanently and is never re-attributed by a later switch.

> **Why R6.1 exists · the wording it replaces would have broken the switcher**
>
> "Changing the active profile only affects future actions" leaves one question unanswered: **is an unsent enquiry existing data, or a future action?** Both readings are defensible, and the wrong one silently breaks the `Sending as ▼` control — whose entire purpose is *"I am about to send as the wrong profile; fix it now."* That demands the in-flight action re-attribute.
>
> Stamping at write time dissolves the question rather than answering it. The switcher works automatically (switch, then send, and the send carries the new value); history is immutable by construction; and the draft case needs no special rule at all.

> **Drafts are workspace, not actions**
>
> v1.0 §02 already classifies drafts as owner-scoped *private workspace*, alongside dashboard state and settings. A saved draft therefore **scopes** to the profile it was written under and does not re-attribute — it has no attribution to change. Only the send is an action.

> **⚠ R6 scopes the feed — the badge is the deliberate exception**
>
> "Scopes inboxes" and `R5`  ("the badge aggregates across every profile") are in tension, and the tension is intentional. **The feed scopes; the badge does not.** Stated here explicitly so that a future implementer does not "fix" the badge into per-profile isolation and reintroduce missed commercial notifications.

## A5 — Conversations belong to profiles

Reverses a v1.0 §01 principle. Justified by `B1` .

> **◆ Amended principle (replaces §01's conversation clause)**
>
> **Conversations belong to profiles; every message records its human author.** Every thread — `Personal ↔ Personal`, `Venue ↔ Artist`, `Band ↔ Venue` — is the same model. A booking negotiation is a record of the business that conducted it, not a personal effect of whoever typed it.

> **Why not "commercial conversations"**
>
> An earlier draft qualified this as *commercial* conversations, to carve personal chat out of profile ownership. **The qualifier was doing no work.** Personal is inalienable ([§A9](#a9)) — it can never be claimed or transferred — so personal conversation is already structurally protected by the Personal profile itself. The word bought nothing and implied a second messaging system that does not exist. YesPleez builds **profile messaging**; commercial is merely the dominant case.

### Rationale

-   **v1.0's principle was imported from the wrong product category.** "Threads are personal and stay with the humans who wrote them" is a social-network rule. §01's first commercial principle is *"Commercial opportunity over social engagement."* A booking app cannot declare commercial-over-social and then model negotiations as DMs.
-   **It severs the core flow.** §06's `status` runs `pending · seen · **responded**`. The interest belongs to the profile; under v1.0 the response belongs to the account. A single continuous negotiation would be half profile-owned and half account-owned.
-   **Continuity is the product.** A booking history that evaporates when a manager leaves is the failure being designed against.
-   **v1.0 already does this** (`B1` ) — just accidentally, and only for `booking_interest.note`.

### Conditions of the reversal

1.  **Thread → profile. Message → author.** Accountability is preserved, which is the true thing v1.0's principle protected.
2.  **A profile inbox is a business inbox, and users are told so.** A future owner may read it. Stated policy, surfaced in product — not a footnote.
3.  **Personal is inalienable.** It can never be claimed, transferred, or owned by anyone else — so the risk structurally cannot reach personal conversation.
4.  **On transfer, history is retained.** Retention is the point; the alternative reinstates the problem.

> **Challenge · the objection is weaker than it looks — for now**
>
> The strongest argument against this clause is: *Dave manages Elbows Rest, leaves, Sarah claims it, Sarah reads Dave's inbox.*
>
> But **ownership transfer is not a v1 operation.** §03 states `owner_user_id` is *"Set once, on claim"*; the only identity-changing mechanism in v1.0 is the admin merge. A profile cannot change hands today. The risk is therefore **theoretical until transfer ships** — which defuses the objection for v1 and *defers* the policy rather than solving it. When transfer is specified, it must specify inbox handling. This is logged in [§A12](#a12).

> **⚠ New problem this clause creates: erasure vs. business record**
>
> v1.0 had no conflict — account-owned threads die with the account. Under v1.1, **a user deletes their account and their authored messages persist** in a profile's inbox, attributed to a departed human. Right-to-erasure against business-record retention is a genuine legal tension that v1.1 introduces and does not resolve. Unresolved — [§A12](#a12).

> **Edge case · reversed attach orphans threads**
>
> §03 makes attach *ownership-reversible*. Reverse a wrongful claim on a profile that has since accumulated threads and the threads exist with no owner — unreadable, undeleted, held exactly as pre-claim `booking_interest` is held. Acceptable and consistent, but it must be named rather than discovered.

> **Timing**
>
> Messaging is not built until **M8**; the migration is paused at M5.1. This clause costs nothing today and prevents a retrofit later — it is decided now precisely so M8 is built right the first time.

## A6 — Follows: split, do not move

Amends §05's sender. Preserves every §05 invariant.

> **The live bug this fixes**
>
> Follows are account-scoped today — every query is `.eq('user_id', …)`. The venue dashboard's **"THE REGULARS"** roster is loaded from exactly that. So **a venue owner's personal punter follows appear in their venue's professional roster.** Two different concepts share one table with no way to tell them apart.

Two distinct relationships were conflated:

-   **Personal taste** — "I like this DJ" — belongs to the *account*.
-   **Roster** — "this venue books these acts" — belongs to the *profile*, and must survive a change of owner.

> **`R4` Follows keep their user and gain a profile**
>
> `follows.user_id` is **retained** — it carries C2 (enumeration resistance), C3 (dedup) and notification delivery. `from_profile_id` is **added** for attribution and roster scoping. The target continues to be `target_profile_id` per §05.

> **Challenge · why "follows belong to the profile" was rejected outright**
>
> Moving follows to profiles **breaks §05 C3** — *"one user, one follow, one notification."* One human with five profiles could follow one act five times and receive five notifications for one gig. Worse, notifications must terminate at a human: a profile has no device, so delivery would route profile→owner anyway, reintroducing the account that was just removed. Splitting achieves the roster goal while every §05 invariant survives untouched.

> **Edge case · follows are polymorphic and §05 never says so**
>
> Follows target **events** as well as profiles (`entity_type: 'event'`). v1.0 §05 discusses only profile follows. v1.1 rules that **event follows are personal** — they attribute to the Personal profile — until a business case for a venue following an event is demonstrated. Logged in [§A12](#a12).

## A7 — Notifications

Addressed to a profile, delivered to an account — but that is only two-thirds of the model.

> **Challenge · there are three identities here, not two**
>
> "Addressed to a profile, delivered to the owning account" omits the **subject**. §05 C1 requires that *"pre-claim public activity … must notify followers"* and that the pipeline *"keys off public-activity events on the profile, never owner actions."* So the profile a notification is *about* may have **no owner at all** — it is a third, independent identity.

**Schema — notifications · three identities**

- `about_profile_id` — Subject. What the notification concerns. May be unclaimed (§05 C1). Nullable for account-level notices.
- `to_profile_id` — Recipient identity. Which of the reader's profiles this is for — scopes the feed. For a follow-driven notice, this is the from_profile_id of the follow that generated it.
- `to_user_id` — Delivery. The human with the device. Retained: dedup and delivery both key on it.

> **`R5` Scope the feed, never the badge**
>
> The unread badge **aggregates across every profile the account owns**. The feed scopes to the active profile. Strict per-profile isolation of the badge would cause missed commercial notifications — an artist browsing as Personal would not see an urgent venue enquiry. Opening a notification belonging to another profile **switches the active profile** as part of the navigation.

## A8 — Single owner in V1

Confirms §03 unchanged. Adds the seam that makes the successor cheap.

> **`D1` V1 is single-owner. The word "manage" is struck.**
>
> Each profile has exactly one `owner_user_id`, per §03 unchanged. **"Own or manage" is removed from the vocabulary of this architecture.** "Manage" implies multi-tenancy that a single nullable column cannot express, and shipping a switcher whose language implies a capability the schema lacks guarantees someone builds against it.

### Why not now

-   **It would restart the migration, not extend it.** M4 (RLS) and M6 (write cutover) are designed around a single owner column. The migration is paused at M5.1 with beta as the gate.
-   **Nobody is blocked.** One member admins a band profile; one owner admins a venue. Inelegant, not blocking.
-   **The demand is already scheduled elsewhere.** The Festival companion app — *multi-stage, **crew roles, shared profile system*** — is planned to begin **after v2 ships**. Multi-manager arrives on a known date with a known forcing function, not as a surprise.

> **The successor is pre-paid by `R3`**
>
> Because every ownership test routes through `can_act_as()`, multi-manager later is: add `profile_members`, change **one function body**. No application logic and no policy rewriting. This is the entire reason R3 exists.
>
> **Correction:** an earlier draft claimed the seam "must land with M4". M4 shipped on 11 July without it ([§A10](#a10)). The seam now lands at **M6** — where `from_profile_id` and its policies arrive together — and becomes sole authority at **M8**, when contract drops M4's legacy inline policies. The debt is bounded precisely because M4 was additive-permissive.

## A9 — The Personal profile

A documented exception, not an open question. It already ships.

> **◆ Added to §01 as a bounded exception**
>
> **Personal is a system-generated profile, automatically created for every account.** Unlike professional profiles it cannot be transferred, claimed, or detached from its owning account, and it is never publicly discoverable.

To the database it is another profile type. To the user it is simply *"Me"*. That is the whole rule.

> **This is not a new decision — the system already made it**
>
> `type = 'punter'` **already exists as a `profiles` row** and is already excluded from public resolution — `profileResolution.js`, `FillSlotModal` and `EventScreen` each filter it with `.neq('type','punter')`. It is deliberately absent from the *UI* type registry (`PROFILE_TYPES`) because it is not an industry identity.
>
> So Personal-as-a-profile is a **description of shipped reality**, not a proposal. v1.1 does not introduce the exception; it writes down one the code has been enforcing informally for months.

> **⚠ The invariant is currently enforced by repetition**
>
> "Personal is never publicly discoverable" exists only as `.neq('type','punter')` copy-pasted across call sites. Miss one and a Personal profile leaks into discovery. Writing the exception into §01 is necessary but not sufficient — **the filter belongs in one resolver** (`profileResolution.js` already does this for routing), never re-implemented per query.

> **Acknowledged: it does invert §01's letter**
>
> §01 says *"profiles are entities, not accounts… it can exist with no user attached."* Personal is the inverse — an account with no entity. That is precisely why it is written as an **explicit, bounded exception** rather than left implicit. The alternative — a nullable `from_profile_id` where `NULL` means "acting as themselves" — is rejected: it reintroduces the null sender that is `B2` , and is exactly the column-doing-two-jobs §03 outlawed.

## A10 — Migration implications

This amendment makes M6 larger and better specified. It does not invalidate M0–M5.1.

| Milestone | Impact |
| --- | --- |
| **M0–M5.1** complete | Unaffected. Read cutover and legacy redirects stand. |
| **M5.5** new | **Personal profile census.** Every account must own exactly one before `from_profile_id` can be `NOT NULL` — chicken-and-egg. `type='punter'` already exists, so this is likely a small backfill rather than a mint. **Confirm coverage at M0's census before sizing it.** |
| **M4** RLS shipped | **Shipped 11 Jul, and it does not use the seam** — `20260711000005_m4_rls_migration.sql` contains 13 inline `auth.uid()` checks and no `can_act_as`. **R3 is therefore a retrofit, not an install.** Mitigated by M4's own design: it is *additive-permissive* ("new owner-based policies land beside old ones; old ones are removed only at contract"), so nothing is locked in — the policies are provisional until M8. |
| **M6** write cutover | **Where the identity pair lands — and now where the seam does too.** Add `from_profile_id` to `applications` and `follows`; add the three notification identities; introduce `can_act_as()` and bind attribution to it (`R3.2` ). Policies are being written here anyway — this is the cheap moment, not M4. |
| **M7** validation gate | Gains an assertion: **no profile-actionable row exists without a sender profile.** |
| **M8** contract / messaging | Messaging is built profile-owned **from day one** ([§A5](#a5)). No retrofit. **Contract also consolidates the seam:** M4's legacy inline policies are dropped here, leaving `can_act_as()` as sole authority. R3 is only fully true after this milestone. |

> **⚠ Some history is unrecoverable — decide the policy before M6**
>
> `applications.artist_id` records only a user. For a user who owns **one** profile of the applicable type, the sender can be inferred with confidence. For a user who owns **several**, **the row does not contain the answer and no amount of migration can recover it** — that is `B2`  having already caused permanent data loss.
>
> Choose explicitly: best-effort inference where unambiguous and `NULL` otherwise (with M7 exempting pre-cutover rows), or leave all historical rows `NULL`. Do not let a backfill silently guess.

## A11 — What v1.1 does not change

Explicitly binding and untouched. This amendment is not an invitation to reopen them.

-   **§02 The Unclaimed Profile** — definition, permitted data, the pre-claim prohibitions.
-   **§07 Claiming** — attach is three fields, atomic, never a merge, ownership-reversible.
-   **§03 Merge** — admin-only, tombstoned redirects, the single identity-changing event.
-   **§05 Follows privacy** — C1 (no owner assumed), C2 (enumeration impossible), C3 (dedup). *Preserved precisely because follows split rather than move.*
-   **§06 Booking interest** — model unchanged; it is the pattern the rest now copies.
-   **§01** — every principle except the conversation clause.
-   **Migration hard rules** — schema≠backfill, RLS isolated, reads≠writes, contract alone with fresh backup.

> **The switcher UX is not architecture**
>
> The Industry-tab profile switcher, sticky active profile, and the `Sending as ▼` control are **product decisions** in §16's P-class sense — expected in-version updates, no amendment required. Build them whenever. They must simply obey `R2` : they set attribution, never permission.

## A12 — Unresolved

Known open questions. Listed so they are decided deliberately rather than by accident of implementation.

| # | Question | Blocks |
| --- | --- | --- |
| **U1** closed | **Personal profile status** — ~option (a), (b) or (c)~. **Resolved:** Personal is a system-generated, inalienable `profiles` row ([§A9](#a9)). It was never genuinely open — `type='punter'` already ships. | Unblocked. M5.5 reduces to a census: does every existing account already have one? |
| **U2** | **Erasure vs. business record** — account deletion leaves authored messages in a profile inbox ([§A5](#a5)) | Blocks M8. Legal input required. |
| **U3** | **Transfer policy** — inbox handling when ownership changes hands | Deferred: transfer is not a v1 operation. Must be specified *with* transfer. |
| **U4** | **Backfill of ambiguous applications** — infer or NULL ([§A10](#a10)) | Blocks M6. |
| **U5** | **Event follows** — v1.1 rules them personal; confirm or specify a business case | Low. Confirm at M6. |
| **U6** | **Type enum** — Personal, Festival and Contractor are absent from §03's `venue · artist · band · host · standup` | U1 forces Personal. Festival/Contractor are future amendments. |

## A13 — Amendment record

Per v1.0 §17. v1.0 is preserved in full as historical reference.

| Field | Value |
| --- | --- |
| Amendment | **v1.1 — Identity Architecture** |
| Amends | Architecture Specification v1.0 (canonical, 10 Jul 2026) |
| Justification | `B1`  internal contradiction · `B2`  unrepresentable state — both uncovered by implementation, per §00 |
| Supersedes | §01 conversation clause · §03 relations (`messages`) · §05 follow sender |
| Adds to §01 | **Attribution ≠ authorization** (principle) · **Conversations belong to profiles** · **The Personal exception** |
| Adds | R1 identity pair · R2 attribution ≠ authorization · R3 ownership seam · **R3.1 frozen signature** · **R3.2 attribution must be authorized** · R4 follow split · R5 badge/feed · **R6 active profile context** · **R6.1 write-time stamp** · D1 single owner |
| Corrections at ratification | M4 recorded as **shipped without the seam** (13 inline `auth.uid()`); R3 reclassified install → **retrofit at M6**, sole authority at M8. An earlier draft asserted "RLS is still ahead of us" — verified false against the repo before freezing. |
| Status | RATIFIED — frozen 17 Jul 2026 |
| Open | U2 only (erasure vs. business record — legal, blocks M8) |

### The identity contract — a review gate, not a rule

Every feature that lets a user create, send, modify or publish something on behalf of a profile must answer three questions **against the diff** — not against intent:

> **The identity contract**
>
> 1.  **Does the row name its actor?**  `from_profile_id` present, non-null, stamped at write time (`R1` , `R6.1` )
> 2.  **Does the row name the human?**  `from_user_id` present (`R1` )
> 3.  **Does authorization go through the seam — and *only* the seam?**  `can_act_as()`, never inline, never the active profile (`R2` , `R3` , `R3.2` )
>
> This adds no architectural content. It is `R1`  and `R2`  restated as something you can **fail**.

> **⚠ Why this is deliberately not a §-numbered principle**
>
> Writing it into the architecture would make it a rule about following rules — and this project already has proof that does not work. **v1.0 §03 documented the exact lesson** — *"one column never again does both jobs"* — and `applications.artist_id` then shipped with a user id and no profile *in the same codebase* (`B2` ). The rule was written down and violated anyway. Writing it down harder is not a control.
>
> A checklist only works where it is **unskippable by construction**. Its homes, in descending order of reliability: a **CI assertion** that enumerates profile-actionable tables and fails on a missing pair; the **PR template**, so it is asked at the diff; and **CLAUDE.md**, so it is in context for every AI-assisted change in this repo. The specification's job is to state what is true — not to remind anyone to read it.

### Ratification gate — clear

**U1 is closed**, and closing it revealed it was never genuinely open: `type='punter'` already ships as a `profiles` row. Nothing now blocks ratification. U2–U6 each have a milestone at which they are answered, and none of them gate the schema shape.

On ratification, this document joins v1.0 as canonical. The pair, the seam and the boundary become non-negotiable conventions: **any new feature touching identity keys on `profile.id` for attribution and `can_act_as()` for authorization** — never on `user_id`\-as-identity, and never on the active profile for permission.
