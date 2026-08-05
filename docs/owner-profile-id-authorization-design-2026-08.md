# Event authorization — `host_id` → `owner_profile_id`

**Design only. No code changed. 4 Aug 2026.**

This is not a proposal. **Identity v1.3 §O8 already ratifies this cutover** as phases 3 and 4
of a four-phase plan, and §O9 already names its risks `K1`–`K6`. Phases 1 and 2 are done
(`m14a` schema, `m14c` backfill). This document is the *implementation design* for the two
phases that remain, plus the evidence survey v1.3 could not contain because the code did not
exist yet.

Nothing here amends frozen text. Where this document and v1.3 disagree, v1.3 wins and the
disagreement is a defect in this document.

---

## 1 · What moves, and what must not

`O-R4` gives `events` three columns for three concepts:

| Column | Concept | After this cutover |
|---|---|---|
| `owner_profile_id` | **AUTHORITY** — who may manage it | **the sole input to authorization** |
| `venue_profile_id` | LOCATION — where it happens | unchanged; **never an ownership signal** (errata `E3`) |
| `host_id` | AUTHORSHIP — which human created the row | **retained, unchanged, and still written** |

**`host_id` is not being removed, deprecated, or emptied.** It answers "who typed this in",
which is a real question the platform still needs for audit and for notification delivery.
What ends is its use as an *answer to a different question*. Every change below either moves
an authorization decision off `host_id`, or deliberately leaves an authorship/display use of
it alone.

The test for whether a given site is in scope: **would a correct answer change if the event's
owner claimed their profile tomorrow?** If yes, it is authorization and it moves. If no, it is
authorship and it stays.

---

## 2 · The defect this closes

`host_id` is the account that ran the INSERT. **An imported event has no author** — Studio has
no auth user — so `host_id` is NULL on every event the importer creates. Meanwhile
`can_act_as(owner_profile_id)` is exactly what `O-R5` makes true the instant a profile is
claimed, *without rewriting any row*.

So today:

- **Imported events are structurally unmanageable.** `performances` RLS (confirmed live) admits
  only `lineup_members.artist_id = auth.uid()` or `events.host_id = auth.uid()`. With
  `host_id` NULL, no host arm can ever match. **Claiming does not fix it** — claiming sets
  `profiles.user_id`, not `events.host_id`. The lineup of an imported event cannot be edited by
  anyone, ever, under the current policies.
- **The app contradicts itself.** `HostDashboard.jsx:92` lists an event as yours via
  `owner_profile_id`, and `EventScreen.jsx:78` then renders the *public* page for it because
  `session.user.id !== event.host_id`. Two surfaces, one question, two answers.

This is `O-R5`'s promise going unredeemed: the mechanism that makes claiming meaningful exists
and is installed, and nothing in the event domain consults it.

---

## 3 · Affected surface — evidence

### 3.1 · Database — ⚠ the largest unknown in this document

**Not one `events` policy exists in `supabase/migrations/`.** `m1_schema_expansion.sql:79-80`
describes them in prose ("events RLS/ownership checks keep using `host_id = auth.uid()`") but
no migration creates them. They were made in the dashboard and live only in production. The
same is true of `event_hosts` and `performances`.

Confirmed live (queried 4 Aug):

| Table | Policy | Predicate |
|---|---|---|
| `performances` | Host can update performances | `EXISTS (SELECT 1 FROM events WHERE events.id = performances.event_id AND events.host_id = auth.uid())` |
| `performances` | Host can insert performances | same, as `WITH CHECK` |
| `performances` | Host can delete performances | same |
| `performances` | Artist can update own performance status | `EXISTS (… lineup_members lm … lm.artist_id = auth.uid())` — **out of scope**, artist-side |

Known to exist but **body unread**:

