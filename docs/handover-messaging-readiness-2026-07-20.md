# Messaging (M8) — readiness brief

**Revision 2, 20 Jul 2026.** Amended after the verification pass; supersedes revision 1, which
was written before any of §2's evidence existed.

For a fresh session. Read §1 and §2 before doing anything.

---

## 1 · The milestone numbering — read this first, it is the source of most confusion

**Three independent sequences share the labels M5–M8.** They are not the same roadmap, and
conflating them produces contradictions that look like stale documentation but are not.

| Track | Range | Meaning |
|---|---|---|
| **Identity migration** | M0–M8 | The attribution/authorization retrofit. **M6** = write cutover · **M7** = not-null assertion · **M8** = **messaging** |
| **Studio** | M5–M9 | Phase 16's own milestones. **Studio M7 = custodial publication, SHIPPED 19 Jul** (`1d629ec`, 16 tests) |
| **Product phases** | 9–17 | Product work — Notifications, Analytics, QA and so on |

So `CLAUDE.md:43` saying *"M7 remains not started"* and the Phase 16 brief §15 titled
*"M7 — custodial publication"* are **both true**. Different M7s.

**Messaging is identity-track M8.** Every gate below refers to the identity track.

---

## 2 · Current state — verified 20 Jul, not assumed

| | Status |
|---|---|
| **Notifications (product)** | ✅ **COMPLETE** — N1, N2, N3, N4, NP1 built, migrations applied, verified. `handover-notifications-2026-07-20.md` |
| **M6 backfills** | ✅ **VERIFIED.** `follows` 4/4 attributed. `applications` 12 rows: **M6c had never been applied** — 9 derivable rows were NULL and have now been backfilled. The remaining 3 are correctly NULL under `U4` (two accounts own three performer profiles, one owns none) |
| **`R3.2` observation gap — follow path** | ✅ **CLOSED IN PRODUCTION.** A real client follow wrote `from_profile_id` = the **Personal** profile, correct per §A6/§A9. `verification-held-notification-production-2026-07-20.md` |
| **Held-notification pipeline** | ✅ **VERIFIED END TO END IN PRODUCTION.** Notification `72c76fd7-…` — `to_user_id` NULL, `to_profile_id` set, `suppressed_at` NULL, `expired_at` NULL. N1 + NP1 + N4 confirmed live. That row could not have existed before the N1 fix |
| **M5.5 census** | ✅ Partial — 18 Personal profiles, 18 distinct accounts, **no duplicates, no orphans**. Only the `auth.users` total remains unchecked |
| **IA-01 steps 1–2** | ✅ Step 1 **passes** (Discover shows a self-owned profile as an ordinary result). Step 2's affordance **renders**. `identity-validation-scenarios.md` §Status is stale on both |
| **Applications write path** | ⚠️ **NOT YET OBSERVABLE** — see §3. **Not known to be broken** |
| **Active Profile Context** | ⏸ Not built. Required for **`general` conversations only** — see §4 |
| **`R3.2` policy application** | ⏸ Now *applicable* on the follow-path evidence. Whether to apply it to `applications` before that path is observed is a judgement call |
| **SEC-1** | ⚠️ HIGH, open. `notifications` INSERT is unrestricted for authenticated users. Deployment prerequisite |

---

## 3 · The applications path — a precise statement

**The `applications` write path has not been observed in production because the current dataset
makes it impossible to test.** That is the accurate claim, and it is deliberately not the same as
"unverified, therefore Messaging is blocked."

Why it cannot be tested today:

- 23 of 24 live events are hosted by the only account available, and `ApplyButton` renders only
  when `!effectiveIsHost` — so Apply is hidden on all of them.
- The one event with `host_id = null` has `applications_open = false`, so Apply is hidden there too.

**There is no reachable Apply affordance for this account.** Not a defect in the write path — an
artifact of a single-account dataset.

What is known about that path:

- The code stamps attribution: `EventScreen.jsx:1201` writes `from_profile_id: actingId`, and
  `ArtistDashboard.jsx:301` writes `from_profile_id: fromProfileId`.
