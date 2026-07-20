# Notifications — final handover, 20 Jul 2026

Closes the Notifications milestone. Every claim below was verified against the live database or a
live browser, not inferred. Where something is unverified it says so.

Branch `v2-react`, level with origin at `90e1da5`. 26 tests passing (`npm test` in `v2/`).

---

## 1 · What was completed

| | Milestone | Commit(s) | Migration | State |
|---|---|---|---|---|
| **N1** | Held notifications | `aec5bda` | `20260720000000` | ✅ applied + verified |
| **N2** | Action-time disclosure | `d664955` `7dcbbcb` `e3b2ac1` | none needed | ✅ shipped + verified live |
| **N3** | Claim delivery | `24fca7b` | `20260720000001` | ✅ applied + verified |
| **N4** | Held expiry | `555a315` | `20260720000002` | ✅ applied + verified |
| **NP1** | Preferences (engine + UI) | `c6e4995` `4b9655d` | `20260720000003` | ✅ applied + verified live |
| — | Security review | `96f1067` `f043664` `90e1da5` | none | ✅ complete |

**N1** — a notification to an unclaimed profile is created and held, never discarded. Three
suppression points were removed: an early return in `writeNotification()`, a `.filter()` in the
batch path, and an `if (profile.user_id)` guard at the follow call site. Between them every follow
of an unclaimed profile had been a deleted fact.

**N2** — disclosure wherever a user can act on an unclaimed profile: Follow, Apply to Play, and
the host's add-to-slot. Verified live: unclaimed Farfetchd shows badge + notice; claimed Heffekt
and Elbows Rest show neither.

**N3** — claiming delivers the held pile. Implemented as a database trigger on
`profiles.user_id` transitioning NULL → NOT NULL, because **no code path in the app writes
`profiles.user_id`** — claims complete by hand in the SQL editor.

**N4** — expiry by type, not by a global clock. Follows never expire; event-bound types expire
with their event; enquiries with their date. Marks `expired_at`, never deletes.

**NP1** — preferences govern delivery, never existence. Suppression is a trigger at the delivery
transition, so it covers both the ordinary insert and N3's claim delivery with one rule.

---

## 2 · Final security status

### Confirmed — open

**SEC-1 · `notifications` INSERT is unrestricted for authenticated users — HIGH**

```
with_check : (auth.role() = 'authenticated'::text)
```

Being logged in is sufficient to write any notification to anyone. Nothing constrains
`to_user_id`, `to_profile_id`, `type` or `data`.

Worse than spam: `notifActions.js:25` reads `data.performance_id` from the notification's own
JSONB and updates `performances` / `applications`, so a forged `slot_offer` carries
attacker-chosen ids executed **under the victim's credentials** when they tap ACCEPT.

Found behaviourally (anon `42501` vs authenticated `23514` on an identical payload — proving RLS
runs first and had admitted the row), then confirmed verbatim in `pg_policies`.

### Withdrawn

**SEC-5 · `notifications` UPDATE has no `WITH CHECK` — FALSE POSITIVE**

`with_check = null` does not mean "no check". For UPDATE, Postgres uses the `USING` expression as
the check. Proven by a rolled-back `SET ROLE authenticated` transaction returning
`42501: new row violates row-level security policy`. Phase A existed only to fix this and was
cancelled before implementation — it would have been a no-op that looked like a security fix.

### Closed

- **SEC-4 · profile self-claim** — `profiles` carries `auth.uid() = user_id` in **both** `USING`
  and `WITH CHECK`. An unclaimed row has `user_id IS NULL`, so `USING` evaluates to NULL and the
  row is invisible to the policy. Nobody can claim an unclaimed profile by writing to it, and the
  N3 trigger cannot be induced to fire.
- **SEC-2 · `notification_preferences` RLS** — correct. Cross-user write denied `42501` for anon
  and authenticated; cross-user read empty.
- **SEC-3 · `SECURITY DEFINER`** — `apply_notification_preferences` is the only elevated function,
  `search_path` pinned to `public, pg_temp`. Its elevation is necessary: with invoker rights the
  recipient-preference read returns nothing under RLS, and preferences would appear to work while
  suppressing nothing.

### Minor

**SEC-6** — two byte-identical SELECT policies and two identical UPDATE policies on
`notifications`; no DELETE policy at all (root cause of **S39**). Behaviour unaffected, but a
future fix applied to one copy will look effective while the other permits.

### Deployment prerequisites

1. **SEC-1 must be closed before public beta.** Its only bound today is that the app is
   localhost-only, so the authenticated attacker population is the owner. That bound disappears
   on the day deployment unparks.
2. **`deliver_held_notifications()` runs with invoker rights.** Confirmed against the live policy:
   `notifications` UPDATE `qual = (auth.uid() = to_user_id)`, which can never match a held row
   (`to_user_id IS NULL`) — zero rows, no error. **Treat as a blocker on any claim-completion UI.**

---

## 3 · Remaining Notifications backlog

