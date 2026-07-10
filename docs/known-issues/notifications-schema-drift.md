# Notifications schema drift — writes likely failing silently

**Severity:** High — likely means most/all notification writes from current v2 code fail in production.
**Status:** Open. Found during Fix 3 security-sprint verification (2026-07-11), deliberately excluded from that fix.
**Not a security issue.** Unrelated to the RLS policy changes in this sprint.

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

- [ ] Compare the live `notifications` table schema against the shape every current write site constructs.
- [ ] Decide whether a migration (add a `data` JSONB column, backfill/deprecate the flat columns) or a frontend rewrite (go back to flat columns) is the right direction — likely depends on how much other code already depends on the flat shape for reads.
- [ ] Audit every notification creation path for the correct shape once decided:
  - `v2/src/lib/writeNotification.js`
  - `v2/src/lib/notifActions.js` (4 write sites)
  - `v2/src/screens/EventScreen.jsx` (4 direct insert sites)
- [ ] Once fixed, re-verify the notification-driven UI flows this blocks: slot offers, shortlist/decline notifications, follow notifications, invite accept/decline.
- [ ] Consider whether this also explains why no live `slot_offer`-type notifications were found for test accounts during Fix 2/3 verification — writes may have been failing silently (errors not surfaced to the user in some call sites).

## Related

Found in the same investigation as [applications-schema-drift.md](./applications-schema-drift.md) — worth checking whether both stem from the same migration that was applied to the database but never fully reflected back into the app code, or vice versa.