- **`events`** — all policies. The primary target.
- **`event_hosts`** — INSERT/DELETE gated on **`is_event_main_host(event_id)`**, a function that
  **is not in the repository**. Its body is unknown and almost certainly resolves `host_id`.
  Co-hosts are attribution-only by design ("equal billing, authority unchanged"), so this
  function is a genuine authorization surface that must be rewritten, not merely inspected.
- **`applications`** — a "hosts can update application status" policy of the form
  `EXISTS (… host_id = auth.uid())`, per `fix2`'s comment at `:82`.
- Possibly `lineup_members`, `venue_enquiries`, `personal_events`.

**Step 0 of the plan is therefore an enumeration, not a change.** Run:

```sql
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual::text LIKE '%host_id%' OR with_check::text LIKE '%host_id%')
 ORDER BY tablename, cmd;

SELECT p.proname, pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND pg_get_functiondef(p.oid) LIKE '%host_id%';
```

Until that output exists, **any estimate of this work's size is a guess.** This document
enumerates the client exhaustively and the database partially, and says so rather than
implying symmetry it does not have.

### 3.2 · Client — authorization sites (these move)

Four sites decide who may manage an event. Three consult `host_id` **exclusively**.

| # | Site | Today | Defect |
|---|---|---|---|
| **A1** | `EventScreen.jsx:78` | `session?.user?.id === event.host_id` → `<EventHostView>` | **The single gate on the entire management surface.** Owner who did not author sees the public page. |
| **A2** | `VenueDashboard.jsx:67` | `.eq('host_id', userId)` | Venue-owned events not authored by that account never appear. Comment at `:66` admits the approximation. |
| **A3** | `ProfileScreen.jsx:247` | `.eq('host_id', session.user.id)` | Builds the venue's event list for `InviteSheet` — which events a venue may invite an artist to. |
| **A4** | `HostDashboard.jsx:40-45` | `ownedByFilter()` → `owner_profile_id.eq.X,host_id.eq.Y` | **Already correct in shape** — the reference implementation. But module-private, so nobody else uses it. |

`MySceneScreen.jsx:235` (`.eq('host_id', uid)`, driving the "MY EVENT" badge, Spotlight
`my_event` and floor exclusion) sits on the boundary. It is presentation, but it answers "is
this mine", so it should follow the same rule. `spotlight.js:76` already documents the reserved
`hosting` rule as dead precisely because of this.

**There is no `canManageEvent()` anywhere in `v2/src`.** The rule exists in four
re-implementations and one private helper. That absence *is* the bug — a rule with no single
home cannot be cut over in one place.

### 3.3 · Client — authorship and display sites (these stay)

Listed so a future implementer does not "helpfully" migrate them:

- **Notification §A7 attribution** — `ApplyButton.jsx:218-219`, `EventHostView.jsx:105,145,230`,
  `ApplicationsScreen.jsx:34`. These already carry the correct pair (`toUserId` from `host_id`
  for delivery, `toProfileId`/`aboutProfileId` from `owner_profile_id`). **Correct as written.**
- **Display** — `useEventData.js:40,79`, `eventViewModel.js:407`, `EventPresentedBy`,
  `sceneFloor.js:141` (favourite-host reason reads *both* columns, deliberately).
- **Authorship write** — `CreateEventScreen.jsx:778`. `host_id: session.user.id` must keep being
  written. It is the audit record.

### 3.4 · The `notifications.data.host_id` payload — a separate contract, do not touch

`host_id` is stamped **inside notification JSONB** at `EventHostView.jsx:233` and
`InviteSheet.jsx:139`, and read back at `notifActions.js:123,144,174,189` to route replies.

Two reasons this is out of scope:

1. It is **delivery addressing**, which `§A7` says is a *user*, not a profile. Correct already.
2. ⚠ **The key name collides.** In `InviteSheet.jsx:139`, `data.host_id` holds the **venue's
   account id**, not `events.host_id`. Same key, different referent. Any sweep that migrates
   "`host_id`" by name will corrupt invite routing.

Historical rows carry this payload and cannot be rewritten. Treat `data.host_id` as a frozen,
versioned wire format that happens to share a name with a column.

