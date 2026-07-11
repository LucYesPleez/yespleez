# M3 Design Review — Backfill and Placeholder Promotion

**Status:** COMPLETE. Approved with two refinements (see `docs/m3-migration-plan-2026-07.md` and `docs/m3-implementation-2026-07.md`), executed and verified 2026-07-11. This document answers the five questions posed before implementation began. Every number below is a live read against the database as it stood before execution — see `docs/m3-implementation-2026-07.md` for post-execution verification.

M3 has two independent operations sharing one migration: **backfill** (populate `*_profile_id` on existing rows in the five M1/M2 tables) and **promotion** (copy eligible `placeholder_profiles` rows into `profiles`, preserving their UUID). They're treated separately below because their risk profiles differ, but §1's ordering covers both.

---

## 1. Backfill Ordering

### 1.1 Every table that will be backfilled

| Table | Column | Total rows | Rows needing backfill (legacy FK set, new column NULL) |
|---|---|---|---|
| `venue_enquiries` | `venue_profile_id`, `applicant_profile_id` | 2 | 2 |
| `follows` | `target_profile_id` | 5 | 5 (all non-event; 0 event-type rows exist) |
| `events` | `venue_profile_id` | 24 | 24 |
| `venue_availability` | `profile_id` | 25 | 25 |
| `lineup_members` | `artist_profile_id` | 28 | 7 (the other 21 have no `artist_id` — free-text/no-account bookings; correctly out of scope, nothing to resolve) |

Plus, ahead of all five: **placeholder promotion** — `placeholder_profiles` currently has exactly **1** row, eligible (see §3).

### 1.2 Execution order and justification

1. **Placeholder promotion** (1 candidate row) — runs first.
2. **`venue_enquiries`** (2 rows)
3. **`follows`** (5 rows)
4. **`events`** (24 rows)
5. **`venue_availability`** (25 rows)
6. **`lineup_members`** (28 rows)

**Why promotion runs first:** backfill resolves `(user_id, type) → profiles.id` by reading `profiles` as it exists *at the moment the backfill runs*. If a relationship row's legacy FK happens to reference an entity that only exists as a placeholder today, resolving it before promotion would correctly yield `NULL` (not an error — see §2), but resolving it *after* promotion would find the newly-promoted row and succeed. Running promotion first means every backfill pass gets the most complete picture available in a single run, rather than needing a follow-up pass later. (In practice, this doesn't change today's outcome — confirmed in §1.3 that zero live relationship rows currently reference the one placeholder — but it's the correct default order going forward as more placeholders accumulate.)

**Why the five relationship tables are ordered by ascending row count:** they are mutually independent for this operation — none of the five reads or depends on another's `*_profile_id` column, and no FK relationship exists between them for this purpose. Order among them therefore has no correctness consequence, only a risk-sequencing one. Running the smallest table first (`venue_enquiries`, 2 rows) means the entire result set can be manually inspected end-to-end before scaling up to the largest (`lineup_members`, 28 rows) — if the resolution logic ever produced a surprising result, it would surface on a 2-row blast radius before a 28-row one. `venue_enquiries` is doubly low-risk to go first: it's both the smallest table and the one whose read/write flow is already known-broken by a pre-existing, unrelated bug (RLS block — `docs/known-issues/venue-enquiries-schema-drift.md`), so there is no live user-facing feature currently depending on it that a backfill mistake could disrupt further.

**Why this minimizes risk overall:** every one of these six operations (1 promotion + 5 backfills) is independent of every other — none reads a column another writes, except promotion-before-backfill as described above. A problem discovered on table *N* never invalidates work already committed on tables before it, and never blocks proceeding to tables after it once resolved. This is the same "isolated, single-purpose, independently verifiable" pattern used for every fix so far in this migration (each committed and verified standalone).

### 1.3 Confirmed: no live row currently depends on promotion happening first

