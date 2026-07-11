# M4 Verification Evidence — RLS Migration

**Status:** COMPLETE — verification matrix passed, migration applied to production, accepted. Executed 2026-07-11 against the live database (project `doqzxvppibuzieajqkxm`, `main`/production) via the Supabase dashboard SQL editor.

This document records the before/after verification of `supabase/migrations/20260711000005_m4_rls_migration.sql`, per the M4 design review (`docs/m4-design-review-2026-07.md` §4) and the approved rollout order: PRE matrix → apply → POST matrix → diff → accept.

Platform-health prerequisite was checked first: the only active Supabase incident was the capacity/provisioning incident (project creation/resize/restart), which the status page states does not affect running database instances; all data-plane components (Database, API Gateway, Auth) showed Operational. Cleared to run production RLS changes.

---

## 1. Result

**The verification matrix completed successfully.** 66 tests, run identically before and after the migration. Every test matched its phase-specific expected value (0 unexpected failures in PRE, 0 in POST). Exactly **8 cells differed PRE→POST**, all confined to the two cutover tables plus the policy-count meta check; the remaining **58 cells were byte-identical**, including the entire C2 follower-enumeration guarantee (Section C) and the entire regression set across the nine tables M4 does not touch (Section D).

Post-migration policy inventory confirmed: `venue_availability` and `venue_enquiries` now carry **8 policies** (4 legacy, unchanged + byte-identical; 4 new profile-based), each legacy policy sitting beside its new twin, none replaced.

---

## 2. The eight observed PRE→POST differences

