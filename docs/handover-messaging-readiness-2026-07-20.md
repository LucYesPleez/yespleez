# Messaging (M8) — readiness brief

Written 20 Jul 2026 at the close of the Notifications milestone, for a fresh session.

**Read §1 before doing anything.** This is a readiness brief, not a start-work brief — the
project's own governance says Messaging cannot begin yet, and the reason is not ratification.

---

## 1 · ⛔ Messaging is M8 and it is GATED. Do not start implementing.

`CLAUDE.md:43`, which is binding project instruction:

> M0–M5.1 are complete. **M6 is the active milestone.** M7 and M8 remain **not started** — M6 must
> complete before M7 begins, and M7 before M8. **Finishing M6 is not permission to start M7.**

`docs/architecture/communication-v1.0-draft.md` §0 sets the same gate independently:

| Prerequisite | Status | Why |
|---|---|---|
| **M6 complete** | 🔄 **active, not finished** | `can_act_as()` is the authorization seam every permission in §4 assumes. Writing messaging RLS before it exists adds to the inline-`auth.uid()` debt `CLAUDE.md` forbids growing. |
| **M7 complete** | ⛔ **not started** | Messaging is the densest producer of profile-attributed rows in the product. The validation gate should close before it starts writing, not after. |
| ~~`U2` answered~~ | ✅ **struck off** | No longer an implementation prerequisite. `C25` made the architectural decision; §8's remaining questions gate **launch**, not code. |
| **Ratification** | ⛔ outstanding | The spec is `DRAFT v1.0 · Revision 5`. Its own header: **"no implementation may cite it."** On ratification it is re-authored as `communication-v1.0.html` and the draft deleted. |

**A correction this brief exists partly to make.** At the close of the Notifications milestone the
assistant said *"Messaging is the next active milestone, gated on ratification"*. That was wrong in
a way worth naming: it treated ratification as the only gate and skipped the milestone ordering
entirely. `D1`/`U2` genuinely were downgraded to launch blockers (main handover §5) — but that
downgrade says nothing about M6/M7, and reading one correction as clearing the whole path is
exactly the error.

**So the next active work is finishing M6, then M7.** Not Messaging.

**Also do not confuse this with deployment.** Deployment is separately parked until
Notifications/Analytics/Messaging/QA are done — see `handover-2026-07-20.md` §9.

---

## 2 · What to do instead, in order

1. **Finish M6** — the write cutover. It is the active milestone. `can_act_as()` exists as a
   migration (`20260718000003_m6a_can_act_as.sql`) but the app still uses inline `auth.uid()` in
   9 places across migrations; the seam retrofits at M6 and becomes sole authority at M8.
2. **M7** — custodial publication. Not started. Blocked on M6.
3. **Ratify** `communication-v1.0-draft.md` → re-author as `communication-v1.0.html`, delete the
   draft.
4. **Then** M8 / Messaging.

If the owner wants Messaging sooner, the honest conversation is about **reordering milestones**,
not about starting M8 quietly. That is their call to make explicitly, not one to arrive at by
drift.

---

## 3 · When Messaging is unblocked — what is already decided

Do not redesign these. They are in the draft and, where noted, in frozen documents.

- **Conversations belong to PROFILES, not accounts** (Identity v1.1 §A5, frozen). Built
  profile-owned **from day one — no retrofit.** This clause is why the spec exists.
- **Bound by, and may not reopen:** v1.1 §A5, §A3 (the identity pair), §A4 (`can_act_as` as sole
  ownership predicate), §A9 (Personal is inalienable). Where the draft appears to disagree with
  any of them, the draft is wrong.
- **Context is immutable** (§3.2) — a conversation's "why" does not change even as its subject
  progresses (§3.3).
- **No cold DM.** Reachability governs who may initiate (§4.2).
- **Read state is per-human**, and unread counts follow from it (§2.5).
- **`C18` — notifications are a delivery layer over domain events, not over messages.** A
  notification is not a kind of message. "Message received" is one source among many. And they are
  **never generated in UI components** — a component that constructs one has created a second
  notification engine.
- **Voice**: 48 kHz Opus, capture processing OFF (per the project memory; confirm against the
  draft before implementing).

---

## 4 · What Notifications built that Messaging inherits

Notifications closed 20 Jul 2026 — see `handover-notifications-2026-07-20.md`. Four things carry
directly:

**The `new_message` type already exists and is already categorised.** `TYPE_META` carries it, and
`notification_expiry_policy` classifies it as category `messages`, policy `never`. The preferences
UI deliberately **omits** the `messages` switch because no notification of that type is ever
written yet — `CATEGORIES` in `NotificationPreferences.jsx` has a comment saying to add it when
messaging lands. That is the single line of UI work Messaging needs on the preferences side.

