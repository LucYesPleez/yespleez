# Security review — notifications subsystem

Requested by the owner 2026-07-20, after NP1 introduced a second `SECURITY DEFINER` function
and while the notification internals were still fresh. Scope as set: both `SECURITY DEFINER`
functions, `notifications` INSERT RLS (especially `WITH CHECK`), `notification_preferences` RLS,
privilege-escalation paths, `search_path`, and cross-user write/read isolation.

**Every probe below was non-destructive by construction** — each attempted write was designed to
violate a constraint regardless of outcome, so no row could be created either way. The one test
that could not be made safe was deliberately not run; see SEC-4.

---

## SEC-1 · `notifications` INSERT is unrestricted for authenticated users — **HIGH, CONFIRMED**

**Any authenticated user can write a notification addressed to any other user.**

### Confirmed by the catalog, 2026-07-20

```
policyname : authenticated users can insert notifications
cmd        : INSERT      permissive : PERMISSIVE      roles : {public}
qual       : null
with_check : (auth.role() = 'authenticated'::text)
```

That is the whole check. Being logged in is sufficient. Nothing constrains `to_user_id`,
`to_profile_id`, `type` or `data`. The behavioural inference below was reading the policy
correctly and stands unamended.

### Evidence

The same payload, sent twice with different credentials:

| Credentials | Result |
|---|---|
| anon (publishable key) | `401` · **`42501`** — row-level security |
| authenticated (real session) | `400` · **`23514`** — `notifications_addressable` CHECK |

The payload was `{type, message}` with neither `to_user_id` nor `to_profile_id`, which violates
the `N1` addressability CHECK for everyone. **The constraint does not depend on the role**, so
anon reaching a *policy* error while an authenticated user reached a *constraint* error proves
RLS is evaluated first — and therefore that RLS **admitted** the authenticated row. Only the
CHECK stopped it, and only because the probe was deliberately unaddressable.

This is the differential that makes the finding sound. A single 23514 in isolation would not
have distinguished "RLS allowed it" from "constraints are checked before policies".

### Impact — worse than spam

Notification types are not inert. `notifActions.js:25` `acceptSlotOffer()` reads
`data.performance_id` **from the notification's own JSONB** and issues
`performances.update({status:'accepted'})`, then updates `applications`. `declineSlotOffer`,
`acceptInvite` and `declineInvite` follow the same shape.

So a forged `slot_offer` or `event_invite` carries **attacker-chosen identifiers that are
executed under the victim's credentials** the moment they tap ACCEPT. That is a confused-deputy
path, not a nuisance. The victim's own RLS still bounds what those writes can touch, which caps
the blast radius — but the attacker chooses the parameters and the victim supplies the authority.

Secondary impact: forged notices can impersonate the platform. A fabricated `booking_confirmed`
("You've been accepted — you're booked!") is indistinguishable from a real one in the feed.

### Interaction with `N1` — mild amplification, not the cause

`N1` did not create this. It does extend it slightly: an attacker can now insert **held**
notifications (`to_profile_id` only, no `to_user_id`) against an unclaimed profile, which `N3`
will faithfully deliver to the real owner when they claim it. Forged notices can lie in wait.
The correct fix is SEC-1's policy, not a retreat from `N1`.

### Why the fix is not a one-line policy

The obvious `WITH CHECK (auth.uid() = to_user_id)` **would break the entire subsystem**. Almost
every legitimate notification is written by someone *other* than the recipient: an artist applies
and the venue is notified; a host shortlists and the artist is notified. That policy would permit
only notes to oneself.

The honest options, in ascending order of cost and correctness:

1. **Constrain the sender's claim to identity.** Require `about_profile_id` to be a profile the
   writer owns. Cheap, and it stops the impersonation half — a forger could no longer attribute
   a notice to somebody else's profile. It does **not** stop arbitrary `data` payloads.
2. **Move writes behind a `SECURITY DEFINER` RPC.** `writeNotification()` becomes a database
   function that validates the sender's relationship to the recipient and ignores caller-supplied
   fields it should own. Clients lose direct INSERT entirely. This is the architecturally correct
   answer and it is a real piece of work — eleven call sites, and a validation rule that has to be
   written.
3. **Bind to `can_act_as()`.** The R3.2 restrictive policy the identity work already anticipated.
   Blocked on the same observation gap recorded in CLAUDE.md: the policy must not be applied
   until a real client write carrying attribution has been observed end to end.

**Recommendation: (1) now as mitigation, (2) as the milestone.** Option 1 is small, reversible,
and closes impersonation without touching the write path. Option 2 is where this should land, but
shipping it in a hurry risks breaking every notification in the app — which is how a security fix
becomes an outage.

**Not fixed in this pass.** Choosing between these is an owner decision with real cost attached,
and the review's job was to establish the fact, not to unilaterally change the write path.

---

## SEC-2 · `notification_preferences` RLS — **verified correct, catalog-confirmed**

