# Messaging (M8) — implementation handover, 20 Jul 2026

For a fresh session. **Messaging is under construction.** Two layers are applied and verified in
production; the next is M8c.

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
| **M8c** creation | — | not written | — |

**Repo:** branch `v2-react`, **2 commits ahead of origin** (`c62d47f` M8a, `dfab38c` M8b). Clean
tree. 26 tests passing (`npm test` in `v2/`).

### ⚠ One check still open: `C13`

`C13` (context immutability) is enforced by a trigger in M8a and has **not been verified**. The
first block written for it was wrapped in an exception handler, so it reported success whether or
not the guarantee held — the outcome was only in a `NOTICE`. That was a design error in the check,
not in the trigger.

**Run this before M8c.** Success *is* the evidence; it is self-cleaning either way:

```sql
do $$
declare v_id uuid; v_blocked boolean := false;
begin
  insert into public.conversations (context_type, context_id)
  values ('application', gen_random_uuid()) returning id into v_id;

  begin
    update public.conversations set context_type = 'booking' where id = v_id;
  exception when others then
    v_blocked := true;
  end;

  delete from public.conversations where id = v_id;

  if not v_blocked then
    raise exception 'C13 FAILED — context mutation was permitted';
  end if;
end $$;
```

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

## 3 · Next: M8c — conversation creation

Nothing can create a conversation today. That is by design, and M8c is what makes Messaging
reachable.

A `SECURITY DEFINER` function that opens a conversation from a workflow act:

- Takes `(context_type, context_id)` and the participant profile ids
- **Enforces `C15` by returning the existing conversation** if one already matches, rather than
  raising — *"one artist applying twice to the same event produces one conversation"*
- Creates the conversation and all participants **in one transaction**, which is why `C15`'s
  constraint is deferrable
- Pinned `search_path`, like every other elevated function here

### ⚠ Open design question — needs the owner

**Who may call it.** Two readings of §4.3:

- **Strict** — the caller must be able to `can_act_as` at least one participant profile, and is
  refused otherwise. Keeps the SEC-1 lesson intact: a caller who can act as neither party has no
  business opening a thread between them.
- **Loose** — any authenticated caller may create a conversation for a workflow object they can see.

**Recommended: strict.** Not yet decided by the owner.

### After M8c

Read state (**`C11`**, keyed `(conversation, user)` — its own table), then the notification bridge
(`new_message` is already categorised in `notification_expiry_policy` as `messages`/`never`, and
`NotificationPreferences.jsx` carries a comment marking the one line that enables its switch), then
UI. **Do not jump to UI** — the owner set the order: schema → migrations → RLS → verification →
commit, one layer at a time.

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
- **Notification fan-out** — §5.3 and `C11` require delivery to *every* human who can act as the
  recipient profile. The notification system delivers to one. Not a defect today (no multi-owner
  profile exists); decide deliberately when it matters.
- **Deployment is PARKED** until Notifications/Analytics/Messaging/QA are done. `yespleez.pages.dev`
  serves the legacy HTML prototype. Verify against `localhost:5173`.

---

## 7 · Suggested first message

> Read `docs/handover-messaging-2026-07-20.md`. Run the `C13` check in §1, then write M8c —
> conversation creation. I want the strict caller rule.