```
SELECT * FROM follows WHERE entity_id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae';  -- the one placeholder's id
```
Result: 0 rows. No `follows`, `lineup_members`, `venue_enquiries`, `venue_availability`, or `events` row references the one existing placeholder anywhere (`lineup_members`/`venue_enquiries`/`venue_availability`/`events` can't reference a placeholder at all today — none of their write sites ever query `placeholder_profiles`, only `profiles`, per the M2 investigation). So for *today's* data, running promotion first changes nothing observable — it's a forward-looking ordering choice, not a correction of a live gap.

---

## 2. Idempotency

### 2.1 Every backfill operation can be safely re-run

Each backfill is a single scoped update per table, shaped as:

> `UPDATE <table> SET <new_column> = resolved WHERE <new_column> IS NULL AND <legacy_fk> IS NOT NULL`

The `WHERE <new_column> IS NULL` guard is the entire idempotency mechanism: once a row's new column is set (by this backfill, or by M2's dual-write on a newer row, or by a prior partial run of this same backfill), that row no longer matches the `WHERE` clause on any subsequent run. Re-running the exact same statement a second, third, or hundredth time touches zero rows the second time onward — not because of a special re-run flag or checkpoint, but because the guard condition itself becomes false for every row already handled.

### 2.2 An interrupted migration resumes correctly

Because each table's backfill is a single independent statement (not a multi-step saga), "interrupted" only has two possible meanings, both safe:
- **Interrupted mid-statement** (e.g., connection drop while the `UPDATE` for one table is running): Postgres runs the whole statement in one implicit transaction; a drop rolls the entire statement back atomically. Nothing is left half-written for that table. Re-issuing the same statement is a clean, full retry — not a resume-from-partial-state, because there was no partial state to resume from.
- **Interrupted between tables** (e.g., `venue_enquiries` and `follows` completed, then the migration run was stopped before `events`): the two completed tables are simply done — their rows already have `IS NULL` false, so re-running the entire six-step sequence from the top is safe and cheap; steps 1–2 do zero work (nothing left to match), and execution effectively resumes at step 3 on its own, with no explicit "resume point" bookkeeping needed.

### 2.3 Duplicate updates cannot occur

"Duplicate" isn't a meaningful failure mode here because backfill is `UPDATE`, not `INSERT` — there is no row-creation step that could produce two rows for one entity. The worst case of running a backfill statement multiple times is that it evaluates its own resolution logic again for a row and writes the *same* value back to a column already holding that value — a no-op in effect, not a correctness issue. Combined with the `WHERE ... IS NULL` guard (§2.1), even that redundant-write scenario doesn't actually happen: already-populated rows are excluded from the statement before resolution is even attempted.

**Promotion's idempotency is a different mechanism** (INSERT, not UPDATE) — covered in §3.4 below, since it depends on the promotion criteria.

---

## 3. Placeholder Promotion

### 3.1 Current state (investigated fresh, not assumed from M0)

`placeholder_profiles` has exactly **1** row today (a test row, "Test DJ" — `id: 86c431ff-dd25-4851-b94b-73e91e7dd0ae`). Every lifecycle flag on it is at its default/clean state: `claim_status: 'unclaimed'`, `claimed: false`, `owner_user_id: null`, `claimed_by: null`, `merged_to: null`, `duplicate_of: null`, `is_duplicate: false`, `blocklisted: false`, `removed_at: null`. A full census of the table confirms **zero** rows currently have any of the "complex" states (claimed, merged, duplicate, blocklisted, removed) populated:

```
SELECT claim_status, count(*) FROM placeholder_profiles GROUP BY claim_status;      -- unclaimed: 1
SELECT count(*) FROM placeholder_profiles WHERE owner_user_id IS NOT NULL;          -- 0
SELECT count(*) FROM placeholder_profiles WHERE claimed_by IS NOT NULL;             -- 0
SELECT count(*) FROM placeholder_profiles WHERE merged_to IS NOT NULL;              -- 0
SELECT count(*) FROM placeholder_profiles WHERE is_duplicate = true;                -- 0
SELECT count(*) FROM placeholder_profiles WHERE blocklisted = true;                 -- 0
SELECT count(*) FROM placeholder_profiles WHERE removed_at IS NOT NULL;             -- 0
```