**Held-and-disclosed is the pattern for contacting someone who has not joined.** A message to an
unclaimed profile should be **held** (created, no delivery identity), **disclosed at the point of
sending** (`UnclaimedNotice`, a new `context`), and **delivered on claim** — not suppressed, and
not silently permitted. That model is built, applied and verified for notifications; reuse it
rather than inventing a second one.

**Write RLS policies with the expression in BOTH `USING` and `WITH CHECK`, explicitly.** An
omitted `WITH CHECK` on an UPDATE policy silently means "use `USING`" — correct behaviour, but it
misled a careful reader into filing a MEDIUM finding that had to be withdrawn. `profiles` and
`notification_preferences` both have the explicit form; copy them.

**Suppression and expiry MARK, they never DELETE.** `expired_at`, `suppressed_at`. The principle
is `N1`'s: *"a held notification is an asset; a suppressed one is a deleted fact."* Messaging
retention will face the same choice.

### ⚠ One architectural delta Messaging will force

The draft's §5.3 says routing *"resolves recipient profile → **the humans who can act as it**, then
applies each human's preferences"*, and `C11`'s consequence: *"a notification to a two-owner
profile is delivered to **both** humans, and read by one does not clear it for the other."*

**The notification system as built does not fan out.** One row carries one `to_user_id`, so a
notification reaches exactly one human. Multi-owner profiles are not delivered to both. `read` is
a column on that single row, so per-human read state works only because there is one row per
human — and today nothing creates the second row.

This is not a defect in what shipped (no multi-owner profile exists yet, and `U4` deliberately
declines to guess), but it **is** a gap Messaging will expose the moment a profile has two owners.
Decide it deliberately when M8 starts: either fan out at write time (N rows) or introduce a
per-human read table. Do not discover it mid-implementation.

---

## 5 · Verification discipline — read before reporting anything done

The Notifications milestone earned these. §7 of `handover-2026-07-20.md` has the originals; these
are additions and confirmations from 20 Jul.

- **The app uses `HashRouter`.** URLs are `/#/path`. A path-based URL silently renders the home
  screen instead of 404-ing, which will waste your time exactly once.
- **The preview browser IS signed in** — as the YesPleez host account
  `94a88288-43aa-445b-abb8-7dc895804b51`, which owns all 24 events. Authenticated paths can be
  driven directly. It also means `effectiveIsHost` hides apply-flows from you.
- **Migrations are applied BY THE OWNER, by hand, in the SQL editor.** The assistant has no
  service-role key and the CLI is unlinked. **Never suggest `supabase db push`** — the migrations
  directory is not a linear applied history (live-schema audit D5).
- **Verify migrations independently via PostgREST.** A missing column returns Postgres `42703`
  directly, which is authoritative. `public` functions are callable at `/rest/v1/rpc/<name>` — use
  NULL arguments on mutating ones to prove existence without writing.
- **`pg_policies`, `pg_proc` and `information_schema` are NOT reachable** through PostgREST
  (`PGRST205`). Policy questions need the owner to run catalog queries.
- **To test RLS, impersonate the role inside a transaction:** `begin; set local role authenticated;
  set local request.jwt.claims = '{"sub":"…"}'; … ; rollback;`. The SQL editor otherwise runs
  privileged and bypasses RLS entirely, so a plain query proves nothing about policy.
- **`[]` under RLS is a policy artifact, not "no data".** An unauthorised read returns `200 []`,
  not `403`. A `404` means the table is missing; `[]` means it exists and you cannot see it.
- **Mutation-check every regression test.** Reintroduce the bug and confirm the test fails. A suite
  that passes against both the fixed and the broken code proves nothing.
- **Screens have pre-existing circular imports**, so editing a shared lib produces
  "failed to apply HMR … circular import" and a forced reload. Expected noise, not a symptom.

---

## 6 · Repo state at handover

| | |
|---|---|
| **Branch** | `v2-react`, level with `origin`, clean tree |
| **HEAD** | `8d6d919` |
| **Tests** | 26 passing — `npm test` in `v2/` |
| **Notification migrations** | `20260720000000`–`…0003`, all applied and verified |
| **Messaging code** | **None.** `v2/src` has no messaging anywhere — §0 calls that "an asset to be spent deliberately" |

**Open security finding that reaches Messaging: SEC-1 (HIGH).** `notifications` INSERT
`with_check` is only `auth.role() = 'authenticated'` — any authenticated user can write a
notification to anyone. Messaging will add `new_message` notifications to that surface. It is a
deployment prerequisite and it should be closed before Messaging widens the attack surface, not
after. Details and a three-phase remediation proposal:
`security-remediation-proposal-notifications-2026-07-20.md`.

---

## 7 · Suggested first message for the new session

> Read `docs/handover-messaging-readiness-2026-07-20.md`. Do not start Messaging — confirm the
> M6/M7 gate first and tell me what finishing M6 actually requires.

That question is the real next step. Messaging is four gates away, and the first of them is the
milestone that is already active.
