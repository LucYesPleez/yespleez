# M3 Migration Plan

**Status:** COMPLETE. Executed 2026-07-11 — see `docs/m3-implementation-2026-07.md` for the final SQL/diff as run and `supabase/migrations/20260711000004_m3_backfill_and_promotion.sql` for verification results. This elaborates the approved design (`docs/m3-design-review-2026-07.md`) into an exact, ordered execution plan, incorporating the one approved amendment: the `ProfileScreen.jsx` compatibility fix from §3.7 is now part of M3 itself, not a deferred follow-up. Two further refinements were approved after this plan and are reflected only in the implementation doc, not retrofitted here: the compatibility fix's sequencing (user_id first, id as a strict fallback only) and the decision to leave the promoted placeholder's source row completely untouched.

Nothing below is final SQL. Statement shapes are shown to make the plan concretely reviewable; the actual migration file is written only after this plan is approved.

---

## 0. Pre-flight (re-run immediately before executing, not relied on from the design review's timestamp)

The design review's row counts and dry-run resolution results are from earlier today. Before running anything, re-confirm they still hold — cheap to check, and this migration should act on current state, not a stale snapshot:

- Row counts for the five relationship tables and `placeholder_profiles` (§1.1/§3.1 of the design review).
- Re-run the resolution dry-run (§4.3) for any rows added since.
- Re-confirm zero UUID collisions between `placeholder_profiles.id` and `profiles.id` (§3.4).

If any number has changed, re-derive the affected step's expected-impact figures before proceeding — the plan's structure doesn't change, only the specific counts.

---

## 1. Step 1 — `ProfileScreen.jsx` compatibility fix

**Exact change, one line:**

```diff
- let q = supabase.from('profiles').select('*').eq('user_id', id);
+ let q = supabase.from('profiles').select('*').or(`user_id.eq.${id},id.eq.${id}`);
```

`v2/src/screens/ProfileScreen.jsx:65`. Every subsequent filter in the chain (`typeFilter`, `preferPerformer`, the plain `neq('type','punter')` default) is unaffected — `.or()` contributes one OR-group that ANDs with the rest of the chain exactly as the single `.eq()` did before.

**Why this is sufficient and nothing else needs to change:**
- A normal claimed profile is still found exactly as before, via `user_id = id` (the `id.eq.${id}` branch essentially never matches for these rows — a profile's own `id` and some other account's `user_id` coinciding is not a realistic collision in a UUID keyspace).
- A promoted-but-unclaimed profile (`user_id IS NULL`, `id` = the preserved placeholder id) is now found via the `id.eq.${id}` branch, since `user_id IS NULL` never matches anything under `.eq()` but doesn't need to — `id.eq.${id}` does the work.
- `isPlaceholder` becomes `false` for a profile found this way (it came back from the `profiles` branch, not the `placeholder_profiles` fallback) — this is accepted as-is, per your instruction that the required fix is resolvability, not preserving the `isPlaceholder`-gated UNCLAIMED badge/CTA/hero-fallback treatment. Those remain keyed on which table answered, not on `claim_status`, so a promoted-but-unclaimed profile will render as if fully claimed (no badge, no claim CTA, no placeholder hero image) once reachable. That visual/UX gap is intentionally **not** touched here — it would require broader changes to the `isPlaceholder`-gated blocks (lines 238/260/296/319/510/512) that go beyond "resolve the profile," and is left for its own separate task if it's ever wanted.
- The two downstream event queries (`events.host_id = id` for venues, `lineup_members.artist_id = id` for performers, lines 76/79/100) are untouched. For a promoted-but-unclaimed profile these correctly return zero events — nobody has created an event or lineup slot under an identity nobody owns yet — so this is accurate present-day behavior, not a gap this fix needs to close.

**Isolation note:** `ProfileScreen.jsx` currently has unrelated uncommitted changes in the working tree (confirmed via `git status` immediately before writing this plan), the same pre-existing condition present throughout M1/M2. This one-line change will be isolated into its own commit via a hand-crafted patch, exactly as done for the three prior M2 edits to this same file — not a `git add` of the whole file.