**This matters for how to read the rest of this section:** the matching/collision rules below are designed to correctly handle every state the schema allows, but only the "clean unclaimed" path can be verified against real data right now — there is exactly one row, and it takes that path. The other branches (owner already assigned, duplicate, merged, blocklisted) are specified from the schema and the locked architecture decisions, not from an observed example. That's flagged explicitly rather than glossed over.

### 3.2 Exact matching rules — eligibility for promotion

A `placeholder_profiles` row is eligible to be copied into `profiles` if and only if:

```
merged_to IS NULL          -- not a tombstone pointing elsewhere
AND is_duplicate = false   -- not marked as a duplicate of another placeholder
AND blocklisted = false    -- not flagged for removal/abuse
AND removed_at IS NULL     -- not soft-deleted
```

This is deliberately the **same filter `ProfileScreen.jsx`'s existing live query already applies** (`is_duplicate = false`, `claim_status IN ('unclaimed','pending')`) with two additions (`merged_to IS NULL`, `blocklisted = false`) that the app's read query doesn't currently check. Reusing the app's own established "is this a real, displayable placeholder" definition — rather than inventing a separate one for the migration — is the point: promotion eligibility should match what the app already treats as a legitimate placeholder. **Separately noted, not fixed here:** `ProfileScreen.jsx`'s query not checking `blocklisted`/`merged_to` looks like a gap worth closing, but it's a read-query concern, not a migration concern — flagged for its own follow-up, out of scope for M3.

The 1 existing row passes this filter and is the only current candidate.

### 3.3 Ambiguous ownership

"Ambiguous ownership" here means: the placeholder already has `owner_user_id` set (i.e., some future admin-approval step already decided who owns it) *and* that owner already has an existing `profiles` row of the same `type`. Promotion must not silently pick a winner between them. The rule:

- If `owner_user_id IS NULL` → promote as **unclaimed**: new `profiles` row gets `user_id = NULL`, `claim_status` copied from the placeholder's own `claim_status` (`'unclaimed'` or `'pending'`).
- If `owner_user_id IS NOT NULL` → before promoting, check whether `profiles` already has a row with `(user_id = owner_user_id, type = placeholder.type)`.
  - **No existing row:** promote as **claimed** — `user_id = owner_user_id`, `claim_status = 'claimed'`, `claimed_at`/`claimed_via` copied over.
  - **Existing row found:** this is the collision case — see §3.4. Excluded from automatic promotion.

This isn't a new rule invented for M3: it's the direct consequence of the `UNIQUE(user_id, type)` constraint already governing `profiles` (confirmed in M1) applied to a row that's about to be inserted with a non-null `user_id`. No live data currently exercises this branch (§3.1) — it's specified for correctness against the schema, not verified against an example.

### 3.4 Collision handling

Two distinct meanings, both checked:

1. **UUID collision** — does the placeholder's `id` already exist in `profiles`? Checked fresh today: **0** (re-confirmed live, not just carried over from M0's earlier finding of the same). The promotion insert should still guard against this defensively regardless of today's clean state (`WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = placeholder_profiles.id)`), because the `profiles.id` primary key makes this the correct backstop either way — if it were ever violated, the insert fails loudly rather than silently overwriting a real profile.
2. **Ownership collision** — the §3.3 case: a placeholder with an assigned `owner_user_id` whose `(user_id, type)` pair already has a real `profiles` row. This is excluded from automatic promotion entirely, not auto-merged or auto-resolved — consistent with the architecture's locked decision that merging is "rare, admin-only recovery," never automatic. An excluded row is left exactly as it is in `placeholder_profiles` (no partial state, nothing marked), so it's simply reconsidered the next time promotion runs, once a human resolves the conflict.

### 3.5 What is logged for every promoted placeholder

For each row actually promoted, capture: `id`, `type`, `name`, source `claim_status` (before), resulting `profiles.user_id` (null or the assigned owner), and a timestamp. This is captured the same way every prior milestone's evidence has been captured in this migration — a verification-query result recorded in the M3 completion document (mirroring M0's census tables and M1/M2's before/after evidence) — not a new database audit-log table, since introducing one would be new architecture beyond a data migration's scope. If the underlying migration tooling supports a `RETURNING` clause on the promotion insert, that output is exactly what gets captured into the completion doc; if not, an equivalent before/after `SELECT` against `profiles` for the promoted id(s) serves the same purpose.

