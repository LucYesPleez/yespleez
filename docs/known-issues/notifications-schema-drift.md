# Notifications schema drift — writes were failing silently

**Severity:** High — most notification writes from v2 code were failing, and the accept/decline slot-offer flow was silently doing nothing server-side.
**Status:** RESOLVED (2026-07-11). Additive migration (`data JSONB` column) + one code fix, both verified live.
**Not a security issue.** Unrelated to the RLS policy changes in the earlier security sprint.

## Resolution

Added a `data JSONB` column to `notifications` — additive only, no columns dropped, renamed, or altered, no existing data touched. Every current write and read site already assumed this column existed; this one change made the entire existing codebase correct with zero further code changes needed, except one inconsistent writer (see below).

**Full project-wide dependency audit performed before implementing**, covering frontend, backend, SQL triggers/functions, Edge Functions, Studio/GigImporter, admin scripts, and the retired v1 app — confirmed no active writer depended on the legacy flat columns. Notably: v1's own `notifications.js` (root of this repo, not v2) is the actual historical source of the flat-column shape (`writeDbNotif()` spreads an `extras` object as top-level insert fields) — but v1 was confirmed **not live**: `origin/main` contains only v1 code with no `v2/` folder, no CI/CD deploy path exists in this repo, and the production domain referenced in the project's own code doesn't resolve in DNS.

**Fixed the one inconsistent writer:** `EventScreen.jsx`'s `shortlisted` notification set a bare `event_id` field instead of `data: { event_id }`. Turned out to be dead code (defined, never called, never passed as a prop) — fixed for consistency, not because it was an active bug. The real, live shortlist flow goes through `ApplicationsScreen.jsx` → the shared `writeNotification.js` helper, which was already correct.

**The critical verification** — this wasn't just a display bug. `notif.data || {}` meant the notification *list* already degraded gracefully to an empty object, but `acceptSlotOffer(data, userId)` etc. read `data.performance_id`/`data.event_id`/`data.host_id` to know *what to update*. Before this fix, every future Accept/Decline click would have been a **silent no-op** — UI shows "RESPONDED ✓" via local state, nothing happens server-side. Verified live: created a real `slot_offer` notification with a valid `data` payload against a real performance, clicked the actual ACCEPT SLOT button — `performances.status` genuinely transitioned `offered → accepted`, with a correctly-shaped reciprocal notification generated. Repeated for decline. Performance restored to its original state after testing.

Also verified: the shortlisted flow (real click, correct `data`), `acceptInvite`'s notification write (direct payload replication). The remaining `writeNotification.js` callers (`ArtistDashboard.jsx`, `HostDashboard.jsx`, `VenueDashboard.jsx`, `InviteSheet.jsx`, `ProfileScreen.jsx`) share the identical, now-proven insert shape.

---

## Original report

## Summary

The live `notifications` table has flat legacy columns and no `data` JSONB column at all:

**Live columns (confirmed via `select=*` on a real row):** `id`, `user_id`, `type`, `from_id`, `event_id`, `slot_id`, `message`, `status`, `read`, `created_at`, `slot_label`, `event_name`, `from_uid`, `from_name`.

**Current code writes a `data` JSONB column** — `writeNotification.js`, every call in `notifActions.js`, and the direct inserts in `EventScreen.jsx` all construct `{ user_id, type, message, data, read }`. That column does not exist.

A sample real row on the live table has `type: 'offer_accepted'` — a type string that appears nowhere in the current v2 codebase (current code uses `slot_accepted`, `slot_declined`, `invite_accepted`, `invite_declined`, `new_follower`, `shortlisted`, `application_declined`, `booking_confirmed`, `event_invite`, `slot_offer`, `slot_removed`). This strongly suggests the live schema reflects an older version (possibly v1, or an earlier v2 iteration) that was never migrated forward, while the application code moved on to a different shape.

## Evidence captured

During Fix 3's live verification, the same "Apply to Event" click-through also fired `POST /rest/v1/notifications → 400` before the `applications` insert failed — confirming this table's write path is also currently broken, independent of the `applications` issue.

Direct query confirmation:
```
SELECT * FROM notifications WHERE user_id = '<test user>' ORDER BY created_at DESC LIMIT 3;
```
returned real rows using the flat/legacy shape above — no `data` column present in the result set, and a `select=data` query fails with:
```json
{ "code": "PGRST204", "message": "column notifications.data does not exist" }
```

## Investigation checklist

- [x] Compare the live `notifications` table schema against the shape every current write site constructs.
- [x] Decide whether a migration or a frontend rewrite is the right direction — resolved as: the frontend's `data`-JSONB model is canonical (complete, consistent across all 11 notification types, already has defensive read-side fallbacks); the database's flat-column schema was the outdated one, missing fields (`performance_id`, `host_id`, `proposed_date`/`proposed_fee`) the accept/decline logic genuinely needs. Additive migration, not a frontend rewrite.
- [x] Audit every notification creation path for the correct shape — all 7 sites checked, one inconsistency found and fixed (`EventScreen.jsx`'s dead `respondApp`).
- [x] Re-verify the notification-driven UI flows: slot offer accept/decline (the critical functional test — real `performances` state transition, not just display), shortlisted (live click), invite accept (payload replication).
- [x] Confirmed: yes — this explains why no live `slot_offer`-type notifications were ever found for test accounts. Every write attempting to include `data` was failing with `PGRST204`, silently in most call sites (errors caught and logged, not surfaced to the user).

## Related

Found in the same investigation as [applications-schema-drift.md](./applications-schema-drift.md) — worth checking whether both stem from the same migration that was applied to the database but never fully reflected back into the app code, or vice versa.

---

## Separate issue: interim authorization limitation on INSERT (not schema drift)

**Found:** during the 2026-07 security sprint (Fix 4 investigation). **Not caused by, or related to, the schema drift above** — this is an authorization-design gap, not a missing-column problem.

`notifications` INSERT is currently governed by a single policy, `authenticated users can insert notifications` (`auth.role() = 'authenticated'`). This only checks that the requester is logged in — it does not check who the target `user_id` is or what relationship justifies the write. **Any authenticated user can currently insert a notification into any other user's inbox.**

This is an accepted interim limitation, not an oversight:

- The security sprint's original audit suspected an *additional*, fully unconditional policy (`Anyone can insert notifs`, permitting even anonymous writes) sitting alongside this one. On re-verification against the live database, that policy did not exist — so no removal was necessary, and the sprint made no changes to `notifications` INSERT policy at all (Fix 4 was verified with no database changes required).
- Closing the authenticated cross-user gap properly requires a relationship-scoped authorization model (host-owns-event, venue-owns-enquiry, artist-responds-to-counterparty, open-follow) — a genuine design exercise, not a policy tweak. Tracing every legitimate notification writer in the codebase during Fix 4 investigation confirmed this model has at least four distinct shapes; none reduce to a simple ownership check.
- This is deferred to the future **Notifications architecture redesign**, not the security sprint, which was scoped to closing unconditional/unauthenticated access, not redesigning authorization.

### Investigation checklist (for the Notifications redesign, not now)

- [ ] Design the relationship-scoped authorization model covering all four writer shapes identified during Fix 4 (see sprint summary for details).
- [ ] Decide whether enforcement lives in RLS (a correlated policy per writer shape) or behind a service/RPC layer that centralizes the checks — evaluate once the schema drift above is resolved and the real payload shapes are known.
- [ ] Replace the interim `authenticated users can insert notifications` policy as part of that redesign, not before.