| Cell | Actor / Op | PRE | POST | Classification |
|---|---|---|---|---|
| Z1 | (meta) | 4 | 8 | **Expected policy-count increase** — the 4 new policies. Not a behaviour cell. |
| A9 | Venue / SELECT | 0 | 1 | **State-3 positive** — new owner sees a transferred `venue_availability` row via the profile leg. |
| A12 | Venue / DELETE | rows:0 | rows:1 | **State-3 positive** — new owner can delete a transferred row (the ALL policy's delete facet). |
| A11b | Venue / UPDATE | rows:0 | rows:1 | **State-3 positive** — new owner updates a transferred row, repairing legacy `user_id` to NULL. |
| B9a | Venue / SELECT | 0 | 1 | **State-3 positive** — new owner sees a transferred `venue_enquiries` row via the profile leg. |
| B9b | Venue / UPDATE | rows:0 | rows:1 | **State-3 positive** — new owner performs a venue-side status update on a transferred enquiry. |
| **A6** | Multi / INSERT | denied:42501 | rows:1 | **Expected new-leg INSERT capability** — inserting `venue_availability` with `user_id = NULL` (profile_id only) is now permitted by the additive profile policy's "or absent" WITH CHECK clause. |
| **A11** | Venue / UPDATE | rows:0 | denied:42501 | **Expected consistency-guard rejection** — an in-place update of a State-3 row that would leave legacy `user_id` pointing at the old owner is rejected by the guard's WITH CHECK. |

The five State-3 positives (A9, A12, A11b, B9a, B9b) are the exact intended effect of M4: ownership authorisation now flows through `owner_user_id`/`profiles.user_id` in addition to the legacy columns, so a profile's current owner gains access to the rows referencing that profile.

---

## 3. Post-execution review and acceptance of A6 and A11

A6 and A11 are the two differences that are **not** State-3 authorisation positives. They were reviewed after execution and **accepted**, on the following grounds:

- **Both were explicitly designed in the design review §1.4.** A6 is the "or absent" clause of the INSERT/WITH CHECK consistency guard (permitting M6-era writes that populate only the profile column). A11 is the consistency guard itself — the identity-consistency invariant approved as decision 1 — rejecting a write that would leave the legacy and profile ownership columns naming different identities.
- **Neither changes current application behaviour.** No current code path produces either shape: the application always writes `user_id` on `venue_availability` (never NULL, so A6's path is never taken), and there are zero State-3 rows in production (no claim transfers have occurred, so A11 is unreachable by real traffic). For all live application requests, PRE and POST outcomes are identical.
- **Neither creates a data exposure.** A6 permits a user to insert their *own* availability against a profile they own — no third-party data is read or written. A11 *denies* a write.
- **A11 is a stricter authorization outcome than before**, not a looser one: a formerly-silent 0-row no-op becomes an explicit `42501` rejection. Nothing is written in either the PRE or POST case; the change is no-op → error, never permit.
- **Both affect only synthetic verification cases, not current production traffic.** They were observed solely on the suite's synthetic state-1/3/4 probe rows (dated 2090–2091, created and deleted within the run), which exist to positively exercise the new policy legs precisely because organic data cannot.

The guard's *denial* behaviour was additionally confirmed on two further cells that did **not** change (they were already denied pre-M4 and remain denied): A7 (`venue_availability` insert whose legacy `user_id` names a different account than the profile) and B6 (`venue_enquiries` insert forging `applicant_user_id`) — both `denied:42501` in both phases.

---

## 4. Confirmations of no regression (selected, all byte-identical PRE=POST)

- **C2 follower-enumeration guarantee** (spec's explicit M4 validation requirement): "who follows X" by `entity_id` (C2a) and by `target_profile_id` (C2b) both return **0** in both phases; own-follows list complete (C1: 5); anonymous and cross-user reads 0; forged-follower insert denied. The guarantee holds under the post-M4 policy set.
- **Unclaimed profile U** (`86c431ff…`): publicly readable (counted in D1's 25) but writable by no client session — A/M update attempts return 0 rows in both phases (D2a, D2b); and as an enquiry target it grants authorisation to nobody (B10a/B10b = 0), legacy leg alone governing (B10c = 1).
- **Nine untouched tables** (Section D): profiles, applications, events, lineup_members, artist/band/standup_availability, placeholder_profiles — every cell identical PRE=POST (public-read counts, owner-only writes, host-only lineup/event management, the band/standup no-public-read asymmetry, placeholder client-write denial).
- **Legacy path intact on the cutover tables**: state-1 rows still visible to their legacy owner (A14a=1) and invisible to others (A14b=0); organic rows unchanged (A1=25, B1=2); anonymous denied throughout.

---

## 5. Full matrix (66 tests, PRE → POST)

Format: `test_id · actor · op — description — PRE → POST`. Actors: M=multi-type account (artist/band/host/punter/venue), V=venue-owning (Bellingen), A/A2=artists, DL=artist (lineup fixture), P/P2=punters, anon=unauthenticated. "rows:N" = write rows affected (all writes run inside a rolled-back subtransaction — no probe persisted); bare N = SELECT visible-row count; "denied:42501" = RLS insert/privilege rejection. Changed cells marked ►.

```
Z1  · postgres · meta   — policy count on cutover tables ................... 4 → 8            ►
A1  · M    · SELECT — own organic availability ............................. 25 → 25
A2  · A    · SELECT — someone else's availability .......................... 0 → 0
A3  · anon · SELECT — availability, anonymous .............................. 0 → 0
A4  · P    · SELECT — availability, punter ................................. 0 → 0
A5  · M    · INSERT — self-keyed dual-written row .......................... rows:1 → rows:1
A6  · M    · INSERT — new-leg-only (user_id NULL), M6-style write .......... denied:42501 → rows:1   ►
A7  · M    · INSERT — guard: legacy names Miller, profile is M's ........... denied:42501 → denied:42501
A8  · A    · INSERT — legacy latitude: own user_id, M's profile_id ......... rows:1 → rows:1
A9  · V    · SELECT — state-3 row via profile leg .......................... 0 → 1           ►
A10 · P    · SELECT — state-3 row via legacy leg (Miller) .................. 1 → 1
A11 · V    · UPDATE — state-3 in-place update, user_id not repaired (guard) rows:0 → denied:42501   ►
A11b· V    · UPDATE — state-3 update repairing user_id to NULL ............. rows:0 → rows:1  ►
A12 · V    · DELETE — state-3 delete via profile leg ....................... rows:0 → rows:1  ►
A13 · anon · INSERT — anonymous insert ..................................... denied:42501 → denied:42501
A14a· V    · SELECT — state-1 row (own legacy, no profile id) .............. 1 → 1
A14b· M    · SELECT — state-1 row, non-owner ............................... 0 → 0
B1  · M    · SELECT — own organic enquiries (both sides M) ................. 2 → 2
B2a · V    · SELECT — organic enquiries, uninvolved venue .................. 0 → 0
B2b · anon · SELECT — enquiries, anonymous ................................. 0 → 0
B3  · M    · UPDATE — venue-side status update, own enquiry ................ rows:1 → rows:1
B4  · A    · UPDATE — status update by uninvolved artist ................... rows:0 → rows:0
B5  · A    · INSERT — artist self-enquiry to V, fully dual-written ......... rows:1 → rows:1
B6  · A    · INSERT — guard: forged applicant_user_id (Miller) + own prof .. denied:42501 → denied:42501
B7  · A    · INSERT — legacy latitude: own user_id, M's band applicant prof rows:1 → rows:1
B8  · V    · INSERT — venue-initiated invite (InviteSheet shape) blocked ... denied:42501 → denied:42501
B9a · V    · SELECT — state-3 enquiry via profile leg ...................... 0 → 1           ►
B9b · V    · UPDATE — state-3 status update via profile leg (no guard) ..... rows:0 → rows:1  ►
B9c · P    · SELECT — state-3 enquiry via legacy venue side (Miller) ....... 1 → 1
B9d · P2   · SELECT — state-3 enquiry via legacy applicant side (Jamie) .... 1 → 1
B10a· V    · SELECT — state-4 (unclaimed profile) grants V nothing ......... 0 → 0
B10b· M    · SELECT — state-4 grants M nothing ............................. 0 → 0
B10c· P    · SELECT — state-4 via legacy leg only (Miller) ................. 1 → 1
B11 · anon · INSERT — anonymous insert ..................................... denied:42501 → denied:42501
B12a· M    · DELETE — no DELETE policy either system (organic row) ......... rows:0 → rows:0
B12b· V    · DELETE — no DELETE policy either system (state-3 row) ......... rows:0 → rows:0
C1  · M    · SELECT — own follows, complete ................................ 5 → 5
C2a · V    · SELECT — "who follows me?" by entity_id — must be zero ........ 0 → 0
C2b · V    · SELECT — "who follows me?" by target_profile_id — must be zero  0 → 0
C3  · A    · SELECT — another user's follow rows ........................... 0 → 0
C4  · anon · SELECT — follows, anonymous ................................... 0 → 0
C5  · A    · INSERT — forged follower (user_id = M) ........................ denied:42501 → denied:42501
C6  · A    · DELETE — another user's follow ................................ rows:0 → rows:0
D1  · anon · SELECT — profiles public read (incl. unclaimed U) ............. 25 → 25
D2a · A    · UPDATE — unclaimed profile U not writable ..................... rows:0 → rows:0
D2b · M    · UPDATE — unclaimed profile U not writable (multi-type owner) .. rows:0 → rows:0
D3a · A    · SELECT — own profile visible .................................. 1 → 1
D3b · A    · UPDATE — own profile writable ................................. rows:1 → rows:1
D4  · P    · SELECT — applications invisible to punter ..................... 0 → 0
D5  · A2   · SELECT — artist sees own applications ......................... 1 → 1
D6  · M    · SELECT — host sees applications for own event ................. 8 → 8
D7a · A2   · UPDATE — artist updates own application (interim policy) ...... rows:1 → rows:1
D7b · A2   · UPDATE — artist cannot update another artist's application .... rows:0 → rows:0
D8a · anon · SELECT — events public read ................................... 24 → 24
D8b · A    · UPDATE — non-host cannot update event ......................... rows:0 → rows:0
D9a · anon · SELECT — lineup_members public read ........................... 28 → 28
D9b · DL   · UPDATE — artist cannot update own lineup row (host-only) ...... rows:0 → rows:0
D9c · M    · UPDATE — host updates lineup row on own event ................. rows:1 → rows:1
D10a· anon · SELECT — artist_availability public read ...................... 4 → 4
D10b· P    · UPDATE — punter cannot touch artist availability .............. rows:0 → rows:0
D10c· A    · UPDATE — artist manages own artist availability (0 own rows) .. rows:0 → rows:0
D11a· anon · SELECT — band_availability has no public read ................. 0 → 0
D11b· M    · SELECT — band owner sees own band availability (0 own rows) ... 0 → 0
D11c· anon · SELECT — standup_availability has no public read .............. 0 → 0
D12a· anon · SELECT — placeholder_profiles eligible-rows public read ....... 1 → 1
D12b· A    · UPDATE — placeholder_profiles not client-writable ............. rows:0 → rows:0
```

Notes: D10c and D11b return 0 because the artist/band fixtures happen to hold no availability rows — consistent PRE=POST, not a regression. No standup-typed profile exists in production; standup cells are structurally identical to band (no per-type policy in the cutover set) and represented by the band cells plus the standup_availability no-public-read probe (D11c).

---

## 6. Method (reproducibility)

The suite (`docs/m4-verification-suite-2026-07.sql`) runs as a single SQL-editor request. It simulates each session in-process by setting the JWT-claim GUCs `auth.uid()` reads (verified against the live `auth.uid()` definition) and `SET LOCAL ROLE authenticated/anon`; write probes execute inside a plpgsql subtransaction that is force-rolled-back after capturing the affected-row count, so no probe write ever persists. Synthetic state-1/3/4 rows are created as `postgres` at the start and deleted at the end. Every data-volume-dependent expectation is computed live as a policy-replica count under `postgres`, making the suite deterministic against whatever the data is on run day. Temp objects are `ON COMMIT DROP`. The dashboard SQL-linter warned about "destructive operations / tables without RLS" on both runs (the session-local TEMP tables and synthetic-row DELETEs); "Run without RLS" is correct — the temp tables are `pg_temp`, not public.

Fixtures were discovered live the same day (see §7 of the design review for the account map). To re-run: replace `__PHASE__` with `PRE` or `POST` and diff the two result sets.

---

## 7. Rollback (unused — recorded for completeness)

M4 remains reversible by SQL alone: `DROP POLICY` on the four new policies (verbatim block in the migration file's trailing comment). No data was written by the migration or by verification. Rollback is behaviour-neutral for current traffic until the first real ownership divergence (a claim transfer producing a live State-3 row); the hard floor is M8, when the legacy policies and columns are dropped and these four become the sole authorisation. Not exercised — the migration was accepted.
