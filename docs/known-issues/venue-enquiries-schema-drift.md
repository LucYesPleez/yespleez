# venue_enquiries schema drift — "Invite an artist" likely broken

**Severity:** High — likely means the host/venue-initiated invite flow fails in production.
**Status:** Open. Found during M1 schema investigation (2026-07-11), out of scope for the identity migration — logged only.
**Not part of the identity migration.** Discovered incidentally while confirming `venue_enquiries`'s real schema for M1's additive columns.

## Summary

`InviteSheet.jsx`'s insert into `venue_enquiries` writes: `applicant_name`, `event_id`, `event_name`, `proposed_date`, `proposed_fee`, `notes` (plural), plus `venue_user_id`, `applicant_user_id`, `direction`, `status`.

**Live columns (confirmed via `information_schema.columns`, 2026-07-11):** `id` (bigint), `created_at`, `venue_user_id`, `applicant_user_id`, `applicant_type` (default `'artist'`), `date_requested` (**NOT NULL, no default**), `note` (singular), `status` (default `'pending'`).

None of `applicant_name`, `event_id`, `event_name`, `proposed_date`, `proposed_fee`, `notes`, or `direction` exist on the table. The real field is `note`, not `notes`.

**More severe than the applications/notifications cases:** `date_requested` is a required (`NOT NULL`) column with no default, and the insert payload never sets it. This isn't just extra fields being rejected — the insert is missing a mandatory field, so it would fail regardless of the other mismatches.

## Not yet verified

Unlike the applications and notifications fixes, this has **not been confirmed live** — no test insert or UI click-through has been run against this specific flow. This is a schema-comparison finding only, flagged for investigation, not a verified reproduction.

## Investigation checklist

- [ ] Confirm live via a test insert or UI click-through (same technique used for applications/notifications).
- [ ] Compare `InviteSheet.jsx`'s payload against the real schema field-by-field; decide what `date_requested` should be populated with (likely the proposed date field the UI collects, which currently has nowhere real to go).
- [ ] Decide whether `event_id`/`event_name`/`proposed_date`/`proposed_fee` need real columns added (this table currently has no way to represent a specific event or proposed terms at all — the schema looks like it predates the InviteSheet feature, or the feature was built against an assumed schema that was never migrated).
- [ ] Fix `notes` → `note` field name mismatch.
- [ ] Verify end-to-end once resolved: send an invite, confirm the venue_enquiries row is created correctly, confirm the artist receives it correctly (`ArtistDashboard.jsx`'s incoming-offers query already reads this table — check it still resolves correctly against whatever the final schema is).

## Related

Third instance of the same pattern as [applications-schema-drift.md](./applications-schema-drift.md) and [notifications-schema-drift.md](./notifications-schema-drift.md) — code and database drifting apart independently, discovered incidentally rather than through deliberate audit. Worth considering, at some point, a systematic schema-vs-code comparison across every table, rather than continuing to find these one at a time.
