# M4 Design Review — RLS Migration

**Status:** APPROVED 2026-07-11, with two decisions: (1) the INSERT consistency guard is implemented, framed as an identity-consistency invariant (reject writes where the legacy ownership column and the profile ownership column refer to different identities), not a business rule; (2) F1 was resolved first, as its own app-code change, before M4 — see `docs/known-issues/m2-dual-write-gap-sendenquiry.md`. F2–F5 are excluded from M4, per the approval. Migration SQL generated after the pre-flight in §7 passed: `supabase/migrations/20260711000005_m4_rls_migration.sql`. **APPLIED to production 2026-07-11** after the §4 verification matrix passed (66 tests, PRE→POST diff = 8 expected differences only: policy-count increase + 5 State-3 positives + A6 new-leg INSERT + A11 guard rejection; A6/A11 reviewed post-execution and accepted). Full evidence: `docs/m4-verification-evidence-2026-07.md`. M4 complete.

This document answers the five questions posed for the M4 design review. Every conclusion below was re-derived from the current repository state (2026-07-11, including the uncommitted working tree), the migration history (`supabase/migrations/`), the M0–M3 design documents, and the canonical Architecture Specification v1.0 (§12, fetched fresh from the artifact, not recalled from memory).

---

## 0. Authority, and the current state it was checked against

### 0.1 What the spec says M4 is (verbatim)

Architecture Specification v1.0, §12, Phase 4:

> **RLS migration → M4.** Objective: ownership authorisation flows through `owner_user_id`. **Additive-permissive: new owner-based policies land beside old ones; old ones are removed only at contract.** Risk: the security phase — too-broad leaks, too-narrow silently hides data. Validation: written multi-account matrix including the C2 guarantee (no follower enumeration). Done when: matrix passes on all accounts. **Never combined with any app-code change.**

And from M8 (contract): "remove dual-writes, drop/rename legacy columns, **remove superseded policies**, delete dead code."

Hard separation rule: "RLS: always isolated from app code."

Two consequences that govern everything below:

1. **M4 adds policies. It modifies nothing and removes nothing.** Every removal is M8's job.
2. **M4 contains zero application-code changes.** Anything discovered during this investigation that needs a code change is documented separately (§6) and excluded.

### 0.2 One spec-to-implementation translation

The spec's `owner_user_id` is `profiles.user_id` in the implementation — the approved M1 amendment (M1 design review §1.1) established that `profiles.user_id` already means exactly "which account owns this row" and that no separate `owner_user_id` column would be added. So "ownership authorisation flows through owner_user_id" translates concretely to: **authorisation flows through the chain `relationship row → *_profile_id → profiles.id → profiles.user_id = auth.uid()`.**

### 0.3 Re-derived current policy state

The authoritative policy inventory is M0 §3.1 (fresh `pg_policies` dump, 2026-07-11, post-Fix-2/Fix-3). All five migration files in `supabase/migrations/` were re-read for this review: only `…000000_fix2` and `…000001_fix3` touch policies, and both predate the M0 inventory (M0 §2 confirms it reflects them). M1 and M3 are schema/data only. **Therefore the M0 §3.1 table is the current live policy state, unless something was changed via the dashboard without a migration file.**