| Item | Type | Notes |
|---|---|---|
| **Phase B (SEC-1)** | Security | Require `about_profile_id` to be a profile the writer owns. Gated on auditing all 11 `writeNotification` call sites — if any writes *about* someone else's profile, the policy rejects a legitimate write, and most call sites ignore the return value so it fails invisibly. Stops impersonation, **not** the confused-deputy path. |
| **`expire_held_notifications()` scheduling** | Operational | Never called. pg_cron / Edge Function / manual is an unmade decision. N4 is inert until then. Not urgent — no held rows exist yet. |
| **Push notifications** | Feature | Not started. Needs a channel dimension: `notification_preferences` PK becomes `(user_id, category, channel)`. Deliberately not pre-built. |
| **`new_application` (F3)** | Gap | Applying to an event notifies nobody, claimed owner or not. The type is in `TYPE_META` and written by no code path. Confirm intended before Phase B's audit. |
| **Notification Centre polish** | UX | Not scoped. `messages` category is hidden until messaging ships. `N5` (ops sees counts, never content) and `N6` (no cold outreach from held items) are unbuilt constraints on features that do not exist yet. |

Phase C (move writes behind a `SECURITY DEFINER` RPC) is the real fix for SEC-1 and is a future
architectural milestone. It should not block Messaging.

---

## 4 · Notification architecture — final state

### Creation

`writeNotification()` / `writeNotifications()` in `v2/src/lib/writeNotification.js` are the only
client write path. A row carries three §A7 identities:

- `about_profile_id` — **subject**; may be an unclaimed profile
- `to_profile_id` — **recipient**; NULL when not uniquely inferable (`U4` — a correct answer)
- `to_user_id` — **delivery**; NULL means **held**

The only reason to refuse a write is **addressability**: a row must carry `to_user_id` or
`to_profile_id`. Enforced in the database by `CHECK notifications_addressable` and mirrored by
`isAddressable()`. Deliberately an OR — requiring `to_profile_id` would reject `U4`'s correct NULLs.

### Held

`held ⇔ to_user_id IS NULL`. No `delivery_state` column: a flag would be a second source of truth
that can disagree with `to_user_id`, with no principled winner.

### Claim delivery

Trigger `trg_profile_claimed` on `profiles`, firing when `user_id` goes NULL → NOT NULL — the
canonical `claim.completed` event, bound to the transition rather than to any caller.
`deliver_held_notifications()` sets `to_user_id` on held, unexpired rows. Idempotent.
`read` and `created_at` are untouched, so a claimant sees the notices unread and dated when they
actually happened.

Guarded to NULL → NOT NULL only: reattribution is a different event.

### Expiry

`expire_held_notifications()` marks `expired_at` on **held rows only** — delivered notifications
are governed by retention, which is not implemented and is deliberately out of scope. Policy is
per-type in `notification_expiry_policy` (27 rows): `never` / `event` / `enquiry`. A type with no
policy is never expired.

Event end date is **derived** — `config->>'date'` plus `length(config->'days') - 1` — because
events have no end-date column and day objects carry no dates. `safe_date()` returns NULL rather
than raising on malformed input; without it one bad date would abort the sweep for everyone.

### Preferences

Per-**user**, not per-profile — `U4` leaves `to_profile_id` NULL often enough that a per-profile
preference would be unenforceable for exactly those rows. **Absence of a row means enabled.**

Suppression is trigger `trg_apply_notification_preferences`, firing when `to_user_id` becomes
non-NULL — which is the moment of delivery on **both** paths, ordinary insert and claim delivery.
It stamps `suppressed_at`. `payments` and `account` always deliver, enforced by
`notification_category_is_mutable()`. A NULL category is treated as un-mutable, so an
unclassified type is delivered rather than silently withheld.

### Reader filtering

Every read requires **both**:

```js
.eq('to_user_id', session.user.id)   // excludes held rows (SQL equality never matches NULL)
.is('suppressed_at', null)            // excludes muted rows
```

Three readers: `App.jsx` (badge), `NotifPanel.jsx`, `NotificationsScreen.jsx`. Both filters are
asserted against the source by `notificationReaders.test.js`, because the guarantee is emergent —
it holds only while every reader keeps both clauses.

### Security model

- **Read** — `auth.uid() = to_user_id`. Held rows are unreadable by anyone, including the eventual
  owner, until delivery populates `to_user_id`.
- **Update** — `auth.uid() = to_user_id`, and (per the SEC-5 correction) that same expression is
  applied to the post-update row.
- **Insert** — `auth.role() = 'authenticated'` only. **This is SEC-1.**
- **Preferences** — `auth.uid() = user_id` in both clauses.
- **Elevation** — exactly one `SECURITY DEFINER` function, `search_path` pinned.

---

## 5 · Status

**Notifications is feature-complete for the milestone as scoped.** N1–N4 and NP1 are built,
applied and verified; disclosure is complete; the security review is closed out with one confirmed
open finding.

It is **not** "finished" in the sense of nothing remaining — §3 lists five items, one of which
(SEC-1 / Phase B) is a deployment prerequisite. None blocks Messaging.

**Messaging is the next active milestone.** `communication-v1.0.md` was **ratified and frozen
20 Jul 2026** and may now be implemented against. `D1`/`U2` gate launch rather than code
(handover §5). Implementation prerequisites remain M6 · M7 (§0).

Two things from Notifications that Messaging should inherit:

1. **Held-and-disclosed is the pattern for contacting someone who has not joined.** A message to
   an unclaimed profile should be held, disclosed at the point of sending, and delivered on claim —
   not suppressed, and not silently permitted.
2. **Write the policy expression in both `USING` and `WITH CHECK`, explicitly.** The implicit form
   is correct but it misled a careful reader once already, and it cost a withdrawn finding.
