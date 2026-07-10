# M1 Design Review — Schema Expansion (Additive Only)

**Status:** COMPLETE. Applied 2026-07-11, schema verified, live application smoke-tested with zero visible behavior change. See §3.1–3.2 for the verification evidence.

This document answers the three questions posed before implementation begins: exact schema additions, compatibility, and exit criteria. All facts below are drawn from the confirmed schema investigation performed on 2026-07-11 (`information_schema.columns` and constraint queries against the live database), not inference.

---

## 1. Exact Schema Additions

### 1.1 A finding that shrinks M1's scope further

`profiles.id` **already exists** as the table's actual primary key (`uuid`, `NOT NULL`, `gen_random_uuid()` default) — confirmed via the constraints query, not assumed. `profiles.user_id` is **already nullable** in the live schema. The "permanent public identity" and "ownership as a nullable attribute" properties the architecture calls for already hold structurally.

**Revision:** the initial draft of this design proposed a new `owner_user_id` column alongside `user_id`. On review, this isn't technically necessary: `user_id`'s meaning at the row level (which account owns *this specific row*) never changes anywhere in the migration, unlike the relationship-table FKs (`artist_id`, etc.) where old and new resolution logic can genuinely disagree for a multi-profile-owning user. RLS already checks `auth.uid() = user_id` and needs no changes. The existing `UNIQUE(user_id, type)` constraint already tolerates any number of `user_id = NULL` rows per type (standard SQL NULL semantics — NULLs are never equal to each other for uniqueness). M1 continues using `profiles.user_id` directly as the ownership field; no new ownership column is introduced.

### 1.2 `profiles` — new columns

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `claim_status` | `text` | NOT NULL | `'claimed'` | Every existing row represents an owned profile today; `'claimed'` is confirmed correct for 100% of current data (verified §2.3 — zero rows have `user_id IS NULL`). |
| `claimed_at` | `timestamptz` | NULL | — | |
| `claimed_via` | `text` | NULL | — | |
| `created_via` | `text` | NULL | — | Not backfilled by M1 — left NULL for existing rows, populated going forward and during M3. |
| `source` | `jsonb` | NULL | — | One JSONB field, not three flat text columns (`source_type`/`source_name`/`source_url`) — matches the existing convention in this schema (`events.config`, `events.host_controls`, `lineup_members.card_pills`, `notifications.data` are all JSONB for similar "structured, evolving metadata" needs). Flagging this as a judgment call, not a locked decision — flat columns are the alternative if you'd rather match `profiles`'s otherwise-flat shape. |
| `onboarding_seen_at` | `timestamptz` | NULL | — | Gates the future "While you were away" screen. |

### 1.3 New nullable profile-reference column, one per relationship table

| Table | New column | Points at | Existing analogous column |
|---|---|---|---|
| `follows` | `target_profile_id` | `profiles.id` | `entity_id` (uuid, NOT NULL — but polymorphic: can reference a profile *or* an event depending on `entity_type`. The new column is only meaningful for non-event follows; it stays NULL for `entity_type = 'event'` rows by design, not as an oversight.) |
| `lineup_members` | `artist_profile_id` | `profiles.id` | `artist_id` |
| `venue_enquiries` | `venue_profile_id`, `applicant_profile_id` | `profiles.id` | `venue_user_id`, `applicant_user_id` (Note: `venue_enquiries.id` is `bigint`, not `uuid` — an existing inconsistency in this table, irrelevant to these new columns since they reference `profiles.id`, not `venue_enquiries.id`.) |
| `venue_availability` | `profile_id` | `profiles.id` | `user_id` |
| `events` | `venue_profile_id` | `profiles.id` | `host_id` stays exactly as-is — this is the attribution split: `host_id` remains the auth-only column, `venue_profile_id` becomes the new public-attribution column. Two different concerns, no longer sharing one column. |

### 1.4 Constraints

- **Foreign keys**: each new column above gets `REFERENCES public.profiles(id)`. Safe to add immediately even though every value is currently `NULL` — Postgres does not evaluate FK constraints against `NULL`, so this cannot fail or block on today's data.
- **No new UNIQUE constraints.** The existing composite uniques (`profiles(user_id, type)`, `follows(user_id, entity_id)`, `venue_availability(user_id, available_date)`, `venue_enquiries(venue_user_id, applicant_user_id, date_requested)`) are untouched — none of the new columns participate in them.
- **Indexes** (recommended, not strictly required for M1): a plain btree index on each new `*_profile_id` column. Cheap to create on an all-NULL column, and removes a decision from M2's plate later. Optional to defer to M2 if you'd rather M1 be schema-only with zero indexing decisions.