### 3.6 Confirmed: `resolveProfileId()` is reused unchanged

`resolveProfileId(user_id, type)` is application (JS) code; a database migration can't literally call it, so "reused unchanged" here means: the migration's resolution logic is the exact same query shape, verbatim — a scalar lookup of `profiles.id` filtered by `user_id` and `type`, returning nothing (not an error) on no match. No heuristic matching, no fuzzy name comparison, no new resolution path is introduced anywhere in M3. The file itself, `v2/src/lib/resolveProfileId.js`, is not touched — nothing in M3 requires editing it.

### 3.7 Significant finding: promotion makes a profile briefly unreachable through `ProfileScreen.jsx` as it exists today

This is not a pre-existing bug incidentally discovered — it's a direct, immediate consequence of M3's own promotion step, so it belongs in this design review rather than a separate known-issues doc.

`ProfileScreen.jsx`'s query (lines 61–107) resolves the route's `:id` param two different ways depending on which table answers first:
- **Owned profile:** `profiles.user_id = id` (line 65) — `id` is treated as an *account* id.
- **Placeholder fallback:** `placeholder_profiles.id = id` (line 93) — `id` is treated as the *placeholder's own* id.

A promoted-but-still-unclaimed profile has `profiles.user_id = NULL` and `profiles.id` = the preserved placeholder id. Neither existing branch finds it: the owned-profile query filters on `user_id`, which is `NULL`, not equal to anything passed in; the placeholder-fallback query no longer applies because the row has left `placeholder_profiles`'s eligible set (§3.2 — once promoted, its source row would be marked `claim_status = 'claimed'`, per §3.8, removing it from the fallback query's `IN ('unclaimed','pending')` filter). The profile becomes unreachable via its own URL — not a display glitch, an actual 404 (`profile: null` renders "Profile not found").

This doesn't block M3's *data* migration (which only touches `profiles`, `placeholder_profiles`, and the five relationship tables — never `ProfileScreen.jsx`), but it does mean: **promoting any real placeholder before `ProfileScreen.jsx`'s lookup is updated to also try `profiles.id = id` makes that profile's page briefly unreachable.** Today's impact is theoretical — a grep confirms `ProfileScreen.jsx` is the only file in `v2/src` that references `placeholder_profiles` at all, so nothing in the current app links to a placeholder by its id in the first place, and the one real row (a test row) has no live inbound links. But it will matter the moment any discovery/follow feature links to a placeholder. Recommend: treat the `ProfileScreen.jsx` lookup fix (adding an `id = id` branch, and switching its `isPlaceholder`-gated UI — the UNCLAIMED badge, claim CTA, and hero-image fallback, all currently keyed on which table answered rather than on `profile.claim_status`, lines 238/260/296/319/510/512 — to key on `claim_status` instead) as a small, separate, sequenced companion fix, not part of M3's own commit. Whether to land that fix before or after promotion actually runs is a call for the user, not decided here.

### 3.8 Source-row disposition after promotion