**Mandatory pre-flight for implementation (not for this review):** a fresh dump of `pg_policies` capturing `policyname, cmd, roles, permissive, qual, with_check` for all eleven tables, diffed against M0 §3.1. Two things the M0 inventory did not record separately and the pre-flight must: (a) `qual` vs `with_check` (M0 shows one combined column), and (b) **`permissive` vs `restrictive`** — the entire additive-OR strategy below assumes every existing policy is PERMISSIVE (Supabase's default). If any policy is RESTRICTIVE, the coexistence math changes and this design must be revisited before implementation.

---

## 1. RLS Cutover Strategy

### 1.1 The central re-derived conclusion: M4's cutover set is two tables

M4 changes policies only where an existing policy authorises through a **legacy identity column that the migration retires at M8**. Working through every table against that criterion:

| Table | Existing policies authorise via | Is that column retired at M8? | In M4 cutover set? |
|---|---|---|---|
| `profiles` | `user_id` | **No** — `user_id` *is* the permanent ownership column (M1 amendment) | No |
| `follows` | `user_id` (the **follower** side) | **No** — follows belong to accounts; M1 deliberately added no follower-side profile column | No |
| `lineup_members` | `events.host_id` (host manages lineup) | **No** — the attribution split keeps `host_id` as the permanent account-based auth column ("auth stays account-based", spec §12 phase 6) | No |
| `applications` | `artist_id` (account id) + `events.host_id` | Not in the M1 five-table set; no profile column exists; profile-keying of booking is explicitly deferred to the Booking architecture review | No |
| `events` | `host_id` | **No** — permanent per the attribution split; `venue_profile_id` is public attribution, never authorisation | No |
| `artist_availability` | `user_id` | No profile column exists (see §6, F5) | No |
| `band_availability` | `user_id` | No profile column exists (see §6, F5) | No |
| `standup_availability` | `user_id` | No profile column exists (see §6, F5) | No |
| `placeholder_profiles` | n/a (public-read only) | Table is demoted to Studio staging, but `ProfileScreen.jsx` still reads it as a live fallback — removing its policy is an app-behaviour change, forbidden in M4 | No |
| **`venue_enquiries`** | `venue_user_id`, `applicant_user_id` | **Yes** — replaced by `venue_profile_id` / `applicant_profile_id` | **Yes** |
| **`venue_availability`** | `user_id` | **Yes** — replaced by `profile_id` | **Yes** |

This is deliberately narrower than "every table gets profile policies." Most of the app's authorisation is *correctly account-based and stays that way forever* (events management, follow ownership, application ownership, profile ownership itself). Only the two tables whose ownership columns are actually being replaced get parallel profile-based policies.

### 1.2 Every table, every existing policy: unchanged / modified / removed

**Nothing is modified. Nothing is removed. Every one of the 28 existing policies remains byte-identical.** (An earlier draft said 29 — the correct count, confirmed by both the M0 table and the fresh §7 pre-flight dump, is 28.) M4 adds exactly four new policies. Table by table:

#### `profiles` — 3 policies, all unchanged, nothing added
- `enable all for authenticated users` (ALL, `auth.uid() = user_id`) — **unchanged**. This already *is* the owner-based policy the spec's M4 objective names.
- `Anyone can read profiles` (SELECT, `true`) — **unchanged**. Public visibility of all profiles including unclaimed ones is spec behaviour (§2: publicly visible and navigable).
- `enable read for everyone` (SELECT, `true`) — **unchanged**. The overlap with the previous policy is pre-existing (M0 §4.1); duplicate-policy cleanup is contract-phase work (M8), not M4.
- No claim policy is added. `ClaimDialog.jsx` (current working tree) is a manual request flow — mailto/Instagram, zero database writes. The atomic attach (§3 of the spec) is performed by an admin via dashboard/service role, which bypasses RLS. A client-side claim policy would be a new business rule, out of M4 scope.

#### `follows` — 3 policies, all unchanged, nothing added
- `follows_select_own` (SELECT, `auth.uid() = user_id`), `follows_insert_own` (INSERT), `follows_delete_own` (DELETE) — **all unchanged**. All three authorise the *follower* side, which is permanently account-based. `target_profile_id` is relationship data, never an authorisation input. `follows_select_own` is also the enforcement of the spec's C2 guarantee (no follower enumeration) — it is *verified* in M4's matrix (§4.4), not modified. Every `follows` read in the current codebase was checked: all filter `.eq('user_id', session-or-own-id)` — no code path attempts to enumerate followers.

#### `lineup_members` — 4 policies, all unchanged, nothing added
- `Anyone can read lineup_members` (SELECT, `true`), plus host INSERT/UPDATE/DELETE via `EXISTS (events.host_id = auth.uid())` — **all unchanged**. Host authority flows through `events.host_id`, which is permanent. No artist-side write policy is added (artists cannot modify their own lineup rows today; granting that would be a new business rule).

#### `applications` — 6 policies, all unchanged, nothing added
- All six (artist SELECT/INSERT/UPDATE/DELETE via `auth.uid() = artist_id`; host SELECT/UPDATE via `events.host_id`) — **unchanged**. `applications` has no `*_profile_id` column and is outside the M1 five-table set; its identity model is deferred to the Booking architecture review (per the Fix 2/Fix 3 records).

#### `events` — 3 policies, all unchanged, nothing added
- `hosts manage own events` (ALL, `host_id = auth.uid()`) — **unchanged**, permanently: the attribution split (spec §3) locks authorisation to the account. `public read events` / `public read live events` — **unchanged** (overlap is pre-existing, M8 cleanup).

#### `artist_availability`, `band_availability`, `standup_availability` — 4 policies, all unchanged, nothing added
- Own-manage ALL policies (`auth.uid() = user_id`) and `artist_availability`'s public read — **unchanged**. These tables have no profile column to authorise through (M1 did not add one — flagged as F5 in §6; a schema change is forbidden in M4 by both the milestone rules and this review's own constraints).

#### `placeholder_profiles` — 1 policy, unchanged, nothing added
- `Public read active placeholder profiles` — **unchanged**. The spec demotes this table to never-public Studio staging, but `ProfileScreen.jsx` still uses it as a live lookup fallback (line ~105 of the current tree). Removing or narrowing this policy is inseparable from the M5 read-cutover (single-query ProfileScreen) and therefore cannot happen in an isolated-RLS milestone.

