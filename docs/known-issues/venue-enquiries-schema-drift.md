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

Net effect: this flow cannot currently succeed at all, for reasons independent of and in addition to the schema-drift fields. ~~The RLS policy's exact required condition was not diagnosed (no `pg_policies` access via REST) — that's the next investigation step, not just the field-name fixes.~~ **Diagnosed 2026-07-11** (during the M4 design-review investigation, from the repo alone): the M0 audit's policy inventory (`docs/m0-audit-2026-07.md` §3.1) already contained the answer. The table's only INSERT policy is `Users can insert own enquiries` — `WITH CHECK (auth.uid() = applicant_user_id)`. InviteSheet's payload is **venue-initiated**: it sets `applicant_user_id` to the *artist's* user id, never the inserting venue's session. The check can therefore never pass for this flow — venue-initiated invites have never been insertable, by policy design, not by accident. Fixing it requires a business-rule decision (should a venue be able to create an enquiry naming another user as applicant, and under what scoping?) — flagged for the enquiries rework / Booking architecture review, and explicitly kept out of the M4 RLS migration, whose new profile-based INSERT policy deliberately mirrors the same applicant-side-only semantics (`docs/m4-design-review-2026-07.md` §1.2, §6 F4).

## Update 2026-07-17 — the schema moved, and the payload moved with it

Re-probed live during the schema audit (`docs/live-schema-audit-2026-07.md`). Four things changed since 11 Jul; the rest of this document still holds.

**1. Five of the missing columns now exist — added via the dashboard, by no migration.**
`headliner`, `slot_role`, `set_duration`, `extras`, `respond_by` are all live. No file in `supabase/migrations/` adds them, and `InviteSheet.jsx:83` still comments that they *"require the venue_enquiries columns — see migration."* **The repair was started by hand and abandoned halfway**: the five new pitch fields landed, the six older feature fields did not. The "Live columns (confirmed 2026-07-11)" list above is therefore incomplete, not wrong.

**2. The payload changed too — `notes` is gone, `message` took its place, and it is equally phantom.**
This doc records the code writing `notes` (plural). It no longer does. `InviteSheet.jsx:68-89` now writes **`message`**, which also does not exist. The correct column remains `note`. The drift didn't get fixed; it got renamed.

**3. `proposed_time` is a ninth drift field**, not previously listed.

**4. Current state: 19 payload fields, 8 phantom** — `applicant_name`, `event_id`, `event_name`, `message`, `proposed_date`, `proposed_time`, `proposed_fee`, `direction`. Everything else on the payload is real.

**5. The READ path is broken too — not previously recorded.** `ArtistDashboard.jsx:192` and `:214` filter this table with `.eq('direction', 'outgoing')`. `direction` has never existed, so those queries fail live: `42703: column venue_enquiries.direction does not exist` (probed 2026-07-17). **The artist's incoming-invite list cannot load, independently of whether any invite could ever be written.** Everywhere else (`EnquiryCard:115`, `EnquiryPanel:46,62,83`, `enquiryUtils:50,54`, `VenueDashboard:218`) reads `(e.direction || 'incoming')`, whose fallback silently makes every row read as incoming — which is why the missing column never surfaced as an error there.

**The failure order is a chain, not a single fault.** Each gate hides the next, which is why this has been fixed-and-still-broken more than once:

1. **`PGRST204`** (the live 400) — phantom columns. PostgREST rejects against its schema cache **before any SQL runs**, and names **one column per attempt**, so fixing them one at a time costs eight round trips.
2. **`23502`** — `date_requested` NOT NULL, still never sent.
3. **`42501`** — the RLS policy diagnosed above. Unchanged.

**Fixing the 400 will not make invites work — it will reveal the next gate.** Worth knowing before estimating this.

**One nuance from `identity-validation-scenarios.md` IA-01:** gate 3 passes when a venue invites *its own* artist profile, because then `auth.uid() = applicant_user_id` is satisfied. The self-invite is the only case the current policy permits — and the one the UI blocks at `ProfileScreen.jsx:177`.

## Investigation checklist

- [x] Confirm live via a test insert or UI click-through (same technique used for applications/notifications). — Confirmed broken, 2026-07-11 (see above).
- [x] Diagnose the exact RLS policy condition on `venue_enquiries` INSERT. — **Diagnosed 2026-07-11** from the M0 inventory (see above): `Users can insert own enquiries`, `WITH CHECK (auth.uid() = applicant_user_id)`. Deciding the correct fix remains an open business-rule decision.
- [ ] Compare `InviteSheet.jsx`'s payload against the real schema field-by-field; decide what `date_requested` should be populated with (likely the proposed date field the UI collects, which currently has nowhere real to go).
- [ ] Decide whether `event_id`/`event_name`/`proposed_date`/`proposed_fee` need real columns added (this table currently has no way to represent a specific event or proposed terms at all — the schema looks like it predates the InviteSheet feature, or the feature was built against an assumed schema that was never migrated).
- [ ] Fix `notes` → `note` field name mismatch, and drop `direction` (not a real column).
- [ ] Verify end-to-end once resolved: send an invite, confirm the venue_enquiries row is created correctly, confirm the artist receives it correctly (`ArtistDashboard.jsx`'s incoming-offers query already reads this table — check it still resolves correctly against whatever the final schema is).

## Related

Third instance of the same pattern as [applications-schema-drift.md](./applications-schema-drift.md) and [notifications-schema-drift.md](./notifications-schema-drift.md) — code and database drifting apart independently, discovered incidentally rather than through deliberate audit. Worth considering, at some point, a systematic schema-vs-code comparison across every table, rather than continuing to find these one at a time.