Promotion **copies** the placeholder into `profiles` (preserving its `id`) and then marks the *source* `placeholder_profiles` row as consumed by setting its `claim_status = 'claimed'` — reusing the existing enum value already present on the table, not introducing a new status. The row is not deleted, preserving history, and setting `claim_status = 'claimed'` naturally excludes it from `ProfileScreen.jsx`'s existing placeholder-fallback filter (`IN ('unclaimed','pending')`) and from future promotion runs' eligibility filter (§3.2 doesn't check `claim_status` directly, but a second promotion attempt would find the id already exists in `profiles` and skip it via the §3.4 UUID-collision guard regardless).

### 3.9 Field mapping (for the fields that don't line up 1:1)

Most fields map directly by name (`type`, `name`, `bio`, `genre_string`, `sound`, `location`, `state`, `website`). Two don't:
- `social_links` (one JSONB column on `placeholder_profiles`) → `profiles`'s individual columns (`instagram`, `facebook`, `youtube`, `soundcloud`, `mixcloud`, `tiktok`, `spotify`) — a key-by-key unpack, not a new decision, since each target column's meaning is already unambiguous.
- `avatar_url` → `profiles.avatar` (the base field). `avatar_hero`/`avatar_thumb` are left `NULL`, exactly matching how a never-claimed profile already looks in `profiles` today for any row lacking hero/thumb variants — no special-casing needed.
- `source`, `source_name`, `source_url` (three flat fields) → `profiles.source` (one JSONB column, per M1) — the three values nest into that one JSONB object.
- `claimed` (bool), `claimed_by`, `merged_to`, `duplicate_of`, `is_duplicate`, `blocklisted`, `removed_at`, `removal_reason` have no counterpart in `profiles` and are **not** carried forward — they're placeholder-lifecycle-only concepts. Their history stays on the source row (§3.8), which remains queryable for audit purposes even though the app no longer surfaces it.

---

## 4. Verification

### 4.1 Row counts and NULL counts, before (today) and expected after

| Table | Total rows | New column NULL (before) | Expected NULL (after) | Acceptance criterion |
|---|---|---|---|---|
| `venue_enquiries` | 2 | 2 (both columns) | 0 | Both `venue_profile_id` and `applicant_profile_id` non-null for all 2 rows — confirmed resolvable today (dry-run, §4.3). |
| `follows` | 5 | 5 | 0 | All 5 resolve — confirmed resolvable today (dry-run, §4.3), including the one row with `entity_type='venue'` on an account that also owns a `punter` profile (the case M0 flagged as ambiguous — resolves cleanly because `entity_type` already disambiguates it). |
| `events` | 24 | 24 | 0 in current data (all 24 belong to one venue-owning account) | Not a permanent guarantee — once real, diverse hosts exist, most will legitimately resolve to `NULL` (non-venue hosts, per M0's 72/120 finding on the pre-M1 dataset). Acceptance is "every row's outcome matches a fresh `resolveProfileId`-equivalent dry-run," not "zero NULLs forever." |
| `venue_availability` | 25 | 25 | 0 (single venue account owns all 25 rows today) | Same caveat as `events`: acceptance is dry-run match, not zero-NULL-forever. |
| `lineup_members` | 28 | 28 | 21 (the 21 rows with no `artist_id` stay `NULL` — correct, not a gap) | 7 of 28 resolve to non-null; 21 of 28 legitimately stay null. Acceptance: exactly the 7 rows with `artist_id IS NOT NULL` become non-null, the other 21 remain null. |

### 4.2 Comparing legacy FKs against the new columns

For every table, the check is: for each row where the new column is non-null, does it point at the `profiles` row whose `user_id` equals the legacy FK (and whose `type` matches what that write site always assumes — see the M2 design review §2.2 for each table's type-resolution source)? Illustrative form (shown for `lineup_members`; identical shape for the other four):

```sql
SELECT lm.id, lm.artist_id AS legacy_fk, lm.artist_profile_id, p.user_id AS resolved_user_id, p.type AS resolved_type
FROM lineup_members lm
JOIN profiles p ON p.id = lm.artist_profile_id
WHERE lm.artist_profile_id IS NOT NULL
  AND (p.user_id IS DISTINCT FROM lm.artist_id OR p.type <> 'artist');
```
Acceptance: this query returns **zero rows** for all five tables — meaning every non-null `*_profile_id` genuinely points back to the same `user_id` the legacy FK already names, under the same type assumption each write site uses. Any row returned here is a hard failure, not a warning.

### 4.3 Dry-run performed today (read-only, no writes) — results

Ran the exact resolution `resolveProfileId` would perform, live, for every row currently needing backfill:

- `venue_enquiries`: 2/2 rows — both `venue_profile_id` and `applicant_profile_id` resolve to a real `profiles.id`.
- `follows`: 5/5 rows resolve (4 `artist`-type, 1 `venue`-type — including the previously-flagged Bellingen Brewing Co ambiguous-owner case, which resolves unambiguously because the row's own `entity_type` supplies the type).
- `lineup_members`: 7/7 rows with `artist_id` set resolve.
- `venue_availability`: 25/25 resolve.
- `events`: 24/24 resolve (all currently belong to the one venue-owning test account — expected to look different once real data diversifies, per §4.1).

100% resolution success across all five tables in today's data — a direct result of this dataset still being small and largely single-owner, not a property that will hold at production scale. The acceptance criteria in §4.1–4.2 are written to hold regardless of how many rows resolve to `NULL` once real, diverse data exists.

### 4.4 Placeholder promotion verification

Before: `placeholder_profiles` has 1 eligible row (§3.1), `profiles` has 0 rows with that id (collision check, §3.4). After: `profiles` gains exactly 1 row with that id, `user_id = NULL`, `claim_status = 'unclaimed'`; `placeholder_profiles`'s source row now has `claim_status = 'claimed'` (§3.8) and is otherwise untouched. Acceptance: row counts change by exactly +1 on `profiles` and 0 net change on `placeholder_profiles` (update, not delete); the promoted row's fields match the mapping in §3.9 field-for-field.

---

## 5. Rollback

### 5.1 Backfill rollback

Fully reversible with a single statement per table: `UPDATE <table> SET <new_column> = NULL WHERE <new_column> IS NOT NULL` (or, more precisely if only *this run's* rows should be reverted, scoped to the specific ids captured in that run's verification evidence, §4). Nothing else in the system reads these columns yet (confirmed unchanged from M1/M2's finding — no code added since touches them for reads), so setting them back to `NULL` has zero observable effect on the running app. This is a pure data rollback, no manual intervention required, no risk of data loss (the legacy FKs — the actual source of truth — were never modified by backfill in the first place).

### 5.2 Promotion rollback

Reversible **only if nothing has claimed the promoted profile in the meantime**: `DELETE FROM profiles WHERE id = <promoted id>` and revert the source `placeholder_profiles` row's `claim_status` back to its prior value. This is a clean, reversible data rollback as long as the promoted row is still exactly what M3 wrote — verified by checking `profiles.claim_status = 'unclaimed'` (or `'pending'`) and `user_id IS NULL` still hold immediately before rolling back.

**This stops being a clean rollback, and requires manual intervention, the moment any of the following happen after promotion and before rollback is attempted:**
- A real user claims the promoted profile (`user_id` becomes non-null) — deleting it would destroy a real ownership grant, not just undo a migration artifact.
- Any new row in the five relationship tables is created referencing the promoted profile's id via its own `*_profile_id` (e.g., a fresh follow, once `ProfileScreen.jsx`'s reachability gap in §3.7 is fixed and someone follows it) — deleting the profile would leave a dangling reference.
- Any other write happens to the promoted row (edits, avatar changes, etc.).

In any of these cases, rollback is **not a simple delete** — it requires a human decision (reassign, merge, or accept the promotion as permanent) rather than an automated revert, consistent with the architecture's locked stance that anything past "atomic attach" is admin-only recovery, never automatic. This is the same distinction §2 draws for backfill (always mechanically reversible) versus promotion (mechanically reversible only in a narrow, checkable window).

### 5.3 Unexpected matches or data issues discovered mid-migration

Because every operation in M3 is independently scoped per table (§1.2) and idempotent (§2), discovering a problem on any one table does not require rolling back work already done on a different table. The response is: stop before running the next table in the sequence, inspect the specific rows the verification query (§4) flagged, and decide per-row whether to roll back that table's backfill (§5.1) — global rollback of the whole migration is never required to correct a localized problem.

---

## Explicitly out of scope for this document (per the stated requirements)

- No migration SQL or implementation code — this is a design review only.
- No changes to `resolveProfileId()` — confirmed reused unchanged (§3.6).
- No redesign of placeholder semantics — matching/collision rules in §3 are derived from the existing schema and the already-locked architecture decisions, not invented fresh.
- Two issues surfaced during investigation are **not** addressed here, logged separately instead:
  - §3.7's `ProfileScreen.jsx` reachability gap is documented above because it's a direct consequence of M3's own promotion step (not incidental), but the *fix* for it is explicitly deferred to its own separate change, not bundled into M3.
  - No other unrelated bugs were found during this investigation.