#### `venue_enquiries` — 3 policies unchanged, **3 policies added**
Existing, all remain byte-identical:
- `Users can insert own enquiries` (INSERT, `auth.uid() = applicant_user_id`)
- `Venue owner can read their enquiries` (SELECT, `auth.uid() = venue_user_id OR auth.uid() = applicant_user_id`)
- `Venue owner can update status` (UPDATE, `auth.uid() = venue_user_id`)

Added (shapes described in §1.3; names indicative only):
- **INSERT** — "applicant profile owner can insert own enquiries": the inserting account owns the profile named in `applicant_profile_id`.
- **SELECT** — "profile owners can read their enquiries": the account owns the profile named in `venue_profile_id` **or** in `applicant_profile_id`.
- **UPDATE** — "venue profile owner can update status": the account owns the profile named in `venue_profile_id`. Deliberately venue-side only, mirroring the legacy policy exactly — the applicant-side status update the code attempts (§6, F3) is denied today and must remain denied by M4 (fixing it is a business-rule decision, not an identity migration).
- **No DELETE policy exists on either identity system and none is added** — no code path deletes enquiries.

#### `venue_availability` — 1 policy unchanged, **1 policy added**
Existing, remains byte-identical:
- `Users manage own venue availability` (ALL, `auth.uid() = user_id`)

Added:
- **ALL** — "profile owner manages venue availability": the account owns the profile named in `profile_id` (USING and WITH CHECK).
- **No public-read policy is added**, even though the in-flight enquiry feature needs one (§6, F2) — that is a product/feature decision, not identity migration, and bundling it would violate "no new business rules."

### 1.3 The new policy shape, and how the transition works

Every new policy authorises through the same single pattern (shown descriptively — final SQL is written only after this design is approved):

```
EXISTS (
  SELECT 1 FROM profiles p
  WHERE p.id = <table>.<profile_column>
    AND p.user_id = auth.uid()
)
```

**Transition mechanics.** PostgreSQL permissive policies on the same command combine with OR. From M4 until M8, every affected command on the two cutover tables therefore has two live "legs":

- **Legacy leg** — `auth.uid() = <legacy user-id column>` (the existing policies, untouched).
- **Profile leg** — the EXISTS pattern above (the new policies).

A request is authorised if **either** leg passes. Nothing that is granted today can become denied — additive-permissive policies are mathematically incapable of narrowing access. The legacy legs are removed only at M8 (contract), together with the legacy columns they reference, after M5/M6 have cut reads and writes over and the M7 gate has passed.

### 1.4 Exact conditions where both identity systems grant simultaneously

For any given row and requesting account, four states are possible:

| # | Row state | Legacy leg | Profile leg | Who is granted |
|---|---|---|---|---|
| 1 | Legacy column = requester; `*_profile_id` NULL | grants | inert (EXISTS over NULL matches nothing) | Same account as today. **This is every pre-M2 row that failed resolution, every event-follow, and every row from the un-dual-written write site (§6, F1).** |
| 2 | Legacy column = requester; `*_profile_id` → profile owned by the same account | grants | grants | Same account, twice over. **This is every dual-written and every backfilled row — M3 verified zero legacy-vs-profile mismatches, so this is 100% of populated rows today.** |
| 3 | Legacy column = account A; `*_profile_id` → profile owned by account B | grants A | grants B | **Both accounts, each via a different identity system.** Cannot occur in today's data (zero mismatches, zero claim transfers). It arises the first time an admin attaches a promoted profile to a new owner while old rows still carry the previous account's user-id — and it is *intended*: "commercial records belong to profiles" means the new owner must gain access, while the legacy leg keeps the old reads working until M8. This overlap window is the price of additive-permissive, is bounded (ends at M8), and is confined to rows referencing a transferred profile. |
| 4 | `*_profile_id` → **unclaimed** profile (`profiles.user_id IS NULL`) | grants whoever the legacy column names | grants **nobody** (`p.user_id = auth.uid()` can never be true when `p.user_id` is NULL) | Legacy leg only. Unclaimed profiles confer authorisation on no one — exactly the spec's §2 "Editable: No" boundary, falling out of the policy shape with no special-casing. |

**One deliberate deviation from "plain parallel" worth an explicit approval decision — the INSERT/WITH CHECK consistency guard.** For SELECT/UPDATE/DELETE, the profile leg can only widen access to *existing* rows, bounded by the row's stored ownership. INSERT (and UPDATE's WITH CHECK) is different: a plain profile-leg WITH CHECK would allow an authenticated user to **mint a row whose legacy column names someone else** (e.g. insert a `venue_enquiries` row with `applicant_profile_id` = own profile but `applicant_user_id` = another account) — and until M5/M6, the application *reads by the legacy columns*, so the forged legacy value is what every current screen would trust. That is precisely the spec's "too-broad leaks" risk. The recommended shape for the new INSERT/WITH CHECK legs is therefore:

```
<profile-leg EXISTS>  AND  (<legacy column> = auth.uid() OR <legacy column> IS NULL)
```

This is not a new business rule — it enforces the same invariant the legacy policies already enforce ("the identity column you write must be your own"), extended with "or absent" so that M6+ writes that stop populating legacy columns still pass. It never widens and never narrows current behaviour. Consequence for M8: these guarded policies reference legacy columns, so the contract phase must **replace** them (drop the guard) in the same migration that drops the columns — M8's "remove superseded policies" step already covers policy rework, but this makes it obligatory, not optional. If plain additive-permissive (no guard) is preferred for spec literalism, the forged-legacy-column window described above should be explicitly accepted in writing.

---

## 2. Mixed-Mode Behaviour

How authorisation behaves for each row/profile class, on the two cutover tables (all other tables: identical to today by construction, since their policies don't change):

- **Legacy rows without `*_profile_id` populated** — profile legs are inert (state 1, §1.4). Authorisation is exactly the legacy policy, byte-identical to today. This includes all 21 `lineup_members` rows with no `artist_id` (not that lineup policies change), any row whose M2 resolution returned NULL, and rows created by the un-dual-written `sendEnquiry` site (§6, F1).
- **Rows with `*_profile_id` populated** — both legs grant, and (per M3's zero-mismatch verification) they grant the *same account* for every populated row in today's data (state 2). Observable behaviour: unchanged; the profile leg is redundant until ownership diverges.
- **Promoted but unclaimed profiles** — two distinct aspects:
  - *The profile row itself* (`profiles.id = 86c431ff…`, `user_id NULL`, `claim_status 'unclaimed'`): publicly readable via the existing public SELECT policies (spec: publicly navigable); writable by **no client session** — `auth.uid() = user_id` is never true when `user_id` is NULL. Only service-role (admin attach) can touch it. Unchanged by M4, verified by M4's matrix.
  - *Relationship rows referencing it* via `*_profile_id`: the profile leg grants nobody (state 4); the legacy leg governs alone. No such rows exist today (M3 §1.3 confirmed zero references to the promoted placeholder).
- **Claimed profiles** — the owner account passes the profile leg for every row referencing that profile, in addition to whatever the legacy leg already granted. For all current data these are the same account.
- **Newly-created rows after M2/M3** — dual-written, so state 2: both legs agree. **Exception:** rows from `ProfileScreen.jsx`'s new `sendEnquiry()` (uncommitted work, post-dates M2, no dual-write — §6, F1) land in state 1 and behave as pure-legacy rows. They are correct under M4 but violate M2's "zero legacy-only rows" invariant and would need backfilling before M5.
- **Multi-profile owners** — the profile leg checks ownership of the *specific profile the row references*, never a `(user_id, type)` resolution. An account owning five typed profiles passes the profile leg on exactly the rows referencing one of those five profiles — no ambiguity is possible, because the row itself names the profile. This is the same "resolution happened at write time, authorisation just checks ownership" division the M2 design established. The M0-confirmed multi-type account (5 types) and the punter+venue account (Bellingen) are both exercised in the matrix.

**Why existing application behaviour remains unchanged throughout M4:**

1. Permissive policies OR together — adding policies can only ever grant *more*, never less. Every access that succeeds today still succeeds.
2. The only *new* grants the profile legs can produce are to accounts owning a referenced profile whose ownership differs from the legacy column — and M3 verified zero such rows exist. So in today's data the new policies grant precisely nothing that wasn't already granted: observable behaviour is identical.
3. With the §1.4 consistency guard, the new INSERT/WITH CHECK legs cannot admit any write the legacy policies would have rejected under the current (always-dual-writing, legacy-column-populating) application code.
4. M4 ships no application code, so no query, payload, or screen changes. The app cannot observe policy *existence* — only grant/deny outcomes, which are unchanged per (2).

---

## 3. Failure Semantics

For each of the four new policies (and each condition on the two cutover tables):

| Condition | Profile leg | Legacy leg | Net outcome |
|---|---|---|---|
| `*_profile_id` IS NULL | Evaluates false — `EXISTS` over a NULL FK matches no `profiles` row. Not an error, a clean miss. | Evaluates normally | **Falls back to the legacy identity path.** Granted iff the legacy column matches `auth.uid()`. |
| `resolveProfileId()` returned NULL at write time (wrong type, no profile of that type, unpromoted placeholder target, transient error — M2 §3's best-effort semantics) | Same as above: the column is NULL, the leg is inert. | Evaluates normally | **Legacy path.** Identical to a pre-M2 row. |
| A **placeholder** profile is referenced | Cannot occur via `*_profile_id`: the M1 FK constrains these columns to `profiles.id`, unpromoted placeholders don't exist in `profiles`, and M2 explicitly skips the write for placeholder targets (`isPlaceholder ? null : …`). The only "placeholder-descended" rows possible are references to *promoted* rows — next case. | — | Structurally impossible; no policy branch needed. |
| A **promoted-but-unclaimed** profile is referenced (`profiles.user_id IS NULL`) | Grants **nobody**: `p.user_id = auth.uid()` is never satisfied by a NULL `user_id` (SQL NULL comparison semantics — this needs no explicit NULL check in the policy). | Evaluates normally | **Denied via the profile leg; legacy path alone governs.** Unclaimed profiles confer authorisation on no one. |
| A **claimed** profile is referenced | Grants the account for which `p.user_id = auth.uid()` — the current owner, whoever that is at query time. If ownership was transferred by an admin attach, the *new* owner is granted immediately, with no data migration (the spec's "nothing migrates on claim" made literal in RLS). | Grants whoever the legacy column names | **Union of both.** In today's data these are the same account for every row. |
| Requester owns **multiple profile types** | Granted iff one of their profiles is the *specific* profile the row references. Owning other profiles grants nothing extra. | Granted iff the legacy column is their account id | **Union of both** — which, because both systems resolve to "this account," is the same set of rows for all current data. |
| **Anonymous** request | `auth.uid()` is NULL → the EXISTS can never match | `auth.uid() = anything` never true | **Denied** on every command that has only these policies. (Public-read policies on *other* tables are unaffected.) |

No condition produces an error, a NULL-propagation surprise, or a partial state: each leg independently evaluates to true or false, and the ORed result grants or denies. The profile leg's two "silent false" cases (NULL column, unclaimed profile) both degrade to exactly the legacy behaviour — which is the entire design intent of the transition period.

---

## 4. Verification Matrix

The spec's exit criterion: *"written multi-account matrix including the C2 guarantee. Done when: matrix passes on all accounts."*

### 4.1 Fixture

Seven sessions, mapped to the requested roles, plus two special cases:

| Session | Role | Holds |
|---|---|---|
| **H** | Host | account with a `host` profile, owning ≥1 event with lineup + applications |
| **V** | Venue | account with a `venue` profile, owning availability rows + enquiries (venue side) |
| **A** | Artist | account with an `artist` profile, with sent enquiries, applications, a lineup slot, follows |
| **B** | Band | account with a `band` profile |
| **S** | Stand-up | account with a `standup` profile |
| **P** | Punter | account with only a `punter` profile, some follows |
| **X** | Anonymous | no session (anon key only) |
| **M** | Multi-type | the confirmed 5-type account (punter/venue/host/artist/band) — every "own" test re-run to prove per-profile scoping |
| **U** | — | the promoted-unclaimed profile `86c431ff…` (not a session; a target) |

Synthetic rows (created via service role, deleted after): one `venue_availability` and one `venue_enquiries` row in each of states 1, 3, and 4 of §1.4 — these are the only way to positively prove the new legs *do something*, since all organic rows are state 2 where the legs are indistinguishable.

### 4.2 Master acceptance criterion

**For every cell below, the outcome must be identical before and after M4 is applied** — run the full matrix twice, once immediately before and once immediately after, and diff. The *only* permitted differences are on the synthetic state-3 rows (where the profile leg is designed to grant the profile's owner). Any other difference — in either direction — is a hard failure: a new grant is the "too-broad" leak, a new denial is the "too-narrow" data-hiding, both named in the spec's risk line.

### 4.3 Cutover tables — full grid

"0 rows" = RLS-filtered empty result / no-op, the Supabase deny mode for SELECT/UPDATE/DELETE; "42501" = insert rejection.

**`venue_availability`** (legacy leg: `user_id = auth.uid()`; profile leg: owns profile in `profile_id`):

| Actor → operation | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| V on own rows (state 2) | rows visible | granted (self-keyed upsert) | granted | granted |
| V on own synthetic state-1 row (`profile_id` NULL) | visible (legacy leg) | — | granted (legacy leg) | granted (legacy leg) |
| V on synthetic state-3 row (`user_id` = dummy, `profile_id` = V's venue profile) | **visible via profile leg only** — the positive proof M4 works | — | **granted via profile leg** | granted |
| V on synthetic state-4 row (`profile_id` = U) where `user_id` = dummy | 0 rows (both legs fail) | — | 0 rows | 0 rows |
| H, A, B, S, P on V's rows | 0 rows | 42501 (naming V's `user_id` or V's profile fails both WITH CHECK legs) | 0 rows | 0 rows |
| M | exactly M's own rows (via either leg), nothing of V's | granted self-keyed only | own rows only | own rows only |
| X (anon) | 0 rows | 42501 | 0 rows | 0 rows |

Note: non-owner SELECT returning 0 rows includes the ProfileScreen "CHECK AVAILABILITY" read (§6, F2) — that read is *expected to stay empty* for non-owners after M4. M4 must not make it visible.

**`venue_enquiries`** (legacy legs per command as in §1.2; profile legs added for INSERT/SELECT/UPDATE; no DELETE policy on either system):

| Actor → operation | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| A on enquiries A sent (state 2) | visible (applicant, both legs) | granted (self as applicant) | 0 rows — **applicant-side UPDATE stays denied** (legacy is venue-only; new leg mirrors it; §6 F3 unchanged) | 0 rows |
| V on enquiries to V's venue (state 2) | visible (venue side, both legs) | **42501 for a venue-initiated invite naming A as applicant — stays blocked** (both legs check the *applicant* side; the InviteSheet 42501, §6 F4, is untouched by design) | granted (status update) | 0 rows |
| V on synthetic state-3 row (`venue_user_id` = dummy, `venue_profile_id` = V's profile) | **visible via profile leg only** | — | **granted via profile leg** | 0 rows |
| Any actor on synthetic state-4 row (`venue_profile_id` = U) | only whoever the legacy columns name | — | only legacy `venue_user_id` account | 0 rows |
| H, B, S, P on A↔V enquiries | 0 rows | 42501 (naming others on both identity columns) | 0 rows | 0 rows |
| A forging INSERT: `applicant_profile_id` = own profile but `applicant_user_id` = another account | — | **42501 — this is the consistency-guard test (§1.4).** Without the guard this would succeed; with it, it must fail. | — | — |
| M | own-side rows across all owned profiles, nothing else | granted self-applicant only | venue-side own only | 0 rows |
| X (anon) | 0 rows | 42501 | 0 rows | 0 rows |

### 4.4 C2 guarantee — follows (explicitly required by the spec's M4 validation line)

Policies unchanged; the matrix must still prove the guarantee holds under the post-M4 policy set:

| Test | Expected |
|---|---|
| Each of H, V, A, B, S, P: SELECT own follows (`user_id = self`) | own rows, complete |
| Each session: SELECT follows filtered by `entity_id`/`target_profile_id` of a profile they don't own ("who follows X?") | **0 rows, always** |
| Same via aggregate (`count: exact, head: true`) | **count 0** — counts respect RLS; no aggregate leak |
| Owner of a followed profile trying to read followers of *their own* profile | 0 rows (C2: never shown as identities, enforced at data layer) |
| INSERT `user_id` = another account | 42501 |
| DELETE another account's follow | 0 rows |
| X (anon): any operation | 0 rows / 42501 |

### 4.5 Regression set — the nine unchanged tables

For these, role identity mostly doesn't alter the policy math (policies key on ownership relations, not profile type), so the grid is by relationship; run it under each of H/V/A/B/S/P/M to satisfy "passes on all accounts":

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | everyone incl. anon sees all rows, **including U** (unclaimed rows are public) | authenticated, self-keyed (`user_id = auth.uid()`) only; anon 42501 | own rows only; **U: 0 rows for every session** (nobody can edit unclaimed) | own rows only; U: 0 rows for everyone |
| `follows` | §4.4 | §4.4 | no UPDATE policy → 0 rows for everyone | §4.4 |
| `lineup_members` | everyone (public) | event's host only; others 42501 | event's host only; **A on own lineup row: 0 rows** (unchanged) | event's host only |
| `applications` | artist own + host of the event; others 0 rows | artist self only | artist own + host of event | artist own |
| `venue_enquiries` | §4.3 | §4.3 | §4.3 | §4.3 |
| `venue_availability` | §4.3 | §4.3 | §4.3 | §4.3 |
| `artist_availability` | everyone (public read exists) | owner self only | owner only | owner only |
| `band_availability` | **owner only — no public read** (pre-existing asymmetry, M0 §4.1; unchanged) | owner self only | owner only | owner only |
| `standup_availability` | owner only (same asymmetry) | owner self only | owner only | owner only |
| `events` | everyone | host self only | host own only | host own only |
| `placeholder_profiles` | everyone sees eligible rows (`unclaimed/pending`, not duplicate/blocklisted/removed) — incl. the promoted source row, which remains eligible by the M3 leave-untouched decision | 0 rows / 42501 for every client session (no write policies; Studio writes via service role) | same | same |

Every cell above must be **identical before and after** M4 — this set exists to prove M4 touched nothing it shouldn't.

---

## 5. Rollback Strategy

**What M4 consists of:** one SQL migration that executes `CREATE POLICY` four times. No `ALTER`, no `DROP`, no schema change, no data change, no application code.

- **Do legacy policies remain during transition?** Yes — all 28 existing policies remain untouched throughout M4 and stay in force until M8 (contract). This is the spec's additive-permissive mandate, not an implementation choice.
- **Is rollback SQL-only?** Yes: `DROP POLICY` × 4. Nothing else exists to undo.
- **Does any migrated data need reverting?** No. M4 reads and writes zero rows. There is no backfill, no promotion, no column value anywhere that changes.
- **The precise point at which rollback stops being trivial:**
  1. **Today through M5 (and in practice through M7):** rollback is trivial *and behaviour-neutral*. Dual-writes keep populating legacy columns and legacy policies keep granting, so every access that works with the new policies also works without them. Dropping the four policies restores the exact pre-M4 state with zero observable effect.
  2. **First real ownership divergence (earliest possible loss of neutrality):** the first time an admin attaches a promoted profile to an owner while older relationship rows still carry a different (or dummy) legacy identity — a state-3 row (§1.4) in production. From that moment, the new owner's access to those rows flows *only* through the profile legs; dropping the policies revokes a real user's working access. Still SQL-only and instant, but no longer invisible — it becomes a user-facing regression. No such row exists today and none can be created until claims are actually processed, so this point is entirely under operational control.
  3. **M8 (contract) — the hard floor:** once legacy policies and legacy columns are dropped, the M4 policies are the *only* authorisation on these tables. "Rolling back M4" after M8 would remove all access to `venue_enquiries`/`venue_availability` — it stops being a rollback and becomes an outage. Reverting past M8 is a restore-from-backup event, which is exactly why the spec requires M8 to be preceded by its own fresh verified backup.

One sequencing note the guard decision adds: if the §1.4 consistency-guard variant is approved, the M8 contract migration must drop-and-recreate those policies (guard removed) in the same change that drops the legacy columns — a policy referencing a dropped column would otherwise error. This belongs in M8's plan; it changes nothing about M4's own rollback.

---

## 6. Additional issues found during this investigation — documented separately, all excluded from M4

None of these are fixed, worked around, or silently absorbed by M4. Each is recorded here and in `docs/known-issues/` where noted.

- **F1 — New `venue_enquiries` write site without dual-write (M2 invariant breach).** `ProfileScreen.jsx` `sendEnquiry()` (uncommitted working tree, added after M2 closed) inserts `venue_enquiries` with legacy columns only — no `venue_profile_id`/`applicant_profile_id`. It is applicant-initiated (`applicant_user_id = self`), so unlike InviteSheet it *passes* the legacy INSERT policy and will produce real legacy-only rows, violating M2's exit criterion ("organic use produces zero legacy-only rows") and eroding M3's parity. Needs an app-code fix (M2-pattern dual-write) plus a one-off re-run of the M3 `venue_enquiries` backfill statement before M5. It is app code, therefore constitutionally excluded from M4. Logged: `docs/known-issues/m2-dual-write-gap-sendenquiry.md`.
- **F2 — `venue_availability` has no public-read policy, but the in-flight enquiry feature reads it publicly.** ProfileScreen's "CHECK AVAILABILITY" (uncommitted) queries `venue_availability` for the viewed venue as *any* signed-in viewer; under the current (and post-M4) policy set that returns 0 rows for every non-owner, so the calendar will always look empty and the feature can't work. Whether venue availability becomes publicly readable (like `artist_availability` already is) is a product decision — deliberately not smuggled into M4. Logged: `docs/known-issues/enquiry-feature-rls-gaps.md`.
- **F3 — Applicant-side enquiry status updates are silently denied.** `ArtistDashboard.jsx` `handleOfferRespond()` updates `venue_enquiries.status` as the applicant; the only UPDATE policy is venue-side, so this is 0-rows-affected with no error checked — the same silent-failure family as the four previously logged drift bugs. M4's new UPDATE policy deliberately mirrors venue-only semantics so this stays *unchanged*, not accidentally legalised. Logged in the same known-issues doc as F2.
- **F4 — The undiagnosed InviteSheet `42501` is now diagnosed (from the repo alone).** The known-issue doc records the RLS rejection's condition as unknown; the M0 §3.1 inventory already contains the answer: the INSERT policy requires `auth.uid() = applicant_user_id`, and InviteSheet's venue-initiated payload sets `applicant_user_id` to the *artist*. Venue-initiated invites have therefore never been insertable. Whether venues should be able to create enquiries naming an applicant is a business-rule decision (likely the Booking/enquiries rework); M4 keeps both identity systems equally strict. Diagnosis appended to `docs/known-issues/venue-enquiries-schema-drift.md`.
- **F5 — M1 gap vs. spec: `artist/band/standup_availability` never received `profile_id` columns.** Spec §12 phase 1 says "nullable profile_id columns beside **every** user-keyed relationship column"; the approved M1 design added them to five tables but not these three, without recording why. Nothing blocks M4 (no column → no policy to add), but M6 ("availability operate on profile ids") and M8 cannot complete for these tables without a small additive M1-style amendment + M3-style backfill first. Flagged for a decision when M6 is planned — or an explicit decision that per-type availability tables stay account-keyed (which would itself be a spec amendment).
- **F6 — Pre-existing policy overlaps and asymmetries, untouched:** duplicate public SELECT policies on `profiles` and `events`, and the availability public-read asymmetry (M0 §4.1). Cleanup is M8-contract work ("remove superseded policies"); M4 adds nothing to and removes nothing from this pile. The promoted placeholder's source row also remains publicly readable via `placeholder_profiles`'s policy (consequence of M3's approved leave-untouched refinement) — harmless today because ProfileScreen finds the promoted `profiles` row first; resolved naturally when the table is demoted at/after M5.

---

## Explicitly out of scope for this document (per the stated requirements)

- No migration SQL, no policy names finalised, no implementation — design review only.
- No schema changes (F5 is flagged, not acted on).
- `resolveProfileId()` untouched and unreferenced by M4 (RLS never calls application code; the profile legs are pure SQL over `profiles`).
- No identity-model redesign: the four new policies are the spec's own §12-phase-4 instruction applied to the only two tables the re-derivation shows are in scope.
- No new business rules: every currently-denied operation stays denied (F2, F3, F4 remain exactly as broken as they are today); the only approval-worthy judgment call is the INSERT consistency guard (§1.4), which *preserves* an existing invariant rather than adding one.
- No unrelated bug fixes: F1–F4 are documented, not fixed.

## Open items requiring your decision before implementation

All resolved at approval (2026-07-11):

1. **INSERT/WITH CHECK consistency guard** — APPROVED, framed as an identity-consistency invariant: reject writes where the legacy ownership column and the profile ownership column refer to different identities. Implemented on both WITH CHECKs (the venue_availability ALL policy and the venue_enquiries INSERT policy, both column pairs). Deliberately not applied to the UPDATE policy, where post-claim-transfer divergence is legitimate.
2. **Two-table cutover scope** — APPROVED as re-derived.
3. **F1 sequencing** — APPROVED and done first: dual-write fix applied to `ProfileScreen.jsx` before this migration's SQL was generated; residual check found zero legacy-only rows (§7).

---

## 7. Pre-flight verification record (2026-07-11, performed before generating the SQL)

Run live via the Supabase dashboard SQL editor (project `doqzxvppibuzieajqkxm`, main/production), immediately before writing `20260711000005_m4_rls_migration.sql`:

**Fresh `pg_policies` dump** — `tablename, policyname, permissive, roles, cmd, qual, with_check` across all eleven tables:

- **28 policies. Exact match to the M0 §3.1 baseline + Fix 2/Fix 3.** No dashboard drift since M0. Per-table counts: applications 6, artist_availability 2, band_availability 1, events 3, follows 3, lineup_members 4, placeholder_profiles 1, profiles 3, standup_availability 1, venue_availability 1, venue_enquiries 3.
- **Every policy is PERMISSIVE** — the additive-OR strategy's load-bearing assumption is now confirmed, not assumed.
- Roles detail M0 didn't record: `profiles` "enable all for authenticated users" is `TO authenticated`; "enable read for everyone" is `TO anon, authenticated`; the other 26 policies are `{public}`.
- `with_check` detail M0 didn't record: `venue_availability`'s ALL policy has `with_check = NULL` (USING doubles as the check, per Postgres semantics); `band_availability`/`standup_availability`/`profiles` ALL policies carry explicit matching WITH CHECKs; the applications interim UPDATE policy has its explicit WITH CHECK as recorded in the Fix 2 migration.
- Cutover-set quals verbatim, confirming the design's assumptions exactly: `venue_availability` ALL `(auth.uid() = user_id)`; `venue_enquiries` INSERT WITH CHECK `(auth.uid() = applicant_user_id)`, SELECT `((auth.uid() = venue_user_id) OR (auth.uid() = applicant_user_id))`, UPDATE `(auth.uid() = venue_user_id)`.

**F1 residual check:** `venue_enquiries` holds 2 rows (the M3-backfilled pair); **0 rows** have a NULL `venue_profile_id` or `applicant_profile_id`. The pre-fix `sendEnquiry` path never produced legacy-only rows in the live table; no backfill re-run required.

Two operational observations from the dashboard session, unrelated to M4: Supabase was showing a platform-wide "investigating a technical issue" banner, and the organisation shows an **outstanding invoices** warning ("pay your invoices to avoid service disruption") — flagged to the owner.
