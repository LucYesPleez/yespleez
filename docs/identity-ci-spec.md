# Identity CI specification

**Purpose:** fail the build when Identity Architecture v1.1 is violated.

**Source:** `docs/architecture/identity-v1.1.html` (canonical; `.md` beside it is a reading copy). Every `R`-number below cites it.

**Scope:** enforcement only. This document introduces no architecture and decides nothing. Every check below traces to a numbered rule in v1.1; if a check has no rule, it does not belong here. If a rule cannot be checked, that is stated rather than faked.

**Status:** *specification.* **Nothing here is implemented.** `.github/` contains a pull request template and no workflows; no check described below runs anywhere. This document describes what to build, in the order worth building it.

---

## Reality check before you build this

Three facts shape everything below:

1. **The repo has no pipeline.** Do not specify a mature CI system for a repo with zero workflows. Start with one script runnable locally (`npm run identity:check`), wire it to a pre-push hook, and promote it to a workflow later. A check that never runs enforces nothing.
2. **The codebase already violates C1.** `20260711000005_m4_rls_migration.sql` contains **7 inline `auth.uid()` checks** in policy bodies, and `20260711000000_fix2_applications_update_rls.sql` contains **2**. A naive check fails the build on day one, gets marked `continue-on-error`, and dies. That is why C1 ships with a **debt ledger** (below) rather than a green field.
3. **The migrations do not create the schema.** There is not one `CREATE TABLE` in `supabase/migrations/` — the tables were created in the Supabase dashboard, and the migrations only `ALTER` them. Anything in Tier 2 that assumes "run the migrations and inspect the result" does not work until a baseline schema dump exists. See the Tier 2 prerequisite.

---

## The registry

Most checks need to know which tables are **profile-actionable**. This cannot be inferred — it is a product judgment. It lives in one file, `identity-registry.json`, and is the single input to C2/C3/C5.

```jsonc
{
  // table -> the pair, under that table's names (v1.1 accepts existing names)
  "profile_actionable": {
    // v1.1 §A3 marks this "✓ already". No such table or column exists in this repo. UNVERIFIED — see note.
    "booking_interest": { "profile": "from_profile_id",      "user": "from_user_id" },
    "venue_enquiries":  { "profile": "applicant_profile_id", "user": "applicant_user_id" },
    "lineup_members":   { "profile": "artist_profile_id",    "user": "artist_id" },
    "events":           { "profile": "venue_profile_id",     "user": "host_id" },

    // Missing the pair today. M6 adds it. Listed so C2 fails loudly when M6 lands wrong.
    "applications":     { "profile": "from_profile_id", "user": "artist_id", "pending": "M6" },
    "follows":          { "profile": "from_profile_id", "user": "user_id",   "pending": "M6" },
    "messages":         { "profile": "from_profile_id", "user": "author_user_id", "pending": "M8" }
  },

  // Account-level. A user column only, never a profile. Claiming happens AS A PERSON.
  "account_actionable": ["claims", "sessions", "account_settings", "billing"]
}
```

> **Note — the pair is a concept, not a literal column name.** v1.1 marks `venue_enquiries`, `lineup_members` and `events` as already compliant, and they use table-specific names. Renaming shipped columns is churn with no benefit. Checks assert the *declared* pair per table. **New tables must use the canonical `from_profile_id` / `from_user_id`** (enforced by C5).

> **Unverified — `booking_interest`.** v1.1 §A3 lists it as profile-actionable and **already carrying the pair**, and v1.0 §06 specifies it. **This repository contains no trace of it**: no table (migrations create none — see Tier 2), no `from_profile_id` / `from_user_id` column anywhere, and no reference in `v2/` source. Either it exists in the dashboard schema and is not yet wired to the app, or it was specified and never built. **This cannot be settled from the repository** — it needs a look at the live schema. Until then C2 would fail on this entry, which is the honest outcome: v1.1's "✓ already" is unconfirmed, not confirmed.

---

## Tier 1 — static checks (cheap, reliable, no database)

### C1 — No inline ownership checks · *R3*
**Rule:** `owner_user_id = auth.uid()` (or equivalent) must never appear inline in a policy. Ownership routes through `can_act_as()`.

**Check:** scan `supabase/migrations/**/*.sql` for `auth.uid()` outside the body of `can_act_as` itself. Any hit not in the ledger fails.

**Strip SQL comments before scanning.** These migrations are heavily commented and discuss `auth.uid()` in prose far more often than they call it. Of 24 textual occurrences across the migration directory, **only 9 are policy code** — a scan that does not strip `--` comments reports 15 false positives and flags two files that contain no violation at all (`20260711000001_fix3_applications_insert_rls.sql`, which is a pure `DROP POLICY`, and `20260711000003_m1_schema_expansion.sql`, which only describes existing RLS). There are no block comments in this directory today, so stripping `--` to end-of-line is sufficient; that is an observation about the current files, not a licence to ignore `/* */` if it appears.

> **These counts diverge from v1.1 deliberately.** v1.1 §A10 states M4 contains "13 inline `auth.uid()` checks". That figure counts comments; the executable count is 7. v1.1 is frozen and stands as ratified — the divergence is recorded in `docs/architecture/errata.md` (E1), not hidden. A CI check scans code, so it must use the executable count or it fails on prose.

**The debt ledger.** M4 shipped 7 inline checks, and Fix 2 shipped 2, *before* this rule existed. They are additive-permissive and provisional, so they are grandfathered — explicitly, by name:

```jsonc
// identity-debt.json — this list may only ever SHRINK.
{
  "legacy_inline_auth_uid": [
    "20260711000000_fix2_applications_update_rls.sql",  // 2 — lines 50-51
    "20260711000005_m4_rls_migration.sql"               // 7 — p.user_id = auth.uid()
  ],
  "must_be_empty_by": "M8 (contract)"
}
```