---

## 2. Step 2 — Placeholder promotion

Runs once, before any of the five backfills (§1.2 of the design review). Two parts against `placeholder_profiles`'s one current eligible row (re-verified at pre-flight, §0):

**2a. Insert the promoted row into `profiles`** (shape only):

```sql
INSERT INTO profiles (
  id, type, name, bio, genre_string, sound, location, state, website,
  instagram, facebook, youtube, soundcloud, mixcloud, tiktok, spotify,
  avatar, source, user_id, claim_status, claimed_at, claimed_via
)
SELECT
  pp.id, pp.type, pp.name, pp.bio, pp.genre_string, pp.sound, pp.location, pp.state, pp.website,
  pp.social_links->>'instagram', pp.social_links->>'facebook', pp.social_links->>'youtube',
  pp.social_links->>'soundcloud', pp.social_links->>'mixcloud', pp.social_links->>'tiktok', pp.social_links->>'spotify',
  pp.avatar_url,
  jsonb_build_object('source', pp.source, 'source_name', pp.source_name, 'source_url', pp.source_url),
  pp.owner_user_id,                                    -- NULL for today's one row
  CASE WHEN pp.owner_user_id IS NULL THEN pp.claim_status ELSE 'claimed' END,
  CASE WHEN pp.owner_user_id IS NOT NULL THEN pp.claimed_at ELSE NULL END,
  CASE WHEN pp.owner_user_id IS NOT NULL THEN pp.claimed_via ELSE NULL END
FROM placeholder_profiles pp
WHERE pp.merged_to IS NULL
  AND pp.is_duplicate = false
  AND pp.blocklisted = false
  AND pp.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = pp.id)              -- UUID collision guard, §3.4
  AND NOT EXISTS (                                                          -- ownership collision guard, §3.3
    SELECT 1 FROM profiles p WHERE pp.owner_user_id IS NOT NULL
      AND p.user_id = pp.owner_user_id AND p.type = pp.type
  );
```

**Expected impact today:** exactly 1 row inserted (the "Test DJ" row), `user_id = NULL`, `claim_status = 'unclaimed'`.

**2b. Mark the source row consumed** (only the row(s) actually promoted in 2a — matched by the same eligibility + collision conditions, restricted to ids that now exist in `profiles`):

```sql
UPDATE placeholder_profiles pp
SET claim_status = 'claimed'
WHERE pp.merged_to IS NULL
  AND pp.is_duplicate = false
  AND pp.blocklisted = false
  AND pp.removed_at IS NULL
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = pp.id);
```

**Idempotency:** re-running 2a on a later pass matches zero rows for anything already promoted (the `NOT EXISTS (... profiles ...)` guard excludes it) — safe to include this same script in a later M3-adjacent run without double-inserting. Re-running 2b likewise only ever (re)sets an already-`'claimed'` row to `'claimed'` again — a no-op.

---

## 3. Steps 3–7 — Backfill, in the documented order