### 3.5 · Incidental

`FillSlotModal`'s `hostId` prop (`FillSlotModal.jsx:5`, passed at `EventHostView.jsx:648`) is
**declared and never used**. Delete it with the cutover — it is exactly the kind of dead
authorization-shaped input that gets "restored" by someone assuming it mattered.

---

## 4 · Staged plan

Aligned to v1.3 §O8. Phases 1–2 are complete; this expands 3 and 4.

### Step 0 · Enumerate (no change)

Run §3.1's queries. Produce a checked-in inventory of every live policy and function
mentioning `host_id`. **Nothing else starts until this exists** — the current plan is written
against four confirmed policies and an unknown number of unconfirmed ones.

### Step 0b · Audit the backfilled owners (no change) — ⚠ do not skip

Phase 3 **grants authority on the strength of `owner_profile_id`**. Every error in the M14c
backfill therefore becomes an authorization error the moment the policy lands. `E3` is the
precedent: a column verified for *population* and never for *meaning* nearly assigned 23
events to a venue that did not host them.

```sql
SELECT e.id, e.name, e.host_id, e.owner_profile_id,
       p.name AS owner_name, p.type, p.user_id IS NOT NULL AS claimed,
       e.config->>'venue' AS typed_venue
  FROM public.events e
  LEFT JOIN public.profiles p ON p.id = e.owner_profile_id
 ORDER BY e.created_at;
```

Read every row. Population is not correctness.

### Step 1 · Dual authority in the database (additive, reversible)

For each policy found in Step 0, add the seam arm beside the legacy arm:

```
USING ( can_act_as(events.owner_profile_id) OR events.host_id = auth.uid() )
```

- **Additive-permissive**, per M4's pattern, which v1.1 §A10 endorses *because it makes cutover
  reversible*. No access is removed in this step.
- **`can_act_as` first** — an unclaimed owner returns false and falls through to the legacy arm,
  which is the pre-existing behaviour.
- Rewrite **`is_event_main_host()`** the same way, once its body is known.
- Child tables (`performances`, `applications`, `event_hosts`, and whatever Step 0 finds) join
  through `events`; each needs its own EXISTS rewritten. **This is the step that makes imported
  lineups manageable**, and it is why the scope is larger than "the `events` table".

**Does not add to the M4 debt ledger.** The legacy arm here is pre-existing, and it acquires a
named end (Step 4) it did not have before. Nothing new is appended.

### Step 2 · One client helper, then four call sites

Introduce a single exported helper — the abstraction whose absence is the defect:

- `eventOwnedByFilter(userId, profileIds)` → the `.or()` string, generalising
  `HostDashboard`'s private `ownedByFilter` to the full set of profiles the account may act as.
- `canManageEvent(event)` → boolean, via `supabase.rpc('can_act_as', { profile_id:
  event.owner_profile_id })`, falling back to `session.user.id === event.host_id` while Step 4
  is pending.

Then cut over **A1, A2, A3** and `MySceneScreen.jsx:235`, and repoint **A4** at the shared
helper so the four stop diverging. Delete `FillSlotModal`'s dead `hostId`.

⚠ **Order matters: Step 1 before Step 2.** A client that shows a management surface the
database then refuses produces silent write failures — the worst failure mode this codebase has
(see the `EnquiryCard` and "Adjust crop" precedents, where the UI existed and nothing landed).
The reverse order is safe: policies widened before any client uses the width.

⚠ **The client check is a hint, never the gate.** `can_act_as` runs server-side in RLS
regardless. `canManageEvent` decides what to *render*; it does not decide what is *permitted*.
A tampered client must change only a label.

### Step 3 · Verify, then census

- Confirm an imported event with `host_id IS NULL` becomes manageable to its owner after claim,
  and to nobody before it.
- Confirm a co-host still cannot edit (`event_hosts` authority unchanged is a ratified owner
  decision, not an accident to be tidied).