```
notification_preferences_select_own  SELECT  qual (auth.uid() = user_id)  with_check null
notification_preferences_write_own   ALL     qual (auth.uid() = user_id)  with_check (auth.uid() = user_id)
```

`write_own` carries the expression in **both** clauses — the correct shape, and precisely what
`notifications` lacks (SEC-1/SEC-5).

**Self-finding:** `notification_preferences_select_own` is redundant. `write_own` is `FOR ALL`,
which already covers SELECT with an identical expression, so the two OR together to the same
result. Harmless, but it is the same duplication flagged as SEC-6 — written by me, in a migration
authored hours after criticising it. Left in place deliberately: removing a policy is a change
that needs verifying, and it buys nothing behaviourally. Recorded so nobody later assumes it is
load-bearing.

### Probe results

| Probe | anon | authenticated |
|---|---|---|
| INSERT a preference for another `user_id` | `42501` | **`42501`** |
| SELECT another user's preferences | — | `[]` |
| SELECT own preferences (via the app) | — | works, and persists across reload |

The write probe used a `user_id` absent from `auth.users`, so the FK would have rejected it had
RLS not — nothing could be written either way. The authenticated `42501` is the meaningful
result: `notification_preferences_write_own`'s `WITH CHECK (auth.uid() = user_id)` is doing its
job. A user cannot mute, unmute, or read another user's categories.

Note the read returns `200 []`, not `403`. Under RLS an unauthorised read is an *empty result*,
not an error — so "no rows" here is a policy artifact and must never be read as "no data".

---

## SEC-3 · `SECURITY DEFINER` review

**Catalog-confirmed, 2026-07-20** — `apply_notification_preferences` is the **only** elevated
function in the subsystem, and its `search_path` is pinned:

```
apply_notification_preferences      security_definer = true   proconfig = {search_path=public, pg_temp}
deliver_held_notifications          false   null
on_profile_claimed                  false   null
expire_held_notifications           false   null
safe_date                           false   null
event_end_date                      false   null
notification_category_is_mutable    false   null
```

### `apply_notification_preferences()` — DEFINER, justified

- `SET search_path = public, pg_temp` — pinned, so the elevated function cannot be redirected to
  a shadowed table in a caller-controlled schema. ✅
- Elevation is **necessary, not convenient.** The writer of a notification is usually not its
  recipient, so the trigger must read the *recipient's* preferences while running as the *sender*.
  With invoker rights and RLS on `notification_preferences`, that read returns nothing for every
  cross-user notification — and because absence means enabled, preferences would appear to work
  while silently suppressing nothing. A mute switch that reports success and does nothing is a
  worse outcome than the elevation.
- **Returns nothing to the caller.** It sets `NEW.suppressed_at` and returns the row; it does not
  surface preference data. There is no read path by which a caller learns another user's settings.
- **Residual, low:** a caller who can insert a notification to another user (SEC-1) *and* read it
  back could infer that user's mute state from whether `suppressed_at` was stamped. Readback is
  denied by the SELECT policy (SEC-2 probe D returned `[]`), so this is not currently exploitable.
  It becomes live only if the SELECT policy is ever loosened. **Recorded, not actioned** — and it
  disappears entirely once SEC-1 is fixed.

### `deliver_held_notifications()` / `on_profile_claimed()` — INVOKER, correct today

Neither is `SECURITY DEFINER`. That is right while claims are completed in the SQL editor by a
privileged role. The migration already records that it stops being right once an ordinary user
can complete a claim from the app, and `claimDelivery.test.js` asserts the precondition. No
change needed now.

---

## SEC-5 · `notifications` UPDATE has no `WITH CHECK` — **MEDIUM, CONFIRMED**

```
Users update own notifs / users can update their own notifications
cmd : UPDATE   qual : (auth.uid() = to_user_id)   with_check : null
```

`qual` correctly restricts you to rows you already own. But with **no `with_check`**, nothing
constrains the row *after* the update — so a user can take a notification they legitimately
received and **re-address it to somebody else** by setting `to_user_id`.

A second path into another person's feed, and a nastier one than SEC-1: it starts from a genuine
notification rather than a fabricated one, so the content is authentic and only the recipient is
forged.

**This matters for the remediation.** A fix that only adds an INSERT `with_check` leaves this
open. Both statements need constraining, and the `profiles` policy (SEC-4) is the model: the same
expression in both `USING` and `WITH CHECK`.

---

## SEC-6 · Duplicated policies on `notifications` — **minor, CONFIRMED**

`Users see own notifs` and `users can read their own notifications` are byte-identical SELECT
policies. `Users update own notifs` and `users can update their own notifications` likewise.

Permissive policies OR together, so behaviour is unaffected today. The risk is maintenance: two
people wrote the same rule twice without noticing, and **a future fix applied to one copy will
appear to work while the other still permits.** Worth collapsing when SEC-1/SEC-5 are addressed,
not before — deleting policies is its own risk and should ride with a change that is being
verified anyway.