- The **same helper family** on the **follows** path was observed working correctly in production.
- All 12 existing applications predate the 18 Jul cutover, so their NULLs say nothing about it.

**How to close it when convenient:** open applications on one event, or create a second account,
then submit one application and confirm `from_profile_id` lands. Minutes of work. **It does not
need to happen before Messaging starts** — it needs to happen before `R3.2` is applied to
`applications`, which is a separate decision.

---

## 4 · Does Messaging need Active Profile Context? Only for `general`.

Established by reading `communication-v1.0-draft.md` §2.2 and §3.1, not inferred.

**Participants are derived from context.** Of the eight contexts, seven derive both parties from
rows that already exist:

| Context | Participants derived from |
|---|---|
| `application` | applicant ↔ host — reads `applications.from_profile_id` |
| `invitation` | host ↔ invitee — `venue_enquiries` profile columns |
| `booking` | booked party ↔ booker |
| `event` | host + lineup |
| `venue` | venue ↔ counterparty |
| `festival` / `operations` | future products |
| **`general`** | **"Two profiles" — nothing to derive from** |

And §2.2: *"Access derives from `can_act_as` and nothing else"* — which is **live and verified**
(`can_act_as(profile_id)` returns correctly against production).

**So derived-context messaging is technically independent of Active Profile Context.** Only
`general` needs a sender chooser, and §4.2's no-cold-DM rule already restricts initiation there.

This is a sensible architectural boundary, not a workaround: a conversation *about* an application
knows who is speaking because the application already recorded it.

---

## 5 · What remains in identity M6

| Item | Effort | Class |
|---|---|---|
| `R3.2` restrictive policy | S — small SQL, now unblocked for follows | **Deployment prerequisite.** Best applied with the SEC-1 remediation; same class of defect |
| Active Profile Context | L — a week+, and a design decision (three approaches, none chosen; accessibility baseline is zero) | **Deferrable** — required only for `general` conversations |
| IA-01 steps 6–8 | M | Depend on the two above |
| M5.5 `auth.users` total | XS — one query | Prerequisite |

### IA-01 spans milestones by design — resolved 20 Jul

**This is a documentation inconsistency, not an architectural one.** The suite is explicitly
defined as a living validation suite that is re-run at M6, M7 and M8. One sentence incorrectly
framed it as a single binary gate on M6. **Messaging does not depend on any missing Identity
capability**; later scenarios are validated when the capabilities they verify become available.

Resolved by amending `identity-validation-scenarios.md`: a milestone's acceptance requires every
scenario whose **required capability exists** at that milestone to pass, and any scenario awaiting
a later capability must appear in the **Validation Deferral Register** naming what it awaits. No
architectural requirement changed — every scenario and every rule it validates survives intact.

---

## 6 · Recommended milestone amendment — proposed, not applied

> **Identity M6 is considered sufficiently complete to begin Messaging implementation for derived
> contexts** (`application`, `invitation`, `booking`, `event`, `venue`). **General conversations
> remain blocked until Active Profile Context is implemented. `R3.2` remains a deployment
> prerequisite.**

Supported by: the backfills are verified, `can_act_as` is live, attribution is observed working in
production, and seven of eight contexts derive participants without an active profile.

**Not yet applied.** `CLAUDE.md:38` says *"if you believe you have found a contradiction: stop and
surface it. Do not route around it."* This amendment is the surfacing. It needs the owner's
explicit adoption, and `CLAUDE.md:43` should be edited to match rather than silently bypassed.

---

## 7 · When Messaging starts — what is already decided

Do not redesign these; several are frozen.

- **Conversations belong to PROFILES** (v1.1 §A5, frozen), built profile-owned **from day one — no
  retrofit.** This clause is why the spec exists.
- **Bound by and may not reopen:** §A5, §A3 (identity pair), §A4 (`can_act_as` as sole ownership
  predicate), §A9 (Personal inalienable).
- **Context is immutable** (§3.2), even as its subject progresses (§3.3).
- **No cold DM** — §4.2 governs initiation.
- **Read state is per-human** (§2.5).
- **`C18`** — notifications are a delivery layer over **domain events**, not over messages, and are
  **never generated in UI components**.
