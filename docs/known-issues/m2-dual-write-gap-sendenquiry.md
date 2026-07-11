# M2 dual-write gap — `ProfileScreen.jsx` `sendEnquiry()` inserts `venue_enquiries` without profile ids

**Severity:** Medium — no user-visible breakage, but it silently violates the identity migration's M2 invariant and erodes M3's data parity as soon as the flow is used.
**Status:** RESOLVED 2026-07-11 — fixed as the approved pre-M4 step (M4 approval decision 2: "Resolve F1 before implementing M4"), as its own app-code change, kept fully outside the M4 RLS migration. Fix applied in `ProfileScreen.jsx`: `openEnquiry()`'s profiles select now fetches `id`, and `sendEnquiry()`'s insert dual-writes `venue_profile_id: profile.id` (the already-loaded venue row) and `applicant_profile_id: enquiryProf.id` (the already-resolved applicant row) — both M2 "preference 1" direct assignments, no `resolveProfileId` lookup needed. Found 2026-07-11 during the M4 design-review investigation (`docs/m4-design-review-2026-07.md`, finding F1).

**Residual check performed with the fix:** the live table was checked for legacy-only rows this write path may have created before the fix (see the M4 pre-flight inventory record); the M3 backfill statement is idempotent and is re-run if any are found.
**Part of the identity migration's obligations, but not part of M4.** This is an M2-scope regression introduced after M2 closed.

## Summary

`ProfileScreen.jsx`'s enquiry feature (currently **uncommitted working-tree work**, added after the M2 dual-write milestone was implemented and verified) inserts into `venue_enquiries` at `sendEnquiry()`:

```js
await supabase.from('venue_enquiries').insert({
  venue_user_id:     id,
  applicant_user_id: session.user.id,
  applicant_type:    enquiryProf.type,
  date_requested:    pickerDate,
  note:              enquiryNote.trim() || null,
  status:            'pending',
});
```

No `venue_profile_id`, no `applicant_profile_id`. Every other write site on the five M1 tables dual-writes (M2 design review §1); this one was created outside that inventory and doesn't.

Two aggravating details:

1. **Unlike InviteSheet's insert, this one actually works.** It is applicant-initiated (`applicant_user_id = auth.uid()`), so it passes the legacy INSERT policy (`Users can insert own enquiries`). It will therefore produce real legacy-only rows in production the moment the feature ships — directly violating M2's exit criterion ("organic use produces zero legacy-only rows") and M3's parity sign-off.
2. It is also, incidentally, the first *schema-correct* insert path this table has ever had (it uses the real columns, including `date_requested` and `note` — the drift that breaks InviteSheet doesn't apply here).

## Required fix (M2 pattern, small)

- Resolve both sides per the M2 design's rules: `applicant_profile_id` — the enquiry picker already holds the applicant's resolved profile row (`enquiryProf`), but its select at `openEnquiry()` fetches `user_id, type, name, …` **without `id`** — add `id` to that select (same one-line pattern as `FillSlotModal`) and use `enquiryProf.id` directly. `venue_profile_id` — `resolveProfileId(id, 'venue')` (the route `id` is the venue's user id in this flow).
- After the fix lands, re-run the M3 `venue_enquiries` backfill statement once (it is idempotent, `WHERE … IS NULL`-guarded) to repair any legacy-only rows created in the meantime.

## Sequencing recommendation

Land this as its own isolated commit **before** the M4 verification matrix is executed, so the matrix isn't run against a table with a known-drifting write path. It must not be bundled into the M4 migration (hard rule: RLS isolated from app code).

## Related

- `docs/m4-design-review-2026-07.md` §6 F1 (discovery record)
- `docs/known-issues/enquiry-feature-rls-gaps.md` (two further gaps in the same in-flight feature)
- `docs/known-issues/venue-enquiries-schema-drift.md` (the InviteSheet-side problems on this same table)
