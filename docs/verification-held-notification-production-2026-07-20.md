# First end-to-end production verification of the held-notification pipeline

**20 Jul 2026, 04:47 UTC.** Performed against the **live production database** through the real
app at `localhost:5173`, signed in as the owner's account
(`94a88288-43aa-445b-abb8-7dc895804b51`). Not a test double, not a migration check, not a schema
probe — a real user action producing real rows.

**This is the first time a held notification has been observed being created by the production
write path.** Everything prior — the applied migrations, the 26-test suite, the PostgREST probes —
verified that the machinery *existed*. None of it verified that the machinery *ran*.

---

## What was done

1. Opened the profile of **Farfetchd** (`99488e7a-3fbf-4834-b2f8-8c9815c89429`), an **unclaimed**
   artist profile minted by Studio.
2. Pressed **+ FOLLOW** in the app.
3. Read back both rows before touching anything.
4. Pressed **✓ FOLLOWING** to unfollow, removing the `follows` row.

The notification was deliberately **not** deleted — see §Artifact.

---

## Evidence · the `follows` row

```
id                c11479fa-6fbc-4c0d-aa55-0369280e6b6d
user_id           94a88288-43aa-445b-abb8-7dc895804b51   ← the human
from_profile_id   d3975981-1c1b-40f0-8840-ebe215f55ad5   ← "Luc", the Personal profile
target_profile_id 99488e7a-3fbf-4834-b2f8-8c9815c89429   ← Farfetchd
entity_type       artist
entity_name       Farfetchd
entity_id         99488e7a-…                              ← profile id, correct for an unclaimed target
created_at        2026-07-20T04:47:06.411Z
```

### This closes `R3.2`'s observation gap

`CLAUDE.md` defers the restrictive attribution policy because *"no write from the deployed client
has yet been seen carrying `from_profile_id`."* **One has now been seen.**

The value is also *correct*, not merely present: `from_profile_id` is the **Personal** profile, not
the account and not one of the five industry profiles the same human owns. Identity v1.1 §A6/§A9
require a follow to be a personal act, and it was attributed accordingly. The identity pair is
intact — **profile for attribution, user for delivery** — in a single row.

---

## Evidence · the held notification

```
id                72c76fd7-18e3-4881-a548-e5a9622700e8
type              new_follower
to_user_id        NULL                                    ← HELD
to_profile_id     99488e7a-…  (Farfetchd)
about_profile_id  d3975981-…  (Luc, Personal)
message           Someone followed your profile — Farfetchd.
data              {"follower_id": "94a88288-…"}
read              false
suppressed_at     NULL
expired_at        NULL
created_at        2026-07-20T04:47:06.572Z
```

Written **161 ms** after the follow row, by the same user action.

### What each field proves

| Field | Value | Proves |
|---|---|---|
| the row **exists at all** | — | **`N1`.** Before 20 Jul this write was discarded twice over: `ProfileScreen` skipped it behind `if (profile.user_id)`, and `writeNotification()` returned early with *"no delivery identity, no notification"*. **This row could not have existed yesterday.** |
| `to_user_id` | **NULL** | **`N1`** — held, not suppressed. The absence *is* the state; no flag to disagree with it |
| `to_profile_id` | Farfetchd | recipient retained, so `N3` can deliver it on claim |
| `about_profile_id` | Luc (Personal) | §A7's third identity — subject ≠ recipient ≠ delivery, all three distinct in one row |
| `suppressed_at` | NULL | **`NP1`** — the trigger ran and correctly did **not** suppress: `new_follower` is category `social`, unmuted. A trigger that never fired would look identical, but the delivery-transition guard returns early for held rows, which is exactly what it should do |
| `expired_at` | NULL | **`N4`** — follows never expire. Live, indefinitely, as a claim incentive |
| `read` | false | unread on delivery, per `N3` |

---

## Two things observed that no test could have shown

**Held rows are invisible to the client — confirmed in production.** Querying
`notifications?to_profile_id=eq.99488e7a-…` as the *authenticated owner* returned `200 []`. The
SELECT policy is `auth.uid() = to_user_id`; a held row has NULL there, so the comparison is NULL
and nobody can read it through the app — not even the account that caused it. **`N5`'s boundary is
holding**: held content is not readable, only countable. It is also why this document quotes the
owner's SQL rather than an app query.

**Unfollowing does not retract the held notification.** The `follows` row was deleted; row
`72c76fd7` remains. That is consistent with the project's own rule — *"notification rows are
historical facts and are always recorded"* — but it has a consequence worth stating: when
Farfetchd is eventually claimed, its owner will be shown a follow that no longer exists. Correct
under the model, potentially surprising in the UI. **Not a defect; a product question for whenever
the claim experience is designed.**

---

## Artifact — intentional, retained

**Notification `72c76fd7-18e3-4881-a548-e5a9622700e8` is a deliberate verification artifact.**

It is held against Farfetchd and will be delivered to whoever claims that profile. It is retained
rather than deleted at the owner's instruction, so the evidence survives. It can be removed at any
time with:

```sql
delete from public.notifications
 where id = '72c76fd7-18e3-4881-a548-e5a9622700e8';
```

(Client-side deletion is impossible — `notifications` has no DELETE policy at all, which is backlog
**S39**.)

---

## Scope — what this does and does not establish

**Established:** the `follows` write path stamps `from_profile_id` correctly, and the held
notification pipeline works end to end in production across `N1`, `NP1` and `N4`.

**Not established:** the **`applications`** write path. No application has been created since the
18 Jul cutover, and none can be from this account — 23 of 24 live events are hosted by it (so
`ApplyButton` is hidden), and the one hostless event has `applications_open = false`. **The
applications path remains unobserved, and closing it needs either a second account or an event
opened for applications.**

`R3.2` may now be applied on the strength of the follows observation, but whether it should be
applied to `applications` before that path is observed is a judgement call — applying it there
would restrict writes nobody has yet seen succeed.

---

## Related

- `handover-notifications-2026-07-20.md` — the milestone this verifies
- `security-review-notifications-2026-07-20.md` — SEC-1 remains open
- `identity-validation-scenarios.md` — §Status is stale; IA-01 step 1 passes and the step 2
  affordance renders, contrary to what it records