Same shape for all five, differing only in table/columns/type assumption (matching each site's resolution logic from the M2 design review). All are plain `UPDATE ... WHERE new_column IS NULL AND legacy_fk IS NOT NULL`, resolving via a scalar subquery against `profiles` — the SQL-level equivalent of `resolveProfileId(user_id, type)`, unchanged.

### 3. `venue_enquiries` (2 rows expected)

```sql
UPDATE venue_enquiries ve
SET venue_profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = ve.venue_user_id AND p.type = 'venue'),
    applicant_profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = ve.applicant_user_id AND p.type = COALESCE(ve.applicant_type, 'artist'))
WHERE (ve.venue_profile_id IS NULL OR ve.applicant_profile_id IS NULL)
  AND (ve.venue_user_id IS NOT NULL OR ve.applicant_user_id IS NOT NULL);
```

### 4. `follows` (5 rows expected)

```sql
UPDATE follows f
SET target_profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = f.entity_id AND p.type = f.entity_type)
WHERE f.target_profile_id IS NULL
  AND f.entity_type <> 'event';
```

### 5. `events` (24 rows expected to attempt resolution; how many succeed depends on how many hosts are venue-type — 24/24 in today's data, per the dry-run)

```sql
UPDATE events e
SET venue_profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = e.host_id AND p.type = 'venue')
WHERE e.venue_profile_id IS NULL
  AND e.host_id IS NOT NULL;
```

### 6. `venue_availability` (25 rows expected)

```sql
UPDATE venue_availability va
SET profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = va.user_id AND p.type = 'venue')
WHERE va.profile_id IS NULL
  AND va.user_id IS NOT NULL;
```

### 7. `lineup_members` (7 of 28 rows expected — the other 21 have no `artist_id`, correctly excluded by the guard)

```sql
UPDATE lineup_members lm
SET artist_profile_id = (SELECT p.id FROM profiles p WHERE p.user_id = lm.artist_id AND p.type = 'artist')
WHERE lm.artist_profile_id IS NULL
  AND lm.artist_id IS NOT NULL;
```

Each statement is independent (§1.2) — no ordering dependency between steps 3–7 beyond the documented smallest-to-largest sequencing for risk exposure.

---

## 4. Step 8 — Verification

Run immediately after each step, not only at the end — matching the "pre-flight → apply → verification query" discipline used for every fix so far in this migration:

- After Step 2: `SELECT count(*) FROM profiles WHERE id = '<promoted id>'` = 1; source row's `claim_status = 'claimed'`.
- After each of Steps 3–7: row/NULL counts compared against the design review's §4.1 table (exact expected numbers listed there); the legacy-FK-vs-new-column comparison query from §4.2, expected to return zero rows for all five tables.
- After Step 1: manually load the promoted profile's URL (`/#/profile/<promoted id>`) and confirm it renders instead of "Profile not found" — this is the direct, observable proof the compatibility fix works, not just a query result.

---

## 5. Commit plan

Eight isolated commits, mirroring the discipline used for every prior fix/milestone in this migration — each verified before the next begins:

1. `ProfileScreen.jsx` compatibility fix (isolated patch, per §1's isolation note).
2. Promotion migration (2a + 2b, one migration file).
3. `venue_enquiries` backfill.
4. `follows` backfill.
5. `events` backfill.
6. `venue_availability` backfill.
7. `lineup_members` backfill.
8. M3 completion doc — verification evidence appended to `docs/m3-design-review-2026-07.md` (or a new `docs/m3-completion-2026-07.md`, matching whichever pattern reads more consistently with M0/M1/M2's own completion records) plus a memory update.

Steps 3–7 could be combined into a single migration file (they're independent and equally low-risk to deploy together), but committing and verifying them one at a time preserves the ability to stop after any single table if its verification surfaces something unexpected, without having already applied the ones after it.

---

## 6. Rollback (restated concretely against this plan)

- **Step 1 (ProfileScreen):** revert the one-line diff. No data involved.
- **Steps 3–7 (backfill):** `UPDATE <table> SET <new_column> = NULL WHERE <new_column> IS NOT NULL` — safe unconditionally, nothing reads these columns yet.
- **Step 2 (promotion):** `DELETE FROM profiles WHERE id = '<promoted id>'` + revert the source row's `claim_status`, valid only if the promoted row is still untouched (`claim_status` still `'unclaimed'`/`'pending'`, `user_id` still `NULL`, no relationship-table row references it) — checked before attempting. If any of those has changed, rollback requires manual reconciliation instead, per §5.2 of the design review.

---

## Unchanged from the approved design (restated, not modified)

- Promotion runs first, then the five backfills in the documented smallest-to-largest order.
- Every backfill statement is `WHERE new_column IS NULL`-guarded and UPDATE-only.
- `resolveProfileId()` itself is not touched — Steps 3–7 use its SQL-level equivalent, not a call to the JS function.
- No unrelated bugs are fixed in this plan. No placeholder semantics are redesigned beyond what §3 of the design review already specified.