Also confirmed in passing: **there is no DELETE policy on `notifications` at all**, which is the
root cause of **S39** (a user cannot delete their own notification, and the failure is silent).

---

## SEC-4 · Profile self-claim — **CLOSED, not vulnerable**

### Confirmed by the catalog, 2026-07-20

```
policyname : enable all for authenticated users
cmd        : ALL   permissive : PERMISSIVE   roles : {authenticated}
qual       : (auth.uid() = user_id)
with_check : (auth.uid() = user_id)
```

**An unclaimed profile cannot be claimed by writing to it.** `user_id IS NULL` on an unclaimed
row, so `qual` evaluates `auth.uid() = NULL` → **NULL**, which is not true. The row is invisible
to the policy and cannot be updated at all. The `N3` trigger therefore cannot be induced to fire,
and the held pile cannot be redirected.

The `with_check` closes the other half independently: even on a row you *can* reach, `user_id`
cannot be set to anyone but yourself.

**This is the shape `notifications` is missing** — the same expression in both clauses. It is
worth noting that the correct pattern already exists in this database; `notifications` is the
outlier, not the norm.

The decision not to probe this empirically was the right one but for a luckier reason than
expected: the policy denies the write, so a probe would have been harmless. That could not be
known in advance, and the cost of being wrong was a real profile claim plus a real delivery.

---

> **Why this was not probed empirically.** Had RLS permitted the update, the write would have
> succeeded and the `N3` trigger would have fired for real — claiming a profile and delivering its
> held pile. Every non-destructive framing of the test failed, so the question could not be asked
> without risking the answer. It needed a policy read, and it got one.

---

## Catalog queries — ALL FOUR RUN, 2026-07-20 ✅

`pg_policies` and `pg_proc` are not reachable through PostgREST (every attempt returns
`PGRST205` — only the `public` schema is exposed), so the owner ran these in the SQL editor and
returned the output. Their results are quoted inline in the findings above. Retained here so the
review is reproducible.

```sql
-- 1 · SEC-1: the notifications INSERT policy (expect a permissive one with no with_check)
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies where tablename = 'notifications' order by cmd, policyname;

-- 2 · SEC-4: can an unclaimed profile be claimed by anyone? Read BOTH clauses.
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies where tablename = 'profiles' and cmd in ('UPDATE','ALL')
 order by policyname;

-- 3 · SEC-3: confirm elevation and pinned search_path on both DB functions
select p.proname, p.prosecdef as security_definer, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('apply_notification_preferences','deliver_held_notifications',
                     'on_profile_claimed','expire_held_notifications',
                     'safe_date','event_end_date','notification_category_is_mutable');

-- 4 · SEC-2: confirm the preferences policies as stored
select policyname, cmd, qual, with_check
  from pg_policies where tablename = 'notification_preferences';
```

Expected for (3): `apply_notification_preferences` → `security_definer = true`,
`proconfig = {search_path=public, pg_temp}`. Every other function → `false`. **Any other function
returning `true` is a finding** — nothing else in this subsystem should be elevated.

---

## Summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| **SEC-1** | `notifications` INSERT `with_check` is only `auth.role() = 'authenticated'`; forged notices carry attacker-chosen ids into `notifActions` under the victim's authority | **HIGH** | **CONFIRMED, open** — remediation is an owner decision |
| **SEC-5** | `notifications` UPDATE has no `with_check`; a user can re-address their own notification to another user | **MEDIUM** | **CONFIRMED, open** — must be fixed with SEC-1 |
| **SEC-6** | Two duplicate SELECT policies and two duplicate UPDATE policies; no DELETE policy (root cause of S39) | Minor | Confirmed — collapse alongside SEC-1/SEC-5 |
| **SEC-2** | `notification_preferences` RLS and policies | — | ✅ Verified correct |
| **SEC-3** | `SECURITY DEFINER` usage and `search_path` | Low | ✅ Justified; residual disappears with SEC-1's fix |
| **SEC-4** | Profile self-claim via `profiles.user_id` UPDATE | — | ✅ **CLOSED** — `USING` cannot match a NULL `user_id` |

**Nothing found in NP1 or N1–N4 themselves.** SEC-1, SEC-5 and SEC-6 are pre-existing properties
of a table this work built on. SEC-1 was on the roadmap as "INSERT RLS `with_check` was never
inspected"; it has now been inspected, and it is real.

---

## A prediction verified against the live policy

The `N3` migration records that `deliver_held_notifications()` running with **invoker rights**
will stop being sufficient once a claim can be completed through the app, because a held row has
`to_user_id IS NULL` and a policy scoped to `auth.uid()` cannot match it.

The catalog confirms it exactly: `notifications` UPDATE `qual = (auth.uid() = to_user_id)`.
Against a held row that is `NULL = …` → NULL → not true → **zero rows matched, and no error
raised**. If claim completion moves into the app before this is addressed, delivery will silently
hand over nothing.

That note is no longer an anticipated risk. It is a confirmed property of the live policy set,
and it should be treated as a blocker on any claim-completion UI.
