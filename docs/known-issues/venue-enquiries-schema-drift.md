# venue_enquiries schema drift — "Invite an artist" likely broken

**Severity:** High — likely means the host/venue-initiated invite flow fails in production.
**Status:** Open. Found during M1 schema investigation (2026-07-11), out of scope for the identity migration — logged only. Confirmed live-broken (for two independent reasons) during M2 dual-write verification (2026-07-11) — see "Confirmed live" below. Still out of scope; M2 did not fix this.
**Not part of the identity migration.** Discovered incidentally while confirming `venue_enquiries`'s real schema for M1's additive columns.

## Summary

`InviteSheet.jsx`'s insert into `venue_enquiries` writes: `applicant_name`, `event_id`, `event_name`, `proposed_date`, `proposed_fee`, `notes` (plural), `direction`, plus `venue_user_id`, `applicant_user_id`, `status`.

**Live columns (confirmed via `information_schema.columns`, 2026-07-11):** `id` (bigint), `created_at`, `venue_user_id`, `applicant_user_id`, `applicant_type` (default `'artist'`), `date_requested` (**NOT NULL, no default**), `note` (singular), `status` (default `'pending'`).

None of `applicant_name`, `event_id`, `event_name`, `proposed_date`, `proposed_fee`, `notes`, or `direction` exist on the table. The real field is `note`, not `notes`.

**More severe than the applications/notifications cases:** `date_requested` is a required (`NOT NULL`) column with no default, and the insert payload never sets it. This isn't just extra fields being rejected — the insert is missing a mandatory field, so it would fail regardless of the other mismatches.

## Confirmed live (2026-07-11, during M2 dual-write verification)

While verifying M2's dual-write for this table (adding `venue_profile_id`/`applicant_profile_id`), a direct authenticated REST insert reproduced **two independent failures**, neither caused by M2:

1. **`direction` is not a real column either** — `PGRST204: Could not find the 'direction' column`. This item was missing from the field list above; the drift is one field wider than originally logged.
2. **Even a schema-correct minimal payload (only real columns: `venue_user_id`, `applicant_user_id`, `applicant_type`, `date_requested`, `note`, `status`) is rejected by Row-Level Security**: `42501: new row violates row-level security policy for table "venue_enquiries"`, using the authenticated venue owner's own session as `venue_user_id`. Reproduced with zero extra columns, so this is unrelated to the schema-drift fields and unrelated to M2's new columns — confirmed by re-running the identical test with the two new `*_profile_id` columns entirely omitted; the same 403 occurred.

Net effect: this flow cannot currently succeed at all, for reasons independent of and in addition to the schema-drift fields. The RLS policy's exact required condition was not diagnosed (no `pg_policies` access via REST) — that's the next investigation step, not just the field-name fixes.

## Investigation checklist

- [x] Confirm live via a test insert or UI click-through (same technique used for applications/notifications). — Confirmed broken, 2026-07-11 (see above).
- [ ] Diagnose the exact RLS policy condition on `venue_enquiries` INSERT (needs SQL-editor/dashboard access; not visible via REST) and decide the correct fix.
- [ ] Compare `InviteSheet.jsx`'s payload against the real schema field-by-field; decide what `date_requested` should be populated with (likely the proposed date field the UI collects, which currently has nowhere real to go).
- [ ] Decide whether `event_id`/`event_name`/`proposed_date`/`proposed_fee` need real columns added (this table currently has no way to represent a specific event or proposed terms at all — the schema looks like it predates the InviteSheet feature, or the feature was built against an assumed schema that was never migrated).
- [ ] Fix `notes` → `note` field name mismatch, and drop `direction` (not a real column).
- [ ] Verify end-to-end once resolved: send an invite, confirm the venue_enquiries row is created correctly, confirm the artist receives it correctly (`ArtistDashboard.jsx`'s incoming-offers query already reads this table — check it still resolves correctly against whatever the final schema is).

## Related

Third instance of the same pattern as [applications-schema-drift.md](./applications-schema-drift.md) and [notifications-schema-drift.md](./notifications-schema-drift.md) — code and database drifting apart independently, discovered incidentally rather than through deliberate audit. Worth considering, at some point, a systematic schema-vs-code comparison across every table, rather than continuing to find these one at a time.
