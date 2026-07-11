# M3 Implementation — SQL and Verification Plan

**Status:** COMPLETE. Executed and verified 2026-07-11. The `ProfileScreen.jsx` diff below was applied (commit `a717738`, bundled with previously-uncommitted unclaimed-profile UI work it turned out to be inseparable from — see that commit message). The migration SQL ran with no errors; full verification results are in the trailing comment block of `supabase/migrations/20260711000004_m3_backfill_and_promotion.sql`. Both approved refinements are reflected exactly as executed, not just as planned.

---

## Refinement 1 — ProfileScreen compatibility fix, exact diff

`v2/src/screens/ProfileScreen.jsx`, replacing lines 61–71 (query setup through the owned-profile lookup):

```diff
   const { data, isLoading: loading } = useQuery({
     queryKey: ['profile', id, typeFilter],
     queryFn: async () => {
-      // 1. Try owned profiles first
-      let q = supabase.from('profiles').select('*').eq('user_id', id);
-      const preferPerformer = searchParams.get('prefer') === 'performer';
-      if (typeFilter) q = q.eq('type', typeFilter);
-      else if (preferPerformer) q = q.neq('type', 'punter').not('type', 'in', '("host","venue")');
-      else q = q.neq('type', 'punter');
-      const pRes = await q.limit(1);
-      const ownedProfile = pRes.data?.[0] || null;
+      const preferPerformer = searchParams.get('prefer') === 'performer';
+      const applyTypeFilter = (query) => {
+        if (typeFilter) return query.eq('type', typeFilter);
+        if (preferPerformer) return query.neq('type', 'punter').not('type', 'in', '("host","venue")');
+        return query.neq('type', 'punter');
+      };
+
+      // 1. Try owned profiles first, by account — unchanged behaviour
+      let pRes = await applyTypeFilter(supabase.from('profiles').select('*').eq('user_id', id)).limit(1);
+      let ownedProfile = pRes.data?.[0] || null;
+
+      // 1b. Only if step 1 found nothing: fall back to matching by the
+      //     profile's own id. Covers a promoted-but-unclaimed profile
+      //     (M3), which has no user_id to match on in step 1.
+      if (!ownedProfile) {
+        pRes = await applyTypeFilter(supabase.from('profiles').select('*').eq('id', id)).limit(1);
+        ownedProfile = pRes.data?.[0] || null;
+      }
```

Everything from `if (ownedProfile) { ... }` onward (lines 73–107) is unchanged.

**Why this satisfies "preserve current lookup semantics":** step 1 is byte-identical to the current query — same filter, same order, same result for every profile that's reachable today. Step 1b only runs `if (!ownedProfile)`, i.e. strictly as a fallback when step 1 finds nothing, so it can never change the outcome for an already-working lookup. The `applyTypeFilter` closure is the one small structural change (extracted so the two sequential attempts can't silently drift out of sync with each other) — it doesn't change what filtering happens, only avoids writing the same three-line if/else twice. If literal duplication is preferred instead of the shared closure, that's a trivial substitution — flagging the choice rather than deciding it unilaterally.

**Isolation:** `ProfileScreen.jsx` still has unrelated uncommitted changes in the working tree (confirmed in the migration plan). This diff will be applied via a hand-crafted patch isolating only these lines, same as the three prior M2 edits to this file.

---

## Refinement 2 — placeholder lifecycle state, resolved by reading the actual spec

Fetched the canonical architecture spec artifact directly (not relying on the memory summary) to answer this precisely rather than guess. Relevant, verbatim:

> §2: "`claim_status` is <span>unclaimed</span>" ... §3 schema card: `claim_status` — `unclaimed · claim_pending · claimed · locked`
> §11 Locked decisions: "`placeholder_profiles` becomes importer staging only (Studio-owned) and is never a public identity."
> §15 S1: "Staging (`placeholder_profiles`, demoted) is never publicly navigable; nothing outside staging references a staging row."
> §15 S2: "Promotion into `profiles` creates ownerless rows with stable UUIDs..."
> §15 Sequencing: "The one-time promotion of *existing* placeholder rows is app-side migration work inside M3 — not a Studio deliverable."

**None of the four defined `claim_status` values (`unclaimed`, `claim_pending`, `claimed`, `locked`) means "consumed by a one-time promotion migration, still no owner."** `claimed` would misrepresent it (no human claimed it) — exactly what you flagged. The other three don't fit either: `claim_pending`/`locked` imply an active claim process or a dispute, neither of which applies. The spec's own position on `placeholder_profiles` post-promotion is that it becomes pure Studio-owned staging whose internal bookkeeping isn't part of this app spec at all — it defines the *promoted* row's state (`profiles.claim_status = 'unclaimed'`) precisely, but has nothing to say about marking the *source* staging row, because that's not this migration's concern to invent.

**Conclusion:** the source `placeholder_profiles` row is left **completely untouched** by this migration — no `UPDATE` targets it at all. "Already promoted" is determined solely by the row's `id` now also existing in `profiles`, which is exactly the condition the promotion `INSERT`'s guard already checks (`NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = placeholder_profiles.id)`) — no separate signal is needed, and none is invented. This is reflected in the migration file's header comment and Step 1 (no corresponding Step "1b" UPDATE, unlike the earlier plan draft).

**Minor, separate observation, not acted on:** the spec's schema card names the value `claim_pending`, while the live `ProfileScreen.jsx` query and observed data use `pending`. This is a small naming drift between the spec and the implementation (similar in kind to the already-flagged `owner_user_id` → `user_id` amendment), noted here for completeness — not touched by this migration, since it isn't part of what this milestone needs to resolve.

---