- Confirm switching the active profile changes nothing — **`O-R1`'s distinguishing test**, and
  the cheapest way to catch an active-profile leak into authorization.
- Census for Step 4: `SELECT count(*) FROM events WHERE owner_profile_id IS NULL;` must be **0**.

### Step 4 · Contract, at M8 (not before)

Drop the legacy `host_id = auth.uid()` arm, leaving `can_act_as` sole authority. This is v1.3
§O8 phase 4 and v1.1 §A10's M8 contraction — **the same milestone, not a new one.**

**Gated on the Step 3 census returning zero**, per `K1`. Never the other order.

---

## 5 · Compatibility risks

v1.3 §O9 already names `K1`–`K6`; those stand. New risks this survey surfaced:

| # | Risk | Mitigation |
|---|---|---|
| **N1** | **Unknown live policies.** The repo contains none of the target policies; `is_event_main_host()` is unreadable. Scope is genuinely unknown. | Step 0 is mandatory and blocking. |
| **N2** | **Backfill errors become authorization errors.** Phase 3 grants authority on a backfilled column. `E3` is the precedent for verifying population instead of meaning. | Step 0b: read every row before granting. |
| **N3** | **Dual authority widens access.** During Steps 1–3 both the author *and* the owner can manage. Intended, but if an owner is wrong, the wrong person gains rights. | Bounded by Step 0b; reversible by dropping the added arm; removed at Step 4. |
| **N4** | **Payload key collision.** `notifications.data.host_id` means the venue's account in `InviteSheet`. A name-based sweep corrupts invite routing. | §3.4 — payload is out of scope, explicitly. |
| **N5** | **Client/DB ordering.** Client cutover before policy widening yields silent write failures. | Step 1 strictly before Step 2. |
| **N6** | **`OWNER_ELIGIBLE_TYPES` is narrowed to `['venue','host']`**, overriding `O-R4`'s "any profile type" (`actingProfile.js:146`, owner decision 3 Aug). Authorization now depends on a hand-list that contradicts frozen text. | Out of scope here, but **this cutover makes it load-bearing**: it moves from governing which profiles may be *offered* as owner to governing who may *manage*. Wants an errata entry or a v1.4 before Step 4. **Surfaced, not resolved.** |
| **N7** | **`personal_events` 500s** (`42P17` RLS recursion). If its policy joins `events`, this work touches a table that is already broken. | Include in Step 0; fix or exclude explicitly. |
| **N8** | **No CI enforcement exists.** `identity-debt.json` and `.github/workflows/` are absent despite `identity-ci-spec.md` describing them. Nothing mechanical will notice a new inline `auth.uid()`. | Do not rely on CI to hold this line during the transition. |

---

## 6 · Decisions required before Step 1

Not answerable from the repository:

1. **Does `is_event_main_host()` gate anything besides `event_hosts`?** Determines whether
   co-host management is one rewrite or several.
2. **Should `MySceneScreen`'s "MY EVENT" follow authority or authorship?** Argument for
   authority: an owner should see their own events. Argument for authorship: it is a personal
   scene, and "I made this" is a different feeling from "I am accountable for this". **Recommend
   authority**, for consistency with the dashboards — but it is a product call.
3. **`VenueDashboard` and `HostDashboard` currently answer differently.** After the cutover both
   ask `can_act_as`. Confirm a venue that owns an event should see it on the venue dashboard even
   if a different account created it. (Expected: yes.)

---

## 7 · Explicitly out of scope

- Removing, emptying or deprecating `host_id`.
- `venue_profile_id` — `E3` stands; it is location, never ownership.
- The `notifications.data.host_id` payload (§3.4).
- SEC-1 and notification INSERT policy. **Different problem, different tables, different tests.**
  Keeping them apart is the point.
- `U3` ownership transfer, and Phase 13 `Q6` reattribution tooling.
- Any change to frozen architecture. If Step 0 reveals a genuine contradiction: **stop and
  surface it.**
