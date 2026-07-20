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

## Phase A · Close SEC-5 now — low risk, high confidence

```sql
-- PROPOSAL, NOT APPLIED
ALTER POLICY "Users update own notifs" ON public.notifications
  USING      (auth.uid() = to_user_id)
  WITH CHECK (auth.uid() = to_user_id);
```

Stops a user re-addressing a notification they own to somebody else.

**Why this is safe:** the only thing the app ever updates on a notification is `read` (three
sites) and `responded_at`. Neither changes `to_user_id`, so no client path is affected. The one
statement that *does* change `to_user_id` is `deliver_held_notifications()`, which runs in the SQL
editor under a privileged role that RLS does not constrain — and which the `USING` clause already
excludes from app contexts anyway (a held row has `to_user_id IS NULL`, so it can never match).

**Before applying:** SEC-6 means there are **two** identical UPDATE policies. Both must be
altered, or the untouched one still permits the write and the fix will appear to work while
changing nothing. This is exactly the trap SEC-6 describes.

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

**Phase A now** — small, verifiable, closes a confirmed hole, and the blast radius is understood.

**Phase B after the call-site audit**, as its own change with its own verification. Not bundled
with A: if a notification stops being written, we need to know which change caused it.

**Phase C as a scheduled milestone**, not squeezed in. It is the correct answer and it is also the
one that can take the app down.

**Do not do all three at once.** The failure mode of every phase is the same — a legitimate write
silently rejected, at a call site that ignores the error — and the only defence is changing one
thing at a time.

---

## Interim exposure

SEC-1 and SEC-5 are live and will remain so until Phase A/B land. Two things bound the risk today:

- The app is **localhost-only** and not deployed, so the authenticated attacker population is the
  owner. This is not a public exposure yet.
- It **must** be closed before public beta. The deployment milestone should treat Phase A and B as
  prerequisites, not follow-ups.

Recorded so the sequencing is deliberate: this is not urgent today precisely because deployment is
parked, and it becomes urgent the moment that changes.