- **Ratification first.** The spec is `DRAFT v1.0 · Revision 5` and its header states **no
  implementation may cite it**. On ratification it is re-authored as `communication-v1.0.html`.

---

## 8 · What Notifications hands over

**`new_message` already exists and is already categorised** — `TYPE_META` carries it,
`notification_expiry_policy` classifies it `messages` / `never`. The preferences UI deliberately
omits the switch because nothing writes that type yet; `CATEGORIES` in
`NotificationPreferences.jsx` carries a comment marking the one line to add.

**Held-and-disclosed is the pattern for contacting someone who has not joined** — and it is now
*proven in production*, not merely designed. A message to an unclaimed profile should be held,
disclosed at the point of sending (`UnclaimedNotice`, a new `context`), and delivered on claim.

**Write policy expressions in BOTH `USING` and `WITH CHECK`, explicitly.** An omitted `WITH CHECK`
on an UPDATE policy silently means "use `USING`" — correct, but it misled a careful reader into a
finding that had to be withdrawn.

**Suppression and expiry MARK, they never DELETE.** `N1`: *"a held notification is an asset; a
suppressed one is a deleted fact."*

### ⚠ One architectural delta Messaging will force

§5.3 requires routing to resolve *"recipient profile → the humans who can act as it"*, and `C11`:
*"a notification to a two-owner profile is delivered to both humans, and read by one does not clear
it for the other."*

**The notification system as built does not fan out.** One row carries one `to_user_id`. Decide at
M8 whether to fan out at write time or add a per-human read table. Not a defect today — no
multi-owner profile exists — but do not discover it mid-implementation.

**A second product question, surfaced by the production verification:** unfollowing does **not**
retract the held notification. Correct under "rows are historical facts", but a claimant will see a
follow that no longer exists. The same will apply to withdrawn messages.

---

## 9 · Verification discipline

- **`HashRouter`** — URLs are `/#/path`. A path-based URL silently renders home instead of 404-ing.
- **The preview browser IS signed in**, as `94a88288-…`, which owns Elbows Rest, Lucious, Dusky
  Waters, Test Comedian, YesPleez and Luc (Personal). It hosts 23 of 24 events, which hides
  host-facing affordances from you.
- **Migrations are applied BY THE OWNER**, by hand, in the SQL editor. **Never suggest
  `supabase db push`** — the directory is not a linear applied history (D5). **M6c proved this
  matters:** it had been committed but never run.
- **`UPDATE` in the SQL editor reports "Success" with no row count.** Add `RETURNING id`, or verify
  with a follow-up count — a silent success is not evidence.
- **Verify via PostgREST** — a missing column returns Postgres `42703` directly. Functions are
  callable at `/rest/v1/rpc/<name>`; use NULL args on mutating ones.
- **`pg_policies`, `pg_proc`, `information_schema` are NOT reachable** (`PGRST205`). Policy
  questions need the owner.
- **Test RLS by impersonating the role in a transaction:** `begin; set local role authenticated;
  set local request.jwt.claims = '{"sub":"…"}'; … ; rollback;`.
- **`[]` under RLS is a policy artifact, not "no data".** `404` means missing; `[]` means
  invisible. **Held notifications are invisible even to their own author.**
- **Mutation-check every regression test.**
- Screens have pre-existing circular imports; HMR reload noise is expected.

---

## 10 · Repo state

| | |
|---|---|
| **Branch** | `v2-react`, level with origin, clean |
| **Tests** | 26 passing (`npm test` in `v2/`) |
| **Notification migrations** | `20260720000000`–`…0003`, applied and verified |
| **Messaging code** | **None.** §0 calls that *"an asset to be spent deliberately"* |
| **Verification artifact** | Notification `72c76fd7-18e3-4881-a548-e5a9622700e8`, held against Farfetchd, retained intentionally |

---

## 11 · Suggested first message for the new session

> Read `docs/handover-messaging-readiness-2026-07-20.md`. Confirm the milestone amendment in §6,
> then scope Messaging for derived contexts only.

The amendment is the decision to make first. Everything else follows from it.
