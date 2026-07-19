# M14a–M14e — verification evidence

**18 Jul 2026.** Live results, recorded as run. Same convention as the M4/M5/M5.1 evidence files.

---

## Applied, in order

| # | Migration | Asserts | Result |
|---|---|---|---|
| **M14a** | `20260718000007_m14a_events_owner_profile_id` | schema — `events.owner_profile_id` exists | ✅ `24 / 0` (column present, nothing populated) |
| **M14b** | *(app code, `ffbc628`)* | new events stamp their owner | ✅ build clean; runtime pending a signed-in host |
| — | *(app fix, `a3a1ea7`)* | `venue_profile_id` stops being written wrongly | ✅ build clean |
| **M14c** | `20260718000008_m14c_owner_backfill` | **every event has an owner** | ✅ `UPDATE 24` → `24 / 24 / 0`, `0`, `0` |
| **M14d** | `20260718000009_m14d_venue_null_unmatched` | no untruthful venue links | ✅ `UPDATE 15` → `24 / 9 / 15` |
| **M14e** | `20260718000010_m14e_venue_alias_brewery` | one approved alias linked | ✅ `UPDATE 8` → `8`, `0`, `24 / 9 / 15` |

---

## Invariants now true of the data

**1 · Every event has exactly one accountable owner** — identity v1.3 `O-R6`.
24 of 24 carry `owner_profile_id`; all resolve to a real, owner-eligible profile.

> **True of the data, not yet enforced by the schema.** `owner_profile_id` remains nullable. The
> `NOT NULL` belongs with the policy cutover (v1.3 phase 3), which rides with R3.2 and stays
> deferred pending an observed client write carrying `from_profile_id`.

**2 · Every `venue_profile_id` either identifies the hosting venue or is `NULL`** — `O-R4`.
9 linked (1 name-truthful + 8 by approved alias), 15 honestly `NULL`.

---

## Ownership survived both venue migrations

Checked after M14d and again after M14e: `24 / 24 / 0` each time. M14d and M14e never name
`owner_profile_id`, and the assertion existed to catch a statement that touched a column it did not
mention.

---

## What the dry runs changed

Neither migration ran as originally planned, and both changes came from measuring first.

**M14c was going to apply the `U4` rule.** The dry run returned **0 of 24 resolved** — one host
account owning five owner-eligible profiles is precisely the case `U4` refuses to guess at. Running
it would have produced 24 unowned events, which `O-R6` forbids. Replaced by a single owner decision
covering the whole table.

**The venue fallback was going to be offered as the M14c backup.** The dry run found all 24 events
pointing at one venue while naming four different places — so the fallback would have asserted 23
false commercial relationships. **Withdrawn**, the source bug fixed first, and recorded as erratum
`E3`.

**The venue repair was going to be one migration.** Splitting it by *evidence standard* — data-proven
versus human-approved — kept the curated alias auditable instead of buried among 23 mechanical
clears.

> The pattern worth keeping: **every one of these was found by dry-running against live data, not by
> reasoning about it.** The `U4` rule, the fallback and the single-migration plan were all defensible
> on paper and all wrong in practice.

---

## Still outstanding

- **`NOT NULL` on `owner_profile_id`** — with v1.3 phase 3.
- **15 events with no venue profile** — resolve when Studio creates them; ordinary editing, not migration.
- **M14b runtime verification** — needs a signed-in host; the picker path needs an account with two owner-eligible profiles.
- **R3.2** — still pending an observed client write carrying `from_profile_id`.
