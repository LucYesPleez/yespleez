# Enquiry/availability feature — two RLS gaps that block the in-flight ProfileScreen enquiry flow

**Severity:** High for the feature (it cannot work as built), zero for existing users (both failures are silent no-ops).
**Status:** Open. Found 2026-07-11 during the M4 design-review investigation (`docs/m4-design-review-2026-07.md`, findings F2 and F3). Deliberately **not** addressed by M4: both fixes are product/business-rule decisions, not identity migration work.

## Gap 1 — `venue_availability` has no public-read policy, but the feature reads it publicly (F2)

`ProfileScreen.jsx`'s "CHECK AVAILABILITY" button (uncommitted working-tree work) fetches the viewed venue's availability as **whatever viewer is logged in**:

```js
supabase.from('venue_availability').select('available_date').eq('user_id', id)…
```

The only policy on `venue_availability` is `Users manage own venue availability` (ALL, `auth.uid() = user_id`). There is no public SELECT policy — unlike `artist_availability`, which has one (`Public read availability`, an asymmetry already recorded in the M0 audit §4.1). Result: every non-owner viewer receives 0 rows, silently; the availability calendar will always render empty for exactly the audience the feature exists for, and the enquiry picker built on those dates has nothing to pick.

**Decision needed (product, not migration):** make venue availability publicly readable (matching `artist_availability`), or readable to authenticated users only, or redesign the feature to not read it client-side. Whichever is chosen should be its own small, isolated policy change with its own record — the M4 design review explicitly declines to bundle it.

## Gap 2 — applicant-side enquiry status updates are silently denied (F3)

`ArtistDashboard.jsx` `handleOfferRespond()` updates `venue_enquiries.status` as the **applicant**:

```js
await supabase.from('venue_enquiries').update({ status }).eq('id', id);
```

The only UPDATE policy is `Venue owner can update status` (`auth.uid() = venue_user_id`). An applicant's update matches 0 rows; the error/count is never checked; the UI optimistically shows the new status. Same silent-failure family as the applications/notifications/follows drift bugs found earlier this sprint. (The `accepted` branch's side effects — the `applications` insert and the notification — may still fire even though the status write did nothing.)

**M4 note:** the M4 design deliberately mirrors venue-only UPDATE semantics in its new profile-based policy so this behaviour stays *unchanged* rather than being accidentally legalised. Whether applicants should be able to update enquiry status (accept/decline invites) is a real design question — likely resolved together with the venue_enquiries rework / Booking architecture review.

## Related

- `docs/m4-design-review-2026-07.md` §6 (discovery record)
- `docs/known-issues/venue-enquiries-schema-drift.md` (same table, InviteSheet side — including the now-diagnosed 42501)
- `docs/known-issues/m2-dual-write-gap-sendenquiry.md` (same feature, dual-write gap)
