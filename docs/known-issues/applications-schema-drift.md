# Applications schema drift — breaks live "Apply to Event" flow

**Severity:** High — likely breaks a core user-facing flow in production for any artist with a real profile name set.
**Status:** Open. Found during Fix 3 security-sprint verification (2026-07-11), deliberately excluded from that fix.
**Not a security issue.** Unrelated to the RLS policy changes in Fix 2/Fix 3.

## Summary

`EventScreen.jsx`'s apply form, `notifActions.js`'s `acceptInvite()`, and `ArtistDashboard.jsx`'s `handleOfferRespond()` all insert into `applications` using fields that do not exist on the live table.

**Code writes:** `artist_name`, `genre`, `mix_link`, `avatar_url`
**Live table has:** `applicant_name`, `guest_genre`, `guest_mix_link`, `guest_name`, `guest_email`, `guest_sound` (confirmed via `information_schema.column_privileges`, 2026-07-11) — no `artist_name`, `genre`, `mix_link`, or `avatar_url` columns at all.

## Evidence captured

Live UI click-through (punter view → APPLY TO PLAY → SEND APPLICATION, fresh event, zero prior applications) produced a real `POST /rest/v1/applications → 400`:

```json
{
  "code": "PGRST204",
  "details": null,
  "hint": null,
  "message": "Could not find the 'artist_name' column of 'applications' in the schema cache"
}
```

Separately confirmed this is not an RLS/permissions issue: a minimal payload using only real columns (`event_id`, `artist_id`, `status`, `note`) succeeds cleanly (201) under the identical policy state.

**Secondary observation, not yet investigated:** when reached via `EventScreen.jsx`'s punter-view toggle, the apply form displayed `APPLYING AS: YesPleez` (a host-type profile) rather than the artist profile, for a session that owns multiple profile types under one account. The identity-resolution query (`profiles.select(...).neq('type','punter').limit(1)`, no `type` filter) appears to grab an arbitrary non-punter profile rather than specifically an artist-type one. Worth checking whether this is part of the same root cause or a separate bug.

## Investigation checklist

- [ ] Compare the live `applications` table schema against every field referenced in the three insert/update call sites.
- [ ] Decide whether the database schema or the frontend field names are canonical (i.e., was the table renamed and the code never updated, or vice versa).
- [ ] Update every `applications` insert/update call site consistently.
- [ ] Re-check the `APPLYING AS` identity-resolution query for multi-profile-type accounts while in the area.
- [ ] Verify end-to-end: apply to event, accept invite, accept venue offer — all three flows.

## Call sites affected

- `v2/src/screens/EventScreen.jsx:1130` (`ApplyButton.submit()`)
- `v2/src/lib/notifActions.js:48` (`acceptInvite()`)
- `v2/src/screens/ArtistDashboard.jsx:178` (`handleOfferRespond()`)