## Migration SQL

Full text: `supabase/migrations/20260711000004_m3_backfill_and_promotion.sql`. Six steps, in the approved order (promotion, then the five backfills smallest-to-largest): promotion INSERT, `venue_enquiries`, `follows`, `events`, `venue_availability`, `lineup_members`. Not executed.

---

## Verification plan — exact queries, expected results

Run each block immediately after its corresponding step, before proceeding to the next (per the migration plan's commit sequencing).

### After Step 1 (promotion)

```sql
SELECT count(*) FROM public.profiles WHERE id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae';
-- expect: 1

SELECT user_id, claim_status FROM public.profiles WHERE id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae';
-- expect: user_id = NULL, claim_status = 'unclaimed'

SELECT claim_status FROM public.placeholder_profiles WHERE id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae';
-- expect: 'unclaimed' — unchanged, confirming the source row was not touched
```

Then, after the ProfileScreen fix is deployed: load `/#/profile/86c431ff-dd25-4851-b94b-73e91e7dd0ae` and confirm the page renders (not "Profile not found") — the direct, observable proof of reachability.

### After Step 2 (`venue_enquiries`)

```sql
SELECT count(*) FROM public.venue_enquiries WHERE venue_profile_id IS NOT NULL AND applicant_profile_id IS NOT NULL;
-- before: 0 · expect after: 2

SELECT ve.id, ve.venue_user_id, ve.venue_profile_id, p.user_id AS resolved_user_id, p.type
FROM public.venue_enquiries ve JOIN public.profiles p ON p.id = ve.venue_profile_id
WHERE p.user_id IS DISTINCT FROM ve.venue_user_id OR p.type <> 'venue';
-- expect: 0 rows (repeat the same shape for applicant_profile_id / applicant_user_id / applicant_type)
```

### After Step 3 (`follows`)

```sql
SELECT count(*) FILTER (WHERE target_profile_id IS NULL) AS still_null,
       count(*) FILTER (WHERE target_profile_id IS NOT NULL) AS resolved
FROM public.follows WHERE entity_type <> 'event';
-- before: still_null=5, resolved=0 · expect after: still_null=0, resolved=5

SELECT f.id, f.entity_id, f.entity_type, p.user_id, p.type
FROM public.follows f JOIN public.profiles p ON p.id = f.target_profile_id
WHERE p.user_id IS DISTINCT FROM f.entity_id OR p.type <> f.entity_type;
-- expect: 0 rows
```

### After Step 4 (`events`)

```sql
SELECT count(*) FILTER (WHERE venue_profile_id IS NULL) AS still_null,
       count(*) FILTER (WHERE venue_profile_id IS NOT NULL) AS resolved
FROM public.events;
-- before: still_null=24, resolved=0 · expect after (today's data): still_null=0, resolved=24
-- (acceptance is "matches a fresh resolution dry-run," not "zero nulls" — will differ once real, diverse hosts exist)

SELECT e.id, e.host_id, p.user_id, p.type
FROM public.events e JOIN public.profiles p ON p.id = e.venue_profile_id
WHERE p.user_id IS DISTINCT FROM e.host_id OR p.type <> 'venue';
-- expect: 0 rows
```

### After Step 5 (`venue_availability`)

```sql
SELECT count(*) FILTER (WHERE profile_id IS NULL) AS still_null,
       count(*) FILTER (WHERE profile_id IS NOT NULL) AS resolved
FROM public.venue_availability;
-- before: still_null=25, resolved=0 · expect after: still_null=0, resolved=25

SELECT va.id, va.user_id, p.user_id AS resolved_user_id, p.type
FROM public.venue_availability va JOIN public.profiles p ON p.id = va.profile_id
WHERE p.user_id IS DISTINCT FROM va.user_id OR p.type <> 'venue';
-- expect: 0 rows
```

### After Step 6 (`lineup_members`)

```sql
SELECT count(*) FILTER (WHERE artist_profile_id IS NULL) AS still_null,
       count(*) FILTER (WHERE artist_profile_id IS NOT NULL) AS resolved
FROM public.lineup_members;
-- before: still_null=28, resolved=0 · expect after: still_null=21 (no artist_id, correctly excluded), resolved=7

SELECT lm.id, lm.artist_id, p.user_id, p.type
FROM public.lineup_members lm JOIN public.profiles p ON p.id = lm.artist_profile_id
WHERE p.user_id IS DISTINCT FROM lm.artist_id OR p.type <> 'artist';
-- expect: 0 rows
```

### Acceptance criteria, overall

- Every "0 rows" comparison query above returns exactly zero — any row returned is a hard failure requiring investigation before proceeding to the next step, not a warning.
- Row counts on every table are unchanged (this migration never inserts or deletes relationship-table rows, only updates one nullable column) — except `profiles`, which gains exactly the number of rows promoted in Step 1 (1, in today's data).
- `placeholder_profiles`'s row count and every column on its one existing row are unchanged after Step 1 (confirms the "leave the source row untouched" decision was actually implemented as designed).

---

## Done

Migration executed with no errors. Verified: promotion produced exactly the 1 expected row with the source `placeholder_profiles` row confirmed untouched; all five backfill tables match their pre-computed expected row/NULL counts exactly; a legacy-FK-vs-new-column comparison across every resolved row in every table returned zero mismatches; the promoted profile is confirmed reachable live at its URL post-fix, rendering correctly (without the UNCLAIMED badge, the accepted consequence documented in the design review, not a defect). Full detail in the migration file's trailing comment block. M3 is complete — see [[project-security-sprint-2026-07]] (identity migration progress log) for the milestone record and next steps (M4, RLS migration).
