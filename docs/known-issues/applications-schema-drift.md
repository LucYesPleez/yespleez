# Applications schema drift — breaks live "Apply to Event" flow

**Severity:** High — broke a core user-facing flow in production for any artist with a real profile name set.
**Status:** RESOLVED (2026-07-11) for the insert-blocking bug. One deliberate feature trade-off remains (see below); `applicant_name`'s purpose is still unresolved.
**Not a security issue.** Unrelated to the RLS policy changes in Fix 2/Fix 3.

## Resolution

Removed `artist_name`, `genre`, `mix_link`, `avatar_url`, and `via_invite` (a second, related non-existent column found during the fix) from all three INSERT call sites. Investigation confirmed every display site already reads `profile.name || app.artist_name || fallback` — profile-first — so the row-level fields were redundant duplication, not a required source of truth; dropping them from INSERT loses no display functionality for `artist_name`, `genre`, and `avatar_url`.

**Deliberate trade-off accepted:** `mix_link` was checked row-first (`app.mix_link || profile.mix_link`), meaning a per-application mix-link override was intended (let an applicant point to a specific mix for *this* gig, distinct from their profile's general one). The table has no plain `mix_link` column to write it to (only `guest_mix_link`, reserved for the separate no-account applicant path), so restoring this properly would require a schema change. Decided to drop it for now rather than block the fix — this feature is now fully non-functional (was already silently degrading to the profile mix link before this fix, due to the crash). Revisit if a per-application mix-link override is wanted, as its own schema decision.

**Still unresolved:** `applicant_name`'s purpose. Every live row has it `null`, even guest-applicant rows that populate `guest_name` instead. Not wired up to anything on either the read or write side currently.

Verified: real INSERT succeeds end-to-end via the live UI (punter view → APPLY TO PLAY → SEND APPLICATION), confirmed against a real database row (correct `artist_id`, `status: pending`, no errors). The other two fixed payload shapes (`notifActions.js acceptInvite`, `ArtistDashboard.jsx handleOfferRespond`) confirmed via direct replication of the exact post-fix payload.

The `APPLYING AS: <host profile>` identity-resolution issue noted below is still open — separate root cause, not addressed by this fix.

---

## Original report

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

- [x] Compare the live `applications` table schema against every field referenced in the three insert/update call sites.
- [x] Decide whether the database schema or the frontend field names are canonical — resolved as: database is canonical; the row-level display fields were redundant with the existing profile join, so removed from the frontend rather than added to the schema. `mix_link` was the one exception requiring a real trade-off (see Resolution above).
- [x] Update every `applications` insert/update call site consistently (all three, plus the related `via_invite` non-existent-column finding).
- [ ] Re-check the `APPLYING AS` identity-resolution query for multi-profile-type accounts while in the area. **Still open** — separate bug, not addressed by this fix.
- [x] Verify end-to-end: apply to event (live UI), accept invite / accept venue offer (direct payload replication of the fixed shape).

## Call sites affected

- `v2/src/screens/EventScreen.jsx:1130` (`ApplyButton.submit()`)
- `v2/src/lib/notifActions.js:48` (`acceptInvite()`)
- `v2/src/screens/ArtistDashboard.jsx:178` (`handleOfferRespond()`)