### 1.5 Confirmation: every change is additive

Every item above is one of: `ADD COLUMN` (nullable, or with a default proven safe for all existing rows), `ADD CONSTRAINT FOREIGN KEY` (against all-NULL columns), or `CREATE INDEX`. Nothing in this list is a `DROP`, `RENAME`, `ALTER COLUMN TYPE`, or a `NOT NULL` added without a safe default. No existing column, constraint, or index is modified or removed.

---

## 2. Compatibility

### 2.1 Why M1 cannot break the running application

Every new column is either nullable or defaults to a value proven correct for all current rows. Postgres does not require existing rows to populate a newly-added nullable column, and no application code anywhere in the codebase references any of these new column names (`claim_status`, `claimed_at`, `claimed_via`, `created_via`, `source`, `onboarding_seen_at`, `target_profile_id`, `artist_profile_id`, `venue_profile_id`, `applicant_profile_id`, `profile_id`) — confirmed by the fact that these are new names, not renames of anything currently in use.

### 2.2 Which existing queries continue to work unchanged

All of them. Every `select('*')` call across the codebase returns a JS object; unused extra keys are inert — nothing destructures or iterates these objects in a way that would break on additional fields. Every `insert(...)`/`update(...)` call explicitly lists its own fields and will continue doing exactly that, never touching the new columns. This is the same reasoning already proven correct three times this session (Fix 2, Fix 3, and the notifications `data` column addition) — additive schema changes don't require code changes to stay safe.

### 2.3 Verified: zero profiles have a NULL user_id

```sql
SELECT count(*) AS null_user_id_profiles FROM profiles WHERE user_id IS NULL;
```
Result (2026-07-11): **0**.

Every existing `profiles` row genuinely represents an owned account. `claim_status DEFAULT 'claimed'` is confirmed safe for 100% of existing rows — not an assumption, a verified fact.

### 2.4 Which future code will begin consuming the new schema

None, in M1 itself. M2 (dual-write) is the first phase that writes to these columns — every write path that currently populates a `user_id`-style field starts *also* populating the matching `*_profile_id` column, using the "resolve-my-profile" pattern the frozen plan already describes. M3 (backfill) populates historical rows and promotes `placeholder_profiles` into this same table, preserving UUIDs. Nothing reads these columns for real decisions until M5 (read cutover).

---

## 3. Exit Criteria

### 3.1 How M1's completion was verified

A fresh `information_schema.columns` query against `profiles`, `follows`, `lineup_members`, `venue_enquiries`, `venue_availability`, and `events` — the same "pre-flight → apply → verification query" pattern used for every fix in the security sprint and the notifications migration. Result: every column in §1.2–1.3 confirmed present with the exact specified type, nullability, and default — `events.venue_profile_id`, `follows.target_profile_id`, `lineup_members.artist_profile_id`, `venue_availability.profile_id`, `venue_enquiries.venue_profile_id` + `applicant_profile_id`, and all six new `profiles` columns (`claim_status`, `claimed_at`, `claimed_via`, `created_via`, `source`, `onboarding_seen_at`).

### 3.2 Evidence collected before committing

- Verification query result: schema now matches this design exactly (§3.1).
- Live smoke test: reloaded the app, navigated to Artist Dashboard — identical stats, identical following list, no visible change. Navigated to a real profile (`ProfileScreen`) — full render, genre pills, bio, follow button, upcoming gigs, no missing data, no errors. Console showed only pre-existing, already-tracked warnings (the `DiscoverScreen` duplicate-key issue and the pre-existing `EventScreen.jsx`/`EventsSection.jsx`/`ArtistDashboard.jsx` parse errors, all with timestamps predating this migration) — nothing new.
- `null_user_id_profiles` = 0, verified 2026-07-11 (§2.3).

### 3.3 What M2 becomes possible afterward

Dual-write. Every INSERT/UPDATE that currently writes a `user_id`-style relationship column can begin writing the corresponding `*_profile_id` column alongside it, without those writes needing anywhere to land — M1 is precisely what makes that possible.

---

## Not addressed in this document

The `venue_enquiries` schema drift discovered during this investigation (logged separately, `docs/known-issues/venue-enquiries-schema-drift.md`) is unrelated to M1 and not included in any of the above. The new `venue_profile_id`/`applicant_profile_id` columns are added to that table regardless of that unrelated bug, exactly as they would be to a table with no drift — the two are independent.