Two properties make this a ledger rather than an excuse:
- **Append is forbidden.** CI fails if a file is *added* to the list. New debt cannot be created.
- **M8 requires it empty.** Contract drops M4's legacy policies. `legacy_inline_auth_uid == []` is a hard exit criterion for M8, checked by C1 itself.

### C4 — The seam's signature is frozen · *R3.1*
**Check:** exactly one definition of `can_act_as` exists, with signature `can_act_as(uuid)`. A changed name, arity or parameter type fails. The **body** may change freely — that is the entire point.

### C6 — Personal is never publicly discoverable · *§A9*
**Rule:** the `type='punter'` exclusion belongs in one resolver, not copy-pasted.

**Check:** `.neq('type', 'punter')` (and equivalents) may appear in **`v2/src/lib/profileResolution.js` only**. Any other occurrence fails.

> Today the filter appears in **six** files — five of them outside the resolver:
>
> ```
> v2/src/lib/profileResolution.js        ← the only legitimate home
> v2/src/components/FillSlotModal.jsx
> v2/src/screens/EventScreen.jsx
> v2/src/screens/IndustryScreen.jsx
> v2/src/screens/ProfileEditScreen.jsx
> v2/src/screens/ProfileScreen.jsx
> ```
>
> **C6 fails until the filter is centralised**, and that is correct: "Personal is never publicly discoverable" is a *security-adjacent invariant currently held together by five copy-pastes*. It holds only while every author remembers. Five is not a convention — it is five chances to forget. Centralise, then turn C6 on.

---

## Tier 2 — schema checks (needs the schema reconstructable outside Supabase)

Assert against `information_schema` / `pg_policies` in an ephemeral database.

> **Prerequisite — this tier cannot run today, and the blocker is not effort.**
> `supabase/migrations/` contains no `CREATE TABLE`: 9 `ALTER TABLE`, 6 `CREATE INDEX`, 5 `CREATE POLICY`, 2 `DROP POLICY`, and nothing that creates a relation. The schema was built in the Supabase dashboard. Replaying these migrations into an empty Postgres fails on the first `ALTER`.
>
> Policies are affected the same way. `fix3` drops `"Anyone can apply"` and its comments describe a surviving `"artists can apply"` policy that **no migration creates** — so `pg_policies` in a replayed database would not match production even if the tables existed.
>
> Tier 2 therefore needs a checked-in baseline schema dump (`pg_dump --schema-only` of production, applied before the migrations) as its first build step. Until that exists, C2/C3/C5 are unimplementable, and the registry above is asserted against the dashboard schema **by hand**. Committing to a dump is a real decision with an owner — it makes the dashboard's state a tracked artifact — and it is out of scope for this document.

### C2 — Profile-actionable tables carry the pair · *R1*
For each registry entry without a `pending` marker: both declared columns exist. Missing either fails.
Entries marked `pending` are **skipped, and reported** — so the gap is visible without failing the build before its milestone.

### C3 — Attribution is authorized · *R3.2*
For each registry table that has its pair: every `INSERT` / `UPDATE` policy's `WITH CHECK` must reference `can_act_as(<profile column>)`.

**This is the highest-value check in the document.** Without it a client posts `from_profile_id = <a venue it does not own>` and the enquiry appears to come from that venue. Forgeable attribution is a signed lie; absent attribution is merely a gap. C2 without C3 produces *confidently wrong* data.

### C5 — New tables must be classified · *R1 + scope boundary*
Any table present in the database but in **neither** registry list fails the build.

This is the anti-drift check and the reason the registry exists. It cannot be answered by a machine — a human must decide whether the new table is profile-actionable — so CI's job is to **refuse to proceed until someone decides.** Silence is the failure mode being prevented.

Additionally: a table newly added to `profile_actionable` whose profile column is **not** named `from_profile_id` fails unless it carries an explicit `"legacy_name": true`. Existing tables are grandfathered; new ones use the canonical names.

---

## Tier 3 — cannot be automated

Stated honestly so nobody assumes CI has it covered. These are **PR review items**:

| Invariant | Why a machine can't judge it |
|---|---|
| **The active profile is never used for authorization** *(R2)* | Requires understanding whether a given check is a security boundary or a UI affordance. A grep cannot tell `if (canActAs(p))` gating a button from the same call gating an API. |
| **The sender is semantically correct** *(R1)* | `from_profile_id` being *populated* is checkable; it being the *right* profile is not. |
| **Attribution is stamped at write time, not compose time** *(R6.1)* | A dataflow property. Detectable by review, not by pattern. |
| **The badge aggregates while the feed scopes** *(R5)* | A product behaviour. Guard with a test, not a lint. |

---

## Build order

Ordered by value-per-hour, not by tier number:

1. **C1 + the ledger** — cheapest, and it stops the bleeding. Pure text scan, no database.
2. **C5** — the anti-drift check. Worthless later, invaluable now: it makes every future table a deliberate decision. Also gated on the baseline dump — it needs to enumerate real tables.
3. **C3** — highest security value. Gated on the Tier 2 baseline dump, which is the real cost, not the Postgres. Must exist **before M6 ships**, because M6 is when attribution first becomes forgeable — so the dump decision has to be made before M6, not during it.
4. **C2** — mostly informational until M6 lands the pair.
5. **C6** — turn on after centralising the resolver, not before.
6. **C4** — trivial; add it whenever `can_act_as` first exists (M6).

**Exit criterion for M8 (contract):** `identity-debt.json` is empty and C1–C6 all pass with no skips.
