# Remediation proposal — SEC-1 and SEC-5

**Proposal only. Nothing here is implemented, and no policy migration exists.** Written per the
owner's instruction to keep remediation separate from implementation, because a wrong `WITH CHECK`
on `notifications` does not fail safe — it breaks every notification in the app.

Findings: `docs/security-review-notifications-2026-07-20.md`.

---

## What has to remain true

Any fix must preserve the fact that **almost every legitimate notification is written by someone
other than its recipient**:

| Writer | Recipient | Site |
|---|---|---|
| artist applies | the venue/host | `EventScreen`, `ArtistDashboard` |
| host shortlists or declines | the artist | `ApplicationsScreen`, `HostDashboard` |
| venue invites | the performer | `InviteSheet` |
| anyone follows | the profile owner | `ProfileScreen` |

So `WITH CHECK (auth.uid() = to_user_id)` — the obvious fix, and the one most likely to be reached
for — permits **only notes to oneself** and silently kills the subsystem. It must not be applied.

---

## ~~Phase A · Close SEC-5~~ — **CANCELLED. SEC-5 was a false positive.**

**Do not implement this phase.** SEC-5 was withdrawn on 2026-07-20, before implementation, when
checking the exact semantics of an omitted `WITH CHECK`:

> If no `WITH CHECK` expression is defined, then the `USING` expression will be used both to
> determine which rows are visible and which new rows will be allowed to be added.
> — PostgreSQL, `CREATE POLICY`

`auth.uid() = to_user_id` was therefore already being enforced on the post-update row. Proven by a
rolled-back `SET ROLE authenticated` transaction, which returned
`ERROR 42501: new row violates row-level security policy`.

**Had this shipped as written it would have been a no-op that looked like a security fix** — the
finding marked remediated, and nobody looking again. That is worse than leaving it open.

`pg_policies` reports the **stored** definition. The **effective** policy is what Postgres
evaluates, and for UPDATE the two differ exactly when `with_check` is null.

**Residual, non-security:** writing the check explicitly would remove the reader-trap. That is
schema documentation and belongs with the SEC-6 duplicate-policy cleanup, not here.

Remediation now begins at Phase B.

---

## Phase B · Constrain SEC-1's identity claim — medium risk, needs verification first

The insight that makes a policy possible: `about_profile_id` (§A7 SUBJECT) is, in every current
call site, **a profile the writer owns**.

- follow → the follower's own Personal profile
- shortlist / decline → the deciding host's own profile
- invite → the inviting venue's own profile
- invite accepted → the accepting performer's own profile

So the sender's *claim to identity* is checkable even though the recipient is not:

```sql
-- PROPOSAL, NOT APPLIED — DO NOT SHIP WITHOUT THE AUDIT BELOW
ALTER POLICY "authenticated users can insert notifications" ON public.notifications
  WITH CHECK (
    auth.role() = 'authenticated'
    AND (
      about_profile_id IS NULL
      OR EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = about_profile_id AND p.user_id = auth.uid())
    )
  );
```

This stops **impersonation** — a forger can no longer attribute a notice to somebody else's
profile. It does **not** stop arbitrary `data` payloads, so the confused-deputy path through
`notifActions` survives. It is a mitigation, not a fix.

**Two things must be verified before this is written as a migration:**

1. **Audit all 11 `writeNotification` call sites** and confirm `aboutProfileId` is always a
   profile the writer owns. `EventScreen` passes `event.owner_profile_id` in four places — that is
   the host writing about their own event, but it must be confirmed rather than assumed, because
   if any path writes a notice *about* someone else's profile the policy will reject a legitimate
   write at runtime.
2. **Decide the `about_profile_id IS NULL` branch.** It is currently permitted, which leaves a
   hole: a forger simply omits the field. Closing it means requiring `about_profile_id` on every
   notification, which is a schema-level decision affecting account-level notices that legitimately
   have no subject.

**Cost of getting this wrong:** notifications silently stop being written at whichever call site
disagrees with the policy. `writeNotification()` returns the error, and most call sites ignore the
return value — so the failure would be invisible until someone noticed a missing notification.

---

## Phase C · The actual fix — move writes behind an RPC

Direct client `INSERT` on `notifications` is the root cause. A policy can only check what is in
the row; it cannot check that the row is *warranted*.

```
writeNotification()  →  rpc('create_notification', {...})
                        SECURITY DEFINER, search_path pinned
                        validates the sender's relationship to the recipient
                        owns type/data rather than accepting them from the caller
                        REVOKE INSERT ON notifications FROM authenticated
```

This is the only option that closes the confused-deputy path, because the function — not the
caller — decides what `data` a `slot_offer` carries.

**Cost:** eleven call sites move to an RPC, the validation rule has to be designed (what
relationship entitles A to notify B?), and `writeNotifications()`'s batch path needs an array
form to stay one round trip. This is a milestone, not a patch.

**Note the dependency:** the validation rule is the same question `can_act_as()` was written to
answer, and CLAUDE.md's R3.2 records that the restrictive policy must not be applied until a real
client write carrying attribution has been observed end to end. Phase C should either wait for
that observation or deliberately supersede it.

---

## Recommendation

**Phase A is cancelled** — the vulnerability it addressed does not exist.

**Phase B only after the call-site audit.** With A gone, B is the first change that would actually
alter behaviour, so it carries the whole risk on its own. The audit is not optional: if any call
site writes a notice *about* a profile the writer does not own, the policy rejects a legitimate
write at runtime, and `writeNotification()`'s return value is ignored at most call sites — so it
fails invisibly.

**Phase C as a scheduled milestone**, not squeezed in. It is the correct answer and also the one
that can take the app down.

**Still one change at a time.** The failure mode of both remaining phases is identical — a
legitimate write silently rejected at a call site that ignores the error.

**A note on sequencing that SEC-5 changed:** the stated rationale for doing A first was to
"establish the correct policy pattern before Messaging". That rationale is gone with the phase.
The pattern worth carrying into Messaging is the one already in `profiles` and
`notification_preferences` — the same expression in both `USING` and `WITH CHECK`, written
explicitly — and it is worth writing explicitly there precisely because the implicit form misled a
careful reader once already.

---

## Interim exposure

SEC-1 and SEC-5 are live and will remain so until Phase A/B land. Two things bound the risk today:

- The app is **localhost-only** and not deployed, so the authenticated attacker population is the
  owner. This is not a public exposure yet.
- It **must** be closed before public beta. The deployment milestone should treat Phase A and B as
  prerequisites, not follow-ups.

Recorded so the sequencing is deliberate: this is not urgent today precisely because deployment is
parked, and it becomes urgent the moment that changes.
