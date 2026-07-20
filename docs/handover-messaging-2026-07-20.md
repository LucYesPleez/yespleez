# Messaging (M8) — implementation handover, 20 Jul 2026

For a fresh session. **Messaging is under construction.** The database side is COMPLETE and verified
in production (M8a–M8e). The client service layer and both screens are BUILT (M8f, M8g).

**Start here:** the inbox has **no entry point** — nothing in the app links to `/messages` — and the
**authenticated data path has never been exercised**. See §3d.

Every claim here was verified against the live database. Where something is unverified it says so.

---

## 0 · Governance is CLOSED. Do not reopen it.

The owner froze this explicitly. **Do not reopen governance, documentation, roadmap or ratification
discussions** unless a genuine implementation bug or architectural contradiction is discovered
during development.

- **Identity is frozen** — read-only unless Messaging exposes a real defect.
- **Notifications are closed** — `handover-notifications-2026-07-20.md`.
- **Communication Architecture v1.0 is CANONICAL**, ratified and frozen 20 Jul 2026 —
  `docs/architecture/communication-v1.0.md`. Rule numbers `C1`–`C32` / `D1`–`D17` are a frozen
  citation interface and may never be renumbered.
- **The Markdown file is the canonical artifact** for that document. Unlike the four HTML
  specifications, it was *authored* in Markdown, so the Markdown is the authored record. Do not
  generate an HTML copy and treat it as canonical.

**Milestone numbering** — three independent sequences share labels M5–M8. Identity M0–M8 (Messaging
is **identity M8**), Studio M5–M9, product phases 9–17. `CLAUDE.md`'s *"M7 not started"* and Phase
16's *"M7 — custodial publication, shipped"* are both true; they are different M7s.

---

## 1 · Where Messaging stands

| Layer | Migration | Applied | Verified |
|---|---|---|---|
| **M8a** schema | `20260720000004_m8a_messaging_foundation.sql` | ✅ | tables, columns, RLS-on-with-zero-policies, context CHECK rejects `general` |
| **M8b** RLS | `20260720000005_m8b_messaging_rls.sql` | ✅ | exactly four policies; both predicates live and returning `false` for a non-participant |
| **M8c** creation | `20260720000006_m8c_conversation_creation.sql` | ✅ | seven assertions, incl. the strict caller rule refusing a non-participant |
| **M8d** read state | `20260720000007_m8d_read_state.sql` | ✅ | own message not unread to self; watermark monotonic; another human's read state refused |
| **M8e** notification bridge | `20260720000008_m8e_notification_bridge.sql` | ✅ | authority models agree; fan-out to another account's owner; sender skipped; held row for unclaimed; no body leak |

**Repo:** branch `v2-react`, in sync with origin. Clean tree. 26 tests passing (`npm test` in
`v2/`).

### `C13` — VERIFIED 20 Jul 2026

Closed. The replacement check ran clean, so the M8a trigger does block context mutation.

The original check was wrapped in `WHEN others` and reported success whether or not the guarantee
held — the outcome was only in a `NOTICE`. That was a design error in the *check*, not the trigger,
and it is generalised in §5 as a rule.

### What M8c's verification actually proved

Run as `94a88288-…`, in a rolled-back transaction, discovering profile ids via `can_act_as` rather
than hand-substitution. Each assertion raises on failure, so a clean run is the evidence:

1. `open_conversation` creates and returns an id
2. `C15` — a repeated act returns the **same** conversation, it does not raise
3. participant **order is irrelevant** (`[a,b]` ≡ `[b,a]`)
4. a **duplicated** id in the input collapses rather than forking
5. `participant_key` was derived — M8a's trigger fired
6. a **different** participant set on the same context forks a new thread (`C15`'s two-artists case)
7. **the strict caller rule** — a caller who can act as no participant is refused `42501`

A fourth block confirmed M8b did not regress: clients still cannot `INSERT` a conversation directly.

Note (6) and (7) are the load-bearing ones. (7) is the migration's whole purpose, and it is only
meaningful because 18 accounts exist — with a single-account dataset it would have raised
`CANNOT TEST` rather than passing, by design.

The runbook that produced this is **not committed**; it is a throwaway. The permanent version is the
verification footer inside the migration.

---

## 2 · What was built, and the reasoning that must not be undone

### Schema (M8a)

Three tables, **profile-owned from day one** per Identity v1.1 §A5 — the clause the whole
specification exists to honour. No retrofit.

- **`conversations`** — `(context_type, context_id)` polymorphic reference per **`C15`**;
  `subject_state` free text per **`C14`**; `status` is `active`/`closed`/`restricted` only.
- **`conversation_participants`** — the participant source of truth. Profiles, never accounts.
- **`messages`** — `from_profile_id` (attribution, displayed) and `from_user_id` (audit, never
  displayed, never a permission input), per §A3.

**Four decisions with reasoning, not preference:**

1. **`archived_at` is on participants, not conversations.** §2.6 makes archiving per-participant; a
   global archive would let one party hide a thread from the other.
2. **Read state is NOT in `conversation_participants`**, and the table comment says so. **`C11`**
   keys it `(conversation, user)` because two humans can act as one profile — a manager opening a
   negotiation would otherwise mark it read for a colleague who never saw it. **Invisible until a
   profile has two owners, which is when it is most expensive to discover.**
3. **`participant_key` is trigger-derived**, so a caller cannot desynchronise it from the actual
   rows. Safe only because §2.1 fixes the participant set at creation.
4. **`C15`'s unique constraint is `DEFERRABLE INITIALLY DEFERRED`, and this is load-bearing.**
   Creating a two-party conversation inserts participants one row at a time, so the key passes
   through a one-participant state that could collide with a real one-participant conversation.
   Checking at `COMMIT` makes creation atomic — which is what `C15` means. **Do not "simplify" this
   to a plain unique index.**

### RLS (M8b)

§2.2 is the whole rule: *"Access derives from `can_act_as` and nothing else."* Four policies:

| Table | SELECT | INSERT |
|---|---|---|
| `conversations` | participant | — |
| `conversation_participants` | participant — **the whole set**, not just yourself | — |
| `messages` | participant | participant + `status = 'active'` + identity pair |

**Not granted, deliberately:**

- **No client INSERT on conversations or participants.** §4.3 makes creation automatic from
  workflow acts. This is also **SEC-1's lesson applied before the fact**: `notifications` accepts
  direct client inserts under `auth.role() = 'authenticated'`, which is exactly why any logged-in
  user can forge one. A conversation row decides who may read a thread.
- **No UPDATE on messages** — `D9` default, immutable in v1.
- **No DELETE anywhere** — §2.4's removal right is deferred with `D9`/`D12`, not denied.
- **No UPDATE on conversations** — `status` and `subject_state` are workflow-driven. Granting it
  would let a participant re-open a `restricted` thread by editing a column.

**The identity pair is enforced at the write, and both halves are required.** `can_act_as` alone
would let someone record a different human as author; `auth.uid()` alone would let them speak as a
profile they do not own.

**Predicates are `SECURITY DEFINER` functions, not inline subqueries.** A policy on
`conversation_participants` that queried the same table would recurse and raise `42P17` — the exact
fault that still makes `personal_events` return 500 on every query (backlog **S30**). All three
functions carry a pinned `search_path`.

---

## 3 · M8c — conversation creation (DONE)

`public.open_conversation(context_type, context_id, participant_ids)` is the only sanctioned way a
thread comes into being. `SECURITY DEFINER`, pinned `search_path`, `EXECUTE` granted to
`authenticated` only and revoked from `PUBLIC` and `anon`.

**The caller rule is STRICT — owner decision, 20 Jul 2026.** The caller must be able to
`can_act_as` at least one participant profile. *Creation derives from participant authority, never
merely from authentication or visibility.* The loose reading — any authenticated caller may open a
thread for a workflow object they can see — was rejected: it is the same shape of hole as SEC-1.

Note what the rule does **not** require: that the caller act as a *particular* side. §2.2 makes a
conversation a relationship, so authority over either end is authority to open it.

Three implementation decisions worth knowing before changing it:

- **`C15` is satisfied by returning, not raising.** A repeated workflow act returns the existing
  conversation, so callers need no duplicate defence.
- **A transaction-scoped advisory lock** on `(context, participant_key)` makes check-then-insert
  atomic. Without it, a double-submitted application would have both calls find nothing, both
  insert, and surface a constraint violation *at COMMIT* to a caller who did nothing wrong — after
  `C15` promised idempotence instead.
- **The participant key is derived in two places** — here and in M8a's trigger — with the same
  expression. This is the one fragile seam: if they drift, the idempotence lookup silently misses an
  existing conversation and only collides at COMMIT. Change both or neither.

A one-participant conversation is deliberately **not** rejected: M8a's own `C15` note contemplates
one, so forbidding it would be a new rule. Adding a minimum later is additive.

---

## 3b · M8d — read state (DONE)

`conversation_read_state`, keyed **`(conversation_id, user_id)`** per `C11`. `user_id` references
`auth.users`: the one place in Messaging where a human id is the **key** rather than an audit
column (contrast `messages.from_user_id`, which is audit-only and never a permission input). M8a's
comment forbidding read state on `conversation_participants` is now satisfied rather than
outstanding.

- **A watermark, not per-message rows.** One timestamp per (conversation, human); everything at or
  before it is read. This makes §5.6's *one counting rule, four surfaces, cannot disagree*
  structural rather than a convention — all four call `conversation_unread_count` /
  `total_unread_count`.
- **Unread excludes messages this HUMAN sent** — `from_user_id`, not `from_profile_id`. A colleague
  acting as the same profile is still unread to you. Using `from_profile_id` would be the exact
  per-profile mistake `C11` exists to prevent.
- **`SECURITY INVOKER`, unlike `open_conversation`.** RLS already states who may write a read row,
  so elevating would move authority into a second place that could disagree with it. The unread
  scan is scoped by RLS on `messages` rather than a predicate of its own, so it cannot drift from
  what the caller may actually see. `open_conversation` must be elevated only because M8b grants no
  INSERT at all — the asymmetry is deliberate.
- **`mark_conversation_read` is monotonic** (`GREATEST`): a replayed or out-of-order call cannot
  move the watermark backwards and resurrect read messages as unread.
- **No read receipts.** No SELECT on another human's read state. §2.5 draws this line itself —
  *"someone on your team replied"* is a profile-level signal about **authorship**, not a read
  receipt. Granting visibility later is additive; retracting it would not be.

Reads message *events* only, never `body` — §1's explicit `C32` carve-out.

### ⚠ A tension recorded, not resolved: archived conversations and the badge

§2.6 makes `archived` **per-participant**, and a participant is a **profile**. §2.5 makes unread
**per-human**. Those cannot both be honoured cleanly: a human acting as two profiles could have one
archive a thread and not the other, and making a per-human count depend on per-profile state
reintroduces exactly the coupling `C11` forbids.

**v1 default: archived conversations still count.** The restrictive direction is the one that cannot
silently hide a real booking enquiry from a human. This is a default, not a ruling — resolving it is
a specification question (§2.6 vs §2.5), and no multi-owner profile exists yet to make it bite.
**Raise it with the owner before building the inbox UI.**

---

## 3c · M8e — notification bridge (DONE)

**Owner decision, 20 Jul 2026: delivery derives from CURRENT participant authority.** If several
humans can act as a participant profile, each receives their own notification. No ownership
snapshot, and no second authority model.

**It needed no schema change to `notifications`, and that is the interesting part.** §A7 already
separates the three identities and `N1` already gives the unclaimed case a meaning:

- recipient profile with **three owners** → three rows differing only in `to_user_id`
- recipient profile with **no owner** → one **held** row (`to_user_id` NULL), per `N1`

**Fan-out and the held pile are the same mechanism at different owner counts.** Nothing needed
adding; `CHECK notifications_addressable` already permits both shapes, and NP1's
`apply_notification_preferences` trigger fires on these inserts like any other, so muting works with
no involvement from M8e.

### `profile_actors` — the inverse of `can_act_as`, NOT a second model

`can_act_as(profile)` answers *"may I act as this?"*; fan-out needs *"who may act as this?"*. Both
read `profiles.user_id` (M6a). **They are two projections of one fact.**

- `can_act_as`'s own comment says *"signature frozen; body may evolve (V1 single-owner)"* — **when
  that body goes multi-owner, `profile_actors` must change in the same commit.**
- That obligation is **asserted, not commented**: verification block 1 checks the two agree for every
  profile, and can be re-run any time.
- **Not granted to any client role.** It maps a profile to the humans behind it; exposing it would
  let any logged-in user enumerate profile ownership. Only the elevated trigger calls it.

### What M8e does NOT do

**It does not make multi-owner profiles exist.** `profiles.user_id` is a single-owner column, so
`profile_actors` returns at most one row today and fan-out fans out to one. §6's fan-out item is now
**structurally resolved and factually unchanged**. A single delivered row in production is correct —
do not read it as a broken bridge. When identity goes multi-owner, delivery is not rewritten; one
function is.

### Two more decisions

- **A trigger, not a call in the send path.** `C18`/§A7: notifications originate from shared
  services, never from UI. A trigger cannot be forgotten by a send path and leaves no second call
  site to drift. Mirrors `touch_conversation_last_message`.
- **No message body in the notification, ever.** Two independent reasons: `C32` excludes
  conversation content from platform systems, and `D1`'s **two retention domains** mean copying body
  text into `notifications` would leave content behind when a conversation is erased. The row
  carries ids; the client resolves display from the conversation, under RLS, where the participant
  could read it anyway.
- **The sender is skipped by HUMAN** (`from_user_id`), so a colleague acting as the sending profile
  IS notified. The actor count is taken **before** the skip — a profile whose only owner is the
  sender is *claimed*, so it must not fall through to the held branch. Verification block 2b exists
  solely to catch that inversion.

---

## 3d · M8f / M8g — client layer and UI (BUILT, partly unverified)

| Piece | File | State |
|---|---|---|
| Service layer | `v2/src/lib/messaging.js` | built, 16 unit tests |
| Inbox | `v2/src/screens/InboxScreen.jsx` | route `/messages` |
| Thread | `v2/src/screens/ConversationScreen.jsx` | route `/messages/:id` |

**`lib/messaging.js` is the ONE place messages are sent and read**, written before the call sites
exist. `writeNotification.js`'s header records what the late version of that consolidation cost:
fifteen write paths, and the sixteenth missed every change.

- **`sendMessage` takes no `fromUserId`.** Attribution is the caller's choice; the audit identity
  comes from the session, always (§A3). M8b would reject a forged one anyway — but an API that
  accepts a value it then polices is an API inviting the bug.
- **No notification write on send.** `notify_new_message` already fanned out per human. A client
  write would double-notify *and* be the wrong shape. Locked by test.
- **No screen asks an ownership question.** `actableProfileIds` / `resolveSenderProfile` ask
  `can_act_as` (§A4). A client-side `profiles.user_id === session.user.id` works today and silently
  becomes wrong at multi-owner while still returning an answer.
- **Composer is disabled, not hidden**, when no profile can speak — §4.4 `restricted` and
  "a profile you no longer own" are real states; removing the box reads as a bug.

**ARCHIVED STILL COUNTS — owner ruling, 20 Jul 2026.** The §3b tension is CLOSED. Archived threads
sink and dim in the list, but never leave it and never leave the unread count, because the
alternative can silently hide a booking enquiry. Archive is read from the caller's OWN participant
row (§2.6 makes it per-profile).

### ⚠ Two gaps — do these first

1. **The inbox is unreachable.** Nothing links to `/messages`. `BottomNav` has four tabs and adding
   a fifth is a navigation design change, **needs the owner**. Options: fifth tab; an entry from My
   Scene; or deep-linking `new_message` notifications into the thread — those rows already carry
   `conversation_id` in `data`. Recommendation was deep-link + My Scene entry, leaving the nav alone.
2. **The authenticated data path has NEVER been exercised.** Verification ran as a GUEST on port
   5199 (another session held 5173, and a different port is a different origin, so the signed-in
   preview session did not carry). That proves the routes mount and render; it proves **nothing**
   about RLS reads, `can_act_as` resolution, real unread counts, or an actual send. The unit tests
   cannot cover this — they stub Supabase, so they cannot catch an argument that is never passed.
   **Sign in and send one real message before trusting any of it.**

---

## 4 · Scope boundaries — already settled, do not relitigate

- **Five contexts only**: `application`, `invitation`, `booking`, `event`, `venue`. All five derive
  both participants from rows that already exist.
- **`general` is out of scope** — it has no workflow object to derive participants from and needs
  Active Profile Context, which does not exist. `festival`/`operations` are future products.
  Adding a context is an amendment (`D8`), not a schema change.
- **`D3`, `D9`, `D11`, `D12` are defaulted**, with defaults recorded in the spec's §12. None blocks
  the schema.
- **Active Profile Context is not required** for derived-context messaging. It is required for
  `general`, and for IA-01 steps 7–8.

---

## 5 · Verification discipline — read before reporting anything done

- **Migrations are applied BY THE OWNER**, by hand, in the SQL editor. There is no service-role key
  and the CLI is unlinked. **Never suggest `supabase db push`** — the migrations directory is not a
  linear applied history (live-schema audit **D5**). **M6c proved it matters**: it had been
  committed for two days and never run.
- **A migration committed is not a migration applied.** Verify, do not assume.
- **A migration *reported* applied is not a migration applied either.** M8d came back "success" and
  had created nothing — the editor runs only the *selected* text if anything is highlighted, so a
  stray selection silently applies a fragment. Caught only because the next block asserted the table
  existed instead of trusting the message. **Follow every apply with a check that the object is
  really there.** Clear the editor (Ctrl+A, Delete) before pasting.
- **Split a long migration into chunks when re-running after a failure.** M8d went in as table+RLS,
  then functions, each with its own assertion — so a second failure would have been localised
  instead of ambiguous. `LANGUAGE sql` functions are parsed at creation, so they fail loudly if the
  table they reference is missing; that made chunk B corroborate chunk A for free.
- **`UPDATE` in the SQL editor reports "Success" with no row count.** Add `RETURNING`, or verify
  with a follow-up count.
- **Write checks whose success is the evidence.** A check wrapped in an exception handler reports
  success either way — that is how `C13` ended up unverified.
- **Verify via PostgREST independently.** A missing column returns Postgres `42703` directly.
  `public` functions are callable at `/rest/v1/rpc/<name>`; use NULL or nonexistent-id arguments to
  prove existence without writing.
- **`pg_policies`, `pg_proc` and `information_schema` are NOT reachable** (`PGRST205`). Policy and
  function questions need the owner to run catalog queries.
- **`[]` under RLS is a policy artifact, not "no data"** — and on an *empty* table it proves nothing
  either way. `404` means missing; `200 []` means either.
- **Test RLS by impersonating the role in a transaction:** `begin; set local role authenticated;
  set local request.jwt.claims = '{"sub":"…"}'; … ; rollback;`. The editor otherwise runs privileged
  and bypasses RLS entirely.
- **`with_check = null` on an UPDATE policy does NOT mean "no check"** — Postgres uses the `USING`
  expression. Misreading this produced a MEDIUM finding that had to be withdrawn.
- **The app uses `HashRouter`** — URLs are `/#/path`. A path-based URL silently renders home.
- **The preview browser IS signed in**, as `94a88288-…`, which owns Elbows Rest (venue), Lucious
  (artist), Dusky Waters (band), Test Comedian (standup), YesPleez (host) and Luc (Personal). It
  hosts 23 of 24 events, which hides host-facing affordances from you.
- **Mutation-check every regression test** — reintroduce the bug and confirm the test fails.

---

## 6 · Open items outside Messaging

Not blockers; recorded so they are not rediscovered.

- **SEC-1 (HIGH, open)** — `notifications` INSERT is unrestricted for authenticated users.
  Deployment prerequisite. Messaging will add `new_message` notifications to that surface.
  Remediation proposal: `security-remediation-proposal-notifications-2026-07-20.md`.
- **`expire_held_notifications()` is never called** — N4 is inert until scheduled.
- **The `applications` write path is unobserved** — not known to be broken. The dataset makes it
  untestable: 23 of 24 events are hosted by the only account, and the hostless one has
  `applications_open = false`.
- ~~**Notification fan-out**~~ — **RESOLVED by M8e**, 20 Jul 2026. Delivery now derives from
  `profile_actors` at send time, so it fans out to however many humans can act as the recipient
  profile. That number is currently always 0 or 1 because `profiles.user_id` is single-owner; the
  *structure* no longer assumes it. See §3c.
- **Deployment is PARKED** until Notifications/Analytics/Messaging/QA are done. `yespleez.pages.dev`
  serves the legacy HTML prototype. Verify against `localhost:5173`.

---

## 7 · Suggested first message

> Read `docs/handover-messaging-2026-07-20.md`. M8a–M8g are built; the database side is applied and
> verified. Do §3d's two gaps: sign in and exercise the real authenticated path end to end (send one
> message, confirm the notification row and the unread count), then wire an entry point to
> `/messages` — I'll decide which of the three options.

Remember that **you cannot apply or verify SQL yourself** (§5) — migrations are applied by the owner
by hand. Write the migration, then hand over a runbook the owner can paste with no substitutions,
where every block raises on failure. That is what made M8c's verification actually get run.
